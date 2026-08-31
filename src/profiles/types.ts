import type { AvatarFormatId, MotionFormatId } from "@/formats";
import type { HumanoidBoneName } from "@/retarget";

export type AxisName = "x" | "y" | "z" | "-x" | "-y" | "-z";

export type RigProfileId =
  | "mixamo"
  | "vrm-humanoid"
  | "actorcore"
  | "ready-player-me"
  | "mmd-body"
  | "generic-fbx-humanoid"
  | "generic-gltf-humanoid"
  | "canonical-gltf-humanoid"
  | "bvh-humanoid";

export type RigProfileBone = {
  humanoid: HumanoidBoneName;
  aliases: readonly string[];
  required?: boolean;
};

export type RigProfile = {
  id: RigProfileId;
  label: string;
  family: "humanoid";
  rigDefinitionId: "humanoid-v1";
  sourceFormats: readonly MotionFormatId[];
  avatarFormats: readonly AvatarFormatId[];
  restPose: "t-pose" | "a-pose" | "normalized" | "unknown";
  upAxis: AxisName;
  forwardAxis: AxisName;
  scaleUnit: "meters" | "centimeters" | "unknown";
  rootMotion: "hips" | "root" | "none" | "unknown";
  supportsFingers: boolean;
  supportsFacialAnimation: boolean;
  bones: readonly RigProfileBone[];
  notes: readonly string[];
};
