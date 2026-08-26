import { Matrix4, Quaternion, Vector3 } from "three";
import type { Node } from "@gltf-transform/core";
import { collectParentChain } from "@/core/parent-graph";
import { getRigProfile, type RigProfile, type RigProfileId } from "@/profiles";
import {
  assertHumanoidTargetIdentity,
  createHumanoidRigSignature,
  readBindingRigRevision,
  type HumanoidBoneName,
  type TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import {
  bindCanonicalTracksToTargetRest,
  type TargetBoneRestTransform,
} from "@/retarget/target-binding";

export function bindCanonicalClipToGLTFTarget(
  clip: TargetBoundSolvedHumanoidMotionClip,
  nodesByBone: ReadonlyMap<HumanoidBoneName, Node>,
  profile: RigProfile | null = clip.target.profile
    ? getRigProfile(clip.target.profile as RigProfileId)
    : null,
): TargetBoundSolvedHumanoidMotionClip {
  assertHumanoidTargetIdentity(
    clip,
    createGLTFHumanoidRigSignature(nodesByBone, profile?.id ?? "unknown"),
  );
  const bones = new Map<HumanoidBoneName, TargetBoneRestTransform>();
  for (const [bone, node] of nodesByBone) {
    const parent = node.getParentNode();
    const parentWorld = new Matrix4().fromArray(
      Array.from(parent?.getWorldMatrix() ?? new Matrix4().elements),
    );
    bones.set(bone, {
      parentWorldMatrixInverse: parentWorld.clone().invert(),
      parentWorldQuaternionInverse: new Quaternion(
        ...(parent?.getWorldRotation() ?? [0, 0, 0, 1]),
      ).invert(),
      worldPosition: new Vector3(...node.getWorldTranslation()),
      worldQuaternion: new Quaternion(...node.getWorldRotation()),
    });
  }
  const hipsHeight = bones.get("hips")?.worldPosition.y;
  return {
    ...clip,
    tracks: bindCanonicalTracksToTargetRest(clip, {
      bones,
      profile: profile ?? undefined,
      restHipsHeight: hipsHeight && hipsHeight > 0 ? hipsHeight : undefined,
    }),
  };
}

export function createGLTFHumanoidRigSignature(
  nodesByBone: ReadonlyMap<HumanoidBoneName, Node>,
  profileId: string,
) {
  const boneByNode = new Map(
    Array.from(nodesByBone, ([bone, node]) => [node, bone] as const),
  );
  return createHumanoidRigSignature(
    profileId,
    Array.from(nodesByBone, ([bone, node]) => {
      const parentBone = collectParentChain(
        node.getParentNode(),
        (parent) => parent.getParentNode(),
        { label: `${profileId} glTF rig parent chain` },
      )
        .map((parent) => boneByNode.get(parent))
        .find((candidate): candidate is HumanoidBoneName => Boolean(candidate));
      return {
        bone,
        parentBone,
        worldPosition: node.getWorldTranslation(),
        worldQuaternion: node.getWorldRotation(),
        bindingRevision: readBindingRigRevision(node.getExtras()),
        worldScale: node.getWorldScale(),
      };
    }),
  );
}
