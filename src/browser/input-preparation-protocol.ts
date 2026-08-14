import type {
  AssetPackageReport,
  AssetPackageRole,
  PreparedAssetPackageEntry,
} from "@/import/asset-package";
import type { RetargetJobFailure } from "@/jobs/types";
import type {
  BrowserInputDirectoryHandle,
  BrowserInputFileHandle,
  BrowserInputPreparationBudget,
  BrowserInputPreparationPhase,
  BrowserInputSelection,
} from "./input-preparation-types";

export type BrowserInputPreparationSource =
  | { kind: "file"; file: File }
  | { kind: "file-handle"; handle: BrowserInputFileHandle }
  | { kind: "directory-handle"; handle: BrowserInputDirectoryHandle };

export type BrowserInputPreparationRequest = {
  jobId: string;
  deadlineMs: number;
  task: {
    type: "prepare-browser-input";
    source: BrowserInputPreparationSource;
    role: AssetPackageRole;
    budget: BrowserInputPreparationBudget;
  };
};

export type BrowserInputPreparationWireResult = {
  file: File;
  report: AssetPackageReport | null;
  entries?: PreparedAssetPackageEntry[];
  selection: BrowserInputSelection;
};

export type BrowserInputPreparationResponse =
  | {
      jobId: string;
      type: "progress";
      phase: BrowserInputPreparationPhase;
      progress: number;
    }
  | {
      jobId: string;
      type: "success";
      result: BrowserInputPreparationWireResult;
    }
  | {
      jobId: string;
      type: "failure";
      error: RetargetJobFailure["error"];
    };

export function isBrowserInputPreparationRequest(
  request: unknown,
): request is BrowserInputPreparationRequest {
  return Boolean(
    request &&
      typeof request === "object" &&
      "task" in request &&
      request.task &&
      typeof request.task === "object" &&
      "type" in request.task &&
      request.task.type === "prepare-browser-input",
  );
}
