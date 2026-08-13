import { WebIO } from "@gltf-transform/core";
import { VRMC_VRM_EXTENSIONS } from "gltf-transform-vrm-extensions";
import type { AvatarExportInput } from "@/adapters/types";
import { readAvatarAsGLBDocument } from "./avatar-conversion";
import { collectHumanoidNodes } from "./avatar-glb";
import { recommendBoneNamingProfileForAvatar } from "./bone-naming";
import { createFBXAvatarSceneBinary, exportFBXAnimation } from "./fbx";
import { bindCanonicalClipToGLTFTarget } from "./gltf-target-binding";

export async function exportFBXAvatarAnimation({
  avatarFile,
  avatarFormatId,
  clip,
}: AvatarExportInput) {
  // Without an avatar file the export falls back to a bare animated
  // skeleton using the ecosystem naming recommended for the avatar format.
  if (!avatarFile) {
    return exportFBXAnimation(clip, {
      boneNamingProfile: recommendBoneNamingProfileForAvatar(avatarFormatId),
    });
  }

  const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
  const document = await readAvatarAsGLBDocument({
    avatarFile,
    avatarFormatId,
    io,
  });
  const nodesByBone = collectHumanoidNodes(document);
  return createFBXAvatarSceneBinary(
    document,
    nodesByBone,
    bindCanonicalClipToGLTFTarget(clip, nodesByBone),
  );
}
