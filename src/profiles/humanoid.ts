import {
  HUMANOID_BONES,
  MIXAMO_BONE_MAP,
  REQUIRED_VRM_BONES,
  type HumanoidBoneName,
} from "@/retarget";
import {
  MMD_EXPORT_BONE_NAMES,
  resolveExportBoneName,
} from "./bone-naming";
import type { RigProfile, RigProfileBone } from "./types";

function mixamoAliasesFor(bone: HumanoidBoneName) {
  return Object.entries(MIXAMO_BONE_MAP)
    .filter(([, humanoid]) => humanoid === bone)
    .map(([alias]) => alias);
}

const MIXAMO_BONES = HUMANOID_BONES.map(
  (bone): RigProfileBone => ({
    humanoid: bone,
    aliases: mixamoAliasesFor(bone),
    required: REQUIRED_VRM_BONES.includes(bone),
  }),
);

const VRM_BONES = HUMANOID_BONES.map(
  (bone): RigProfileBone => ({
    humanoid: bone,
    aliases: [bone],
    required: REQUIRED_VRM_BONES.includes(bone),
  }),
);

const GENERIC_GLTF_BONES = HUMANOID_BONES.map(
  (bone): RigProfileBone => ({
    humanoid: bone,
    aliases: [bone, bone.toLowerCase()],
    required: REQUIRED_VRM_BONES.includes(bone),
  }),
);

const BVH_BONES = HUMANOID_BONES.map(
  (bone): RigProfileBone => ({
    humanoid: bone,
    aliases: [
      bone,
      bone.toLowerCase(),
      resolveExportBoneName(bone, "bvh-standard"),
      resolveExportBoneName(bone, "actorcore"),
      ...optionalMmdBoneAlias(bone),
      ...mixamoAliasesFor(bone),
    ],
    required: REQUIRED_VRM_BONES.includes(bone),
  }),
);

const ACTORCORE_BONE_ALIASES: Partial<
  Record<HumanoidBoneName, readonly string[]>
> = {
  hips: ["CC_Base_Hip"],
  spine: ["CC_Base_Waist", "CC_Base_Spine01"],
  chest: ["CC_Base_Spine02"],
  upperChest: ["CC_Base_Chest"],
  neck: ["CC_Base_NeckTwist01", "CC_Base_Neck"],
  head: ["CC_Base_Head"],
  leftShoulder: ["CC_Base_L_Clavicle"],
  leftUpperArm: ["CC_Base_L_Upperarm"],
  leftLowerArm: ["CC_Base_L_Forearm"],
  leftHand: ["CC_Base_L_Hand"],
  rightShoulder: ["CC_Base_R_Clavicle"],
  rightUpperArm: ["CC_Base_R_Upperarm"],
  rightLowerArm: ["CC_Base_R_Forearm"],
  rightHand: ["CC_Base_R_Hand"],
  leftUpperLeg: ["CC_Base_L_Thigh"],
  leftLowerLeg: ["CC_Base_L_Calf"],
  leftFoot: ["CC_Base_L_Foot"],
  leftToes: ["CC_Base_L_ToeBase"],
  rightUpperLeg: ["CC_Base_R_Thigh"],
  rightLowerLeg: ["CC_Base_R_Calf"],
  rightFoot: ["CC_Base_R_Foot"],
  rightToes: ["CC_Base_R_ToeBase"],
};

const ACTORCORE_BONES = HUMANOID_BONES.map(
  (bone): RigProfileBone => ({
    humanoid: bone,
    aliases: [
      bone,
      bone.toLowerCase(),
      ...mixamoAliasesFor(bone),
      ...(ACTORCORE_BONE_ALIASES[bone] ?? []),
    ],
    required: REQUIRED_VRM_BONES.includes(bone),
  }),
);

const MMD_BONES = HUMANOID_BONES.map(
  (bone): RigProfileBone => ({
    humanoid: bone,
    aliases: [
      bone,
      bone.toLowerCase(),
      resolveExportBoneName(bone, "bvh-standard"),
      ...optionalMmdBoneAlias(bone),
    ],
    required: REQUIRED_VRM_BONES.includes(bone),
  }),
);

