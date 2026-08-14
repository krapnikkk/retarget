import { Euler, Quaternion } from "three";
import { BVH_HUMANOID_PROFILE } from "@/profiles";
import type { HumanoidBoneName, MotionTrack } from "@/retarget";
import {
  createImportedHumanoidMotionClip,
  normalizeImportedTracks,
  resolveProfileBoneName,
} from "./humanoid-motion";
import {
  DEFAULT_PARSE_BUDGET,
  ParseDomainError,
  assertCountWithinBudget,
  assertInputWithinBudget,
} from "./parse-budget";
import { DEFAULT_MAX_PARENT_DEPTH } from "@/core/parent-graph";

type BVHChannel = {
  nodeName: string;
  bone: HumanoidBoneName | null;
  channels: string[];
  offset: number;
};

type BVHRestNode = {
  nodeName: string;
  bone: HumanoidBoneName | null;
  worldOffset: [number, number, number];
};

const ROTATION_VALUE_SIZE = 4;
const TRANSLATION_VALUE_SIZE = 3;

export function importBVH(bytes: Uint8Array, filename = "motion.bvh") {
  assertInputWithinBudget(bytes.byteLength, DEFAULT_PARSE_BUDGET, {
    filename,
    section: "BVH",
  });
  const text = new TextDecoder().decode(bytes);
  const parsed = parseBVH(text, filename);
  const tracks = normalizeImportedTracks(createBVHTracks(parsed));

  if (tracks.length === 0) {
    throw new Error("BVH file does not contain supported humanoid tracks.");
  }

  return createImportedHumanoidMotionClip({
    kind: "bvh",
    filename,
    profile: BVH_HUMANOID_PROFILE,
    tracks,
    duration: parsed.frameTime * Math.max(parsed.frames.length - 1, 1),
    fps: Math.round(1 / parsed.frameTime),
    restHipsHeight: parsed.restHipsHeight,
    rootName: parsed.rootName,
    rootMotionEvidence: {
      status: parsed.restHipsHeight ? "preserved" : "unresolved",
      scaleSource: parsed.restHipsHeight ? "bvh-hierarchy" : "unknown",
      sourceRestHipsHeight: parsed.restHipsHeight,
      coordinateTransform:
        "+Y-up/+Z-forward BVH profile normalized to canonical +Y-up/-Z-forward",
    },
  });
}

