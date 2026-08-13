import type {
  CanonicalMotion,
  CanonicalHumanoidMotionClip,
  RetargetTargetBinding,
  RetargetedMotionClip,
} from "./types";

export function createRetargetedMotionClipFromCanonicalMotion(
  motion: CanonicalMotion,
  target: RetargetTargetBinding,
): CanonicalHumanoidMotionClip {
  return {
    ...motion,
    target,
    processing: {
      stage: "canonical",
      sourceCanonicalId: createSourceCanonicalId(),
    },
  };
}

export function createCanonicalMotionFromRetargetedClip(
  clip: RetargetedMotionClip,
): CanonicalMotion {
  const { processing, target, ...motion } = clip;
  void processing;
  void target;
  return motion;
}

export function isCanonicalHumanoidMotionClip(
  clip: RetargetedMotionClip,
): clip is CanonicalHumanoidMotionClip {
  return clip.processing.stage === "canonical";
}

function createSourceCanonicalId() {
  return globalThis.crypto?.randomUUID
    ? `canonical:${globalThis.crypto.randomUUID()}`
    : `canonical:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
