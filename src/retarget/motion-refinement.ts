import type { HumanoidBoneName } from "./types";

export type Vec3Tuple = [number, number, number];

export type FootConstraintBone = Extract<
  HumanoidBoneName,
  "leftFoot" | "leftToes" | "rightFoot" | "rightToes"
>;

export type FootConstraintSamples = Partial<Record<FootConstraintBone, Vec3Tuple>>;

export type RootTranslationRefinementInput = {
  times: number[];
  rootOffsets: Vec3Tuple[];
  footSamples: FootConstraintSamples[];
  sourceRestFeet: FootConstraintSamples;
  targetRestFeet: FootConstraintSamples;
  sourceToTargetScale: number;
  targetHeight: number;
  rootMotion: boolean;
};

const FOOT_SIDE_BONES = {
  left: ["leftFoot", "leftToes"],
  right: ["rightFoot", "rightToes"],
} as const satisfies Record<string, readonly FootConstraintBone[]>;

type FootSide = keyof typeof FOOT_SIDE_BONES;
const EMPTY_FOOT_CONSTRAINT_SAMPLES: FootConstraintSamples = {};

const FOOT_LOCK_STRENGTH = 0.9;
// These are calibrated at 30 FPS and converted to a time-based alpha for each
// sample interval. The same motion therefore receives comparable refinement at
// 30, 60, or 120 FPS.
const REFERENCE_FPS = 30;
const FOOT_LOCK_ENGAGE_RATE_AT_REFERENCE_FPS = 0.5;
const FOOT_LOCK_RELEASE_RATE_AT_REFERENCE_FPS = 0.3;
const GROUND_LIFT_RELEASE_RATE_AT_REFERENCE_FPS = 0.35;

export function refineRootTranslationSamples({
  times,
  rootOffsets,
  footSamples,
  sourceRestFeet,
  targetRestFeet,
  sourceToTargetScale,
  targetHeight,
  rootMotion,
}: RootTranslationRefinementInput): Vec3Tuple[] {
  const groundY = getTargetGroundY(targetRestFeet);
  const contactHeight = Math.max(targetHeight * 0.025, 0.01);
  const verticalSpeedThreshold = Math.max(targetHeight * 0.32, 0.08);
  const horizontalSpeedThreshold = Math.max(targetHeight * 0.45, 0.12);
  const anchors: Partial<Record<FootSide, Vec3Tuple>> = {};
  const lockWeights: Record<FootSide, number> = { left: 0, right: 0 };
  const lockCorrections: Record<FootSide, [number, number]> = {
    left: [0, 0],
    right: [0, 0],
  };
  let groundLift = 0;

  return rootOffsets.map((rawOffset, index) => {
    const currentFootSamples =
      footSamples[index] ?? EMPTY_FOOT_CONSTRAINT_SAMPLES;
    const deltaTime = getSampleDeltaTime(times, index);
    const engageRate = timeAdjustedRate(
      FOOT_LOCK_ENGAGE_RATE_AT_REFERENCE_FPS,
      deltaTime,
    );
    const releaseRate = timeAdjustedRate(
      FOOT_LOCK_RELEASE_RATE_AT_REFERENCE_FPS,
      deltaTime,
    );
    const groundReleaseRate = timeAdjustedRate(
      GROUND_LIFT_RELEASE_RATE_AT_REFERENCE_FPS,
      deltaTime,
    );
    const root: Vec3Tuple = rootMotion
      ? [...rawOffset]
      : [0, rawOffset[1] > 0 ? rawOffset[1] : 0, 0];

    const neededLift = getNeededGroundLift(
      root,
      rawOffset,
      currentFootSamples,
      sourceRestFeet,
      targetRestFeet,
      sourceToTargetScale,
      groundY,
    );
    groundLift =
      neededLift >= groundLift
        ? neededLift
        : groundLift + (neededLift - groundLift) * groundReleaseRate;
    root[1] += groundLift;

    let weightSum = 0;
    let correctionX = 0;
    let correctionZ = 0;
    for (const side of Object.keys(FOOT_SIDE_BONES) as FootSide[]) {
      const projected = getSideProjectedFoot(
        side,
        root,
        rawOffset,
        currentFootSamples,
        sourceRestFeet,
        targetRestFeet,
        sourceToTargetScale,
      );

      const contact =
        projected !== null &&
        projected.lowestY <= groundY + contactHeight &&
        getSideVerticalSpeed(
          side,
          index,
          times,
          footSamples,
          sourceRestFeet,
          targetRestFeet,
          sourceToTargetScale,
        ) <= verticalSpeedThreshold &&
        getSideHorizontalSpeed(
          side,
          index,
          times,
          footSamples,
          sourceRestFeet,
          targetRestFeet,
          sourceToTargetScale,
        ) <= horizontalSpeedThreshold;

      if (contact) {
        anchors[side] ??= projected.center;
        const anchor = anchors[side]!;
        lockCorrections[side] = [
          (anchor[0] - projected.center[0]) * FOOT_LOCK_STRENGTH,
          (anchor[2] - projected.center[2]) * FOOT_LOCK_STRENGTH,
        ];
        lockWeights[side] += (1 - lockWeights[side]) * engageRate;
      } else {
        anchors[side] = undefined;
        lockWeights[side] *= 1 - releaseRate;
      }

      weightSum += lockWeights[side];
      correctionX += lockWeights[side] * lockCorrections[side][0];
      correctionZ += lockWeights[side] * lockCorrections[side][1];
    }

    if (weightSum > 1e-6) {
      const denominator = Math.max(weightSum, 1);
      root[0] += correctionX / denominator;
      root[2] += correctionZ / denominator;
    }

    return root;
  });
}

