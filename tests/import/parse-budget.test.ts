import { describe, expect, it } from "vitest";
import { DEFAULT_PARSE_BUDGET, ParseDomainError } from "@/import/parse-budget";
import {
  PMXBinaryReader,
  readPMXHeader,
} from "@/parsers/pmx-binary";

describe("binary parse budgets", () => {
  it("rejects negative and oversized PMX counts with domain context", () => {
    const negative = new Uint8Array(4);
    new DataView(negative.buffer).setInt32(0, -1, true);

    expect(() =>
      new PMXBinaryReader(negative, "negative.pmx").readCount({
        max: DEFAULT_PARSE_BUDGET.maxVertices,
        label: "PMX vertices",
      }),
    ).toThrow(/PMX vertices must be a non-negative safe integer.*file=negative\.pmx/);

    const oversized = new Uint8Array(4);
    new DataView(oversized.buffer).setInt32(
      0,
      DEFAULT_PARSE_BUDGET.maxVertices + 1,
      true,
    );
    expect(() =>
      new PMXBinaryReader(oversized, "oversized.pmx").readCount({
        max: DEFAULT_PARSE_BUDGET.maxVertices,
        label: "PMX vertices",
      }),
    ).toThrow(/declared=5000001, limit=5000000/);
  });

  it("rejects truncated reads and invalid PMX index widths", () => {
    expect(() =>
      new PMXBinaryReader(new Uint8Array(2), "short.pmx").readFloat32(),
    ).toThrow(/PMX\/PMD input is truncated.*file=short\.pmx.*offset=0/);

    const bytes = createPMXHeader({ vertexIndexSize: 3 });
    expect(() => readPMXHeader(new PMXBinaryReader(bytes, "bad-index.pmx"))).toThrow(
      /PMX index size 0 is invalid: 3/,
    );
  });

  it("exposes stable domain codes for callers", () => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, -2, true);
    try {
      new PMXBinaryReader(bytes, "domain.pmx").readCount({
        max: 10,
        label: "items",
      });
      throw new Error("Expected count validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ParseDomainError);
      expect((error as ParseDomainError).code).toBe("PARSE_INVALID_COUNT");
    }
  });
});

function createPMXHeader({ vertexIndexSize }: { vertexIndexSize: number }) {
  const bytes = new Uint8Array(17);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PMX "), 0);
  view.setFloat32(4, 2, true);
  bytes[8] = 8;
  bytes.set([1, 0, vertexIndexSize, 4, 4, 4, 4, 4], 9);
  return bytes;
}
