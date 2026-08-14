import { DEFAULT_PARSE_BUDGET } from "@/import/parse-budget";
import { DEFAULT_PROCESSING_BUDGET } from "@/processing-budget";
import { RetargetError } from "@/retarget";
import type { NodeToolBudget } from "./types";

export const DEFAULT_NODE_TOOL_BUDGET = Object.freeze({
  maxInputBytes: DEFAULT_PARSE_BUDGET.maxInputBytes,
  maxOutputBytes: DEFAULT_PROCESSING_BUDGET.maxOutputBytes,
  maxArchiveEntries: 512,
  maxArchiveEntryBytes: DEFAULT_PROCESSING_BUDGET.maxOutputBytes,
  maxArchiveExpandedBytes: 512 * 1024 * 1024,
  maxArchiveCompressionRatio: 200,
  softDeadlineMs: DEFAULT_PROCESSING_BUDGET.softDeadlineMs,
} as const satisfies NodeToolBudget);

export function resolveNodeToolBudget(
  overrides: Partial<NodeToolBudget> = {},
): NodeToolBudget {
  const resolved = { ...DEFAULT_NODE_TOOL_BUDGET, ...overrides };
  for (const key of Object.keys(DEFAULT_NODE_TOOL_BUDGET) as Array<
    keyof NodeToolBudget
  >) {
    const value = resolved[key];
    const ceiling = DEFAULT_NODE_TOOL_BUDGET[key];
    if (!Number.isFinite(value) || value <= 0 || value > ceiling) {
      throw new RetargetError("PROCESSING_OPTION_INVALID", {
        details: { key, value, ceiling },
        message: `${key} must be finite, positive, and no greater than ${ceiling}.`,
      });
    }
    if (key !== "maxArchiveCompressionRatio" && !Number.isSafeInteger(value)) {
      throw new RetargetError("PROCESSING_OPTION_INVALID", {
        details: { key, value },
        message: `${key} must be a safe integer.`,
      });
    }
  }
  return resolved;
}
