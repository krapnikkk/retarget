import type { MotionImportAdapter } from "@/adapters/types";
import { vrmaMotionImportProbe } from "@/adapters/import-probe-registry";
import { importVRMA } from "@/import/vrma";

export const vrmaMotionAdapter = {
  ...vrmaMotionImportProbe,
  async importMotion(file) {
    return importVRMA(new Uint8Array(await file.arrayBuffer()), file.name);
  },
} satisfies MotionImportAdapter;
