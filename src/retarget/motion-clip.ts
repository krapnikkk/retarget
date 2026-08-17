import {
  MOTION_CLIP_SCHEMA_VERSION,
  type CanonicalMotion,
  type MotionTrack,
  type RetargetTargetBinding,
  type RetargetedMotionClip,
  isHumanoidBoneName,
} from "./types";
import {
  DEFAULT_PARSE_BUDGET,
  type ParseBudget,
  resolveParseBudget,
} from "@/import/parse-budget";
import {
  validateFiniteTimeSeries,
  validateQuaternionSamples,
} from "@/validation/time-series";

export type CanonicalMotionValidationResult =
  | { ok: true; motion: CanonicalMotion }
  | { ok: false; issues: string[] };

export type MotionClipValidationResult =
  | { ok: true; clip: RetargetedMotionClip }
  | { ok: false; issues: string[] };

const TRACK_VALUE_SIZE: Record<MotionTrack["path"], number> = {
  rotation: 4,
  translation: 3,
};

export function validateCanonicalMotion(
  value: unknown,
  budgetOverrides: Partial<ParseBudget> = {},
): CanonicalMotionValidationResult {
  const issues = validateCanonicalMotionShape(
    value,
    resolveParseBudget(budgetOverrides),
  );

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, motion: value as CanonicalMotion };
}

