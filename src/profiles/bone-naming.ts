import type { AvatarFormatId } from "@/formats";
import type { HumanoidBoneName } from "@/retarget";

export type BoneNamingProfileId =
  | "canonical"
  | "mixamo"
  | "actorcore"
  | "bvh-standard"
  | "mmd";

export type BoneNamingOptions = {
  boneNamingProfile?: BoneNamingProfileId;
};

const MIXAMO_EXPORT_NAMES = {
  hips: "mixamorig:Hips",
  spine: "mixamorig:Spine",
  chest: "mixamorig:Spine1",
  upperChest: "mixamorig:Spine2",
  neck: "mixamorig:Neck",
  head: "mixamorig:Head",
  leftShoulder: "mixamorig:LeftShoulder",
  leftUpperArm: "mixamorig:LeftArm",
  leftLowerArm: "mixamorig:LeftForeArm",
  leftHand: "mixamorig:LeftHand",
  leftThumbMetacarpal: "mixamorig:LeftHandThumb1",
  leftThumbProximal: "mixamorig:LeftHandThumb2",
  leftThumbDistal: "mixamorig:LeftHandThumb3",
  leftIndexProximal: "mixamorig:LeftHandIndex1",
  leftIndexIntermediate: "mixamorig:LeftHandIndex2",
  leftIndexDistal: "mixamorig:LeftHandIndex3",
  leftMiddleProximal: "mixamorig:LeftHandMiddle1",
  leftMiddleIntermediate: "mixamorig:LeftHandMiddle2",
  leftMiddleDistal: "mixamorig:LeftHandMiddle3",
  leftRingProximal: "mixamorig:LeftHandRing1",
  leftRingIntermediate: "mixamorig:LeftHandRing2",
  leftRingDistal: "mixamorig:LeftHandRing3",
  leftLittleProximal: "mixamorig:LeftHandPinky1",
  leftLittleIntermediate: "mixamorig:LeftHandPinky2",
  leftLittleDistal: "mixamorig:LeftHandPinky3",
  rightShoulder: "mixamorig:RightShoulder",
  rightUpperArm: "mixamorig:RightArm",
  rightLowerArm: "mixamorig:RightForeArm",
  rightHand: "mixamorig:RightHand",
  rightThumbMetacarpal: "mixamorig:RightHandThumb1",
  rightThumbProximal: "mixamorig:RightHandThumb2",
  rightThumbDistal: "mixamorig:RightHandThumb3",
  rightIndexProximal: "mixamorig:RightHandIndex1",
  rightIndexIntermediate: "mixamorig:RightHandIndex2",
  rightIndexDistal: "mixamorig:RightHandIndex3",
  rightMiddleProximal: "mixamorig:RightHandMiddle1",
  rightMiddleIntermediate: "mixamorig:RightHandMiddle2",
  rightMiddleDistal: "mixamorig:RightHandMiddle3",
  rightRingProximal: "mixamorig:RightHandRing1",
  rightRingIntermediate: "mixamorig:RightHandRing2",
  rightRingDistal: "mixamorig:RightHandRing3",
  rightLittleProximal: "mixamorig:RightHandPinky1",
  rightLittleIntermediate: "mixamorig:RightHandPinky2",
  rightLittleDistal: "mixamorig:RightHandPinky3",
  leftUpperLeg: "mixamorig:LeftUpLeg",
  leftLowerLeg: "mixamorig:LeftLeg",
  leftFoot: "mixamorig:LeftFoot",
  leftToes: "mixamorig:LeftToeBase",
  rightUpperLeg: "mixamorig:RightUpLeg",
  rightLowerLeg: "mixamorig:RightLeg",
  rightFoot: "mixamorig:RightFoot",
  rightToes: "mixamorig:RightToeBase",
} as const satisfies Partial<Record<HumanoidBoneName, string>>;

const ACTORCORE_EXPORT_NAMES = {
  hips: "CC_Base_Hip",
  spine: "CC_Base_Waist",
  chest: "CC_Base_Spine02",
  upperChest: "CC_Base_Chest",
  neck: "CC_Base_Neck",
  head: "CC_Base_Head",
  leftShoulder: "CC_Base_L_Clavicle",
  leftUpperArm: "CC_Base_L_Upperarm",
  leftLowerArm: "CC_Base_L_Forearm",
  leftHand: "CC_Base_L_Hand",
  rightShoulder: "CC_Base_R_Clavicle",
  rightUpperArm: "CC_Base_R_Upperarm",
  rightLowerArm: "CC_Base_R_Forearm",
  rightHand: "CC_Base_R_Hand",
  leftUpperLeg: "CC_Base_L_Thigh",
  leftLowerLeg: "CC_Base_L_Calf",
  leftFoot: "CC_Base_L_Foot",
  leftToes: "CC_Base_L_ToeBase",
  rightUpperLeg: "CC_Base_R_Thigh",
  rightLowerLeg: "CC_Base_R_Calf",
  rightFoot: "CC_Base_R_Foot",
  rightToes: "CC_Base_R_ToeBase",
} as const satisfies Partial<Record<HumanoidBoneName, string>>;

