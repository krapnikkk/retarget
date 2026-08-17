import type {
  AssetPackageReport,
  AssetPackageRole,
  PreparedAssetPackageEntry,
} from "@/import/asset-package";
import type { RetargetJobFailure } from "@/jobs/types";
import { RETARGET_ERROR_CODES, RetargetError } from "@/retarget/errors";
import type {
  BrowserInputDirectoryHandle,
  BrowserInputFileHandle,
  BrowserInputPreparationBudget,
  BrowserInputPreparationPhase,
  BrowserInputSelection,
} from "./input-preparation-types";

export const BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION = 2;

const INPUT_PHASES = new Set<BrowserInputPreparationPhase>([
  "discover",
  "read",
  "probe",
  "unpack",
  "resolve",
  "complete",
]);
const INPUT_SELECTION_STATUSES = new Set(["matched", "inconclusive", "unsupported"]);
const INPUT_CONTAINERS = new Set(["bvh", "fbx", "gltf", "mmd-model", "vmd"]);
const RESPONSE_TYPES = new Set(["progress", "success", "failure"]);

export type BrowserInputPreparationSource =
  | { kind: "file"; file: File }
  | { kind: "file-handle"; handle: BrowserInputFileHandle }
  | { kind: "directory-handle"; handle: BrowserInputDirectoryHandle };

export type BrowserInputPreparationRequest = {
  schemaVersion: typeof BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION;
  jobId: string;
  deadlineMs?: number;
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
      schemaVersion: typeof BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION;
      jobId: string;
      type: "progress";
      phase: BrowserInputPreparationPhase;
      progress: number;
    }
  | {
      schemaVersion: typeof BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION;
      jobId: string;
      type: "success";
      result: BrowserInputPreparationWireResult;
    }
  | {
      schemaVersion: typeof BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION;
      jobId: string;
      type: "failure";
      error: RetargetJobFailure["error"];
    };

export function assertBrowserInputPreparationResponse(
  value: unknown,
  request: BrowserInputPreparationRequest,
): asserts value is BrowserInputPreparationResponse {
  const response = asRecord(value, "Input Worker response");
  if (response.schemaVersion !== BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION) {
    protocolError("Input Worker response schemaVersion is unsupported.");
  }
  if (response.jobId !== request.jobId) {
    protocolError("Input Worker response jobId does not match its request.");
  }
  if (typeof response.type !== "string" || !RESPONSE_TYPES.has(response.type)) {
    protocolError("Input Worker response discriminator is unsupported.");
  }
  if (response.type === "progress") {
    if (
      typeof response.phase !== "string" ||
      !INPUT_PHASES.has(response.phase as BrowserInputPreparationPhase) ||
      typeof response.progress !== "number" ||
      !Number.isFinite(response.progress) ||
      response.progress < 0 ||
      response.progress > 1
    ) {
      protocolError("Input Worker progress response is invalid.");
    }
    return;
  }
  if (response.type === "failure") {
    assertFailure(response.error);
    return;
  }
  assertInputResult(
    response.result,
    request.task.role,
    request.task.budget.maxEntries ?? Number.MAX_SAFE_INTEGER,
  );
}

function assertFailure(value: unknown) {
  const error = asRecord(value, "Input Worker failure error");
  if (
    typeof error.code !== "string" ||
    !RETARGET_ERROR_CODES.includes(error.code as never)
  ) {
    protocolError("Input Worker failure code is not registered.");
  }
  assertBoundedString(error.name, "Input Worker failure name", 128);
  assertBoundedString(error.message, "Input Worker failure message", 16_384);
}

