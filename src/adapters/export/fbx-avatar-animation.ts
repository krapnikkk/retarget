import type { AvatarExportAdapter } from "@/adapters/types";
import { exportFBXAvatarAnimation } from "@/export/fbx-avatar";

export const fbxAvatarAnimationExportAdapter = {
  id: "fbx-avatar-animation",
  label: "Animated FBX",
  maturity: "active",
  extension: ".fbx",
  mimeType: "application/octet-stream",
  exportAvatar: exportFBXAvatarAnimation,
} satisfies AvatarExportAdapter;
