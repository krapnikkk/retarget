import {
  DEFAULT_PARSE_BUDGET,
  type ParseBudget,
  resolveParseBudget,
} from "@/import/parse-budget";
import { getRigDefinition } from "@/rigs/definitions";
import {
  validateFiniteTimeSeries,
  validateQuaternionSamples,
} from "@/validation/time-series";
import {
  RIG_MOTION_SCHEMA_VERSION,
  type RigMotionTrack,
  type RigMotionV2,
  type RigRestTransform,
} from "./types";

export type RigMotionValidationResult =
  | { ok: true; motion: RigMotionV2 }
  | { ok: false; issues: string[] };

export function validateRigMotion(
  value: unknown,
  budgetOverrides: Partial<ParseBudget> = {},
): RigMotionValidationResult {
  const budget = resolveParseBudget(budgetOverrides);
  const issues: string[] = [];
  const motion = value as Partial<RigMotionV2> | null;
  if (!motion || typeof motion !== "object") {
    return { ok: false, issues: ["Rig Motion must be an object."] };
  }
  if (motion.schemaVersion !== RIG_MOTION_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${RIG_MOTION_SCHEMA_VERSION}.`);
  }
  const definition = motion.rigDefinitionId
    ? getRigDefinition(motion.rigDefinitionId)
    : null;
  if (!definition) {
    issues.push("rigDefinitionId must identify an active rig definition.");
  } else if (motion.family !== definition.family) {
    issues.push("family must match rigDefinitionId.");
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
  if (!motion.source || motion.source.kind !== "gltf-animation") {
    issues.push("source.kind must be gltf-animation.");
  } else {
    validateSourceAnimation(motion.source.animation, issues);
  }

  const validRoles = new Set(definition?.roles.map((role) => role.id) ?? []);
  validateRestPose(motion.restPose, validRoles, budget, issues);
  validateTracks(
    motion.tracks,
    validRoles,
    definition?.translationRole,
    typeof duration === "number" && Number.isFinite(duration)
      ? duration
      : undefined,
    budget,
    issues,
  );

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, motion: motion as RigMotionV2 };
}

function validateSourceAnimation(
  animation: RigMotionV2["source"]["animation"] | undefined,
  issues: string[],
) {
  if (!animation || typeof animation !== "object") {
    issues.push("source.animation must identify the selected glTF action.");
    return;
  }
  if (!Number.isInteger(animation.index) || animation.index < 0) {
    issues.push("source.animation.index must be a non-negative integer.");
  }
  if (!animation.name || typeof animation.name !== "string") {
    issues.push("source.animation.name must be a non-empty string.");
  }
  if (
    !Array.isArray(animation.interpolationModes) ||
    animation.interpolationModes.length === 0 ||
    animation.interpolationModes.some(
      (mode) =>
        mode !== "LINEAR" && mode !== "STEP" && mode !== "CUBICSPLINE",
    )
  ) {
    issues.push(
      "source.animation.interpolationModes must contain supported glTF interpolation modes.",
    );
  }
  if (
    !Number.isInteger(animation.resampledTracks) ||
    animation.resampledTracks < 0
  ) {
    issues.push(
      "source.animation.resampledTracks must be a non-negative integer.",
    );
  }
}

export function parseRigMotion(json: string) {
  assertJsonWithinBudget(json);
  const validation = validateRigMotion(JSON.parse(json) as unknown);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }
  return validation.motion;
}

export function serializeRigMotion(motion: RigMotionV2) {
  const validation = validateRigMotion(motion);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }
  return JSON.stringify(validation.motion, null, 2);
}

function validateRestPose(
  restPose: RigMotionV2["restPose"] | undefined,
  validRoles: ReadonlySet<string>,
  budget: ParseBudget,
  issues: string[],
) {
  if (!Array.isArray(restPose) || restPose.length === 0) {
    issues.push("restPose must contain mapped rig roles.");
    return;
  }
  if (restPose.length > budget.maxTracks) {
    issues.push(`restPose must not contain more than ${budget.maxTracks} roles.`);
  }
  const roles = new Set<string>();
  restPose.forEach((transform, index) => {
    issues.push(...validateRestTransform(transform, index, validRoles));
    if (transform?.role) {
      if (roles.has(transform.role)) {
        issues.push(`restPose[${index}] duplicates role ${transform.role}.`);
      }
      roles.add(transform.role);
    }
  });
}

function validateTracks(
  tracks: RigMotionV2["tracks"] | undefined,
  validRoles: ReadonlySet<string>,
  translationRole: string | undefined,
  duration: number | undefined,
  budget: ParseBudget,
  issues: string[],
) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    issues.push("tracks must contain at least one track.");
    return;
  }
  if (tracks.length > budget.maxTracks) {
    issues.push(`tracks must not contain more than ${budget.maxTracks} tracks.`);
  }
  const keys = new Set<string>();
  let totalSamples = 0;
  tracks.forEach((track, index) => {
    const result = validateTrack(track, index, validRoles, duration, budget);
    issues.push(...result.issues);
    totalSamples += result.sampleCount;
    if (result.key) {
      if (keys.has(result.key)) {
        issues.push(`tracks[${index}] duplicates ${result.key}.`);
      }
      keys.add(result.key);
    }
    if (
      translationRole &&
      track?.path === "translation" &&
      track.role !== translationRole
    ) {
      issues.push(
        `tracks[${index}] translates ${track.role}; only ${translationRole} may translate.`,
      );
    }
  });
  if (totalSamples > budget.maxTotalSamples) {
    issues.push(
      `tracks contain ${totalSamples} samples; limit is ${budget.maxTotalSamples}.`,
    );
  }
}

function validateTrack(
  track: RigMotionTrack,
  index: number,
  validRoles: ReadonlySet<string>,
  duration: number | undefined,
  budget: ParseBudget,
) {
  if (!track || typeof track !== "object") {
    return {
      issues: [`tracks[${index}] must be an object.`],
      key: null,
      sampleCount: 0,
    };
  }
  const issues: string[] = [];
  if (!track.role || !validRoles.has(track.role)) {
    issues.push(`tracks[${index}].role is not defined by rigDefinitionId.`);
  }
  const validPath = track.path === "rotation" || track.path === "translation";
  if (!validPath) {
    issues.push(`tracks[${index}].path must be rotation or translation.`);
  }
  const valueSize = track.path === "rotation" ? 4 : 3;
  const series = validateFiniteTimeSeries({
    duration,
    label: `tracks[${index}]`,
    maxSamples: budget.maxSamplesPerTrack,
    times: track.times,
    valueSize,
    values: track.values,
  });
  issues.push(...series.issues);
  if (track.path === "rotation") {
    issues.push(
      ...validateQuaternionSamples({
        label: `tracks[${index}]`,
        values: track.values,
      }),
    );
  }
  return {
    issues,
    key: track.role && validRoles.has(track.role) && validPath
      ? `${track.role}.${track.path}`
      : null,
    sampleCount: series.sampleCount,
  };
}

function validateRestTransform(
  transform: RigRestTransform,
  index: number,
  validRoles: ReadonlySet<string>,
) {
  const issues: string[] = [];
  if (!transform || typeof transform !== "object" || !transform.role) {
    return [`restPose[${index}] must identify a role.`];
  }
  if (!validRoles.has(transform.role)) {
    issues.push(`restPose[${index}].role is not defined by rigDefinitionId.`);
  }
  if (transform.parentRole && !validRoles.has(transform.parentRole)) {
    issues.push(`restPose[${index}].parentRole is not defined by rigDefinitionId.`);
  }
  if (!transform.nodeName || typeof transform.nodeName !== "string") {
    issues.push(`restPose[${index}].nodeName must be a non-empty string.`);
  }
  if (!isTuple(transform.translation, 3)) {
    issues.push(`restPose[${index}].translation must contain 3 finite numbers.`);
  }
  validateRestQuaternion(transform.rotation, `restPose[${index}].rotation`, issues);
  if (!isTuple(transform.worldTranslation, 3)) {
    issues.push(
      `restPose[${index}].worldTranslation must contain 3 finite numbers.`,
    );
  }
  validateRestQuaternion(
    transform.worldRotation,
    `restPose[${index}].worldRotation`,
    issues,
  );
  if (transform.primaryAxis && !isTuple(transform.primaryAxis, 3)) {
    issues.push(`restPose[${index}].primaryAxis must contain 3 finite numbers.`);
  }
  return issues;
}

function validateRestQuaternion(
  value: unknown,
  label: string,
  issues: string[],
) {
  if (!isTuple(value, 4)) {
    issues.push(`${label} must contain 4 finite numbers.`);
    return;
  }
  issues.push(...validateQuaternionSamples({ label, values: value }));
}

function isTuple(value: unknown, size: number) {
  return (
    Array.isArray(value) &&
    value.length === size &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function assertJsonWithinBudget(json: string) {
  const byteLength = new TextEncoder().encode(json).byteLength;
  if (byteLength > DEFAULT_PARSE_BUDGET.maxInputBytes) {
    throw new Error(
      `Rig Motion JSON contains ${byteLength} bytes; limit is ${DEFAULT_PARSE_BUDGET.maxInputBytes}.`,
    );
  }
}
