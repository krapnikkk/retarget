import { describe, expect, it } from "vitest";
import { readBlobArrayBufferWithSignal } from "@/browser/read-file";

describe("browser file reads", () => {
  it("does not impose a default product-size ceiling", async () => {
    const source = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await readBlobArrayBufferWithSignal(
      new Blob([source]),
      "fixture",
    );

    expect(result.byteLength).toBe(source.byteLength);
  });

  it("returns an exact-sized buffer without retaining streamed chunks", async () => {
    const source = new Uint8Array([1, 2, 3, 4, 5]);

    const result = await readBlobArrayBufferWithSignal(
      new Blob([source]),
      "fixture",
      undefined,
      16,
    );

    expect(result.byteLength).toBe(source.byteLength);
    expect([...new Uint8Array(result)]).toEqual([...source]);
  });

  it("honors cancellation before reading", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(readBlobArrayBufferWithSignal(
      new Blob([new Uint8Array([1])]),
      "fixture",
      controller.signal,
      16,
    )).rejects.toMatchObject({ name: "AbortError" });
  });
});
