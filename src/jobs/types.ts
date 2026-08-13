import type {
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
} from "@/retarget";
import type { RetargetedRigMotionV2, RigMotionV2 } from "@/rig-motion";
import type { RigMotionAction } from "@/import/rig-motion-gltf";
import type { RigInspection, RigRecipe } from "@/rigs";
import type { TransferableAssetPackage } from "@/import/asset-package";
import type { SemanticRestBone } from "@/validation";
import type {
  CustomRigMappingConfig,
  HumanoidSolverTargetRig,
} from "@/solvers";

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

export type SerializedRigInspection = Omit<
  RigInspection,
  "nodesByRole" | "rolesByNode"
>;

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

export type RetargetJobTask =
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

export type RetargetJobRequest = {
  jobId: string;
  deadlineMs?: number;
  task: RetargetJobTask;
};

export type RetargetJobProgress = {
  jobId: string;
  type: "progress";
  phase: RetargetJobPhase;
  progress: number;
};

export type RetargetJobSuccess = {
  jobId: string;
  type: "success";
  result: unknown;
};

export type RetargetJobFailure = {
  jobId: string;
  type: "failure";
  error: {
    name: string;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type RetargetJobResponse =
  | RetargetJobProgress
  | RetargetJobSuccess
  | RetargetJobFailure;
