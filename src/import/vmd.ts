import { MMD_EXPORT_BONE_NAMES } from "@/profiles/bone-naming";
import {
  MMD_STANDARD_REST_HIPS_HEIGHT,
  parseVMDDocument,
  VMD_FPS,
  type VMDBoneFrame,
  type VMDDocument,
} from "@/mmd/vmd-document";
import { MMD_BODY_PROFILE } from "@/profiles";
import type { HumanoidBoneName, MotionTrack } from "@/retarget";
import {
  createImportedHumanoidMotionClip,
  normalizeImportedTracks,
} from "./humanoid-motion";
import {
  DEFAULT_PARSE_BUDGET,
  ParseDomainError,
  assertCountWithinBudget,
  assertInputWithinBudget,
  type ParseBudget,
} from "./parse-budget";

type VMDBoneBinding = {
  bone: HumanoidBoneName;
  order: number;
};

type VMDChannel = VMDBoneBinding & {
  frames: VMDBoneFrame[];
};

export { MMD_STANDARD_REST_HIPS_HEIGHT };

const VMD_BONE_MAP = createVMDBoneMap();
const MAX_VMD_GENERATED_TRACK_SAMPLES = 1_000_000;

export function importVMD(
  bytes: Uint8Array,
  filename = "motion.vmd",
  budget: ParseBudget = DEFAULT_PARSE_BUDGET,
) {
  assertInputWithinBudget(bytes.byteLength, budget, {
    filename,
    section: "VMD",
  });
  const document = parseVMDDocument(padLegacyVMDSections(bytes));
  const tracks = normalizeImportedTracks(createVMDTracks(document, budget));
  assertCountWithinBudget(
    tracks.length,
    budget.maxTracks,
    "VMD track count",
    { filename, section: "bone tracks" },
  );
  if (tracks.length === 0) {
    throw new Error("VMD file does not contain supported body tracks.");
  }

  const unmappedBoneNames = [
    ...new Set(
      document.boneFrames
        .map((frame) => frame.boneName)
        .filter((name) => !VMD_BONE_MAP.has(normalizeVMDName(name))),
    ),
  ].sort();

  return createImportedHumanoidMotionClip({
    kind: "vmd",
    filename,
    profile: MMD_BODY_PROFILE,
    tracks,
    duration: document.duration,
    fps: VMD_FPS,
    restHipsHeight: MMD_STANDARD_REST_HIPS_HEIGHT,
    rootName: "VMD body tracks",
    resampledTrackCount: tracks.length,
    rootMotionEvidence: {
      status: "preserved",
      scaleSource: "mmd-standard-model-preset",
      sourceRestHipsHeight: MMD_STANDARD_REST_HIPS_HEIGHT,
      coordinateTransform:
        "VMD left-handed position/quaternion mirrored once into the canonical right-handed -Z-forward basis",
    },
    metadata: {
      mmd: {
        modelName: document.modelName,
        sectionCounts: {
          bone: document.boneFrames.length,
          morph: document.morphFrames.length,
          camera: document.cameraFrames.length,
          light: document.lightFrames.length,
          selfShadow: document.selfShadowFrames.length,
          property: document.propertyFrames.length,
        },
        unmappedBoneNames,
      },
    },
  });
}

function validateFrameDuration(frameNumber: number, budget: ParseBudget) {
  if (frameNumber / VMD_FPS > budget.maxDurationSeconds) {
    throw new ParseDomainError(
      "PARSE_BUDGET_EXCEEDED",
      "VMD bone frame exceeds the duration limit",
      {
        section: "bone frames",
        declared: Math.ceil(frameNumber / VMD_FPS),
        limit: budget.maxDurationSeconds,
      },
    );
  }
}

function padLegacyVMDSections(bytes: Uint8Array) {
  if (bytes.byteLength < 54) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boneCount = view.getUint32(50, true);
  const boneSectionEnd = 54 + boneCount * 111;
  if (boneSectionEnd > bytes.byteLength || bytes.byteLength >= boneSectionEnd + 20) {
    return bytes;
  }
  const padded = new Uint8Array(boneSectionEnd + 20);
  padded.set(bytes);
  return padded;
}