const BVH_STANDARD_EXPORT_NAMES = {
  hips: "Hips",
  spine: "Spine",
  chest: "Spine1",
  upperChest: "Spine2",
  neck: "Neck",
  head: "Head",
  leftShoulder: "LeftShoulder",
  leftUpperArm: "LeftArm",
  leftLowerArm: "LeftForeArm",
  leftHand: "LeftHand",
  rightShoulder: "RightShoulder",
  rightUpperArm: "RightArm",
  rightLowerArm: "RightForeArm",
  rightHand: "RightHand",
  leftUpperLeg: "LeftUpLeg",
  leftLowerLeg: "LeftLeg",
  leftFoot: "LeftFoot",
  leftToes: "LeftToeBase",
  rightUpperLeg: "RightUpLeg",
  rightLowerLeg: "RightLeg",
  rightFoot: "RightFoot",
  rightToes: "RightToeBase",
} as const satisfies Partial<Record<HumanoidBoneName, string>>;

export const MMD_EXPORT_BONE_NAMES = {
  hips: "センター",
  spine: "上半身",
  chest: "上半身2",
  upperChest: "上半身3",
  neck: "首",
  head: "頭",
  leftShoulder: "左肩",
  leftUpperArm: "左腕",
  leftLowerArm: "左ひじ",
  leftHand: "左手首",
  leftThumbMetacarpal: "左親指０",
  leftThumbProximal: "左親指１",
  leftThumbDistal: "左親指２",
  leftIndexProximal: "左人指１",
  leftIndexIntermediate: "左人指２",
  leftIndexDistal: "左人指３",
  leftMiddleProximal: "左中指１",
  leftMiddleIntermediate: "左中指２",
  leftMiddleDistal: "左中指３",
  leftRingProximal: "左薬指１",
  leftRingIntermediate: "左薬指２",
  leftRingDistal: "左薬指３",
  leftLittleProximal: "左小指１",
  leftLittleIntermediate: "左小指２",
  leftLittleDistal: "左小指３",
  rightShoulder: "右肩",
  rightUpperArm: "右腕",
  rightLowerArm: "右ひじ",
  rightHand: "右手首",
  rightThumbMetacarpal: "右親指０",
  rightThumbProximal: "右親指１",
  rightThumbDistal: "右親指２",
  rightIndexProximal: "右人指１",
  rightIndexIntermediate: "右人指２",
  rightIndexDistal: "右人指３",
  rightMiddleProximal: "右中指１",
  rightMiddleIntermediate: "右中指２",
  rightMiddleDistal: "右中指３",
  rightRingProximal: "右薬指１",
  rightRingIntermediate: "右薬指２",
  rightRingDistal: "右薬指３",
  rightLittleProximal: "右小指１",
  rightLittleIntermediate: "右小指２",
  rightLittleDistal: "右小指３",
  leftUpperLeg: "左足",
  leftLowerLeg: "左ひざ",
  leftFoot: "左足首",
  leftToes: "左つま先",
  rightUpperLeg: "右足",
  rightLowerLeg: "右ひざ",
  rightFoot: "右足首",
  rightToes: "右つま先",
} as const satisfies Partial<Record<HumanoidBoneName, string>>;

const PROFILE_EXPORT_NAMES: Record<
  BoneNamingProfileId,
  Partial<Record<HumanoidBoneName, string>>
> = {
  canonical: {},
  mixamo: MIXAMO_EXPORT_NAMES,
  actorcore: ACTORCORE_EXPORT_NAMES,
  "bvh-standard": BVH_STANDARD_EXPORT_NAMES,
  mmd: MMD_EXPORT_BONE_NAMES,
};

export function resolveExportBoneName(
  bone: HumanoidBoneName,
  profile: BoneNamingProfileId = "canonical",
) {
  return PROFILE_EXPORT_NAMES[profile][bone] ?? bone;
}

export function recommendBoneNamingProfileForAvatar(
  avatarFormatId: AvatarFormatId | null | undefined,
): BoneNamingProfileId {
  if (avatarFormatId === "mixamo-rigged") {
    return "mixamo";
  }
  if (avatarFormatId === "reallusion" || avatarFormatId === "generic-fbx-avatar") {
    return "actorcore";
  }
  if (avatarFormatId === "mmd-model") {
    return "mmd";
  }
  return "canonical";
}
