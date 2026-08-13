import type { HumanoidBoneName } from "./types";

export const REQUIRED_VRM_BONES: readonly HumanoidBoneName[] = [
  "hips",
  "spine",
  "head",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
];

export const MIXAMO_BONE_MAP: Readonly<Record<string, HumanoidBoneName>> = {
  hips: "hips",
  spine: "spine",
  spine1: "chest",
  spine2: "upperChest",
  neck: "neck",
  head: "head",
  leftshoulder: "leftShoulder",
  leftarm: "leftUpperArm",
  leftforearm: "leftLowerArm",
  lefthand: "leftHand",
  lefthandthumb1: "leftThumbMetacarpal",
  lefthandthumb2: "leftThumbProximal",
  lefthandthumb3: "leftThumbDistal",
  lefthandindex1: "leftIndexProximal",
  lefthandindex2: "leftIndexIntermediate",
  lefthandindex3: "leftIndexDistal",
  lefthandmiddle1: "leftMiddleProximal",
  lefthandmiddle2: "leftMiddleIntermediate",
  lefthandmiddle3: "leftMiddleDistal",
  lefthandring1: "leftRingProximal",
  lefthandring2: "leftRingIntermediate",
  lefthandring3: "leftRingDistal",
  lefthandpinky1: "leftLittleProximal",
  lefthandpinky2: "leftLittleIntermediate",
  lefthandpinky3: "leftLittleDistal",
  rightshoulder: "rightShoulder",
  rightarm: "rightUpperArm",
  rightforearm: "rightLowerArm",
  righthand: "rightHand",
  righthandthumb1: "rightThumbMetacarpal",
  righthandthumb2: "rightThumbProximal",
  righthandthumb3: "rightThumbDistal",
  righthandindex1: "rightIndexProximal",
  righthandindex2: "rightIndexIntermediate",
  righthandindex3: "rightIndexDistal",
  righthandmiddle1: "rightMiddleProximal",
  righthandmiddle2: "rightMiddleIntermediate",
  righthandmiddle3: "rightMiddleDistal",
  righthandring1: "rightRingProximal",
  righthandring2: "rightRingIntermediate",
  righthandring3: "rightRingDistal",
  righthandpinky1: "rightLittleProximal",
  righthandpinky2: "rightLittleIntermediate",
  righthandpinky3: "rightLittleDistal",
  leftupleg: "leftUpperLeg",
  leftleg: "leftLowerLeg",
  leftfoot: "leftFoot",
  lefttoebase: "leftToes",
  rightupleg: "rightUpperLeg",
  rightleg: "rightLowerLeg",
  rightfoot: "rightFoot",
  righttoebase: "rightToes",
};

export function normalizeMixamoBoneName(name: string): string {
  return name
    .replace(/^mixamorig[:_]?/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

export function resolveMixamoBoneName(name: string): HumanoidBoneName | null {
  const normalized = normalizeMixamoBoneName(name);
  return MIXAMO_BONE_MAP[normalized] ?? null;
}

export function getMissingRequiredBones(
  mappedBones: Iterable<string>,
): HumanoidBoneName[] {
  const mapped = new Set(mappedBones);
  return REQUIRED_VRM_BONES.filter((bone) => !mapped.has(bone));
}
