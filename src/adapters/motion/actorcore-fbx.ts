import type { MotionImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";
import { importFBXHumanoidMotion } from "@/import/fbx-motion";
import { ACTORCORE_PROFILE } from "@/profiles";

export const actorcoreFbxMotionAdapter = {
  id: "actorcore-fbx",
  label: "ActorCore / Reallusion FBX Motion",
  profileId: "actorcore",
  maturity: "active",
  probe: (file) =>
    probeImportAdapter(file, {
      container: "fbx",
      ecosystemMarkers: ["CC_Base_Hip", "CC_Base_L_Upperarm"],
      extensions: [".fbx"],
      profile: "actorcore",
      role: "motion",
    }),
  importMotion: (file) =>
    importFBXHumanoidMotion({
      file,
      kind: "actorcore-fbx",
      profile: ACTORCORE_PROFILE,
    }),
} satisfies MotionImportAdapter;
