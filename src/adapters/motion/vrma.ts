import type { MotionImportAdapter } from "@/adapters/types";
import { vrmaMotionImportProbe } from "@/adapters/import-probe-registry";
import { importVRMA } from "@/import/vrma";
import { assertMotionFileWithinLimit } from "@/jobs/asset-memory-policy";

export const vrmaMotionAdapter = {
  ...vrmaMotionImportProbe,
  async importMotion(file) {
    assertMotionFileWithinLimit(file);
    return importVRMA(new Uint8Array(await file.arrayBuffer()), file.name);
  },
} satisfies MotionImportAdapter;