export function estimateArmRaiseOffsetDegrees(
  sourceDirection: Vec3Tuple | null,
  targetDirection: Vec3Tuple | null,
) {
  if (!sourceDirection || !targetDirection) {
    return 0;
  }

  const sourceAngle = getArmRaiseAngleDegrees(sourceDirection);
  const targetAngle = getArmRaiseAngleDegrees(targetDirection);
  // The retargeted rotation keeps the target at its own rest pose for a
  // rest-pose frame, so the target arm must rotate by the source-minus-target
  // rest angle to mimic the source (e.g. raise an A-pose arm for T-pose data).
  const offset = sourceAngle - targetAngle;

  if (Math.abs(offset) < 1) {
    return 0;
  }

  return clamp(offset, -65, 65);
}

function getNeededGroundLift(
  root: Vec3Tuple,
  rawOffset: Vec3Tuple,
  frameFeet: FootConstraintSamples,
  sourceRestFeet: FootConstraintSamples,
  targetRestFeet: FootConstraintSamples,
  sourceToTargetScale: number,
  groundY: number,
) {
  let lowestY = Infinity;

  for (const bone of Object.keys(frameFeet) as FootConstraintBone[]) {
    const projected = projectFootBone(
      bone,
      root,
      rawOffset,
      frameFeet,
      sourceRestFeet,
      targetRestFeet,
      sourceToTargetScale,
    );
    if (projected) {
      lowestY = Math.min(lowestY, projected[1]);
    }
  }

  if (!Number.isFinite(lowestY)) {
    return 0;
  }

  return Math.max(0, groundY - lowestY);
}

function getSideProjectedFoot(
  side: FootSide,
  root: Vec3Tuple,
  rawOffset: Vec3Tuple,
  frameFeet: FootConstraintSamples,
  sourceRestFeet: FootConstraintSamples,
  targetRestFeet: FootConstraintSamples,
  sourceToTargetScale: number,
) {
  const projected = FOOT_SIDE_BONES[side]
    .map((bone) =>
      projectFootBone(
        bone,
        root,
        rawOffset,
        frameFeet,
        sourceRestFeet,
        targetRestFeet,
        sourceToTargetScale,
      ),
    )
    .filter(Boolean) as Vec3Tuple[];

  if (projected.length === 0) {
    return null;
  }

  return {
    center: [
      average(projected, 0),
      average(projected, 1),
      average(projected, 2),
    ] as Vec3Tuple,
    lowestY: minimum(projected.map((value) => value[1])),
  };
}

function projectFootBone(
  bone: FootConstraintBone,
  root: Vec3Tuple,
  rawOffset: Vec3Tuple,
  frameFeet: FootConstraintSamples,
  sourceRestFeet: FootConstraintSamples,
  targetRestFeet: FootConstraintSamples,
  sourceToTargetScale: number,
) {
  const frame = frameFeet[bone];
  const sourceRest = sourceRestFeet[bone];
  const targetRest = targetRestFeet[bone];

  if (!frame || !sourceRest || !targetRest) {
    return null;
  }

  // The foot follows the hips, so only its displacement *relative to the raw
  // hips offset* may be added on top of the root track; adding the absolute
  // foot displacement would count locomotion twice and make the constraints
  // fight the root motion frame by frame.
  return [
    targetRest[0] +
      root[0] -
      rawOffset[0] +
      (frame[0] - sourceRest[0]) * sourceToTargetScale,
    targetRest[1] +
      root[1] -
      rawOffset[1] +
      (frame[1] - sourceRest[1]) * sourceToTargetScale,
    targetRest[2] +
      root[2] -
      rawOffset[2] +
      (frame[2] - sourceRest[2]) * sourceToTargetScale,
  ] as Vec3Tuple;
}

