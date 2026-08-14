import { describe, expect, it } from "vitest";
import { collectArrayBufferTransfers } from "@/jobs/transferables";

describe("Worker transferable collection", () => {
  it("recursively collects nested views and deduplicates backing buffers", () => {
    const shared = new ArrayBuffer(16);
    const nested = new ArrayBuffer(8);
    const value = {
      primary: shared,
      aliases: [shared, new Uint8Array(shared)],
      nested: { result: new Float32Array(nested) },
    };

    expect(collectArrayBufferTransfers(value)).toEqual([nested, shared]);
  });

  it("handles cyclic response graphs", () => {
    const value: { bytes: Uint8Array; self?: unknown } = {
      bytes: new Uint8Array([1, 2, 3]),
    };
    value.self = value;

    expect(collectArrayBufferTransfers(value)).toEqual([value.bytes.buffer]);
  });
});
