import { DEFAULT_PARSE_BUDGET } from "@/import/parse-budget";
import { DEFAULT_PROCESSING_BUDGET } from "@/processing-budget";
import { RetargetError } from "@/retarget";
import type { NodeToolBudget } from "./types";

export const DEFAULT_NODE_TOOL_BUDGET: Readonly<NodeToolBudget> = Object.freeze({
  maxInputBytes: DEFAULT_PARSE_BUDGET.maxInputBytes,
  maxOutputBytes: DEFAULT_PROCESSING_BUDGET.maxOutputBytes,
  maxArchiveEntries: 512,
  maxArchiveEntryBytes: 256 * 1024 * 1024,
  maxArchiveExpandedBytes: 512 * 1024 * 1024,
  maxArchiveCompressionRatio: 200,
});

export function resolveNodeToolBudget(
  overrides: Partial<NodeToolBudget> = {},
): NodeToolBudget {
  const resolved = { ...DEFAULT_NODE_TOOL_BUDGET, ...overrides };
  for (const key of Object.keys(resolved) as Array<keyof NodeToolBudget>) {
    const value = resolved[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0) {
      throw new RetargetError("PROCESSING_OPTION_INVALID", {
        details: { key, value },
        message: `${key} must be finite and positive.`,
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
