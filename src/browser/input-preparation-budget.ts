import { MAX_IMPORT_PROBE_BYTES } from "@/adapters/probe";
import type { AssetPackageRole } from "@/import/asset-package";
import { RetargetError } from "@/retarget/errors";
import type { BrowserInputPreparationBudget } from "./input-preparation-types";

export const DEFAULT_BROWSER_INPUT_PREPARATION_BUDGETS = {
  avatar: {
    maxProbeBytes: MAX_IMPORT_PROBE_BYTES,
  },
  motion: {
    maxProbeBytes: MAX_IMPORT_PROBE_BYTES,
  },
} as const satisfies Record<AssetPackageRole, BrowserInputPreparationBudget>;

export function resolveBrowserInputPreparationBudget(
  role: AssetPackageRole,
  overrides: Partial<BrowserInputPreparationBudget> = {},
): BrowserInputPreparationBudget {
  const defaults = DEFAULT_BROWSER_INPUT_PREPARATION_BUDGETS[role];
  return {
    maxProbeBytes: resolveLimit(
      "maxProbeBytes",
      overrides.maxProbeBytes,
      defaults.maxProbeBytes,
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
