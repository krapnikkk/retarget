import type {
  AvatarFormatId,
  MotionExportFormatId,
  AvatarExportFormatId,
  MotionFormatId,
} from "@/formats";
import type {
  CanonicalHumanoidMotionClip,
  RetargetedMotionClip,
  TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import type { RigProfileId } from "@/profiles";
import type { BoneNamingOptions } from "@/export/bone-naming";

export type AdapterMaturity = "active" | "planned" | "experimental";

export type ImportAdapterProbe = {
  confidence: number;
  profile: RigProfileId;
  evidence: string[];
  warnings: string[];
};

export type MotionImportAdapter = {
  id: MotionFormatId;
  label: string;
  profileId: RigProfileId;
  maturity: AdapterMaturity;
  probe(file: File): Promise<ImportAdapterProbe>;
  importMotion?(file: File): Promise<CanonicalHumanoidMotionClip>;
};

export type AvatarImportAdapter = {
  id: AvatarFormatId;
  label: string;
  profileId: RigProfileId;
  maturity: AdapterMaturity;
  probe(file: File): Promise<ImportAdapterProbe>;
};

export type MotionExportOptions = BoneNamingOptions;

export type MotionExportAdapter = {
  id: MotionExportFormatId;
  label: string;
  maturity: AdapterMaturity;
  extension: string;
  mimeType: string;
  exportMotion(
    clip: RetargetedMotionClip,
    options?: MotionExportOptions,
  ): Promise<Uint8Array>;
};

export type AvatarExportInput = {
  clip: TargetBoundSolvedHumanoidMotionClip;
  avatarFile?: File | null;
  avatarFormatId?: AvatarFormatId | null;
};

export type AvatarExportAdapter = {
  id: AvatarExportFormatId;
  label: string;
  maturity: AdapterMaturity;
  extension: string;
  mimeType: string;
  exportAvatar(input: AvatarExportInput): Promise<Uint8Array>;
};