function getSideVerticalSpeed(
  side: FootSide,
  index: number,
  times: number[],
  footSamples: FootConstraintSamples[],
  sourceRestFeet: FootConstraintSamples,
  targetRestFeet: FootConstraintSamples,
  sourceToTargetScale: number,
) {
  const previousIndex = Math.max(0, index - 1);
  const currentTime = times[index] ?? 0;
  const previousTime = times[previousIndex] ?? currentTime;
  const dt = currentTime - previousTime;
  if (dt <= 0) {
    return 0;
  }

  // Contact detection cares about the foot's absolute world speed in the
  // source motion, so both the root and the raw hips offset are zeroed.
  const zero: Vec3Tuple = [0, 0, 0];
  const current = getSideProjectedFoot(
    side,
    zero,
    zero,
    footSamples[index] ?? EMPTY_FOOT_CONSTRAINT_SAMPLES,
    sourceRestFeet,
    targetRestFeet,
    sourceToTargetScale,
  );
  const previous = getSideProjectedFoot(
    side,
    zero,
    zero,
    footSamples[previousIndex] ?? EMPTY_FOOT_CONSTRAINT_SAMPLES,
    sourceRestFeet,
    targetRestFeet,
    sourceToTargetScale,
  );

  if (!current || !previous) {
    return Infinity;
  }

  return Math.abs(current.center[1] - previous.center[1]) / dt;
}

function getSideHorizontalSpeed(
  side: FootSide,
  index: number,
  times: number[],
  footSamples: FootConstraintSamples[],
  sourceRestFeet: FootConstraintSamples,
  targetRestFeet: FootConstraintSamples,
  sourceToTargetScale: number,
) {
  const previousIndex = Math.max(0, index - 1);
  const currentTime = times[index] ?? 0;
  const previousTime = times[previousIndex] ?? currentTime;
  const dt = currentTime - previousTime;
  if (dt <= 0) {
    return 0;
  }

  const zero: Vec3Tuple = [0, 0, 0];
  const current = getSideProjectedFoot(
    side,
    zero,
    zero,
    footSamples[index] ?? EMPTY_FOOT_CONSTRAINT_SAMPLES,
    sourceRestFeet,
    targetRestFeet,
    sourceToTargetScale,
  );
  const previous = getSideProjectedFoot(
    side,
    zero,
    zero,
    footSamples[previousIndex] ?? EMPTY_FOOT_CONSTRAINT_SAMPLES,
    sourceRestFeet,
    targetRestFeet,
    sourceToTargetScale,
  );

  if (!current || !previous) {
    return Infinity;
  }

  const dx = current.center[0] - previous.center[0];
  const dz = current.center[2] - previous.center[2];
  return Math.hypot(dx, dz) / dt;
}

function getTargetGroundY(targetRestFeet: FootConstraintSamples) {
  const values = Object.values(targetRestFeet).map((value) => value[1]);
  return values.length > 0 ? minimum(values) : 0;
}

function getSampleDeltaTime(times: readonly number[], index: number) {
  if (index <= 0) return 1 / REFERENCE_FPS;
  const delta = (times[index] ?? 0) - (times[index - 1] ?? 0);
  return Number.isFinite(delta) && delta > 0 ? delta : 1 / REFERENCE_FPS;
}

function timeAdjustedRate(referenceRate: number, deltaTime: number) {
  return 1 - Math.pow(1 - referenceRate, deltaTime * REFERENCE_FPS);
}

function minimum(values: readonly number[]) {
  let result = Infinity;
  for (const value of values) result = Math.min(result, value);
  return result;
}

function getArmRaiseAngleDegrees(direction: Vec3Tuple) {
  const horizontalLength = Math.hypot(direction[0], direction[2]);
  if (horizontalLength === 0 && direction[1] === 0) {
    return 0;
  }

  return (Math.atan2(direction[1], horizontalLength) * 180) / Math.PI;
}

function average(values: Vec3Tuple[], component: 0 | 1 | 2) {
  return (
    values.reduce((sum, value) => sum + value[component], 0) / values.length
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
