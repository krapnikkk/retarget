import type { MotionExportAdapter } from "@/adapters/types";
import { exportVRMA } from "@/export/vrma";

export const vrmaExportAdapter = {
  id: "vrma",
  label: "VRMA",
  maturity: "active",
  extension: ".vrma",
  mimeType: "model/gltf-binary",
  exportMotion: exportVRMA,
} satisfies MotionExportAdapter;
