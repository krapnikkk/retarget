import type { MotionExportAdapter } from "@/adapters/types";
import { exportVMD } from "@/export/vmd";

export const vmdExportAdapter = {
  id: "vmd",
  label: "VMD",
  maturity: "active",
  extension: ".vmd",
  mimeType: "application/octet-stream",
  exportMotion: exportVMD,
} satisfies MotionExportAdapter;
