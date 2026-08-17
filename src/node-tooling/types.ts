import type { CapabilityAssurance } from "@/formats";
import type { RigMotionAction } from "@/import/rig-motion-gltf";
import type {
  RetargetErrorCode,
  RetargetErrorDetails,
} from "@/retarget";
import type { RigMotionV2 } from "@/rig-motion";
import type {
  RigFamilyId,
  RigRoleId,
} from "@/rigs/types";
import type {
  SerializedGLTFResources,
  SerializedRigInspection,
} from "@/jobs/types";

export type NodeToolBudget = {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxArchiveEntries: number;
  maxArchiveEntryBytes: number;
  maxArchiveExpandedBytes: number;
  maxArchiveCompressionRatio: number;
  softDeadlineMs?: number;
};

export type NodeRigInspectionOptions = {
  familyOverride?: RigFamilyId | "auto";
  profileId?: string | "auto";
  roleOverrides?: Readonly<Record<RigRoleId, string>>;
};

export type NodeVRMAuthoringMetadata = {
  name: string;
  author: string;
  license: string;
  sourceUrl?: string;
};

export type NodePMXAuthoringMetadata = {
  name: string;
  author: string;
  license: string;
};

export type NodeArtifactFormat =
  | "vrm"
  | "pmx"
  | "pmx-bundle"
  | "rig-motion-gltf";

export type NodeArtifactDescriptor = {
  format: NodeArtifactFormat;
  assurance: CapabilityAssurance;
  filename: string;
  mediaType: string;
  bytes: ArrayBuffer;
  byteLength: number;
  sha256: string;
};

export type NodeEvidenceStatus =
  | "passed"
  | "failed"
  | "not-applicable"
  | "not-run";

export type NodeArtifactEvidence = {
  status: NodeEvidenceStatus;
  checks: string[];
  issues: string[];
  details?: Record<string, unknown>;
};

export type NodeToolDiagnostic = {
  level: "info" | "warning" | "error";
  phase: NodeToolPhase;
  message: string;
  code?: RetargetErrorCode;
  details?: RetargetErrorDetails;
};

export type NodeArtifactValidationReport = {
  ok: boolean;
  artifact: Omit<NodeArtifactDescriptor, "bytes" | "assurance">;
  structural: NodeArtifactEvidence;
  semantic: NodeArtifactEvidence;
  ecosystem: NodeArtifactEvidence;
  inspection?: SerializedRigInspection;
  diagnostics: NodeToolDiagnostic[];
};

export type NodeAuthoredArtifactResult = {
  artifact: NodeArtifactDescriptor;
  validation: NodeArtifactValidationReport;
};

export type NodeRigMotionImportResult = {
  motion: RigMotionV2;
  inspection: SerializedRigInspection;
  actions: RigMotionAction[];
};

export type NodeToolTask =
  | {
      type: "inspect-rigged-gltf";
      bytes: ArrayBuffer;
      filename: string;
      resources?: SerializedGLTFResources;
      options?: NodeRigInspectionOptions;
    }
  | {
      type: "import-rig-motion-gltf";
      bytes: ArrayBuffer;
      filename: string;
      createdAt: string;
      resources?: SerializedGLTFResources;
      options?: NodeRigInspectionOptions & {
        animationIndex?: number;
        animationName?: string;
      };
    }
  | {
      type: "export-rig-motion-gltf";
      artifactName: string;
      motion: RigMotionV2;
    }
  | {
      type: "validate-rig-motion-gltf";
      artifactName: string;
      bytes: ArrayBuffer;
      expected: RigMotionV2;
    }
  | {
      type: "author-vrm";
      artifactName: string;
      canonicalGLBBytes: ArrayBuffer;
      metadata: NodeVRMAuthoringMetadata;
    }
  | {
      type: "author-pmx";
      artifactName: string;
      canonicalGLBBytes: ArrayBuffer;
      metadata: NodePMXAuthoringMetadata;
      output: "pmx" | "bundle";
    }
  | {
      type: "validate-artifact";
      artifactName: string;
      bytes: ArrayBuffer;
      format: "vrm" | "pmx" | "pmx-bundle";
    };

export type NodeToolTaskResult<TTask extends NodeToolTask> =
  TTask extends { type: "inspect-rigged-gltf" }
    ? { inspection: SerializedRigInspection; actions: RigMotionAction[] }
    : TTask extends { type: "import-rig-motion-gltf" }
      ? NodeRigMotionImportResult
      : TTask extends {
            type:
              | "export-rig-motion-gltf"
              | "author-vrm"
              | "author-pmx";
          }
        ? NodeAuthoredArtifactResult
        : TTask extends {
              type: "validate-rig-motion-gltf" | "validate-artifact";
            }
          ? NodeArtifactValidationReport
          : never;

export type NodeToolPhase =
  | "validate"
  | "parse"
  | "inspect"
  | "author"
  | "structural-validate"
  | "semantic-validate"
  | "complete";

export type NodeToolProgress = {
  jobId: string;
  type: "progress";
  phase: NodeToolPhase;
  progress: number;
};

export type NodeToolError = {
  name: string;
  code: RetargetErrorCode;
  message: string;
  details?: RetargetErrorDetails;
};

export type NodeToolJobSuccess<TTask extends NodeToolTask> = {
  ok: true;
  jobId: string;
  result: NodeToolTaskResult<TTask>;
  diagnostics: NodeToolDiagnostic[];
};

export type NodeToolJobFailure = {
  ok: false;
  jobId: string;
  error: NodeToolError;
};

export type NodeToolJobResult<TTask extends NodeToolTask> =
  | NodeToolJobSuccess<TTask>
  | NodeToolJobFailure;

export type RunNodeToolJobOptions = {
  budget?: Partial<NodeToolBudget>;
  bufferOwnership?: "copy" | "transfer";
  signal?: AbortSignal;
  onProgress?: (progress: NodeToolProgress) => void;
};

export type NodeToolWorkerRequest = {
  jobId: string;
  budget: NodeToolBudget;
  task: NodeToolTask;
};

export type NodeToolWorkerSuccess = {
  jobId: string;
  type: "success";
  result: unknown;
  diagnostics: NodeToolDiagnostic[];
};

export type NodeToolWorkerFailure = {
  jobId: string;
  type: "failure";
  error: NodeToolError;
};

export type NodeToolWorkerResponse =
  | NodeToolProgress
  | NodeToolWorkerSuccess
  | NodeToolWorkerFailure;
