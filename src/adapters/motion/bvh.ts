import type { MotionImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";
import { importBVH } from "@/import/bvh";

export const bvhMotionAdapter = {
  id: "bvh",
  label: "BVH Motion",
  profileId: "bvh-humanoid",
  maturity: "active",
  probe: (file) =>
    probeImportAdapter(file, {
      container: "bvh",
      extensions: [".bvh"],
      profile: "bvh-humanoid",
      role: "motion",
    }),
  async importMotion(file) {
    return importBVH(new Uint8Array(await file.arrayBuffer()), file.name);
  },
} satisfies MotionImportAdapter;
