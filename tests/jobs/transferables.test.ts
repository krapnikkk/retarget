import { describe, expect, it } from "vitest";
import {
  collectRetargetResultTransfers,
  collectRetargetTaskTransfers,
} from "@/jobs/transferables";

describe("retarget Worker transfer lists", () => {
  it("collects and deduplicates only declared task buffers", () => {
    const shared = new ArrayBuffer(16);
    const nested = new ArrayBuffer(8);
    const task = {
      type: "inspect-humanoid-avatar" as const,
      bytes: nested,
      filename: "avatar.gltf",
      formatId: "gltf-humanoid" as const,
      resources: { "avatar.bin": nested },
      assetPackage: {
        primaryPath: "avatar.gltf",
        resources: { "texture.png": shared },
      },
    };

    expect(collectRetargetTaskTransfers(task)).toEqual([nested, shared]);
  });

  it("does not traverse undeclared object fields", () => {
    const task = {
      type: "export-motion" as const,
      formatId: "motion-json" as const,
      clip: { hidden: new ArrayBuffer(4) },
    };

    expect(collectRetargetTaskTransfers(task as never)).toEqual([]);
  });

  it("transfers only byte-returning job results", () => {
    const bytes = new Uint8Array(4);

    expect(collectRetargetResultTransfers({
      type: "export-motion",
      formatId: "motion-json",
      clip: {} as never,
    }, bytes)).toEqual([bytes.buffer]);
  });
});