export function validateMotionClip(
  value: unknown,
  budgetOverrides: Partial<ParseBudget> = {},
): MotionClipValidationResult {
  const issues = validateCanonicalMotionShape(
    value,
    resolveParseBudget(budgetOverrides),
  );
  const clip = value as Partial<RetargetedMotionClip> | null;

  if (clip && typeof clip === "object") {
    const target = (clip as { target?: Partial<RetargetTargetBinding> }).target;
    if (target !== undefined) {
      if (!target || typeof target !== "object") {
        issues.push("target must be a target binding when present.");
      } else if (!isSupportedTargetKind(target.kind)) {
        issues.push("target.kind must be a supported avatar target format.");
      } else if (!target.filename || typeof target.filename !== "string") {
        issues.push("target.filename must be a non-empty string.");
      } else if (
        typeof target.rigSignature !== "string" ||
        target.rigSignature.length === 0
      ) {
        issues.push("a target-bound clip must include target.rigSignature.");
      }
    }
    if (clip.processing === undefined) {
      issues.push("processing must describe the canonical or solved stage.");
    } else {
      validateProcessing(clip.processing, issues);
      if (target !== undefined && clip.processing.stage !== "solved") {
        issues.push("only a solved clip may include a target binding.");
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, clip: clip as RetargetedMotionClip };
}

function validateProcessing(value: unknown, issues: string[]) {
  if (!value || typeof value !== "object") {
    issues.push("processing must describe the canonical or solved stage.");
    return;
  }
  const processing = value as Partial<RetargetedMotionClip["processing"]>;
  if (!processing.sourceCanonicalId || typeof processing.sourceCanonicalId !== "string") {
    issues.push("processing.sourceCanonicalId must be a non-empty string.");
  }
  if (processing.stage === "canonical") {
    return;
  }
  if (processing.stage !== "solved") {
    issues.push("processing.stage must be canonical or solved.");
    return;
  }
  if (
    processing.solverId !== "humanoid-custom-v4" ||
    processing.solverRevision !== 4 ||
    processing.solvePass !== 1
  ) {
    issues.push("solved processing evidence must identify humanoid-custom-v4 revision 4 pass 1.");
  }
}

function isSupportedTargetKind(value: unknown) {
  return (
    value === "vrm" ||
    value === "gltf-humanoid" ||
    value === "mixamo-rigged" ||
    value === "ready-player-me" ||
    value === "reallusion" ||
    value === "mmd-model" ||
    value === "generic-fbx-avatar"
  );
}

function validateCanonicalMotionShape(
  value: unknown,
  budget: ParseBudget,
): string[] {
  const issues: string[] = [];
  const motion = value as Partial<CanonicalMotion> | null;

  if (!motion || typeof motion !== "object") {
    return ["Motion must be an object."];
  }

  if (motion.schemaVersion !== MOTION_CLIP_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${MOTION_CLIP_SCHEMA_VERSION}.`);
  }

  if (!motion.name || typeof motion.name !== "string") {
    issues.push("name must be a non-empty string.");
  }

  const duration = motion.duration;
  if (!Number.isFinite(duration) || (duration ?? 0) <= 0) {
    issues.push("duration must be a positive finite number.");
  } else if ((duration as number) > budget.maxDurationSeconds) {
    issues.push(`duration must not exceed ${budget.maxDurationSeconds} seconds.`);
  }

  const fps = motion.fps;
  if (!Number.isFinite(fps) || (fps ?? 0) <= 0) {
    issues.push("fps must be a positive finite number.");
  } else if ((fps as number) > budget.maxFps) {
    issues.push(`fps must not exceed ${budget.maxFps}.`);
  }

  if (!motion.source || typeof motion.source !== "object") {
    issues.push("source must describe the source motion.");
  } else {
    if (
      motion.source.kind !== "mixamo-fbx" &&
      motion.source.kind !== "vrma" &&
      motion.source.kind !== "bvh" &&
      motion.source.kind !== "vmd" &&
      motion.source.kind !== "gltf-animation" &&
      motion.source.kind !== "actorcore-fbx" &&
      motion.source.kind !== "generic-fbx"
    ) {
      issues.push("source.kind must be a supported motion input format.");
    }
    if (!motion.source.filename || typeof motion.source.filename !== "string") {
      issues.push("source.filename must be a non-empty string.");
    }
  }

  if (!Array.isArray(motion.tracks) || motion.tracks.length === 0) {
    issues.push("tracks must contain at least one track.");
  } else {
    if (motion.tracks.length > budget.maxTracks) {
      issues.push(`tracks must not contain more than ${budget.maxTracks} tracks.`);
    }
    let totalSamples = 0;
    const trackKeys = new Set<string>();
    motion.tracks.forEach((track, index) => {
      const validation = validateTrack(
        track,
        index,
        typeof duration === "number" ? duration : undefined,
        budget,
      );
      issues.push(...validation.issues);
      totalSamples += validation.sampleCount;
      if (validation.key) {
        if (trackKeys.has(validation.key)) {
          issues.push(`tracks[${index}] duplicates ${validation.key}.`);
        }
        trackKeys.add(validation.key);
      }
    });
    if (totalSamples > budget.maxTotalSamples) {
      issues.push(
        `tracks contain ${totalSamples} samples; limit is ${budget.maxTotalSamples}.`,
      );
    }
  }

  return issues;
}

function validateTrack(
  track: unknown,
  index: number,
  duration: number | undefined,
  budget: ParseBudget,
) {
  const issues: string[] = [];

  if (!track || typeof track !== "object") {
    return {
      issues: [`tracks[${index}] must be an object.`],
      key: null,
      sampleCount: 0,
    };
  }
  const candidate = track as Partial<MotionTrack>;

  if (typeof candidate.bone !== "string" || !isHumanoidBoneName(candidate.bone)) {
    issues.push(`tracks[${index}].bone is not a supported humanoid bone.`);
  }

  if (candidate.path !== "rotation" && candidate.path !== "translation") {
    issues.push(`tracks[${index}].path must be rotation or translation.`);
  }

  const times = candidate.times;
  const values = candidate.values;

  if (
    Array.isArray(times) &&
    Array.isArray(values) &&
    (candidate.path === "rotation" || candidate.path === "translation")
  ) {
    const elementSize = TRACK_VALUE_SIZE[candidate.path];
    issues.push(
      ...validateFiniteTimeSeries({
        duration,
        label: `tracks[${index}]`,
        maxSamples: budget.maxSamplesPerTrack,
        times,
        valueSize: elementSize,
        values,
      }).issues,
    );
    if (candidate.path === "rotation" && values.length % 4 === 0) {
      issues.push(
        ...validateQuaternionSamples({ label: `tracks[${index}]`, values }),
      );
    }
  } else {
    issues.push(
      ...validateFiniteTimeSeries({
        duration,
        label: `tracks[${index}]`,
        maxSamples: budget.maxSamplesPerTrack,
        times,
        valueSize: 1,
        values,
      }).issues,
    );
  }

  return {
    issues,
    key:
      typeof candidate.bone === "string" &&
      isHumanoidBoneName(candidate.bone) &&
      (candidate.path === "rotation" || candidate.path === "translation")
        ? `${candidate.bone}.${candidate.path}`
        : null,
    sampleCount: Array.isArray(times) ? times.length : 0,
  };
}

export function serializeCanonicalMotion(motion: CanonicalMotion): string {
  const validation = validateCanonicalMotion(motion);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  return JSON.stringify(motion, null, 2);
}

export function parseCanonicalMotion(json: string): CanonicalMotion {
  assertJsonWithinBudget(json);
  const parsed = JSON.parse(json) as unknown;
  const validation = validateCanonicalMotion(parsed);

  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  return validation.motion;
}

export function serializeMotionClip(clip: RetargetedMotionClip): string {
  const validation = validateMotionClip(clip);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  return JSON.stringify(clip, null, 2);
}

export function parseMotionClip(json: string): RetargetedMotionClip {
  assertJsonWithinBudget(json);
  const parsed = JSON.parse(json) as unknown;
  const validation = validateMotionClip(parsed);

  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  return validation.clip;
}

function assertJsonWithinBudget(json: string) {
  const byteLength = new TextEncoder().encode(json).byteLength;
  if (byteLength > DEFAULT_PARSE_BUDGET.maxInputBytes) {
    throw new Error(
      `Motion JSON contains ${byteLength} bytes; limit is ${DEFAULT_PARSE_BUDGET.maxInputBytes}.`,
    );
  }
}
