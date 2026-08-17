import type {
  AvatarFormatId,
  MotionFormatId,
} from "@/formats";
import type {
  AssetPackageReport,
  AssetPackageRole,
  TransferableAssetPackage,
} from "@/import/asset-package";
import type { RigProfileId } from "@/profiles";

export type BrowserInputContainer =
  | "bvh"
  | "fbx"
  | "gltf"
  | "mmd-model"
  | "vmd";

export type BrowserInputProbeEvidence = {
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

export type BrowserInputPreparationPhase =
  | "discover"
  | "read"
  | "probe"
  | "unpack"
  | "resolve"
  | "complete";

export type BrowserInputPreparationProgress = {
  phase: BrowserInputPreparationPhase;
  progress: number;
};

export type BrowserInputPreparationBudget = {
  maxProbeBytes: number;
  maxEntries?: number;
  maxCompressedBytes?: number;
  maxExpandedBytes?: number;
  maxSingleEntryBytes?: number;
  maxRetainedBytes?: number;
  maxElapsedMs?: number;
};

export type BrowserInputSelectionStatus =
  | "matched"
  | "inconclusive"
  | "unsupported";

export type BrowserInputSelection = {
  status: BrowserInputSelectionStatus;
  role: AssetPackageRole;
  formatId: AvatarFormatId | MotionFormatId | null;
  profileId: RigProfileId | null;
  container: BrowserInputContainer | null;
  confidence: number;
  evidence: readonly BrowserInputProbeEvidence[];
  warnings: readonly string[];
  bytesInspected: number;
};

export type BrowserInputFileHandle = {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
};

export type BrowserInputDirectoryHandle = {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<BrowserInputFileHandle | BrowserInputDirectoryHandle>;
};

export type BrowserAssetInput =
  | File
  | BrowserInputFileHandle
  | BrowserInputDirectoryHandle;

export type PrepareBrowserAssetInputOptions = {
  role: AssetPackageRole;
  budget?: Partial<BrowserInputPreparationBudget>;
  signal?: AbortSignal;
  onProgress?: (progress: BrowserInputPreparationProgress) => void;
};

export type PreparedBrowserAssetInput = {
  readonly file: File;
  readonly report: AssetPackageReport | null;
  readonly selection: BrowserInputSelection;
  readonly disposed: boolean;
  collectTransferable(signal?: AbortSignal): Promise<
    TransferableAssetPackage | undefined
  >;
  dispose(): boolean;
};
