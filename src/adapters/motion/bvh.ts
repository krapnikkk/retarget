import type { MotionImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";
import { importBVH } from "@/import/bvh";
import { assertMotionFileWithinLimit } from "@/jobs/asset-memory-policy";

export const bvhMotionAdapter = {
  id: "bvh",
  label: "BVH Motion",
  profileId: "bvh-humanoid",
  maturity: "active",
  probe: (file, options) =>
    probeImportAdapter(file, {
      container: "bvh",
      extensions: [".bvh"],
      profile: "bvh-humanoid",
      role: "motion",
    }, options),
  async importMotion(file) {
    assertMotionFileWithinLimit(file);
    return importBVH(new Uint8Array(await file.arrayBuffer()), file.name);
  },
} satisfies MotionImportAdapter;
