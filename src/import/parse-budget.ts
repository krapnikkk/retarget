import {
  RetargetError,
  type RetargetErrorCode,
} from "@/retarget/errors";

export type ParseBudget = {
  maxInputBytes: number;
  maxTracks: number;
  maxSamplesPerTrack: number;
  maxTotalSamples: number;
  maxDurationSeconds: number;
  maxFps: number;
  maxStringBytes: number;
  maxVertices: number;
  maxIndices: number;
  maxMaterials: number;
  maxBones: number;
  maxMorphs: number;
};

export const DEFAULT_PARSE_BUDGET = {
  maxInputBytes: Number.MAX_SAFE_INTEGER,
  maxTracks: Number.MAX_SAFE_INTEGER,
  maxSamplesPerTrack: Number.MAX_SAFE_INTEGER,
  maxTotalSamples: Number.MAX_SAFE_INTEGER,
  maxDurationSeconds: Number.MAX_VALUE,
  maxFps: Number.MAX_VALUE,
  maxStringBytes: Number.MAX_SAFE_INTEGER,
  maxVertices: Number.MAX_SAFE_INTEGER,
  maxIndices: Number.MAX_SAFE_INTEGER,
  maxMaterials: Number.MAX_SAFE_INTEGER,
  maxBones: Number.MAX_SAFE_INTEGER,
  maxMorphs: Number.MAX_SAFE_INTEGER,
} as const satisfies ParseBudget;

export type ParseErrorDetails = {
  filename?: string;
  offset?: number;
  section?: string;
  declared?: number;
  limit?: number;
};

export class ParseDomainError extends RetargetError {
  readonly details: ParseErrorDetails;

  constructor(
    code: RetargetErrorCode,
    message: string,
    details: ParseErrorDetails = {},
  ) {
    super(code, {
      details,
      message: formatParseError(message, details),
    });
    this.name = "ParseDomainError";
    this.details = details;
  }
}

export function resolveParseBudget(
  overrides: Partial<ParseBudget> = {},
): ParseBudget {
  return { ...DEFAULT_PARSE_BUDGET, ...overrides };
}

export function assertInputWithinBudget(
  byteLength: number,
  budget: ParseBudget,
  details: Pick<ParseErrorDetails, "filename" | "section"> = {},
) {
  assertCountWithinBudget(byteLength, budget.maxInputBytes, "input bytes", details);
}

export function assertCountWithinBudget(
  declared: number,
  limit: number,
  label: string,
  details: Pick<ParseErrorDetails, "filename" | "offset" | "section"> = {},
) {
  if (!Number.isSafeInteger(declared) || declared < 0) {
    throw new ParseDomainError(
      "PARSE_INVALID_COUNT",
      `${label} must be a non-negative safe integer`,
      { ...details, declared, limit },
    );
  }
  if (declared > limit) {
    throw new ParseDomainError(
      "PARSE_BUDGET_EXCEEDED",
      `${label} exceeds the processing limit`,
      { ...details, declared, limit },
    );
  }
  return declared;
}

function formatParseError(message: string, details: ParseErrorDetails) {
  const context = [
    details.filename ? `file=${details.filename}` : null,
    details.section ? `section=${details.section}` : null,
    details.offset === undefined ? null : `offset=${details.offset}`,
    details.declared === undefined ? null : `declared=${details.declared}`,
    details.limit === undefined ? null : `limit=${details.limit}`,
  ].filter(Boolean);
  return context.length > 0 ? `${message} (${context.join(", ")})` : message;
}
