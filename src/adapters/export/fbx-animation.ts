import type { MotionExportAdapter } from "@/adapters/types";
import { exportFBXAnimation } from "@/export/fbx";

export const fbxAnimationExportAdapter = {
  id: "fbx-animation",
  label: "FBX Animation",
  maturity: "active",
  extension: ".fbx",
  mimeType: "application/octet-stream",
  exportMotion: exportFBXAnimation,
} satisfies MotionExportAdapter;