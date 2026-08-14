import { WebIO } from "@gltf-transform/core";
import { VRMC_VRM_EXTENSIONS } from "gltf-transform-vrm-extensions";
import type { AvatarExportInput } from "@/adapters/types";
import { readAvatarAsGLBDocument } from "./avatar-conversion";
import { collectHumanoidNodes } from "./avatar-glb";
import { createFBXAvatarSceneBinary } from "./fbx";
import { bindCanonicalClipToGLTFTarget } from "./gltf-target-binding";

export async function exportFBXAvatarAnimation({
  avatarFile,
  avatarFormatId,
  clip,
}: AvatarExportInput) {
  if (!avatarFile) {
    throw new Error("Animated FBX avatar export requires an avatar file.");
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
