import { DEFAULT_PARSE_BUDGET } from "@/import/parse-budget";
import {
  validateMotionClip,
  type RetargetSolveOptions,
  type RetargetedMotionClip,
} from "@/retarget";
import { validateRigMotion, type RigMotionV2 } from "@/rig-motion";

export type ProcessingBudget = {
  maxDurationSeconds: number;
  maxFps: number;
  maxFrames: number;
  maxTracks: number;
  maxTotalSamples: number;
  maxGeneratedValues: number;
  maxOutputBytes: number;
  softDeadlineMs: number;
};

export const DEFAULT_PROCESSING_BUDGET = {
  maxDurationSeconds: DEFAULT_PARSE_BUDGET.maxDurationSeconds,
  maxFps: DEFAULT_PARSE_BUDGET.maxFps,
  maxFrames: DEFAULT_PARSE_BUDGET.maxSamplesPerTrack,
  maxTracks: DEFAULT_PARSE_BUDGET.maxTracks,
  maxTotalSamples: DEFAULT_PARSE_BUDGET.maxTotalSamples,
  maxGeneratedValues: 12_000_000,
  maxOutputBytes: 256 * 1024 * 1024,
  softDeadlineMs: 45_000,
} as const satisfies ProcessingBudget;

export class ProcessingBudgetError extends Error {
  readonly code: string;
  readonly declared?: number;
  readonly limit?: number;
  readonly phase?: string;

  constructor({
    code,
    declared,
    limit,
    message,
    phase,
  }: {
    code: string;
    message: string;
    declared?: number;
    limit?: number;
    phase?: string;
  }) {
    super(
      [
        message,
        phase ? `phase=${phase}` : null,
        declared === undefined ? null : `declared=${declared}`,
        limit === undefined ? null : `limit=${limit}`,
      ]
        .filter(Boolean)
        .join("; "),
    );
    this.name = "ProcessingBudgetError";
    this.code = code;
    this.declared = declared;
    this.limit = limit;
    this.phase = phase;
  }
}

export function assertMotionProcessingBudget(
  clip: RetargetedMotionClip,
  budget: ProcessingBudget = DEFAULT_PROCESSING_BUDGET,
) {
  const validation = validateMotionClip(clip, {
    maxDurationSeconds: budget.maxDurationSeconds,
    maxFps: budget.maxFps,
    maxTracks: budget.maxTracks,
    maxSamplesPerTrack: budget.maxFrames,
    maxTotalSamples: budget.maxTotalSamples,
  });
  if (!validation.ok) {
    throw new ProcessingBudgetError({
      code: "PROCESSING_CLIP_INVALID",
      message: validation.issues.join(" "),
      phase: "validate",
    });
  }
}

export function assertRigMotionProcessingBudget(
  motion: RigMotionV2,
  budget: ProcessingBudget = DEFAULT_PROCESSING_BUDGET,
) {
  const validation = validateRigMotion(motion, {
    maxDurationSeconds: budget.maxDurationSeconds,
    maxFps: budget.maxFps,
    maxTracks: budget.maxTracks,
    maxSamplesPerTrack: budget.maxFrames,
    maxTotalSamples: budget.maxTotalSamples,
  });
  if (!validation.ok) {
    throw new ProcessingBudgetError({
      code: "PROCESSING_RIG_MOTION_INVALID",
      message: validation.issues.join(" "),
      phase: "validate",
    });
  }
  const generatedValues = motion.tracks.reduce(
    (total, track) => total + track.values.length,
    0,
  );
  assertSafeCount(
    generatedValues,
    budget.maxGeneratedValues,
    "rig motion scalar values",
    "solve",
  );
}

export function assertRetargetSolveBudget({
  boneCount,
  duration,
  fps,
  options,
  budget = DEFAULT_PROCESSING_BUDGET,
}: {
  boneCount: number;
  duration: number;
  fps: number;
  options: RetargetSolveOptions;
  budget?: ProcessingBudget;
}) {
  assertFiniteRange(duration, 1 / budget.maxFps, budget.maxDurationSeconds, {
    code: "PROCESSING_DURATION_LIMIT",
    label: "retarget duration",
    phase: "solve",
  });
  assertFiniteRange(fps, 1, budget.maxFps, {
    code: "PROCESSING_FPS_LIMIT",
    label: "retarget FPS",
    phase: "solve",
  });
  assertFiniteRange(options.heightScale, 0.05, 20, {
    code: "PROCESSING_OPTION_INVALID",
    label: "heightScale",
    phase: "solve",
  });
  assertFiniteRange(options.armOffsetDegrees, -180, 180, {
    code: "PROCESSING_OPTION_INVALID",
    label: "armOffsetDegrees",
    phase: "solve",
  });
  assertSafeCount(boneCount, budget.maxTracks, "mapped bones", "solve");

  const frameCount = Math.ceil(duration * fps) + 1;
  assertSafeCount(frameCount, budget.maxFrames, "generated frames", "solve");
  assertSafeCount(
    frameCount * Math.max(boneCount, 1),
    budget.maxTotalSamples,
    "generated bone samples",
    "solve",
  );
}

export function assertGeneratedExportBudget({
  frameCount,
  valuesPerFrame,
  estimatedOutputBytes,
  budget = DEFAULT_PROCESSING_BUDGET,
  phase = "export",
}: {
  frameCount: number;
  valuesPerFrame: number;
  estimatedOutputBytes?: number;
  budget?: ProcessingBudget;
  phase?: string;
}) {
  assertSafeCount(frameCount, budget.maxFrames, "generated frames", phase);
  assertSafeCount(
    frameCount * valuesPerFrame,
    budget.maxGeneratedValues,
    "generated scalar values",
    phase,
  );
  if (estimatedOutputBytes !== undefined) {
    assertSafeCount(
      estimatedOutputBytes,
      budget.maxOutputBytes,
      "estimated output bytes",
      phase,
    );
  }
}

export function assertOutputBytes(
  byteLength: number,
  budget: ProcessingBudget = DEFAULT_PROCESSING_BUDGET,
) {
  assertSafeCount(byteLength, budget.maxOutputBytes, "output bytes", "export");
}

export function createProcessingDeadline(
  deadlineMs: number = DEFAULT_PROCESSING_BUDGET.softDeadlineMs,
) {
  const startedAt = performance.now();
  return {
    checkpoint(phase: string) {
      const elapsed = performance.now() - startedAt;
      if (elapsed > deadlineMs) {
        throw new ProcessingBudgetError({
          code: "PROCESSING_DEADLINE_EXCEEDED",
          declared: Math.round(elapsed),
          limit: deadlineMs,
          message: "processing soft deadline exceeded",
          phase,
        });
      }
    },
  };
}

function assertFiniteRange(
  value: number,
  min: number,
  max: number,
  details: { code: string; label: string; phase: string },
) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ProcessingBudgetError({
      code: details.code,
      declared: value,
      limit: max,
      message: `${details.label} must be finite and between ${min} and ${max}`,
      phase: details.phase,
    });
  }
}

function assertSafeCount(
  value: number,
  limit: number,
  label: string,
  phase: string,
) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) {
    throw new ProcessingBudgetError({
      code: "PROCESSING_BUDGET_EXCEEDED",
      declared: value,
      limit,
      message: `${label} exceeds the processing budget`,
      phase,
    });
  }
}
