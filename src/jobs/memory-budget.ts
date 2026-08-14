import { RetargetError } from "@/retarget/errors";

export type MemoryEstimate = {
  inputBytes: number;
  decodedBytes: number;
  objectBytesEstimate: number;
  temporaryBytes: number;
  outputBytes: number;
  peakBytes: number;
};

export const BROWSER_PEAK_MEMORY_LIMIT_BYTES = 384 * 1024 * 1024;
export const NODE_PEAK_MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

export function estimateMMDConversionMemory(
  inputBytes: number,
  vertexCount: number,
): MemoryEstimate {
  const decodedBytes = vertexCount * 64;
  const objectBytesEstimate = vertexCount * 8;
  const temporaryBytes = vertexCount * 24;
  const outputBytes = Math.max(inputBytes, decodedBytes);
  const peakBytes =
    inputBytes +
    decodedBytes +
    objectBytesEstimate +
    temporaryBytes +
    outputBytes;
  return {
    inputBytes,
    decodedBytes,
    objectBytesEstimate,
    temporaryBytes,
    outputBytes,
    peakBytes,
  };
}

export function assertMemoryEstimateWithinBudget(
  estimate: MemoryEstimate,
  maxPeakBytes: number,
  label: string,
) {
  if (
    !Number.isSafeInteger(maxPeakBytes) ||
    maxPeakBytes <= 0 ||
    !Object.values(estimate).every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  ) {
    throw new RetargetError("PARSE_INVALID_LENGTH", {
      details: { estimate, label, maxPeakBytes },
      message: `${label} memory estimate is invalid.`,
    });
  }
  if (estimate.peakBytes > maxPeakBytes) {
    throw new RetargetError("FILE_TOO_LARGE", {
      details: { estimate, label, maxPeakBytes },
      message: `${label} estimated peak memory exceeds the processing limit.`,
    });
  }
}
