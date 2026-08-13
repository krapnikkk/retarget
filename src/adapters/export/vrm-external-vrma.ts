import type { AvatarExportAdapter } from "@/adapters/types";
import { exportPairedAvatarMotionZip } from "@/export/paired-archive";

export const vrmExternalVrmaExportAdapter = {
  id: "vrm-external-vrma",
  label: "VRM + external VRMA",
  maturity: "active",
  extension: ".zip",
  mimeType: "application/zip",
  async exportAvatar({ avatarFile, clip }) {
    if (!avatarFile || !avatarFile.name.toLowerCase().endsWith(".vrm")) {
      throw new Error("VRM + external VRMA export requires a VRM avatar file.");
    }

    return exportPairedAvatarMotionZip({
      avatarFile,
      clip,
      motionFormat: "vrma",
    });
  },
} satisfies AvatarExportAdapter;
