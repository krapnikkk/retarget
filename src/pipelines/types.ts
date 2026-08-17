import type {
  AvatarExportFormatId,
  AvatarFormatId,
  CapabilityAssurance,
  MotionExportFormatId,
  MotionFormatId,
} from "@/formats";
import type {
  CanonicalHumanoidMotionClip,
  RetargetSolveOptions,
  TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import type { CustomRigMappingConfig } from "@/solvers/humanoid-custom-v4";

export type RetargetPipelineOutputFormatId =
  | MotionExportFormatId
  | AvatarExportFormatId;
export type RetargetPipelineId =
  `${MotionFormatId}-to-${AvatarFormatId}-to-${RetargetPipelineOutputFormatId}`;
export type RetargetPipelineInput = {
  motionFile: File;
  avatarFile: File;
  solveOptions: RetargetSolveOptions;
  mapping: CustomRigMappingConfig;
  animationIndex?: number;
  animationName?: string;
  signal?: AbortSignal;
};
export type RetargetPipelineResult = {
  sourceClip: CanonicalHumanoidMotionClip;
  solvedClip: TargetBoundSolvedHumanoidMotionClip;
};
export type RetargetPipelineOutput = {
  format: RetargetPipelineOutputFormatId;
  bytes: Uint8Array;
};
export type RetargetPipelineRunResult = RetargetPipelineResult & {
  output: RetargetPipelineOutput;
};
export type RetargetPipeline = {
  id: RetargetPipelineId;
  label: string;
  motionFormat: MotionFormatId;
  avatarFormat: AvatarFormatId;
  outputFormat: RetargetPipelineOutputFormatId;
  assurance: CapabilityAssurance;
  retarget(input: RetargetPipelineInput): Promise<RetargetPipelineResult>;
  run(input: RetargetPipelineInput): Promise<RetargetPipelineRunResult>;
};
