import {
  HUMANOID_BONES,
  normalizeMotionTime,
  resolveRootTranslationExportScale,
  sampleMotionClipPose,
  type RetargetedMotionClip,
} from "@/retarget";
import { validateMotionClip } from "@/retarget";
import {
  LINEAR_VMD_BONE_INTERPOLATION,
  MMD_STANDARD_REST_HIPS_HEIGHT,
  MMD_UNIT_METERS,
  serializeVMDBoneMotion,
  VMD_FPS,
  type VMDBoneFrame,
} from "@/mmd/vmd-document";
import { MMD_EXPORT_BONE_NAMES } from "./bone-naming";
import {
  assertGeneratedExportBudget,
  type ProcessingBudget,
} from "@/processing-budget";

const MAX_EXPORTED_VMD_KEYFRAMES = 0xffff_ffff;

export async function exportVMD(
  clip: RetargetedMotionClip,
  _options?: import("./bone-naming").BoneNamingOptions,
  budget?: ProcessingBudget,
): Promise<Uint8Array> {
  const validation = validateMotionClip(clip);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  const bones = collectVMDBones(clip);
  if (bones.length === 0) {
    throw new Error("Motion clip does not contain VMD-supported body tracks.");
  }

  const frameCount = Math.max(2, Math.ceil(clip.duration * VMD_FPS) + 1);
  const keyframeCount = bones.length * frameCount;
  if (keyframeCount > MAX_EXPORTED_VMD_KEYFRAMES) {
    throw new Error(
      `VMD export requires ${keyframeCount} bone keyframes; the format limit is ${MAX_EXPORTED_VMD_KEYFRAMES}.`,
    );
  }
  assertGeneratedExportBudget({
    frameCount,
    valuesPerFrame: bones.length * 7,
    estimatedOutputBytes: 30 + 20 + 4 + keyframeCount * 111 + 20,
    budget,
    phase: "vmd-export",
  });

  return serializeVMDBoneMotion({
    boneFrameCount: keyframeCount,
    boneFrames: createVMDBoneFrames(clip, bones, frameCount),
    modelName: clip.name || "retargeted",
  });
}

function* createVMDBoneFrames(
  clip: RetargetedMotionClip,
  bones: ReturnType<typeof collectVMDBones>,
  frameCount: number,
): Generator<VMDBoneFrame> {
  const rootScale = resolveVMDRootScale(clip);
  for (let frameNumber = 0; frameNumber < frameCount; frameNumber += 1) {
    const time = normalizeMotionTime(frameNumber / VMD_FPS, clip.duration, false);
    const pose = sampleMotionClipPose(clip, time, false);
    for (const bone of bones) {
      const item = pose[bone];
      const position = bone === "hips" ? item?.position : undefined;
      const rotation = item?.rotation ?? [0, 0, 0, 1];
      yield {
        boneName: MMD_EXPORT_BONE_NAMES[bone],
        frameNumber,
        position: [
          (position?.[0] ?? 0) * rootScale,
          (position?.[1] ?? 0) * rootScale,
          -(position?.[2] ?? 0) * rootScale,
        ],
        rotation: [-rotation[0], -rotation[1], rotation[2], rotation[3]],
        interpolation: LINEAR_VMD_BONE_INTERPOLATION,
      };
    }
  }
}

// The inverse of VMD import: root offsets are written in MMD units against the
// standard-model rest hips height that import reads them with.
export function resolveVMDRootScale(clip: RetargetedMotionClip) {
  const sourceRestHipsHeight = clip.metadata?.restHipsHeight;
  if (
    !(typeof sourceRestHipsHeight === "number" && sourceRestHipsHeight > 0) &&
    clip.metadata?.rootTranslationSpace === "offset-meters"
  ) {
    return 1 / MMD_UNIT_METERS;
  }
  return resolveRootTranslationExportScale(clip, MMD_STANDARD_REST_HIPS_HEIGHT);
}

function collectVMDBones(clip: RetargetedMotionClip) {
  const trackedBones = new Set(clip.tracks.map((track) => track.bone));
  return HUMANOID_BONES.filter(
    (bone): bone is keyof typeof MMD_EXPORT_BONE_NAMES =>
      trackedBones.has(bone) && bone in MMD_EXPORT_BONE_NAMES,
  );
}
