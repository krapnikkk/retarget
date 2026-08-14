import { MAX_IMPORT_PROBE_BYTES } from "@/adapters/probe";
import type { AssetPackageRole } from "@/import/asset-package";
import {
  MAX_MOTION_FILE_BYTES,
  MAX_RANGE_LOADABLE_AVATAR_BYTES,
} from "@/jobs/asset-memory-policy";
import { DEFAULT_PROCESSING_BUDGET } from "@/processing-budget";
import { RetargetError } from "@/retarget/errors";
import type { BrowserInputPreparationBudget } from "./input-preparation-types";

const MAX_INPUT_ENTRIES = 512;

export const DEFAULT_BROWSER_INPUT_PREPARATION_BUDGETS = {
  avatar: {
    maxProbeBytes: MAX_IMPORT_PROBE_BYTES,
    maxEntries: MAX_INPUT_ENTRIES,
    maxCompressedBytes: MAX_RANGE_LOADABLE_AVATAR_BYTES,
    maxExpandedBytes: MAX_RANGE_LOADABLE_AVATAR_BYTES,
    maxSingleEntryBytes: MAX_RANGE_LOADABLE_AVATAR_BYTES,
    maxRetainedBytes: MAX_RANGE_LOADABLE_AVATAR_BYTES,
    maxElapsedMs: DEFAULT_PROCESSING_BUDGET.softDeadlineMs,
  },
  motion: {
    maxProbeBytes: MAX_IMPORT_PROBE_BYTES,
    maxEntries: MAX_INPUT_ENTRIES,
    maxCompressedBytes: MAX_MOTION_FILE_BYTES,
    maxExpandedBytes: MAX_MOTION_FILE_BYTES,
    maxSingleEntryBytes: MAX_MOTION_FILE_BYTES,
    maxRetainedBytes: MAX_MOTION_FILE_BYTES,
    maxElapsedMs: DEFAULT_PROCESSING_BUDGET.softDeadlineMs,
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
    maxEntries: resolveLimit(
      "maxEntries",
      overrides.maxEntries,
      defaults.maxEntries,
    ),
    maxCompressedBytes: resolveLimit(
      "maxCompressedBytes",
      overrides.maxCompressedBytes,
      defaults.maxCompressedBytes,
    ),
    maxExpandedBytes: resolveLimit(
      "maxExpandedBytes",
      overrides.maxExpandedBytes,
      defaults.maxExpandedBytes,
    ),
    maxSingleEntryBytes: resolveLimit(
      "maxSingleEntryBytes",
      overrides.maxSingleEntryBytes,
      defaults.maxSingleEntryBytes,
    ),
    maxRetainedBytes: resolveLimit(
      "maxRetainedBytes",
      overrides.maxRetainedBytes,
      defaults.maxRetainedBytes,
    ),
    maxElapsedMs: resolveLimit(
      "maxElapsedMs",
      overrides.maxElapsedMs,
      defaults.maxElapsedMs,
    ),
  };
}

function resolveLimit(name: string, value: number | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RetargetError("PROCESSING_OPTION_INVALID", {
      details: { name, value },
      message: `${name} must be a positive safe integer.`,
    });
  }
  return Math.min(value, maximum);
}
