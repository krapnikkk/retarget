import { WebIO, type Document, type Node } from "@gltf-transform/core";
import {
  VRMCVRM,
  VRMC_VRM_EXTENSIONS,
  assertVRMDocument,
  writeVRM,
} from "gltf-transform-vrm-extensions";
import type { AvatarFormatId } from "@/formats";
import { readAvatarAsGLBDocument } from "@/export/avatar-conversion";
import { addClipAnimation } from "@/export/gltf-animation";
import { bindCanonicalClipToGLTFTarget } from "@/export/gltf-target-binding";
import {
  HUMANOID_BONES,
  isHumanoidBoneName,
  type HumanoidBoneName,
  type TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import { normalizeBoneAlias } from "@/import/humanoid-motion";
import { HUMANOID_RIG_PROFILES } from "@/profiles";
import { getAvatarEagerInputLimit } from "@/jobs/asset-memory-policy";
import { readFileArrayBufferWithSignal } from "@/browser/read-file";

export type AvatarExportInput = {
  clip: TargetBoundSolvedHumanoidMotionClip;
  avatarFile?: File | null;
  avatarFormatId?: AvatarFormatId | null;
};

export async function exportAnimatedGLB({
  avatarFile,
  avatarFormatId,
  clip,
}: AvatarExportInput): Promise<Uint8Array> {
  if (!avatarFile) {
    throw new Error("Animated GLB export requires an avatar file.");
  }

  const io = createVRMWebIO();
  const document = await readAvatarAsGLBDocument({
    avatarFile,
    avatarFormatId,
    io,
  });

  const buffer =
    document.getRoot().listBuffers()[0] ?? document.createBuffer("animation-buffer");
  const nodesByBone = collectHumanoidNodes(document);
  addClipAnimation(
    document,
    buffer,
    nodesByBone,
    bindCanonicalClipToGLTFTarget(clip, nodesByBone),
  );
  return io.writeBinary(document);
}

export async function exportBakedVRM(
  { avatarFile, clip }: AvatarExportInput,
): Promise<Uint8Array> {
  if (!avatarFile) {
    throw new Error("VRM 1.0 embedded-animation export requires a VRM avatar file.");
  }

  const io = createVRMWebIO();
  const document = await io.readBinary(
    new Uint8Array(
      await readFileArrayBufferWithSignal(
        avatarFile,
        getAvatarEagerInputLimit(avatarFile),
        "avatar",
      ),
    ),
  );
  assertVRMDocument(document);

  const buffer =
    document.getRoot().listBuffers()[0] ?? document.createBuffer("animation-buffer");
  const nodesByBone = collectHumanoidNodes(document);
  addClipAnimation(
    document,
    buffer,
    nodesByBone,
    bindCanonicalClipToGLTFTarget(clip, nodesByBone),
  );
  return writeVRM(io, document);
}

export function collectHumanoidNodes(document: Document) {
  const nodesByBone = new Map<HumanoidBoneName, Node>();
  const vrmExtension = document
    .getRoot()
    .listExtensionsUsed()
    .find((extension): extension is VRMCVRM =>
      extension.extensionName === VRMCVRM.EXTENSION_NAME,
    );
  if (vrmExtension) {
    for (const [bone, node] of vrmExtension.getHumanoidBoneNodes()) {
      if (isHumanoidBoneName(bone) && !nodesByBone.has(bone)) {
        nodesByBone.set(bone, node);
      }
    }
  }

  const aliases = new Map<string, HumanoidBoneName>();
  for (const bone of HUMANOID_BONES) {
    aliases.set(normalizeBoneAlias(bone), bone);
  }
  for (const profile of HUMANOID_RIG_PROFILES) {
    for (const bone of profile.bones) {
      for (const alias of bone.aliases) {
        aliases.set(normalizeBoneAlias(alias), bone.humanoid);
      }
    }
  }

  for (const node of document.getRoot().listNodes()) {
    const bone = aliases.get(normalizeBoneAlias(node.getName()));
    if (bone && !nodesByBone.has(bone)) {
      nodesByBone.set(bone, node);
    }
  }

  return nodesByBone;
}

function createVRMWebIO() {
  return new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
}
