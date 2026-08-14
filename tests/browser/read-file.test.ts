import { describe, expect, it } from "vitest";
import { readBlobArrayBufferWithSignal } from "@/browser/read-file";

describe("bounded browser file reads", () => {
  it("returns an exact-sized buffer without retaining streamed chunks", async () => {
    const source = new Uint8Array([1, 2, 3, 4, 5]);

    const result = await readBlobArrayBufferWithSignal(
      new Blob([source]),
      16,
      "fixture",
    );

    expect(result.byteLength).toBe(source.byteLength);
    expect([...new Uint8Array(result)]).toEqual([...source]);
  });

  it("honors cancellation before reading", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(readBlobArrayBufferWithSignal(
      new Blob([new Uint8Array([1])]),
      16,
      "fixture",
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
  });
});
