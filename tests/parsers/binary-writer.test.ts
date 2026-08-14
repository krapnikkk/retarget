import { describe, expect, it } from "vitest";
import { GrowableBuffer } from "@/parsers/binary-writer";

describe("GrowableBuffer", () => {
  it("returns an exact-sized transferable buffer", () => {
    const writer = new GrowableBuffer(64);
    writer.writeUint8(1);
    writer.writeUint16(0x0302);

    const bytes = writer.toUint8Array();

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
  });

  it("keeps exact sizing after the backing storage grows", () => {
    const writer = new GrowableBuffer(2);
    writer.writeBytes(new Uint8Array([1, 2, 3, 4, 5]));

    const bytes = writer.toUint8Array();

    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
  });
});
