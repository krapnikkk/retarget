import type { MotionImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";
import { importVMD } from "@/import/vmd";
import { assertMotionFileWithinLimit } from "@/jobs/asset-memory-policy";

export const vmdMotionAdapter = {
  id: "vmd",
  label: "VMD Body Motion",
  profileId: "mmd-body",
  maturity: "active",
  probe: (file, options) =>
    probeImportAdapter(file, {
      container: "vmd",
      extensions: [".vmd"],
      profile: "mmd-body",
      role: "motion",
    }, options),
  async importMotion(file) {
    assertMotionFileWithinLimit(file);
    return importVMD(new Uint8Array(await file.arrayBuffer()), file.name);
  },
} satisfies MotionImportAdapter;
