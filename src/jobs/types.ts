import type {
  AvatarFormatId,
  AvatarExportFormatId,
  MotionExportFormatId,
  MotionFormatId,
} from "@/formats";
import type { BoneNamingOptions } from "@/export/bone-naming";
import type {
  CanonicalHumanoidMotionClip,
  HumanoidBoneName,
  RetargetSolveOptions,
  RetargetedMotionClip,
  SolvedHumanoidMotionClip,
} from "@/retarget";
import type {
  RetargetedRigMotionV2,
  RigMotionV2,
  RigRestTransform,
} from "@/rig-motion";
import type { RigMotionAction } from "@/import/rig-motion-gltf";
import type {
  RigDefinition,
  RigRecipe,
  RigTopologyConflict,
  SemanticRigProfile,
} from "@/rigs/types";
import type { TransferableAssetPackage } from "@/import/asset-package";
import type { SemanticRestBone } from "@/validation";
import type {
  CustomRigMappingConfig,
  HumanoidSolverTargetRig,
} from "@/solvers/humanoid-custom-v4";
import type { RetargetErrorCode } from "@/retarget";
import type {
  ExportReloadValidationResult,
  ExportSemanticValidationResult,
} from "@/export/reload-validation";
import type { SemanticMotionValidationResult } from "@/validation";
import type { ParseBudget } from "@/import/parse-budget";
import type { ProcessingBudget } from "@/processing-budget";
import type { HumanoidBindingTask, HumanoidBindingResult } from "@/binding/types";

export type RetargetJobPhase =
  | "validate"
  | "parse"
  | "normalize"
  | "solve"
  | "refine"
  | "export"
  | "structural-validate"
  | "semantic-validate"
  | "complete";

export type WorkerMotionImportFormatId = MotionFormatId;

type SerializedTargetRig = Omit<HumanoidSolverTargetRig, "bones"> & {
  bones: HumanoidBoneName[];
};

export type SerializedRigInspection = {
  definition: RigDefinition;
  profile: SemanticRigProfile;
  restPose: RigRestTransform[];
  signature: string;
  missingRequiredRoles: string[];
  unmappedNodes: string[];
  requiredChainCoverage: number;
  topologyConflicts: RigTopologyConflict[];
  axisWarnings: string[];
};

export type SerializedGLTFResources = Record<string, ArrayBuffer>;

export type RiggedGLTFRetargetJobResult = {
  motion: RetargetedRigMotionV2;
  sourceMotion: RigMotionV2;
  sourceInspection: SerializedRigInspection;
  targetInspection: SerializedRigInspection;
  solver: RetargetedRigMotionV2["diagnostics"]["solver"]["id"];
};

export type RiggedGLTFInspectionJobResult = {
  inspection: SerializedRigInspection;
  actions: RigMotionAction[];
};

export type SerializedHumanoidAvatarRig = {
  format: AvatarFormatId;
  filename: string;
  profile: import("@/profiles").RigProfile;
  bones: HumanoidBoneName[];
  skeleton: import("@/retarget").RetargetSkeletonNode;
  missingRequiredBones: HumanoidBoneName[];
  restHipsHeight?: number;
  rigSignature: string;
};

