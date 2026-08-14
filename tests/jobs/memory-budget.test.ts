import { describe, expect, it } from "vitest";
import {
  BROWSER_PEAK_MEMORY_LIMIT_BYTES,
  assertMemoryEstimateWithinBudget,
  estimateMMDConversionMemory,
} from "@/jobs/memory-budget";
import { parsePMX } from "@/export/avatar-conversion";

describe("peak-memory budgets", () => {
  it("accounts for input, typed arrays, temporaries, and output", () => {
    const estimate = estimateMMDConversionMemory(1_000, 10);

    expect(estimate).toEqual({
      inputBytes: 1_000,
      decodedBytes: 640,
      objectBytesEstimate: 80,
      temporaryBytes: 240,
      outputBytes: 1_000,
      peakBytes: 2_960,
    });
  });

  it("rejects an over-budget estimate with a public error code", () => {
    expect(() => assertMemoryEstimateWithinBudget(
      estimateMMDConversionMemory(100 * 1024 * 1024, 5_000_000),
      BROWSER_PEAK_MEMORY_LIMIT_BYTES,
      "PMX conversion",
    )).toThrow(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });

  it("rejects an oversized PMX before allocating its vertex arrays", () => {
    expect(() => parsePMX(
      createPMXHeaderWithVertexCount(5_000_000),
      { maxPeakBytes: BROWSER_PEAK_MEMORY_LIMIT_BYTES },
    )).toThrow(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });
});

function createPMXHeaderWithVertexCount(vertexCount: number) {
  const bytes = new Uint8Array(37);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PMX "), 0);
  view.setFloat32(4, 2, true);
  bytes[8] = 8;
  bytes.set([1, 0, 4, 4, 4, 4, 4, 4], 9);
  view.setUint32(33, vertexCount, true);
  return bytes;
}