function parseBVH(text: string, filename: string) {
  const motionIndex = text.search(/\bMOTION\b/i);
  if (motionIndex < 0) {
    throw new Error("BVH file is missing MOTION section.");
  }

  const hierarchy = text.slice(0, motionIndex);
  const motion = text.slice(motionIndex);
  const { channels, restNodes } = parseHierarchy(hierarchy, filename);
  const restHipsHeight = estimateRestHipsHeight(restNodes);
  const rootName = channels[0]?.nodeName ?? "BVH root";
  const framesMatch = motion.match(/Frames:\s*(\d+)/i);
  const frameTimeMatch = motion.match(/Frame\s+Time:\s*([0-9.eE+-]+)/i);
  if (!framesMatch || !frameTimeMatch) {
    throw new Error("BVH motion section is missing frame metadata.");
  }

  const frameCount = Number(framesMatch[1]);
  const frameTime = Number(frameTimeMatch[1]);
  assertCountWithinBudget(
    frameCount,
    DEFAULT_PARSE_BUDGET.maxSamplesPerTrack,
    "BVH frame count",
    { filename, section: "MOTION" },
  );
  if (frameCount === 0) {
    throw new ParseDomainError(
      "BVH_PARSE_FAILED",
      "BVH motion must contain at least one frame",
      { filename, section: "MOTION" },
    );
  }
  if (!Number.isFinite(frameTime) || frameTime <= 0) {
    throw new ParseDomainError("BVH_INVALID_FRAME_TIME", "BVH frame time is invalid", {
      filename,
      section: "MOTION",
    });
  }
  const fps = 1 / frameTime;
  if (fps > DEFAULT_PARSE_BUDGET.maxFps + 1e-6) {
    throw new ParseDomainError("PARSE_BUDGET_EXCEEDED", "BVH FPS exceeds the processing limit", {
      filename,
      section: "MOTION",
      declared: Math.round(fps),
      limit: DEFAULT_PARSE_BUDGET.maxFps,
    });
  }
  const duration = frameTime * Math.max(frameCount - 1, 0);
  if (duration > DEFAULT_PARSE_BUDGET.maxDurationSeconds) {
    throw new ParseDomainError(
      "PARSE_BUDGET_EXCEEDED",
      "BVH duration exceeds the processing limit",
      {
        filename,
        section: "MOTION",
        declared: Math.ceil(duration),
        limit: DEFAULT_PARSE_BUDGET.maxDurationSeconds,
      },
    );
  }
  const frameText = motion.slice(
    motion.indexOf(frameTimeMatch[0]) + frameTimeMatch[0].length,
  );
  const channelCount = channels.reduce(
    (sum, channel) => sum + channel.channels.length,
    0,
  );
  if (channelCount === 0) {
    throw new ParseDomainError("BVH_MISSING_CHANNELS", "BVH hierarchy has no channels", {
      filename,
      section: "HIERARCHY",
    });
  }
  const expectedValueCount = frameCount * channelCount;
  assertCountWithinBudget(
    expectedValueCount,
    DEFAULT_PARSE_BUDGET.maxTotalSamples,
    "BVH channel values",
    { filename, section: "MOTION" },
  );
  const tokens = frameText.trim() ? frameText.trim().split(/\s+/) : [];
  if (tokens.length !== expectedValueCount) {
    throw new ParseDomainError(
      "BVH_FRAME_SIZE_MISMATCH",
      "BVH motion value count does not match frames x channels",
      {
        filename,
        section: "MOTION",
        declared: tokens.length,
        limit: expectedValueCount,
      },
    );
  }
  const values = tokens.map((token, valueIndex) => {
    const value = Number(token);
    if (!Number.isFinite(value)) {
      const frame = Math.floor(valueIndex / channelCount);
      const channelIndex = valueIndex % channelCount;
      throw new ParseDomainError(
        "BVH_INVALID_CHANNEL_VALUE",
        `BVH frame ${frame} channel ${channelIndex} is not finite`,
        { filename, section: "MOTION" },
      );
    }
    return value;
  });
  const frames: number[][] = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * channelCount;
    frames.push(values.slice(start, start + channelCount));
  }

  return { channels, frameTime, frames, restHipsHeight, rootName };
}

