import { Quaternion, Vector3 } from "three";
import { VRM_HUMANOID_PROFILE, type RigProfile } from "@/profiles";
import {
  REQUIRED_VRM_BONES,
  RetargetError,
  type HumanoidBoneName,
  type MotionTrack,
} from "@/retarget";
import { createImportedHumanoidMotionClip } from "./humanoid-motion";
import {
  resolveParseBudget,
  assertCountWithinBudget,
  type ParseBudget,
} from "./parse-budget";

/** Evaluated local TRS, right-handed Y-up metres, +Z forward. No runtime objects. */
export interface HumanoidSkeletalMotion {
  name: string;
  fps: number;
  joints: Array<{
    name: string;
    parent: number;
    /** Semantic index in the explicitly selected layout; null for helpers. */
    humanBone: number | null;
    rest: number[];
  }>;
  times: number[];
  /** Frame-major local position(3), XYZW quaternion(4), scale(3). */
  frames: number[][];
}

// Unity's thumb Proximal is the VRM thumb Metacarpal (not VRM Proximal).
const BONES: readonly (HumanoidBoneName | null)[] = [
  "hips",
  "leftUpperLeg",
  "rightUpperLeg",
  "leftLowerLeg",
  "rightLowerLeg",
  "leftFoot",
  "rightFoot",
  "spine",
  "chest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
  "leftToes",
  "rightToes",
  null,
  null,
  null,
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
  "upperChest",
];
const HUMAN_TRAIT_BONES: readonly (HumanoidBoneName | null)[] = [
  ...BONES.slice(0, 9),
  "upperChest",
  ...BONES.slice(9, 24),
  ...BONES.slice(24, 54),
  "upperChest",
];
const PROFILE: RigProfile = {
  ...VRM_HUMANOID_PROFILE,
  id: "skeletal-humanoid",
  label: "Evaluated humanoid skeleton",
  forwardAxis: "z",
  restPose: "t-pose",
  supportsFacialAnimation: false,
  sourceFormats: [],
};

/** Fold helpers/root ancestors into semantic joints, then normalize rest-space rotations.
 * No Mixamo/Xbot skeleton, IK, contact correction, smoothing or time-zero trimming.
 */
