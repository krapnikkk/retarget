import type { MotionExportAdapter } from "@/adapters/types";
import { exportBVH } from "@/export/bvh";

export const bvhExportAdapter = {
  id: "bvh",
  label: "BVH",
  maturity: "active",
  extension: ".bvh",
  mimeType: "text/plain",
  exportMotion: exportBVH,
} satisfies MotionExportAdapter;
