import { Quaternion, Vector3 } from "three";
import {
  HUMANOID_BONES,
  type HumanoidBoneName,
  type RetargetedMotionClip,
} from "@/retarget";
import {
  createSemanticSampleTimes,
  sampleSemanticMotionPose,
  solveSemanticWorldPose,
} from "./semantic-fk-oracle";

export type SemanticRestBone = {
  parent?: HumanoidBoneName;
  worldPosition: [number, number, number];
  worldQuaternion: [number, number, number, number];
  worldScale?: [number, number, number];
};

export type HumanoidSemanticRestPose = ReadonlyMap<
  HumanoidBoneName,
  SemanticRestBone
>;

export type SemanticValidationThresholds = {
  durationSeconds: number;
  rotationDegrees: number;
  rootDisplacementMeters: number;
  rootDirectionDegrees: number;
  endEffectorMeters: number;
  symmetryMeters: number;
};

export const DEFAULT_SEMANTIC_THRESHOLDS = {
  durationSeconds: 1 / 120,
  rotationDegrees: 0.5,
  rootDisplacementMeters: 0.005,
  rootDirectionDegrees: 1,
  endEffectorMeters: 0.01,
  symmetryMeters: 0.01,
} as const satisfies SemanticValidationThresholds;

const DEFAULT_END_EFFECTORS = [
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
] as const satisfies readonly HumanoidBoneName[];

export type SemanticMotionValidationResult = {
  level: "semantic";
  ok: boolean;
  sampleTimes: number[];
  issues: string[];
  missingRotationTracks: HumanoidBoneName[];
  metrics: {
    durationErrorSeconds: number;
    maxRotationErrorDegrees: number;
    maxRootDisplacementErrorMeters: number;
    maxRootDirectionErrorDegrees: number;
    maxEndEffectorErrorMeters: number;
    maxSymmetryErrorMeters: number;
  };
};

