import type { MotionImportAdapter } from "@/adapters/types";
import { bvhMotionImportProbe } from "@/adapters/import-probe-registry";
import { importBVH } from "@/import/bvh";
import { assertMotionFileWithinLimit } from "@/jobs/asset-memory-policy";

export const bvhMotionAdapter = {
  ...bvhMotionImportProbe,
  async importMotion(file) {
    assertMotionFileWithinLimit(file);
    return importBVH(new Uint8Array(await file.arrayBuffer()), file.name);
  },
} satisfies MotionImportAdapter;
