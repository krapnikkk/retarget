import { Quaternion } from "three";
import type {
  RetargetedMotionClip,
  TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import type { RetargetedRigMotionV2 } from "@/rig-motion";
import { HUMANOID_BONES, isHumanoidBoneName } from "@/retarget";
import { normalizeBoneAlias } from "@/import/humanoid-motion";
import { readGLBRangeInfo } from "@/import/glb-range";
import {
  getRigProfile,
  HUMANOID_RIG_PROFILES,
  type RigProfileId,
} from "@/profiles";
import {
  CANONICAL_AXIS_FRAME,
  createAxisCorrection,
} from "@/retarget/coordinate-space";
import { validateRigMotionDocumentSemantics } from "@/validation/rig-motion-world-semantic-oracle";
import {
  createStreamedAnimationValidationDocument,
  validateStreamedGLTFWorldSemantics,
} from "@/validation/streamed-gltf-oracle";
import { bindCanonicalClipToRawGLTFTarget } from "./raw-gltf-target-binding";

const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const GLB_MAGIC = 0x46546c67;

export async function exportAnimatedGLBStream({
  avatarFile,
  clip,
}: {
  avatarFile: File;
  clip: TargetBoundSolvedHumanoidMotionClip;
}) {
  const info = await readGLBRangeInfo(avatarFile);
  const json = structuredClone(info.json);
  const nodes = Array.isArray(json.nodes)
    ? json.nodes as Array<Record<string, unknown>>
    : [];
  const nodesByBone = collectRawHumanoidNodeIndices(json, nodes);
  const boundClip = bindCanonicalClipToRawGLTFTarget(clip, nodes, nodesByBone);
  return buildStreamedGLBBlob({
    avatarFile,
    info,
    json,
    animationName: clip.name || "retargeted-motion",
    channels: boundClip.tracks.flatMap((track) => {
      const node = nodesByBone.get(track.bone);
      return node === undefined ? [] : [{ ...track, node }];
    }),
  });
}

export async function exportAnimatedRigGLBStream({
  avatarFile,
  motion,
  expectedRigSignature,
}: {
  avatarFile: File;
  motion: import("@/rig-motion").RetargetedRigMotionV2;
  expectedRigSignature: string;
}) {
  const { document } = await import("@/import/gltf-structural-document").then(
    ({ readGLTFStructuralDocument }) => readGLTFStructuralDocument(avatarFile),
  );
  const { inspectGLTFRig } = await import("@/rigs");
  const inspection = inspectGLTFRig(document, {
    familyOverride: motion.family,
    profileId: motion.target.profileId,
  });
  if (inspection.signature !== expectedRigSignature) {
    throw new Error(
      "Animated GLB target signature differs from the motion target; retarget again before export.",
    );
  }
  const channels = motion.tracks.map((track) => ({
    nodeName: inspection.nodesByRole.get(track.role)?.getName() ?? track.role,
    path: track.path,
    times: track.times,
    values: track.values,
  }));
  return exportRawAnimationGLBStream({
    avatarFile,
    animationName: motion.name || "rig-motion",
    channels,
  });
}

async function exportRawAnimationGLBStream({
  avatarFile,
  animationName,
  channels: rawChannels,
}: {
  avatarFile: File;
  animationName: string;
  channels: Array<{
    nodeName: string;
    path: "rotation" | "translation";
    times: readonly number[];
    values: readonly number[];
  }>;
}) {
  const info = await readGLBRangeInfo(avatarFile);
  if (!info.binaryChunk) {
    throw new Error("Animated streamed GLB export requires an embedded BIN chunk.");
  }
  const json = structuredClone(info.json);
  const nodes = Array.isArray(json.nodes)
    ? json.nodes as Array<Record<string, unknown>>
    : [];
  const nodesByName = new Map(
    nodes.map((node, index) => [typeof node.name === "string" ? node.name : "", index]),
  );
  return buildStreamedGLBBlob({
    avatarFile,
    info,
    json,
    animationName,
    channels: rawChannels.flatMap((track) => {
      const node = nodesByName.get(track.nodeName);
      return node === undefined ? [] : [{ ...track, node }];
    }),
  });
}

function buildStreamedGLBBlob({
  avatarFile,
  info,
  json,
  animationName,
  channels: mappedChannels,
}: {
  avatarFile: File;
  info: Awaited<ReturnType<typeof readGLBRangeInfo>>;
  json: Record<string, unknown>;
  animationName: string;
  channels: Array<{
    node: number;
    path: "rotation" | "translation";
    times: readonly number[];
    values: readonly number[];
  }>;
}) {
  if (!info.binaryChunk) {
    throw new Error("Animated streamed GLB export requires an embedded BIN chunk.");
  }
  const buffers = ensureArray<Record<string, unknown>>(json, "buffers");
  if (buffers.length !== 1 || typeof buffers[0]?.uri === "string") {
    throw new Error("Streamed GLB export requires one embedded buffer.");
  }
  const buffer = buffers[0] ?? {};
  if (!buffers[0]) buffers.push(buffer);
  const sourceBufferByteLength = readNonNegativeInteger(buffer.byteLength);
  if (sourceBufferByteLength > info.binaryChunk.byteLength) {
    throw new Error("GLB buffer length exceeds its embedded BIN chunk.");
  }
  const baseByteLength = align4(sourceBufferByteLength);
  const bufferViews = ensureArray<Record<string, unknown>>(json, "bufferViews");
  const accessors = ensureArray<Record<string, unknown>>(json, "accessors");
  const animations = ensureArray<Record<string, unknown>>(json, "animations");
  const binaryParts: ArrayBuffer[] = [];
  const samplers: Array<Record<string, unknown>> = [];
  const channels: Array<Record<string, unknown>> = [];
  let appendByteLength = 0;
  for (const track of mappedChannels) {
    if (track.times.length === 0) continue;
    const components = track.path === "rotation" ? 4 : 3;
    if (track.values.length !== track.times.length * components) {
      throw new Error(`Invalid node ${track.node}.${track.path} sample count.`);
    }
    const timeBytes = toFloat32Buffer(track.times);
    const valueBytes = toFloat32Buffer(track.values);
    const timeBufferView = bufferViews.push({
      buffer: 0,
      byteOffset: baseByteLength + appendByteLength,
      byteLength: timeBytes.byteLength,
    }) - 1;
    binaryParts.push(timeBytes);
    appendByteLength += timeBytes.byteLength;
    const valueBufferView = bufferViews.push({
      buffer: 0,
      byteOffset: baseByteLength + appendByteLength,
      byteLength: valueBytes.byteLength,
    }) - 1;
    binaryParts.push(valueBytes);
    appendByteLength += valueBytes.byteLength;
    const timeBounds = numberBounds(track.times);
    const input = accessors.push({
      bufferView: timeBufferView,
      componentType: 5126,
      count: track.times.length,
      type: "SCALAR",
      min: [timeBounds.min],
      max: [timeBounds.max],
    }) - 1;
    const output = accessors.push({
      bufferView: valueBufferView,
      componentType: 5126,
      count: track.times.length,
      type: track.path === "rotation" ? "VEC4" : "VEC3",
    }) - 1;
    const sampler = samplers.push({ input, output, interpolation: "LINEAR" }) - 1;
    channels.push({ sampler, target: { node: track.node, path: track.path } });
  }
  if (channels.length === 0) {
    throw new Error("No animation tracks map to this GLB avatar.");
  }
  animations.push({ name: animationName, samplers, channels });
  buffer.byteLength = baseByteLength + appendByteLength;
  const jsonBytes = encodePaddedJSON(json);
  const binByteLength = baseByteLength + appendByteLength;
  const binPaddedByteLength = align4(binByteLength);
  const totalByteLength = 12 + 8 + jsonBytes.byteLength + 8 + binPaddedByteLength;
  if (totalByteLength > 0xffffffff) {
    throw new Error("Streamed GLB output exceeds the GLB 32-bit length limit.");
  }
  const header = new Uint8Array(20);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, GLB_MAGIC, true);
  headerView.setUint32(4, 2, true);
  headerView.setUint32(8, totalByteLength, true);
  headerView.setUint32(12, jsonBytes.byteLength, true);
  headerView.setUint32(16, JSON_CHUNK_TYPE, true);
  const binHeader = new Uint8Array(8);
  const binHeaderView = new DataView(binHeader.buffer);
  binHeaderView.setUint32(0, binPaddedByteLength, true);
  binHeaderView.setUint32(4, BIN_CHUNK_TYPE, true);
  return new Blob(
    [
      header.buffer,
      jsonBytes.buffer,
      binHeader.buffer,
      avatarFile.slice(
        info.binaryChunk.offset,
        info.binaryChunk.offset + sourceBufferByteLength,
      ),
      new Uint8Array(baseByteLength - sourceBufferByteLength).buffer,
      ...binaryParts,
      new Uint8Array(binPaddedByteLength - binByteLength).buffer,
    ],
    { type: "model/gltf-binary" },
  );
}

