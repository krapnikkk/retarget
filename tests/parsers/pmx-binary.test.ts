import { describe, expect, it } from "vitest";
import { PMXBinaryReader, readPMXWeight } from "@/parsers/pmx-binary";

describe("PMX vertex weights", () => {
  it("rejects BDEF2 weights outside 0..1", () => {
    const bytes = new Uint8Array(13);
    const view = new DataView(bytes.buffer);
    bytes[0] = 1;
    view.setInt32(1, 0, true);
    view.setInt32(5, 1, true);
    view.setFloat32(9, 1.5, true);

    expect(() => readPMXWeight(new PMXBinaryReader(bytes), 4)).toThrow(
      expect.objectContaining({ code: "PARSE_INVALID_NUMBER" }),
    );
  });

  it("rejects BDEF4 weights that do not sum to one", () => {
    const bytes = new Uint8Array(33);
    const view = new DataView(bytes.buffer);
    bytes[0] = 2;
    for (let index = 0; index < 4; index += 1) {
      view.setInt32(1 + index * 4, index, true);
      view.setFloat32(17 + index * 4, 0.1, true);
    }

    expect(() => readPMXWeight(new PMXBinaryReader(bytes), 4)).toThrow(
      expect.objectContaining({ code: "PARSE_INVALID_NUMBER" }),
    );
  });
});