export function validateHumanoidMotionSemantics({
  actual,
  endEffectors = DEFAULT_END_EFFECTORS,
  expected,
  restPose,
  rootScale,
  rotationBones,
  sampleFractions = [],
  thresholds = DEFAULT_SEMANTIC_THRESHOLDS,
}: {
  actual: RetargetedMotionClip;
  expected: RetargetedMotionClip;
  restPose?: HumanoidSemanticRestPose;
  /** Expected-to-actual root scale from bound export evidence. When given,
   * both clips may stay in their own declared units. */
  rootScale?: number;
  rotationBones?: readonly HumanoidBoneName[];
  endEffectors?: readonly HumanoidBoneName[];
  sampleFractions?: readonly number[];
  thresholds?: SemanticValidationThresholds;
}): SemanticMotionValidationResult {
  const issues: string[] = [];
  const comparesRootTranslation = expected.tracks.some(
    (track) => track.bone === "hips" && track.path === "translation",
  );
  if (
    comparesRootTranslation &&
    rootScale === undefined &&
    (expected.metadata?.rootTranslationSpace !== "offset-meters" ||
      actual.metadata?.rootTranslationSpace !== "offset-meters")
  ) {
    issues.push("root displacement cannot be certified without meter-normalized tracks");
  }
  const durationErrorSeconds = Math.abs(expected.duration - actual.duration);
  if (durationErrorSeconds > thresholds.durationSeconds) {
    issues.push(
      `duration drift ${durationErrorSeconds.toFixed(6)}s exceeds ${thresholds.durationSeconds.toFixed(6)}s`,
    );
  }

  const expectedRotationBones = new Set(
    expected.tracks
      .filter((track) => track.path === "rotation")
      .map((track) => track.bone),
  );
  const comparedRotationBones = rotationBones
    ? rotationBones.filter((bone) => expectedRotationBones.has(bone))
    : HUMANOID_BONES.filter((bone) => expectedRotationBones.has(bone));
  const actualRotationBones = new Set(
    actual.tracks
      .filter((track) => track.path === "rotation")
      .map((track) => track.bone),
  );
  const missingRotationTracks = comparedRotationBones.filter(
    (bone) => !actualRotationBones.has(bone),
  );
  if (missingRotationTracks.length > 0) {
    issues.push(`missing rotation tracks: ${missingRotationTracks.join(", ")}`);
  }

  const expectedRootScale =
    rootScale ?? resolveExpectedRootScale(expected, restPose);
  const sampleTimes = createSemanticSampleTimes({
    actual,
    expected,
    restPose,
    rootScale: expectedRootScale,
    sampleFractions,
  });
  const expectedRootOrigin = sampleRootPosition(
    expected,
    sampleTimes[0] ?? 0,
    expectedRootScale,
  );
  const actualRootOrigin = sampleRootPosition(actual, sampleTimes[0] ?? 0);
  let maxRotationErrorDegrees = 0;
  let maxRootDisplacementErrorMeters = 0;
  let maxRootDirectionErrorDegrees = 0;
  let maxEndEffectorErrorMeters = 0;
  let maxSymmetryErrorMeters = 0;

  for (const time of sampleTimes) {
    const expectedPose = sampleSemanticMotionPose(expected, time);
    const actualPose = sampleSemanticMotionPose(actual, time);
    for (const bone of comparedRotationBones) {
      if (!actualRotationBones.has(bone)) continue;
      const error = quaternionAngleDegrees(
        expectedPose[bone]?.rotation ?? [0, 0, 0, 1],
        actualPose[bone]?.rotation ?? [0, 0, 0, 1],
      );
      maxRotationErrorDegrees = Math.max(maxRotationErrorDegrees, error);
    }

    const expectedRoot = sampleRootPosition(expected, time, expectedRootScale).sub(
      expectedRootOrigin,
    );
    const actualRoot = sampleRootPosition(actual, time).sub(actualRootOrigin);
    maxRootDisplacementErrorMeters = Math.max(
      maxRootDisplacementErrorMeters,
      expectedRoot.distanceTo(actualRoot),
    );
    const expectedHorizontal = new Vector3(expectedRoot.x, 0, expectedRoot.z);
    const actualHorizontal = new Vector3(actualRoot.x, 0, actualRoot.z);
    if (expectedHorizontal.lengthSq() > 1e-10 && actualHorizontal.lengthSq() > 1e-10) {
      maxRootDirectionErrorDegrees = Math.max(
        maxRootDirectionErrorDegrees,
        expectedHorizontal.angleTo(actualHorizontal) * (180 / Math.PI),
      );
    }

    if (restPose) {
      const expectedWorld = solveSemanticWorldPose({
        clip: expected,
        restPose,
        rootScale: expectedRootScale,
        time,
      });
      const actualWorld = solveSemanticWorldPose({
        clip: actual,
        restPose,
        time,
      });
      for (const bone of endEffectors) {
        const expectedPosition = expectedWorld.get(bone)?.position;
        const actualPosition = actualWorld.get(bone)?.position;
        if (!expectedPosition || !actualPosition) continue;
        maxEndEffectorErrorMeters = Math.max(
          maxEndEffectorErrorMeters,
          expectedPosition.distanceTo(actualPosition),
        );
      }
      for (const [left, right] of [
        ["leftHand", "rightHand"],
        ["leftFoot", "rightFoot"],
      ] as const) {
        const expectedLeft = expectedWorld.get(left)?.position;
        const expectedRight = expectedWorld.get(right)?.position;
        const actualLeft = actualWorld.get(left)?.position;
        const actualRight = actualWorld.get(right)?.position;
        if (!expectedLeft || !expectedRight || !actualLeft || !actualRight) continue;
        maxSymmetryErrorMeters = Math.max(
          maxSymmetryErrorMeters,
          Math.abs(
            expectedLeft.distanceTo(expectedRight) -
              actualLeft.distanceTo(actualRight),
          ),
        );
      }
    }
  }

  if (maxRotationErrorDegrees > thresholds.rotationDegrees) {
    issues.push(
      `rotation error ${maxRotationErrorDegrees.toFixed(6)}deg exceeds ${thresholds.rotationDegrees.toFixed(6)}deg`,
    );
  }
  if (maxRootDisplacementErrorMeters > thresholds.rootDisplacementMeters) {
    issues.push(
      `root displacement error ${maxRootDisplacementErrorMeters.toFixed(6)}m exceeds ${thresholds.rootDisplacementMeters.toFixed(6)}m`,
    );
  }
  if (maxRootDirectionErrorDegrees > thresholds.rootDirectionDegrees) {
    issues.push(
      `root direction error ${maxRootDirectionErrorDegrees.toFixed(6)}deg exceeds ${thresholds.rootDirectionDegrees.toFixed(6)}deg`,
    );
  }
  if (restPose && maxEndEffectorErrorMeters > thresholds.endEffectorMeters) {
    issues.push(
      `end-effector error ${maxEndEffectorErrorMeters.toFixed(6)}m exceeds ${thresholds.endEffectorMeters.toFixed(6)}m`,
    );
  }
  if (restPose && maxSymmetryErrorMeters > thresholds.symmetryMeters) {
    issues.push(
      `left/right symmetry error ${maxSymmetryErrorMeters.toFixed(6)}m exceeds ${thresholds.symmetryMeters.toFixed(6)}m`,
    );
  }

  return {
    level: "semantic",
    ok: issues.length === 0,
    sampleTimes,
    issues,
    missingRotationTracks,
    metrics: {
      durationErrorSeconds,
      maxRotationErrorDegrees,
      maxRootDisplacementErrorMeters,
      maxRootDirectionErrorDegrees,
      maxEndEffectorErrorMeters,
      maxSymmetryErrorMeters,
    },
  };
}

function sampleRootPosition(
  clip: RetargetedMotionClip,
  time: number,
  scale = 1,
) {
  return new Vector3(
    ...(sampleSemanticMotionPose(clip, time).hips?.position ?? [0, 0, 0]),
  ).multiplyScalar(scale);
}

function resolveExpectedRootScale(
  expected: RetargetedMotionClip,
  restPose?: HumanoidSemanticRestPose,
) {
  const sourceRestHipsHeight = expected.metadata?.restHipsHeight;
  const targetRestHipsHeight = restPose?.get("hips")?.worldPosition[1];
  return sourceRestHipsHeight &&
    sourceRestHipsHeight > 0 &&
    targetRestHipsHeight &&
    targetRestHipsHeight > 0
    ? targetRestHipsHeight / sourceRestHipsHeight
    : 1;
}

function quaternionAngleDegrees(
  expected: [number, number, number, number],
  actual: [number, number, number, number],
) {
  const left = new Quaternion(...expected).normalize();
  const right = new Quaternion(...actual).normalize();
  const dot = clamp(Math.abs(left.dot(right)), -1, 1);
  return 2 * Math.acos(dot) * (180 / Math.PI);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