function assertInputResult(
  value: unknown,
  role: AssetPackageRole,
  maxEntries: number,
) {
  const result = asRecord(value, "Input Worker success result");
  if (!(result.file instanceof File)) {
    protocolError("Input Worker success file must be a File.");
  }
  if (result.report !== null && !isRecord(result.report)) {
    protocolError("Input Worker success report must be an object or null.");
  }
  if (isRecord(result.report)) assertPackageReport(result.report, maxEntries);
  if (result.entries !== undefined) {
    if (!Array.isArray(result.entries) || result.entries.length > maxEntries) {
      protocolError("Input Worker success entries are invalid.");
    }
    for (const entryValue of result.entries) {
      const entry = asRecord(entryValue, "Input Worker success entry");
      assertBoundedString(entry.name, "Input Worker success entry name", 4096);
      if (!(entry.blob instanceof Blob)) {
        protocolError("Input Worker success entry blob must be a Blob.");
      }
      assertPositiveInteger(
        entry.byteLength,
        "Input Worker success entry byteLength",
        Number.MAX_SAFE_INTEGER,
        true,
      );
      if (entry.byteLength !== entry.blob.size) {
        protocolError("Input Worker success entry byteLength is inconsistent.");
      }
    }
  }
  if ((result.report === null) !== (result.entries === undefined)) {
    protocolError("Input Worker package report and entries must be returned together.");
  }
  const selection = asRecord(result.selection, "Input Worker success selection");
  if (
    typeof selection.status !== "string" ||
    !INPUT_SELECTION_STATUSES.has(selection.status)
  ) {
    protocolError("Input Worker success selection status is invalid.");
  }
  if (selection.role !== role) {
    protocolError("Input Worker success selection role does not match its request.");
  }
  if (selection.formatId !== null) {
    assertBoundedString(
      selection.formatId,
      "Input Worker success selection formatId",
      128,
    );
  }
  if (selection.profileId !== null) {
    assertBoundedString(
      selection.profileId,
      "Input Worker success selection profileId",
      128,
    );
  }
  if (
    selection.status === "matched" &&
    (selection.formatId === null || selection.profileId === null)
  ) {
    protocolError("Matched input selections require format and profile IDs.");
  }
  if (
    selection.container !== null &&
    (typeof selection.container !== "string" ||
      !INPUT_CONTAINERS.has(selection.container))
  ) {
    protocolError("Input Worker success selection container is invalid.");
  }
  if (
    typeof selection.confidence !== "number" ||
    !Number.isFinite(selection.confidence) ||
    selection.confidence < 0 ||
    selection.confidence > 1
  ) {
    protocolError("Input Worker success selection confidence is invalid.");
  }
  assertPositiveInteger(
    selection.bytesInspected,
    "Input Worker success selection bytesInspected",
    Number.MAX_SAFE_INTEGER,
    true,
  );
  if (!Array.isArray(selection.evidence) || !Array.isArray(selection.warnings)) {
    protocolError("Input Worker success selection diagnostics are invalid.");
  }
  if (selection.evidence.length > 128 || selection.warnings.length > 128) {
    protocolError("Input Worker success selection diagnostics exceed their budget.");
  }
  for (const evidenceValue of selection.evidence) {
    const evidence = asRecord(
      evidenceValue,
      "Input Worker success selection evidence",
    );
    assertBoundedString(
      evidence.code,
      "Input Worker success selection evidence code",
      128,
    );
    assertBoundedString(
      evidence.message,
      "Input Worker success selection evidence message",
      4096,
    );
  }
  for (const warning of selection.warnings) {
    assertBoundedString(
      warning,
      "Input Worker success selection warning",
      4096,
    );
  }
}

function assertPackageReport(
  report: Record<string, unknown>,
  maxEntries: number,
) {
  if (report.sourceKind !== "zip" && report.sourceKind !== "directory") {
    protocolError("Input Worker success report sourceKind is invalid.");
  }
  assertBoundedString(report.sourceName, "Input Worker report sourceName", 1024);
  assertBoundedString(report.primaryPath, "Input Worker report primaryPath", 4096);
  for (const key of ["entryCount", "resourceCount", "expandedBytes"] as const) {
    assertPositiveInteger(
      report[key],
      `Input Worker report ${key}`,
      Number.MAX_SAFE_INTEGER,
      true,
    );
  }
  if (
    !Array.isArray(report.missingResources) ||
    report.missingResources.length > maxEntries
  ) {
    protocolError("Input Worker report missingResources is invalid.");
  }
  for (const resource of report.missingResources) {
    assertBoundedString(resource, "Input Worker report missing resource", 4096);
  }
}

function assertPositiveInteger(
  value: unknown,
  label: string,
  maximum: number,
  allowZero = false,
) {
  if (
    !Number.isSafeInteger(value) ||
    (allowZero ? (value as number) < 0 : (value as number) <= 0) ||
    (value as number) > maximum
  ) {
    protocolError(`${label} must be a bounded integer.`);
  }
}

function assertBoundedString(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    protocolError(`${label} must be a non-empty bounded string.`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) protocolError(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function protocolError(message: string): never {
  throw new RetargetError("WORKER_PROTOCOL_INVALID", { message });
}
