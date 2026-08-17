import type { MotionImportAdapter } from "@/adapters/types";
import { bvhMotionImportProbe } from "@/adapters/import-probe-registry";
import { importBVH } from "@/import/bvh";

export const bvhMotionAdapter = {
  ...bvhMotionImportProbe,
  async importMotion(file) {
    return importBVH(new Uint8Array(await file.arrayBuffer()), file.name);
  },
} satisfies MotionImportAdapter;
