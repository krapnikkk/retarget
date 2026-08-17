import { MAX_IMPORT_PROBE_BYTES } from "@/adapters/probe";
import { RetargetError } from "@/retarget/errors";
import type { BrowserInputPreparationBudget } from "./input-preparation-types";

export function resolveBrowserInputPreparationBudget(
  overrides: Partial<BrowserInputPreparationBudget> = {},
): BrowserInputPreparationBudget {
  return {
    maxProbeBytes: resolveLimit(
      "maxProbeBytes",
      overrides.maxProbeBytes,
      MAX_IMPORT_PROBE_BYTES,
    ),
    maxEntries: resolveOptionalLimit(
      "maxEntries",
      overrides.maxEntries,
    ),
    maxCompressedBytes: resolveOptionalLimit(
      "maxCompressedBytes",
      overrides.maxCompressedBytes,
    ),
    maxExpandedBytes: resolveOptionalLimit(
      "maxExpandedBytes",
      overrides.maxExpandedBytes,
    ),
    maxSingleEntryBytes: resolveOptionalLimit(
      "maxSingleEntryBytes",
      overrides.maxSingleEntryBytes,
    ),
    maxRetainedBytes: resolveOptionalLimit(
      "maxRetainedBytes",
      overrides.maxRetainedBytes,
    ),
    maxElapsedMs: resolveOptionalLimit("maxElapsedMs", overrides.maxElapsedMs),
  };
}

function resolveLimit(name: string, value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RetargetError("PROCESSING_OPTION_INVALID", {
      details: { name, value },
      message: `${name} must be a positive safe integer.`,
    });
  }
  return value;
}

function resolveOptionalLimit(name: string, value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RetargetError("PROCESSING_OPTION_INVALID", {
      details: { name, value },
      message: `${name} must be a positive safe integer.`,
    });
  }
  return value;
}
