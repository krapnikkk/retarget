import type { AssetPackageRole } from "@/import/asset-package";
import { RetargetError } from "@/retarget/errors";
import {
  BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
  type BrowserInputPreparationRequest,
} from "./input-preparation-protocol";
import type { BrowserInputPreparationBudget } from "./input-preparation-types";

const INPUT_ROLES = new Set<AssetPackageRole>(["avatar", "motion"]);
const INPUT_SOURCE_KINDS = new Set(["file", "file-handle", "directory-handle"]);
const BUDGET_KEYS = [
  "maxEntries",
  "maxCompressedBytes",
  "maxExpandedBytes",
  "maxSingleEntryBytes",
  "maxRetainedBytes",
] as const satisfies readonly (keyof BrowserInputPreparationBudget)[];

export function assertBrowserInputPreparationRequest(
  value: unknown,
): asserts value is BrowserInputPreparationRequest {
  const request = asRecord(value, "Input Worker request");
  if (request.schemaVersion !== BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION) {
    protocolError("Input Worker request schemaVersion is unsupported.");
  }
  assertBoundedString(request.jobId, "Input Worker request jobId", 128);
  if (request.deadlineMs !== undefined) {
    assertPositiveInteger(request.deadlineMs, "Input Worker request deadlineMs");
  }
  const task = asRecord(request.task, "Input Worker request task");
  if (task.type !== "prepare-browser-input") {
    protocolError("Input Worker request task discriminator is unsupported.");
  }
  if (typeof task.role !== "string" || !INPUT_ROLES.has(task.role as never)) {
    protocolError("Input Worker request role is unsupported.");
  }
  const budget = asRecord(task.budget, "Input Worker request budget");
  assertPositiveInteger(
    budget.maxProbeBytes,
    "Input Worker request budget.maxProbeBytes",
  );
  for (const key of BUDGET_KEYS) {
    if (budget[key] !== undefined) {
      assertPositiveInteger(budget[key], `Input Worker request budget.${key}`);
    }
  }
  if (budget.maxElapsedMs !== undefined) {
    assertPositiveInteger(
      budget.maxElapsedMs,
      "Input Worker request budget.maxElapsedMs",
    );
  }
  if (request.deadlineMs !== budget.maxElapsedMs) {
    protocolError("Input Worker deadline must match budget.maxElapsedMs.");
  }
  assertInputSource(task.source);
}

function assertInputSource(value: unknown) {
  const source = asRecord(value, "Input Worker request source");
  if (typeof source.kind !== "string" || !INPUT_SOURCE_KINDS.has(source.kind)) {
    protocolError("Input Worker request source kind is unsupported.");
  }
  if (source.kind === "file") {
    if (!(source.file instanceof File)) {
      protocolError("Input Worker request source.file must be a File.");
    }
    return;
  }
  const handle = asRecord(source.handle, "Input Worker request source handle");
  const expectedKind = source.kind === "file-handle" ? "file" : "directory";
  if (handle.kind !== expectedKind) {
    protocolError("Input Worker request handle kind does not match its source.");
  }
  assertBoundedString(handle.name, "Input Worker request handle name", 1024);
  const method = source.kind === "file-handle" ? "getFile" : "values";
  if (typeof handle[method] !== "function") {
    protocolError(`Input Worker request handle.${method} must be callable.`);
  }
}

function assertPositiveInteger(
  value: unknown,
  label: string,
) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0
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
