import { WebIO, type Document, type Node } from "@gltf-transform/core";
import {
  VRMC,
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
  vrm0HumanoidBoneName,
  type HumanoidBoneName,
  type TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import { normalizeBoneAlias } from "@/import/humanoid-motion";
import { HUMANOID_RIG_PROFILES } from "@/profiles";
import { readFileArrayBufferWithSignal } from "@/browser/read-file";

export type AvatarExportInput = {
  clip: TargetBoundSolvedHumanoidMotionClip;
  avatarFile?: File | null;
  avatarFormatId?: AvatarFormatId | null;
  signal?: AbortSignal;
};

export async function exportAnimatedGLB({
  avatarFile,
  avatarFormatId,
  clip,
  signal,
}: AvatarExportInput): Promise<Uint8Array> {
  if (!avatarFile) {
    throw new Error("Animated GLB export requires an avatar file.");
  }

  const io = createVRMWebIO();
  const document = await readAvatarAsGLBDocument({
    avatarFile,
    avatarFormatId,
    io,
    signal,
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
  { avatarFile, clip, signal }: AvatarExportInput,
): Promise<Uint8Array> {
  if (!avatarFile) {
    throw new Error("VRM 1.0 embedded-animation export requires a VRM avatar file.");
  }

  const io = createVRMWebIO();
  const document = await io.readBinary(
    new Uint8Array(
      await readFileArrayBufferWithSignal(
        avatarFile,
        "avatar",
        signal,
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
  for (const [bone, node] of readVRM0HumanoidBoneNodes(document)) {
    if (!nodesByBone.has(bone)) nodesByBone.set(bone, node);
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

  const allNodes = document.getRoot().listNodes();
  const activeJoints = new Set(allNodes.flatMap((node) => node.getSkin()?.listJoints() ?? []));
  for (const node of [...allNodes.filter((node) => activeJoints.has(node)), ...allNodes]) {
    const bone = aliases.get(normalizeBoneAlias(node.getName()));
    if (bone && !nodesByBone.has(bone)) {
      nodesByBone.set(bone, node);
    }
  }

  return nodesByBone;
}

/**
 * The VRM 0.x `VRM` extension's humanoid bone table. The extension keeps the
 * raw JSON and writes its node indices back unchanged, which relies on the
 * reader keeping glTF node order; indices therefore resolve through
 * `listNodes()`. VRoid's `J_Bip_*` node names match no profile alias, so this
 * table is the only way to find their bones.
 */
function readVRM0HumanoidBoneNodes(document: Document) {
  const bones = new Map<HumanoidBoneName, Node>();
  const vrm0 = document
    .getRoot()
    .listExtensionsUsed()
    .find((extension): extension is VRMC => extension.extensionName === VRMC.EXTENSION_NAME);
  const humanBones = (vrm0?.data as { humanoid?: { humanBones?: unknown } } | undefined)
    ?.humanoid?.humanBones;
  if (!Array.isArray(humanBones)) return bones;
  const nodes = document.getRoot().listNodes();
  for (const definition of humanBones as Array<Record<string, unknown> | null>) {
    const name = definition?.bone;
    const bone = typeof name === "string" ? vrm0HumanoidBoneName(name) : undefined;
    const index = definition?.node;
    const node = Number.isInteger(index) ? nodes[index as number] : undefined;
    if (bone && node && !bones.has(bone)) bones.set(bone, node);
  }
  return bones;
}

function createVRMWebIO() {
  return new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
}
