import type { MotionImportAdapter } from "@/adapters/types";
import { vmdMotionImportProbe } from "@/adapters/import-probe-registry";
import { importVMD } from "@/import/vmd";

export const vmdMotionAdapter = {
  ...vmdMotionImportProbe,
  async importMotion(file) {
    return importVMD(new Uint8Array(await file.arrayBuffer()), file.name);
  },
} satisfies MotionImportAdapter;
