import type { AvatarExportAdapter } from "@/adapters/types";
import { exportAnimatedPMX } from "@/export/pmx";

export const animatedPmxExportAdapter = {
  id: "animated-pmx",
  label: "PMX Motion Morphs",
  maturity: "experimental",
  extension: ".pmx",
  mimeType: "application/octet-stream",
  exportAvatar: exportAnimatedPMX,
} satisfies AvatarExportAdapter;
