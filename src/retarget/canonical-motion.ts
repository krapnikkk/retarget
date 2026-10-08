import type {
  CanonicalMotion,
  CanonicalHumanoidMotionClip,
  MotionArtifactEnvelope,
  RetargetTargetBinding,
  RetargetedMotionClip,
  TargetBoundSolvedHumanoidMotionClip,
} from "./types";
import { MOTION_ARTIFACT_ENVELOPE_SCHEMA_VERSION } from "./types";
import { RetargetError } from "./errors";
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

/**
 * Scale from the clip's root translation units to the rest hips height a
 * target-relative export declares (`targetRestHipsHeight / sourceRestHipsHeight`),
 * matching the scale target binding applies to avatar outputs. Without a target
 * height the export declares the source rest height, so the scale is 1.
 * Formats with a fixed reference rest height (VMD) pass it as
 * `declaredRestHipsHeight` in place of the target's.
 */
export function resolveRootTranslationExportScale(
  clip: RetargetedMotionClip,
  declaredRestHipsHeight?: number,
) {
  const sourceRestHipsHeight = clip.metadata?.restHipsHeight;
  const hasSourceHeight =
    typeof sourceRestHipsHeight === "number" && sourceRestHipsHeight > 0;
  if (
    clip.metadata?.rootTranslationSpace === "offset-source-units" &&
    !hasSourceHeight
  ) {
    throw new RetargetError("ROOT_MOTION_SCALE_UNRESOLVED", {
      details: {
        sourceKind: clip.source.kind,
        sourceFilename: clip.source.filename,
      },
    });
  }
  const targetRestHipsHeight =
    declaredRestHipsHeight ??
    getMotionTargetBinding(clip)?.restHipsHeight ??
    clip.metadata?.targetHeight;
  return hasSourceHeight &&
    typeof targetRestHipsHeight === "number" &&
    targetRestHipsHeight > 0
    ? targetRestHipsHeight / sourceRestHipsHeight
    : 1;
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
