import type {
  AvatarFormatId,
  CapabilityAssurance,
  CapabilityAvailability,
  MotionExportFormatId,
  MotionFormatId,
} from "@/formats";
import type {
  CanonicalHumanoidMotionClip,
  RetargetSolveOptions,
  TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import type { CustomRigMappingConfig } from "@/solvers/humanoid-custom-v4";

export type RetargetPipelineId = `${MotionFormatId}-to-${AvatarFormatId}`;
export type RetargetPipelineInput = {
  motionFile: File;
  avatarFile: File;
  solveOptions: RetargetSolveOptions;
  mapping: CustomRigMappingConfig;
  signal?: AbortSignal;
};
export type RetargetPipelineResult = {
  sourceClip: CanonicalHumanoidMotionClip;
  solvedClip: TargetBoundSolvedHumanoidMotionClip;
};
export type RetargetPipeline = {
  id: RetargetPipelineId;
  label: string;
  motionFormat: MotionFormatId;
  avatarFormat: AvatarFormatId;
  outputFormats: readonly MotionExportFormatId[];
  availability: CapabilityAvailability;
  assurance: CapabilityAssurance;
  retarget(input: RetargetPipelineInput): Promise<RetargetPipelineResult>;
};
