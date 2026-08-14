import type {
  AvatarExportFormatId,
  AvatarFormatId,
  CapabilityAssurance,
  MotionExportFormatId,
  MotionFormatId,
} from "@/formats";
import type { SemanticValidationThresholds } from "@/validation";
import type { SampledHumanoidPose } from "@/retarget/pose-sampler";
import manifestJSON from "./golden-motion-v1.json";

export type CertificationEvidenceStatus = "passed" | "pending" | "failed";
export type PipelineCertificationStatus =
  | "candidate"
  | "semantic-passed"
  | "certified";

export type PipelineExecutionMode = "in-memory" | "streamed";
export type RigDetectionMode = "vrm-extension" | "name-heuristic";

export type PipelineCertificationKey = {
  motionFormat: MotionFormatId;
  avatarFormat: AvatarFormatId;
  exportFormat: MotionExportFormatId | AvatarExportFormatId;
  executionMode: PipelineExecutionMode;
  rigDetectionMode: RigDetectionMode;
  solverRevision: number;
  targetBindingRevision: number;
};

export type PipelineCertificationCase = PipelineCertificationKey & {
  id: string;
  motionFormat: MotionFormatId;
  avatarFormat: AvatarFormatId;
  exportFormat: MotionExportFormatId | AvatarExportFormatId;
  status: PipelineCertificationStatus;
  source: GoldenAssetReference;
  avatar: GoldenAssetReference;
  sampleFractions: number[];
  thresholds: SemanticValidationThresholds;
  expectedCanonical?: {
    duration: number;
    fps: number;
    trackCount: number;
    samples: SampledHumanoidPose[];
  };
  expectedCanonicalFrom?: string;
  evidence: {
    structural: CertificationEvidenceStatus;
    semantic: CertificationEvidenceStatus;
    ecosystem: CertificationEvidenceStatus;
  };
  ecosystemReceipt?: {
    path: string;
    sha256: string;
    requiredRuntimes: EcosystemRuntimeName[];
  };
};

export type EcosystemRuntimeName = "blender" | "godot" | "unity";

export type GoldenAssetReference = {
  path: string;
  sha256: string;
  license: string;
  sourceUrl: string;
};

export type PipelineCertificationManifest = {
  schemaVersion: 1;
  validatorVersion: number;
  cases: PipelineCertificationCase[];
};

export const HUMANOID_PIPELINE_CERTIFICATION =
  manifestJSON as PipelineCertificationManifest;

export function getPipelineCertificationCase({
  avatarFormat,
  executionMode,
  exportFormat,
  motionFormat,
  rigDetectionMode,
  solverRevision,
  targetBindingRevision,
}: PipelineCertificationKey) {
  return HUMANOID_PIPELINE_CERTIFICATION.cases.find(
    (item) =>
      item.motionFormat === motionFormat &&
      item.avatarFormat === avatarFormat &&
      item.exportFormat === exportFormat &&
      item.executionMode === executionMode &&
      item.rigDetectionMode === rigDetectionMode &&
      item.solverRevision === solverRevision &&
      item.targetBindingRevision === targetBindingRevision,
  );
}

export function getPipelineExportAssurance({
  avatarFormat,
  executionMode,
  exportFormat,
  fallback = "experimental",
  motionFormat,
  rigDetectionMode,
  solverRevision,
  targetBindingRevision,
}: {
  motionFormat: MotionFormatId | null;
  avatarFormat: AvatarFormatId | null;
  exportFormat: MotionExportFormatId | AvatarExportFormatId;
  fallback?: CapabilityAssurance;
} & Omit<PipelineCertificationKey, "motionFormat" | "avatarFormat" | "exportFormat">): CapabilityAssurance {
  if (!motionFormat || !avatarFormat) return fallback;
  const record = getPipelineCertificationCase({
    motionFormat,
    avatarFormat,
    exportFormat,
    executionMode,
    rigDetectionMode,
    solverRevision,
    targetBindingRevision,
  });
  if (!record) return "experimental";
  if (isFullyCertified(record)) return "certified";
  if (
    record.evidence.structural === "passed" &&
    record.evidence.semantic === "passed"
  ) {
    return "beta";
  }
  return "experimental";
}

export function isFullyCertified(record: PipelineCertificationCase) {
  return (
    record.status === "certified" &&
    record.evidence.structural === "passed" &&
    record.evidence.semantic === "passed" &&
    record.evidence.ecosystem === "passed" &&
    record.ecosystemReceipt !== undefined
  );
}