function optionalMmdBoneAlias(bone: HumanoidBoneName) {
  const aliases = MMD_EXPORT_BONE_NAMES as Partial<
    Record<HumanoidBoneName, string>
  >;
  return aliases[bone] ? [aliases[bone]] : [];
}

export const MIXAMO_RIG_PROFILE = {
  id: "mixamo",
  label: "Mixamo Humanoid",
  family: "humanoid",
  rigDefinitionId: "humanoid-v1",
  sourceFormats: ["mixamo-fbx"],
  avatarFormats: ["mixamo-rigged"],
  restPose: "t-pose",
  upAxis: "y",
  forwardAxis: "z",
  scaleUnit: "centimeters",
  rootMotion: "hips",
  supportsFingers: true,
  supportsFacialAnimation: false,
  bones: MIXAMO_BONES,
  notes: [
    "Mixamo names are normalized by removing the mixamorig prefix and separators.",
    "This profile is the active Phase 1 motion input profile.",
  ],
} as const satisfies RigProfile;

export const VRM_HUMANOID_PROFILE = {
  id: "vrm-humanoid",
  label: "VRM Humanoid",
  family: "humanoid",
  rigDefinitionId: "humanoid-v1",
  sourceFormats: ["vrma"],
  avatarFormats: ["vrm"],
  restPose: "normalized",
  upAxis: "y",
  forwardAxis: "-z",
  scaleUnit: "meters",
  rootMotion: "hips",
  supportsFingers: true,
  supportsFacialAnimation: true,
  bones: VRM_BONES,
  notes: [
    "VRM humanoid bones are addressed through normalized humanoid names.",
    "VRM 0.x scene display rotation is handled separately from normalized pose sampling.",
  ],
} as const satisfies RigProfile;

// VRM 1.0 avatars face +Z in glTF space, while VRM 0.x avatars face -Z. The
// avatar profile drives target binding, so VRM 1.0 targets need their own.
export const VRM1_HUMANOID_PROFILE = {
  ...VRM_HUMANOID_PROFILE,
  id: "vrm1-humanoid",
  label: "VRM 1.0 Humanoid",
  sourceFormats: [],
  forwardAxis: "z",
  notes: [
    "VRM 1.0 avatars (VRMC_vrm) face +Z; VRM 0.x avatars use vrm-humanoid (-Z).",
  ],
} as const satisfies RigProfile;

export const BVH_HUMANOID_PROFILE = {
  id: "bvh-humanoid",
  label: "BVH Humanoid",
  family: "humanoid",
  rigDefinitionId: "humanoid-v1",
  sourceFormats: ["bvh"],
  avatarFormats: [],
  restPose: "t-pose",
  upAxis: "y",
  forwardAxis: "z",
  scaleUnit: "unknown",
  rootMotion: "hips",
  supportsFingers: false,
  supportsFacialAnimation: false,
  bones: BVH_BONES,
  notes: [
    "BVH files vary by capture source; aliases cover common H-Anim, Mixamo-like, and lower-case bone names.",
    "Phase 3 imports body motion and exposes diagnostics before custom mapping UI exists.",
  ],
} as const satisfies RigProfile;

export const MMD_BODY_PROFILE = {
  id: "mmd-body",
  label: "MMD / VMD Body",
  family: "humanoid",
  rigDefinitionId: "humanoid-v1",
  sourceFormats: ["vmd"],
  avatarFormats: ["mmd-model"],
  restPose: "a-pose",
  upAxis: "y",
  // MMD models face -Z in MMD's left-handed space; mirrored into right-handed
  // space (z negated) they face +Z.
  forwardAxis: "z",
  scaleUnit: "unknown",
  rootMotion: "hips",
  supportsFingers: false,
  supportsFacialAnimation: false,
  bones: MMD_BONES,
  notes: [
    "VMD adapters mirror the raw left-handed MMD basis (forward -Z) into this right-handed +Z-forward staging profile before shared canonical normalization; body tracks use the explicit 10-unit standard-model rest-hips preset for root-motion scaling.",
    "Camera, expression, and physics semantics remain out of scope.",
  ],
} as const satisfies RigProfile;

