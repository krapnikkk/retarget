import type { AvatarFormatId, MotionFormatId } from "@/formats";
import type {
  CanonicalHumanoidMotionClip,
  TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import type { RigProfileId } from "@/profiles";

export type AdapterMaturity = "active" | "planned" | "experimental";

export type ImportAdapterProbeOptions = {
  maxBytes?: number;
};

export type ImportProbeEvidenceDetail = {
  code:
    | "extension-hint"
    | "container-signature"
    | "coordinate-convention"
    | "declared-animation"
    | "declared-skin"
    | "gltf-extension"
    | "ecosystem-marker"
    | "profile-bone-coverage"
    | "profile-symmetry"
    | "fbx-axis-metadata"
    | "fbx-unit-metadata";
  message: string;
};

export type ImportAdapterProbe = {
  bytesInspected: number;
  confidence: number;
  contentSignature: boolean;
  profile: RigProfileId;
  evidence: string[];
  evidenceDetails: ImportProbeEvidenceDetail[];
  warnings: string[];
};

export type MotionImportAdapter = {
  id: MotionFormatId;
  label: string;
  profileId: RigProfileId;
  maturity: AdapterMaturity;
  probe(
    file: File,
    options?: ImportAdapterProbeOptions,
  ): Promise<ImportAdapterProbe>;
  importMotion?(
    file: File,
    options?: MotionImportOptions,
  ): Promise<CanonicalHumanoidMotionClip>;
};

export type MotionImportOptions = {
  animationIndex?: number;
  animationName?: string;
};

export type AvatarImportAdapter = {
  id: AvatarFormatId;
  label: string;
  profileId: RigProfileId;
  maturity: AdapterMaturity;
  probe(
    file: File,
    options?: ImportAdapterProbeOptions,
  ): Promise<ImportAdapterProbe>;
};

export type AvatarExportInput = {
  clip: TargetBoundSolvedHumanoidMotionClip;
  avatarFile?: File | null;
  avatarFormatId?: AvatarFormatId | null;
  signal?: AbortSignal;
};
