// The humanoid bone list on its own, with no other runtime values, so the
// @krapnik/retarget/profiles entry can share it without bundling the engine.
export const HUMANOID_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
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
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
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
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
] as const;

export type HumanoidBoneName = (typeof HUMANOID_BONES)[number];

export function isHumanoidBoneName(value: string): value is HumanoidBoneName {
  return (HUMANOID_BONES as readonly string[]).includes(value);
}

/**
 * VRM 0.x names the three thumb joints Proximal, Intermediate, and Distal;
 * VRM 1.0 names the same joints Metacarpal, Proximal, and Distal. Every other
 * humanoid bone keeps its name.
 */
const VRM0_RENAMED_BONES: Readonly<Record<string, HumanoidBoneName>> = {
  leftThumbProximal: "leftThumbMetacarpal",
  leftThumbIntermediate: "leftThumbProximal",
  rightThumbProximal: "rightThumbMetacarpal",
  rightThumbIntermediate: "rightThumbProximal",
};

/** The humanoid bone for a VRM 0.x `humanBones[].bone` name, if any. */
export function vrm0HumanoidBoneName(value: string): HumanoidBoneName | undefined {
  const bone = VRM0_RENAMED_BONES[value] ?? value;
  return isHumanoidBoneName(bone) ? bone : undefined;
}