export const GENERIC_GLTF_HUMANOID_PROFILE = {
  id: "generic-gltf-humanoid",
  label: "Generic glTF Humanoid",
  family: "humanoid",
  rigDefinitionId: "humanoid-v1",
  sourceFormats: ["gltf-animation"],
  avatarFormats: ["gltf-humanoid"],
  restPose: "unknown",
  upAxis: "y",
  forwardAxis: "z",
  scaleUnit: "meters",
  rootMotion: "hips",
  supportsFingers: true,
  supportsFacialAnimation: false,
  bones: GENERIC_GLTF_BONES,
  notes: [
    "glTF provides animation channels but not humanoid semantics; Phase 3 relies on canonical bone names or known aliases.",
  ],
} as const satisfies RigProfile;

export const CANONICAL_GLTF_HUMANOID_PROFILE = {
  ...GENERIC_GLTF_HUMANOID_PROFILE,
  id: "canonical-gltf-humanoid",
  label: "Canonical glTF Humanoid",
  restPose: "normalized",
  forwardAxis: "-z",
  notes: [
    "Explicit canonical +Y-up/-Z-forward glTF input; consumers must not infer this contract from the extension or filename.",
  ],
} as const satisfies RigProfile;

export const GENERIC_FBX_HUMANOID_PROFILE = {
  id: "generic-fbx-humanoid",
  label: "Generic FBX Humanoid",
  family: "humanoid",
  rigDefinitionId: "humanoid-v1",
  sourceFormats: ["generic-fbx"],
  avatarFormats: ["generic-fbx-avatar"],
  restPose: "unknown",
  upAxis: "y",
  forwardAxis: "z",
  scaleUnit: "unknown",
  rootMotion: "unknown",
  supportsFingers: true,
  supportsFacialAnimation: false,
  bones: BVH_BONES,
  notes: [
    "Generic FBX keeps units and rest-pose assumptions unresolved until file evidence is available.",
    "It must not inherit Mixamo centimeter or naming assumptions by extension alone.",
  ],
} as const satisfies RigProfile;

export const ACTORCORE_PROFILE = {
  id: "actorcore",
  label: "ActorCore / Reallusion Humanoid",
  family: "humanoid",
  rigDefinitionId: "humanoid-v1",
  sourceFormats: ["actorcore-fbx"],
  avatarFormats: ["reallusion"],
  restPose: "t-pose",
  upAxis: "y",
  forwardAxis: "z",
  scaleUnit: "centimeters",
  rootMotion: "hips",
  supportsFingers: true,
  supportsFacialAnimation: false,
  bones: ACTORCORE_BONES,
  notes: [
    "ActorCore/Reallusion assets are treated as a humanoid preset before dedicated ecosystem-specific retarget tuning.",
  ],
} as const satisfies RigProfile;

export const READY_PLAYER_ME_PROFILE = {
  id: "ready-player-me",
  label: "Ready Player Me Humanoid",
  family: "humanoid",
  rigDefinitionId: "humanoid-v1",
  sourceFormats: [],
  avatarFormats: ["ready-player-me"],
  restPose: "t-pose",
  upAxis: "y",
  forwardAxis: "z",
  scaleUnit: "meters",
  rootMotion: "hips",
  supportsFingers: true,
  supportsFacialAnimation: true,
  bones: GENERIC_GLTF_BONES,
  notes: [
    "Ready Player Me avatars are glTF/GLB humanoids with stable naming conventions.",
  ],
} as const satisfies RigProfile;

export const HUMANOID_RIG_PROFILES = [
  MIXAMO_RIG_PROFILE,
  VRM_HUMANOID_PROFILE,
  VRM1_HUMANOID_PROFILE,
  BVH_HUMANOID_PROFILE,
  MMD_BODY_PROFILE,
  GENERIC_FBX_HUMANOID_PROFILE,
  GENERIC_GLTF_HUMANOID_PROFILE,
  CANONICAL_GLTF_HUMANOID_PROFILE,
  ACTORCORE_PROFILE,
  READY_PLAYER_ME_PROFILE,
] as const satisfies readonly RigProfile[];

export function getRigProfile(id: RigProfile["id"]) {
  return HUMANOID_RIG_PROFILES.find((profile) => profile.id === id) ?? null;
}
