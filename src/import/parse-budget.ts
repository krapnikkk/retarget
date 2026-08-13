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
  maxInputBytes: 100 * 1024 * 1024,
  maxTracks: 256,
  maxSamplesPerTrack: 150_000,
  maxTotalSamples: 4_000_000,
  maxDurationSeconds: 20 * 60,
  maxFps: 120,
  maxStringBytes: 16 * 1024 * 1024,
  maxVertices: 5_000_000,
  maxIndices: 15_000_000,
  maxMaterials: 100_000,
  maxBones: 100_000,
  maxMorphs: 100_000,
} as const satisfies ParseBudget;

export type ParseErrorDetails = {
  filename?: string;
  offset?: number;
  section?: string;
  declared?: number;
  limit?: number;
};

export class ParseDomainError extends Error {
  readonly code: string;
  readonly details: ParseErrorDetails;

  constructor(code: string, message: string, details: ParseErrorDetails = {}) {
    super(formatParseError(message, details));
    this.name = "ParseDomainError";
    this.code = code;
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