function parseHierarchy(hierarchy: string, filename: string) {
  const tokens = hierarchy.match(/[{}]|[^\s{}]+/g) ?? [];
  assertCountWithinBudget(
    tokens.length,
    DEFAULT_PARSE_BUDGET.maxTotalSamples,
    "BVH hierarchy tokens",
    { filename, section: "HIERARCHY" },
  );
  let index = 0;
  let channelOffset = 0;
  const channels: BVHChannel[] = [];
  const nodes: BVHRestNode[] = [];

  const fail = (message: string): never => {
    throw new ParseDomainError("BVH_PARSE_FAILED", message, {
      filename,
      offset: index,
      section: "HIERARCHY",
    });
  };
  const take = () => tokens[index++];
  const expectToken = (expected: string) => {
    const actual = take();
    if (actual !== expected) {
      fail(`BVH hierarchy expected ${expected}; found ${actual ?? "end of input"}`);
    }
  };
  const readOffset = (): [number, number, number] => {
    const values = [Number(take()), Number(take()), Number(take())];
    if (!values.every(Number.isFinite)) {
      fail("BVH OFFSET must contain three finite numbers");
    }
    return values as [number, number, number];
  };

  const parseNode = (
    parentWorldOffset: readonly [number, number, number],
    depth: number,
    expectedKind: "ROOT" | "JOINT" | "child",
  ) => {
    if (depth > DEFAULT_MAX_PARENT_DEPTH) {
      fail(`BVH hierarchy exceeds ${DEFAULT_MAX_PARENT_DEPTH} levels`);
    }
    const kind = take();
    const endSite = kind === "End";
    if (endSite) {
      if (expectedKind !== "child") fail("BVH root cannot be an End Site");
      expectToken("Site");
    } else if (
      kind !== expectedKind &&
      !(expectedKind === "child" && kind === "JOINT")
    ) {
      fail(`BVH hierarchy contains an unexpected ${kind ?? "end of input"}`);
    }
    const nodeName = endSite ? "End Site" : take();
    if (!nodeName || nodeName === "{" || nodeName === "}") {
      fail("BVH hierarchy node is missing a name");
    }
    const bone = endSite
      ? null
      : resolveProfileBoneName(BVH_HUMANOID_PROFILE, nodeName);
    expectToken("{");

    let offset: [number, number, number] | undefined;
    let channelMetadataSeen = false;
    while (tokens[index] !== "}") {
      const token = tokens[index];
      if (token === undefined) fail("BVH hierarchy has unbalanced braces");
      if (token === "OFFSET") {
        if (offset) fail(`BVH node "${nodeName}" declares OFFSET more than once`);
        index += 1;
        offset = readOffset();
        continue;
      }
      if (token === "CHANNELS") {
        if (endSite) fail("BVH End Site cannot declare channels");
        if (channelMetadataSeen) {
          fail(`BVH node "${nodeName}" declares CHANNELS more than once`);
        }
        index += 1;
        const count = Number(take());
        if (!Number.isInteger(count) || count <= 0 || count > 6) {
          fail(`BVH node "${nodeName}" has an invalid channel count`);
        }
        const channelNames = tokens.slice(index, index + count);
        if (channelNames.length !== count || channelNames.includes("}")) {
          fail(`BVH node "${nodeName}" has truncated channel metadata`);
        }
        validateChannelSchema(channelNames, nodeName, fail);
        channels.push({
          nodeName,
          bone,
          channels: channelNames,
          offset: channelOffset,
        });
        channelOffset += count;
        channelMetadataSeen = true;
        index += count;
        continue;
      }
      if (token === "JOINT" || token === "End") {
        const currentOffset = offset ?? fail(
          `BVH node "${nodeName}" must declare OFFSET before children`,
        );
        const worldOffset = addOffset(parentWorldOffset, currentOffset);
        parseNode(worldOffset, depth + 1, "child");
        continue;
      }
      if (token === "ROOT") fail("BVH hierarchy must contain exactly one ROOT");
      fail(`BVH node "${nodeName}" contains unexpected token ${token}`);
    }
    expectToken("}");
    const finalOffset = offset ?? fail(`BVH node "${nodeName}" is missing OFFSET`);
    if (!endSite && !channelMetadataSeen) {
      fail(`BVH node "${nodeName}" is missing CHANNELS`);
    }
    nodes.push({
      nodeName,
      bone,
      worldOffset: addOffset(parentWorldOffset, finalOffset),
    });
  };

  if (tokens[index]?.toUpperCase() === "HIERARCHY") index += 1;
  parseNode([0, 0, 0], 0, "ROOT");
  if (index !== tokens.length) {
    fail(`BVH hierarchy contains trailing token ${tokens[index]}`);
  }
  return { channels, restNodes: nodes };
}

function addOffset(
  parent: readonly [number, number, number],
  local: readonly [number, number, number],
): [number, number, number] {
  return [parent[0] + local[0], parent[1] + local[1], parent[2] + local[2]];
}

