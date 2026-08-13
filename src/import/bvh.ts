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
  const channels = parseHierarchyChannels(hierarchy);
  const restNodes = parseHierarchyRestNodes(hierarchy);
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

function parseHierarchyRestNodes(hierarchy: string): BVHRestNode[] {
  const tokens = hierarchy.match(/[{}]|[^\s{}]+/g) ?? [];
  const nodes: BVHRestNode[] = [];
  const stack: Array<{
    nodeName: string;
    bone: HumanoidBoneName | null;
    parentWorldOffset: [number, number, number];
    worldOffset: [number, number, number];
  }> = [];
  let pending:
    | { nodeName: string; bone: HumanoidBoneName | null }
    | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "ROOT" || token === "JOINT") {
      const nodeName = tokens[index + 1] ?? "unnamed";
      pending = {
        nodeName,
        bone: resolveProfileBoneName(BVH_HUMANOID_PROFILE, nodeName),
      };
      index += 1;
      continue;
    }
    if (token === "End" && tokens[index + 1] === "Site") {
      pending = { nodeName: "End Site", bone: null };
      index += 1;
      continue;
    }
    if (token === "{" && pending) {
      const parentWorldOffset = stack.at(-1)?.worldOffset ?? [0, 0, 0];
      stack.push({
        ...pending,
        parentWorldOffset: [...parentWorldOffset],
        worldOffset: [...parentWorldOffset],
      });
      pending = null;
      continue;
    }
    if (token === "OFFSET") {
      const node = stack.at(-1);
      if (!node) continue;
      const localOffset = [
        Number(tokens[index + 1]),
        Number(tokens[index + 2]),
        Number(tokens[index + 3]),
      ] as const;
      if (localOffset.every(Number.isFinite)) {
        node.worldOffset = [
          node.parentWorldOffset[0] + localOffset[0],
          node.parentWorldOffset[1] + localOffset[1],
          node.parentWorldOffset[2] + localOffset[2],
        ];
      }
      index += 3;
      continue;
    }
    if (token === "}") {
      const node = stack.pop();
      if (node) {
        nodes.push({
          nodeName: node.nodeName,
          bone: node.bone,
          worldOffset: node.worldOffset,
        });
      }
    }
  }

  return nodes;
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

function parseHierarchyChannels(hierarchy: string): BVHChannel[] {
  const tokens = hierarchy.match(/[{}]|[^\s{}]+/g) ?? [];
  const channels: BVHChannel[] = [];
  let index = 0;
  let channelOffset = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token !== "ROOT" && token !== "JOINT") {
      index += 1;
      continue;
    }

    const nodeName = tokens[index + 1] ?? "unnamed";
    index += 2;
    while (index < tokens.length && tokens[index] !== "CHANNELS") {
      index += 1;
    }
    if (tokens[index] !== "CHANNELS") {
      continue;
    }

    const count = Number(tokens[index + 1]);
    if (!Number.isInteger(count) || count < 0 || count > 6) {
      throw new Error(`BVH node "${nodeName}" has an invalid channel count.`);
    }
    const channelNames = tokens.slice(index + 2, index + 2 + count);
    if (channelNames.length !== count) {
      throw new Error(`BVH node "${nodeName}" has truncated channel metadata.`);
    }
    channels.push({
      nodeName,
      bone: resolveProfileBoneName(BVH_HUMANOID_PROFILE, nodeName),
      channels: channelNames,
      offset: channelOffset,
    });
    channelOffset += count;
    index += 2 + count;
  }

  return channels;
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
