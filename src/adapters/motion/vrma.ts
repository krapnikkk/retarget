import type { MotionImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";
import { importVRMA } from "@/import/vrma";
import { assertMotionFileWithinLimit } from "@/jobs/asset-memory-policy";

export const vrmaMotionAdapter = {
  id: "vrma",
  label: "VRM Animation",
  profileId: "vrm-humanoid",
  maturity: "active",
  probe: (file, options) =>
    probeImportAdapter(file, {
      container: "gltf",
      extensions: [".vrma"],
      profile: "vrm-humanoid",
      requiredExtensions: ["VRMC_vrm_animation"],
      role: "motion",
    }, options),
  async importMotion(file) {
    assertMotionFileWithinLimit(file);
    return importVRMA(new Uint8Array(await file.arrayBuffer()), file.name);
  },
} satisfies MotionImportAdapter;