function validateChannelSchema(
  channelNames: readonly string[],
  nodeName: string,
  fail: (message: string) => never,
) {
  const parsed = channelNames.map((name) =>
    name.match(/^([XYZ])(position|rotation)$/i),
  );
  if (parsed.some((match) => !match)) {
    fail(`BVH node "${nodeName}" contains an unsupported channel`);
  }
  const normalized = parsed.map((match) =>
    `${match![1]!.toUpperCase()}${match![2]!.toLowerCase()}`,
  );
  if (new Set(normalized).size !== normalized.length) {
    fail(`BVH node "${nodeName}" contains duplicate channels`);
  }
  const rotationAxes = parsed
    .filter((match) => match![2]!.toLowerCase() === "rotation")
    .map((match) => match![1]!.toUpperCase());
  if (
    rotationAxes.length > 0 &&
    (rotationAxes.length !== 3 || new Set(rotationAxes).size !== 3)
  ) {
    fail(`BVH node "${nodeName}" must declare unique XYZ rotation channels`);
  }
}

function estimateRestHipsHeight(nodes: readonly BVHRestNode[]) {
  const hips = nodes.find((node) => node.bone === "hips");
  if (!hips) return undefined;
  const footNodes = nodes.filter(
    (node) =>
      node.bone === "leftFoot" ||
      node.bone === "leftToes" ||
      node.bone === "rightFoot" ||
      node.bone === "rightToes",
  );
  const candidates = footNodes.length > 0 ? footNodes : nodes;
  const floorY = Math.min(...candidates.map((node) => node.worldOffset[1]));
  const height = hips.worldOffset[1] - floorY;
  return Number.isFinite(height) && height > 1e-6
    ? Number(height.toFixed(6))
    : undefined;
}

function createBVHTracks({
  channels,
  frameTime,
  frames,
}: ReturnType<typeof parseBVH>): MotionTrack[] {
  const tracks: MotionTrack[] = [];
  const times = frames.map((_, index) => index * frameTime);

  for (const channel of channels) {
    if (!channel.bone) {
      continue;
    }

    const rotationChannels = channel.channels.filter((item) =>
      item.toLowerCase().endsWith("rotation"),
    );
    if (rotationChannels.length > 0) {
      tracks.push({
        bone: channel.bone,
        path: "rotation",
        times,
        values: frames.flatMap((frame) =>
          readBVHQuaternion(frame, channel, rotationChannels),
        ),
      });
    }

    const positionChannels = channel.channels.filter((item) =>
      item.toLowerCase().endsWith("position"),
    );
    if (channel.bone === "hips" && positionChannels.length > 0) {
      tracks.push({
        bone: "hips",
        path: "translation",
        times,
        values: frames.flatMap((frame) =>
          readBVHTranslation(frame, channel, positionChannels),
        ),
      });
    }
  }

  return tracks.filter((track) => {
    const size =
      track.path === "rotation" ? ROTATION_VALUE_SIZE : TRANSLATION_VALUE_SIZE;
    return track.values.length === track.times.length * size;
  });
}

function readBVHQuaternion(
  frame: number[],
  channel: BVHChannel,
  rotationChannels: string[],
) {
  const eulerValues = { X: 0, Y: 0, Z: 0 };
  const order = rotationChannels
    .map((name) => name[0]?.toUpperCase() ?? "X")
    .join("") as "XYZ";

  for (const name of rotationChannels) {
    const axis = name[0]?.toUpperCase() as "X" | "Y" | "Z";
    const localIndex = channel.channels.indexOf(name);
    eulerValues[axis] = degreesToRadians(frame[channel.offset + localIndex] ?? 0);
  }

  const quaternion = new Quaternion().setFromEuler(
    new Euler(eulerValues.X, eulerValues.Y, eulerValues.Z, order),
  );
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function readBVHTranslation(
  frame: number[],
  channel: BVHChannel,
  positionChannels: string[],
) {
  const translation = { X: 0, Y: 0, Z: 0 };
  for (const name of positionChannels) {
    const axis = name[0]?.toUpperCase() as "X" | "Y" | "Z";
    const localIndex = channel.channels.indexOf(name);
    translation[axis] = frame[channel.offset + localIndex] ?? 0;
  }

  return [translation.X, translation.Y, translation.Z];
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}