function createVMDTracks(
  document: VMDDocument,
  budget: ParseBudget,
): MotionTrack[] {
  const channelsByBone = new Map<HumanoidBoneName, Map<string, VMDChannel>>();
  for (const frame of document.boneFrames) {
    validateFrameDuration(frame.frameNumber, budget);
    const normalizedName = normalizeVMDName(frame.boneName);
    const binding = VMD_BONE_MAP.get(normalizedName);
    if (!binding) {
      continue;
    }
    const byName = channelsByBone.get(binding.bone) ?? new Map<string, VMDChannel>();
    const channel = byName.get(normalizedName) ?? { ...binding, frames: [] };
    channel.frames.push(frame);
    byName.set(normalizedName, channel);
    channelsByBone.set(binding.bone, byName);
  }

  let generatedSamples = 0;
  const preparedChannels = [...channelsByBone].map(([bone, channelsByName]) => {
    const channels = [...channelsByName.values()]
      .map((channel) => ({
        ...channel,
        frames: sortAndDedupeFrames(channel.frames),
      }))
      .sort((left, right) => left.order - right.order);
    let maxFrame = 0;
    for (const channel of channels) {
      for (const frame of channel.frames) {
        maxFrame = Math.max(maxFrame, frame.frameNumber);
      }
    }
    const trackSamples = (maxFrame + 1) * (bone === "hips" ? 2 : 1);
    assertCountWithinBudget(
      maxFrame + 1,
      budget.maxSamplesPerTrack,
      "VMD samples per track",
      { section: "bone tracks" },
    );
    generatedSamples += trackSamples;
    const generatedLimit = Math.min(
      MAX_VMD_GENERATED_TRACK_SAMPLES,
      budget.maxTotalSamples,
    );
    if (
      !Number.isSafeInteger(generatedSamples) ||
      generatedSamples > generatedLimit
    ) {
      throw new ParseDomainError(
        "PARSE_BUDGET_EXCEEDED",
        "VMD dense interpolation exceeds the format safety limit",
        {
          section: "bone tracks",
          declared: generatedSamples,
          limit: generatedLimit,
        },
      );
    }
    return { bone, channels, maxFrame };
  });

  const tracks: MotionTrack[] = [];
  for (const { bone, channels, maxFrame } of preparedChannels) {
    const times: number[] = [];
    const rotations: number[] = [];
    const translations: number[] = [];

    for (let frameNumber = 0; frameNumber <= maxFrame; frameNumber += 1) {
      times.push(frameNumber / VMD_FPS);
      let rotation: QuaternionTuple = [0, 0, 0, 1];
      let translation: VectorTuple = [0, 0, 0];
      for (const channel of channels) {
        const sampled = sampleVMDBoneChannel(channel.frames, frameNumber);
        const channelPosition = toCanonicalPosition(sampled.position);
        translation = addVector(
          translation,
          rotateVector(channelPosition, rotation),
        );
        rotation = multiplyQuaternion(rotation, toCanonicalRotation(sampled.rotation));
      }
      rotations.push(...normalizeQuaternion(rotation));
      translations.push(...translation);
    }

    tracks.push({ bone, path: "rotation", times: [...times], values: rotations });
    if (bone === "hips") {
      tracks.push({ bone, path: "translation", times, values: translations });
    }
  }
  return tracks;
}

function createVMDBoneMap() {
  const map = new Map<string, VMDBoneBinding>();
  for (const [bone, name] of Object.entries(MMD_EXPORT_BONE_NAMES)) {
    map.set(normalizeVMDName(name), {
      bone: bone as HumanoidBoneName,
      order: 0,
    });
  }

  addAliases(map, "hips", 0, ["all parent", "motherbone", "全ての親"]);
  addAliases(map, "hips", 1, ["center", "センター"]);
  addAliases(map, "hips", 2, ["groove", "グルーブ"]);
  addAliases(map, "hips", 3, ["lower body", "lowerbody", "下半身"]);
  addAliases(map, "spine", 0, ["upper body", "upperbody", "上半身"]);
  addAliases(map, "chest", 0, ["upper body2", "upperbody2", "上半身2"]);
  addAliases(map, "upperChest", 0, ["upper body3", "upperbody3", "上半身3"]);
  addAliases(map, "neck", 0, ["neck"]);
  addAliases(map, "head", 0, ["head"]);
  addAliases(map, "leftUpperArm", 1, ["left arm twist", "leftarmtwist", "左腕捩"]);
  addAliases(map, "leftLowerArm", 1, ["left wrist twist", "leftwristtwist", "左手捩"]);
  addAliases(map, "rightUpperArm", 1, ["right arm twist", "rightarmtwist", "右腕捩"]);
  addAliases(map, "rightLowerArm", 1, ["right wrist twist", "rightwristtwist", "右手捩"]);
  return map;
}

function addAliases(
  map: Map<string, VMDBoneBinding>,
  bone: HumanoidBoneName,
  order: number,
  aliases: readonly string[],
) {
  for (const alias of aliases) {
    map.set(normalizeVMDName(alias), { bone, order });
  }
}

function normalizeVMDName(name: string) {
  return name.normalize("NFKC").replace(/[\s_.:-]+/g, "").toLowerCase();
}