export function importHumanoidSkeletalMotion(
  motion: HumanoidSkeletalMotion,
  options: {
    humanBoneLayout: "unity-human-body-bones" | "unity-human-trait";
    budget?: Partial<ParseBudget>;
  },
) {
  const invalid = (message: string): never => {
    throw new RetargetError("PROCESSING_CLIP_INVALID", { message });
  };
  const budget = resolveParseBudget(options.budget);
  if (
    !["unity-human-body-bones", "unity-human-trait"].includes(
      options.humanBoneLayout,
    )
  )
    invalid("Explicit human bone layout is required.");
  const bones =
    options.humanBoneLayout === "unity-human-trait" ? HUMAN_TRAIT_BONES : BONES;
  if (
    !motion ||
    !Array.isArray(motion.joints) ||
    !Array.isArray(motion.times) ||
    !Array.isArray(motion.frames)
  )
    invalid("Expected skeletal motion arrays.");
  const { joints, times, frames } = motion;
  if (
    !motion.name ||
    !Number.isFinite(motion.fps) ||
    motion.fps <= 0 ||
    motion.fps > budget.maxFps
  )
    invalid("Invalid motion name or FPS.");
  if (
    !joints.length ||
    times.length < 2 ||
    times.length !== frames.length ||
    times[0] !== 0
  )
    invalid("Expected at least two frames starting at time zero.");
  assertCountWithinBudget(joints.length, budget.maxBones, "skeletal joints");
  assertCountWithinBudget(
    times.length,
    budget.maxSamplesPerTrack,
    "skeletal frames",
  );
  assertCountWithinBudget(
    times.length * joints.length,
    budget.maxTotalSamples,
    "skeletal samples",
  );
  if (
    times.some(
      (t, i) => !Number.isFinite(t) || (i > 0 && t <= times[i - 1]!),
    ) ||
    times.at(-1)! > budget.maxDurationSeconds
  )
    invalid("Invalid skeletal timeline.");
  const mappedNames = new Set<HumanoidBoneName>();
  const names = new Set<string>(),
    semantics = new Set<number>();
  const mapped: Array<{
    index: number;
    bone: HumanoidBoneName;
    parent: number;
  }> = [];
  const semanticAt = new Map<number, number>();
  const validateTRS = (v: number[], offset = 0) => {
    for (let k = 0; k < 10; k++)
      if (!Number.isFinite(v[offset + k])) invalid("Non-finite TRS.");
    if (Math.abs(Math.hypot(...v.slice(offset + 3, offset + 7)) - 1) > 1e-3)
      invalid("Non-unit quaternion.");
    if ([7, 8, 9].some((k) => Math.abs(v[offset + k]! - 1) > 1e-3))
      invalid("Scaled skeletons are unsupported.");
  };
  joints.forEach((joint, i) => {
    if (
      !joint.name ||
      names.has(joint.name) ||
      !Number.isInteger(joint.parent) ||
      joint.parent < -1 ||
      joint.parent >= i
    )
      invalid("Invalid skeleton names or hierarchy.");
    names.add(joint.name);
    if (!Array.isArray(joint.rest) || joint.rest.length !== 10)
      invalid("Invalid rest TRS.");
    validateTRS(joint.rest);
    if (joint.humanBone === null) return;
    if (
      !Number.isInteger(joint.humanBone) ||
      joint.humanBone < 0 ||
      joint.humanBone >= bones.length ||
      semantics.has(joint.humanBone)
    )
      invalid("Invalid or duplicate human bone.");
    semantics.add(joint.humanBone);
    const bone = bones[joint.humanBone];
    if (!bone) return;
    if (mappedNames.has(bone)) invalid("Duplicate semantic bone mapping.");
    mappedNames.add(bone);
    let parent = joint.parent;
    while (parent >= 0 && !semanticAt.has(parent))
      parent = joints[parent]!.parent;
    mapped.push({ index: i, bone, parent });
    semanticAt.set(i, mapped.length - 1);
  });
  const missing = REQUIRED_VRM_BONES.filter(
    (b) => !mapped.some((m) => m.bone === b),
  );
  if (missing.length)
    invalid(`Missing required humanoid bones: ${missing.join(", ")}`);
  const hips = mapped.find((m) => m.bone === "hips")!;
  if (
    hips.parent !== -1 ||
    mapped.some((m) => m.bone !== "hips" && m.parent < 0)
  )
    invalid("Humanoid hierarchy must descend from hips.");
  assertCountWithinBudget(
    mapped.length + 1,
    budget.maxTracks,
    "skeletal tracks",
  );
  const world = (frame?: number[]) => {
    const rotations: Quaternion[] = [],
      positions: Vector3[] = [];
    joints.forEach((joint, i) => {
      const v = frame ?? joint.rest,
        offset = frame ? i * 10 : 0;
      const q = new Quaternion().fromArray(v, offset + 3).normalize();
      const p = new Vector3().fromArray(v, offset);
      if (joint.parent >= 0) {
        p.applyQuaternion(rotations[joint.parent]!).add(
          positions[joint.parent]!,
        );
        q.premultiply(rotations[joint.parent]!);
      }
      rotations.push(q);
      positions.push(p);
    });
    return { rotations, positions };
  };
  const rest = world(),
    height = rest.positions[hips.index]!.y;
  if (height <= 0) invalid("Rest hips must be above ground.");
  const inverseRest = rest.rotations.map((q) => q.clone().invert());
  const tracks: MotionTrack[] = mapped.map((m) => ({
    bone: m.bone,
    path: "rotation",
    times: [...times],
    values: [],
  }));
  const translation: MotionTrack = {
    bone: "hips",
    path: "translation",
    times: [...times],
    values: [],
  };
  const rootAncestors = new Set<number>();
  for (let p = hips.index; p >= 0; p = joints[p]!.parent) rootAncestors.add(p);
  frames.forEach((frame) => {
      if (!Array.isArray(frame) || frame.length !== joints.length * 10)
      invalid("Frame stride mismatch.");
    joints.forEach((j, i) => {
      validateTRS(frame, i * 10);
      if (
        !rootAncestors.has(i) &&
        [0, 1, 2].some((k) => Math.abs(frame[i * 10 + k]! - j.rest[k]!) > 1e-4)
      )
        invalid("Animated non-root translations are unsupported.");
      if (j.humanBone !== null && !bones[j.humanBone]) {
        const q = new Quaternion().fromArray(frame, i * 10 + 3);
        if (q.angleTo(new Quaternion().fromArray(j.rest, 3)) > 1e-4)
          invalid("Animated facial bones are unsupported.");
      }
    });
    const pose = world(frame);
    const deltas = pose.rotations.map((q, i) =>
      q.clone().multiply(inverseRest[i]!),
    );
    mapped.forEach((m, i) => {
      const q = deltas[m.index]!.clone();
      if (m.parent >= 0) q.premultiply(deltas[m.parent]!.clone().invert());
      tracks[i]!.values.push(...q.normalize().toArray());
    });
    translation.values.push(
      ...pose.positions[hips.index]!.clone()
        .sub(rest.positions[hips.index]!)
        .toArray(),
    );
  });
  return createImportedHumanoidMotionClip({
    kind: "skeletal-motion",
    filename: motion.name,
    profile: PROFILE,
    tracks: [...tracks, translation],
    duration: times.at(-1)!,
    fps: motion.fps,
    restHipsHeight: height,
    rotationSemantics: "delta-local",
    translationSemantics: "root-offset",
  });
}