export async function validateAnimatedGLBStream(
  blob: Blob,
  expectedTrackCount?: number,
  expected?: RetargetedMotionClip,
) {
  try {
    const info = await readGLBRangeInfo(blob);
    const { json, declaredByteLength, binaryChunk } = info;
    const animations = Array.isArray(json.animations) ? json.animations : [];
    const animation = animations.at(-1) as Record<string, unknown> | undefined;
    const channels = animation && Array.isArray(animation.channels)
      ? animation.channels
      : [];
    const buffers = Array.isArray(json.buffers) ? json.buffers : [];
    const byteLength = readNonNegativeInteger(
      (buffers[0] as Record<string, unknown> | undefined)?.byteLength,
    );
    if (!binaryChunk || byteLength > binaryChunk.byteLength) {
      return { ok: false as const, issue: "Streamed GLB BIN chunk is incomplete." };
    }
    if (declaredByteLength !== blob.size) {
      return { ok: false as const, issue: "Streamed GLB length does not match its Blob." };
    }
    if (channels.length === 0) {
      return { ok: false as const, issue: "Streamed GLB has no animation channels." };
    }
    if (expectedTrackCount !== undefined && channels.length !== expectedTrackCount) {
      return {
        ok: false as const,
        issue: `Streamed GLB has ${channels.length}/${expectedTrackCount} animation channels.`,
      };
    }
    const nodes = Array.isArray(json.nodes)
      ? json.nodes as Array<Record<string, unknown>>
      : [];
    const rig = resolveRawHumanoidNodeIndices(json, nodes);
    const semantic = expected
      ? await validateStreamedGLTFWorldSemantics({
          blob,
          expected,
          info,
          nodesByBone: rig.nodesByBone,
          worldAxisCorrection: resolveWorldAxisCorrection(expected),
        })
      : undefined;
    return {
      ok: true as const,
      executionMode: "streamed" as const,
      rigDetectionMode: rig.detectionMode,
      semantic,
    };
  } catch (error) {
    return {
      ok: false as const,
      issue: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function validateAnimatedRigGLBStream(
  blob: Blob,
  expected: RetargetedRigMotionV2,
) {
  const structural = await validateAnimatedGLBStream(
    blob,
    expected.tracks.length,
  );
  if (!structural.ok) return structural;
  try {
    const info = await readGLBRangeInfo(blob);
    const { document } = await createStreamedAnimationValidationDocument(
      blob,
      info,
      expected.name || "rig-motion",
    );
    return {
      ...structural,
      rigDetectionMode: "name-heuristic" as const,
      semantic: validateRigMotionDocumentSemantics({ document, expected }),
    };
  } catch (error) {
    return {
      ok: false as const,
      issue: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectRawHumanoidNodeIndices(
  json: Record<string, unknown>,
  nodes: readonly Record<string, unknown>[],
) {
  return resolveRawHumanoidNodeIndices(json, nodes).nodesByBone;
}

function resolveRawHumanoidNodeIndices(
  json: Record<string, unknown>,
  nodes: readonly Record<string, unknown>[],
) {
  const result = new Map<import("@/retarget").HumanoidBoneName, number>();
  let usedNameHeuristic = false;
  const extensions = json.extensions as Record<string, unknown> | undefined;
  const vrm1 = extensions?.VRMC_vrm as Record<string, unknown> | undefined;
  const vrm1Humanoid = vrm1?.humanoid as Record<string, unknown> | undefined;
  const vrm1Bones = vrm1Humanoid?.humanBones as
    | Record<string, { node?: unknown }>
    | undefined;
  for (const [bone, definition] of Object.entries(vrm1Bones ?? {})) {
    if (isHumanoidBoneName(bone) && Number.isInteger(definition?.node)) {
      result.set(bone, definition.node as number);
    }
  }
  const vrm0 = extensions?.VRM as Record<string, unknown> | undefined;
  const vrm0Humanoid = vrm0?.humanoid as Record<string, unknown> | undefined;
  const vrm0Bones = Array.isArray(vrm0Humanoid?.humanBones)
    ? vrm0Humanoid.humanBones as Array<Record<string, unknown>>
    : [];
  for (const definition of vrm0Bones) {
    if (
      typeof definition.bone === "string" &&
      isHumanoidBoneName(definition.bone) &&
      Number.isInteger(definition.node)
    ) {
      result.set(definition.bone, definition.node as number);
    }
  }
  const aliases = new Map<string, import("@/retarget").HumanoidBoneName>();
  for (const bone of HUMANOID_BONES) aliases.set(normalizeBoneAlias(bone), bone);
  for (const profile of HUMANOID_RIG_PROFILES) {
    for (const bone of profile.bones) {
      for (const alias of bone.aliases) {
        aliases.set(normalizeBoneAlias(alias), bone.humanoid);
      }
    }
  }
  for (const [index, node] of nodes.entries()) {
    const name = typeof node.name === "string" ? node.name : "";
    const bone = aliases.get(normalizeBoneAlias(name));
    if (bone && !result.has(bone)) {
      result.set(bone, index);
      usedNameHeuristic = true;
    }
  }
  return {
    nodesByBone: result,
    detectionMode: usedNameHeuristic
      ? "name-heuristic" as const
      : "vrm-extension" as const,
  };
}

function resolveWorldAxisCorrection(expected: RetargetedMotionClip) {
  const profile = expected.target.profile
    ? getRigProfile(expected.target.profile as RigProfileId)
    : null;
  return profile
    ? createAxisCorrection(CANONICAL_AXIS_FRAME, profile)
    : new Quaternion();
}

function ensureArray<T>(json: Record<string, unknown>, key: string) {
  if (!Array.isArray(json[key])) json[key] = [];
  return json[key] as T[];
}

function readNonNegativeInteger(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error("GLB buffer byteLength is invalid.");
  }
  return value as number;
}

function toFloat32Buffer(values: readonly number[]) {
  const array = new Float32Array(values);
  return array.buffer.slice(
    array.byteOffset,
    array.byteOffset + array.byteLength,
  ) as ArrayBuffer;
}

function encodePaddedJSON(json: Record<string, unknown>) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(align4(encoded.byteLength));
  padded.fill(0x20);
  padded.set(encoded);
  return padded;
}

function align4(value: number) {
  return Math.ceil(value / 4) * 4;
}

function numberBounds(values: readonly number[]) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}