function sortAndDedupeFrames(frames: readonly VMDBoneFrame[]) {
  const byFrame = new Map<number, VMDBoneFrame>();
  for (const frame of [...frames].sort((left, right) => left.frameNumber - right.frameNumber)) {
    byFrame.set(frame.frameNumber, frame);
  }
  return [...byFrame.values()];
}

function sampleVMDBoneChannel(frames: readonly VMDBoneFrame[], frameNumber: number) {
  if (frames.length === 0) {
    return IDENTITY_BONE_FRAME;
  }
  if (frames.length === 1 || frameNumber <= frames[0]!.frameNumber) {
    return frames[0]!;
  }
  const last = frames.at(-1)!;
  if (frameNumber >= last.frameNumber) {
    return last;
  }

  let low = 0;
  let high = frames.length - 2;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (
      frames[middle]!.frameNumber <= frameNumber &&
      frameNumber < frames[middle + 1]!.frameNumber
    ) {
      const left = frames[middle]!;
      const right = frames[middle + 1]!;
      const frameDelta = right.frameNumber - left.frameNumber;
      const linearRatio = frameDelta < 1.5 ? 0 : (frameNumber - left.frameNumber) / frameDelta;
      return {
        ...right,
        frameNumber,
        position: [0, 1, 2].map((axis) => {
          const ratio = evaluateVMDBezier(right.interpolation, axis, linearRatio);
          return left.position[axis]! * (1 - ratio) + right.position[axis]! * ratio;
        }) as VectorTuple,
        rotation: slerpQuaternion(
          left.rotation,
          right.rotation,
          evaluateVMDBezier(right.interpolation, 3, linearRatio),
        ),
      };
    }
    if (frameNumber < frames[middle]!.frameNumber) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return last;
}

function evaluateVMDBezier(interpolation: Uint8Array, axis: number, x: number) {
  const x1 = (interpolation[axis] ?? 20) / 127;
  const x2 = (interpolation[axis + 8] ?? 107) / 127;
  const y1 = (interpolation[axis + 4] ?? 20) / 127;
  const y2 = (interpolation[axis + 12] ?? 107) / 127;
  if (x1 === y1 && x2 === y2) {
    return x;
  }
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  let t = x;
  for (let index = 0; index < 8; index += 1) {
    const error = ((ax * t + bx) * t + cx) * t - x;
    if (Math.abs(error) < 1e-7) break;
    const derivative = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(derivative) < 1e-7) break;
    t = clamp(t - error / derivative, 0, 1);
  }
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  return (((1 - cy - by) * t + by) * t + cy) * t;
}

type VectorTuple = [number, number, number];
type QuaternionTuple = [number, number, number, number];

const IDENTITY_BONE_FRAME: VMDBoneFrame = {
  boneName: "",
  frameNumber: 0,
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  interpolation: new Uint8Array(64),
};

function toCanonicalPosition(position: readonly number[]): VectorTuple {
  return [position[0]!, position[1]!, -position[2]!];
}

function toCanonicalRotation(rotation: readonly number[]): QuaternionTuple {
  return [-rotation[0]!, -rotation[1]!, rotation[2]!, rotation[3]!];
}

function addVector(left: VectorTuple, right: VectorTuple): VectorTuple {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function rotateVector(vector: VectorTuple, quaternion: QuaternionTuple): VectorTuple {
  const [x, y, z] = vector;
  const [qx, qy, qz, qw] = quaternion;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function multiplyQuaternion(left: QuaternionTuple, right: QuaternionTuple): QuaternionTuple {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function slerpQuaternion(
  left: readonly number[],
  right: readonly number[],
  ratio: number,
): QuaternionTuple {
  const a = normalizeQuaternion(left);
  let b = normalizeQuaternion(right);
  let cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (cosine < 0) {
    b = [-b[0], -b[1], -b[2], -b[3]];
    cosine = -cosine;
  }
  if (cosine > 0.9995) {
    return normalizeQuaternion(a.map((value, index) =>
      value + (b[index]! - value) * ratio,
    ));
  }
  const theta = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(theta);
  const leftRatio = Math.sin((1 - ratio) * theta) / sine;
  const rightRatio = Math.sin(ratio * theta) / sine;
  return normalizeQuaternion(a.map((value, index) =>
    value * leftRatio + b[index]! * rightRatio,
  ));
}

function normalizeQuaternion(value: readonly number[]): QuaternionTuple {
  const length = Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!);
  if (!Number.isFinite(length) || length === 0) {
    return [0, 0, 0, 1];
  }
  return value.map((component) => component / length) as QuaternionTuple;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
