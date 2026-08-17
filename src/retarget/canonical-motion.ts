import type {
  CanonicalMotion,
  CanonicalHumanoidMotionClip,
  MotionArtifactEnvelope,
  RetargetTargetBinding,
  RetargetedMotionClip,
  TargetBoundSolvedHumanoidMotionClip,
} from "./types";
import { MOTION_ARTIFACT_ENVELOPE_SCHEMA_VERSION } from "./types";
import { sha256Hex } from "@/core/sha256";

export function createCanonicalHumanoidMotionClip(
  motion: CanonicalMotion,
): CanonicalHumanoidMotionClip {
  return {
    ...motion,
    processing: {
      stage: "canonical",
      sourceCanonicalId: createCanonicalMotionId(motion),
    },
  };
}

export function createCanonicalMotionFromRetargetedClip(
  clip: RetargetedMotionClip,
): CanonicalMotion {
  const motion = { ...clip } as Record<string, unknown>;
  delete motion.processing;
  delete motion.target;
  return motion as CanonicalMotion;
}

export function isCanonicalHumanoidMotionClip(
  clip: RetargetedMotionClip,
): clip is CanonicalHumanoidMotionClip {
  return clip.processing.stage === "canonical";
}

export function getMotionTargetBinding(
  clip: RetargetedMotionClip,
): RetargetTargetBinding | undefined {
  return "target" in clip ? clip.target : undefined;
}

export function isTargetBoundHumanoidMotionClip(
  clip: RetargetedMotionClip,
): clip is TargetBoundSolvedHumanoidMotionClip {
  return clip.processing.stage === "solved" &&
    "target" in clip &&
    typeof clip.target?.rigSignature === "string" &&
    clip.target.rigSignature.length > 0;
}

export function createCanonicalMotionId(motion: CanonicalMotion) {
  return `canonical:sha256:${sha256Hex(
    new TextEncoder().encode(stableStringify(motion)),
  )}`;
}

export function createMotionArtifactEnvelope({
  artifactId,
  createdAt,
  motion,
  toolVersion,
}: {
  artifactId: string;
  createdAt: string;
  motion: CanonicalMotion;
  toolVersion: string;
}): MotionArtifactEnvelope {
  const timestamp = new Date(createdAt);
  if (
    !artifactId ||
    !toolVersion ||
    !Number.isFinite(timestamp.valueOf()) ||
    timestamp.toISOString() !== createdAt
  ) {
    throw new Error(
      "Motion artifact envelope requires an id, ISO timestamp, and tool version.",
    );
  }
  return {
    schemaVersion: MOTION_ARTIFACT_ENVELOPE_SCHEMA_VERSION,
    artifactId,
    createdAt,
    toolVersion,
    sourceHash: createCanonicalMotionId(motion),
    motion,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