export type RetargetJobTask =
  | HumanoidBindingTask
  | {
      type: "inspect-humanoid-avatar";
      bytes: ArrayBuffer;
      filename: string;
      formatId: AvatarFormatId;
      structuralJSONBytes?: ArrayBuffer;
      resources?: SerializedGLTFResources;
      assetPackage?: TransferableAssetPackage;
    }
  | {
      type: "convert-mmd-avatar";
      bytes: ArrayBuffer;
      filename: string;
      assetPackage?: TransferableAssetPackage;
    }
  | {
      type: "inspect-rigged-gltf";
      bytes: ArrayBuffer;
      filename: string;
      resources?: SerializedGLTFResources;
    }
  | {
      type: "import-motion";
      formatId: WorkerMotionImportFormatId;
      filename: string;
      bytes: ArrayBuffer;
      resources?: SerializedGLTFResources;
      animationIndex?: number;
      animationName?: string;
    }
  | {
      type: "solve-humanoid";
      motion: CanonicalHumanoidMotionClip;
      mapping: CustomRigMappingConfig;
      options: RetargetSolveOptions;
      targetRig?: SerializedTargetRig;
    }
  | {
      type: "retarget-rigged-gltf";
      motionBytes: ArrayBuffer;
      motionFilename: string;
      motionResources?: SerializedGLTFResources;
      targetBytes?: ArrayBuffer;
      targetFilename: string;
      targetResources?: SerializedGLTFResources;
      targetInspection?: SerializedRigInspection;
      recipe?: RigRecipe;
      animationIndex?: number;
      animationName?: string;
    }
  | {
      type: "export-motion";
      formatId: MotionExportFormatId;
      clip: RetargetedMotionClip;
      options?: BoneNamingOptions;
    }
  | {
      type: "validate-motion-export";
      formatId: MotionExportFormatId;
      bytes: ArrayBuffer;
      expected: RetargetedMotionClip;
    }
  | {
      type: "validate-avatar-export";
      formatId: AvatarExportFormatId;
      bytes: ArrayBuffer;
      expected: RetargetedMotionClip;
    }
  | {
      type: "semantic-validate";
      actual: RetargetedMotionClip;
      expected: RetargetedMotionClip;
      restPose?: [HumanoidBoneName, SemanticRestBone][];
    };

export type RetargetJobResult<TTask extends RetargetJobTask> =
  TTask extends HumanoidBindingTask ? HumanoidBindingResult<TTask["command"]>
  : TTask extends { type: "inspect-humanoid-avatar" }
    ? SerializedHumanoidAvatarRig
    : TTask extends { type: "convert-mmd-avatar" }
      ? Uint8Array
      : TTask extends { type: "inspect-rigged-gltf" }
        ? RiggedGLTFInspectionJobResult
        : TTask extends { type: "import-motion" }
          ? CanonicalHumanoidMotionClip
          : TTask extends { type: "solve-humanoid" }
            ? SolvedHumanoidMotionClip
            : TTask extends { type: "retarget-rigged-gltf" }
              ? RiggedGLTFRetargetJobResult
              : TTask extends { type: "export-motion" }
                ? Uint8Array
                : TTask extends {
                      type: "validate-motion-export" | "validate-avatar-export";
                    }
                  ? {
                      structural: ExportReloadValidationResult;
                      semantic: ExportSemanticValidationResult | null;
                    }
                  : TTask extends { type: "semantic-validate" }
                    ? SemanticMotionValidationResult
                    : never;

export type RetargetJobBudget = {
  parse?: Partial<ParseBudget>;
  processing?: Partial<ProcessingBudget>;
};

export const RETARGET_JOB_PROTOCOL_VERSION = 2 as const;

export type RetargetJobRequest = {
  schemaVersion: typeof RETARGET_JOB_PROTOCOL_VERSION;
  jobId: string;
  deadlineMs?: number;
  budget?: RetargetJobBudget;
  task: RetargetJobTask;
};

export type RetargetJobProgress = {
  schemaVersion: typeof RETARGET_JOB_PROTOCOL_VERSION;
  jobId: string;
  type: "progress";
  phase: RetargetJobPhase;
  progress: number;
};

export type RetargetJobSuccess = {
  schemaVersion: typeof RETARGET_JOB_PROTOCOL_VERSION;
  jobId: string;
  type: "success";
  result: unknown;
};

export type RetargetJobFailure = {
  schemaVersion: typeof RETARGET_JOB_PROTOCOL_VERSION;
  jobId: string;
  type: "failure";
  error: {
    name: string;
    code: RetargetErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type RetargetJobResponse =
  | RetargetJobProgress
  | RetargetJobSuccess
  | RetargetJobFailure;
