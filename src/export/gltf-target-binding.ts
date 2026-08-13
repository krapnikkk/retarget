import { Matrix4, Quaternion, Vector3 } from "three";
import type { Node } from "@gltf-transform/core";
import { getRigProfile, type RigProfile, type RigProfileId } from "@/profiles";
import type { HumanoidBoneName, RetargetedMotionClip } from "@/retarget";
import {
  bindCanonicalTracksToTargetRest,
  type TargetBoneRestTransform,
} from "@/retarget/target-binding";

export function bindCanonicalClipToGLTFTarget(
  clip: RetargetedMotionClip,
  nodesByBone: ReadonlyMap<HumanoidBoneName, Node>,
  profile: RigProfile | null = clip.target.profile
    ? getRigProfile(clip.target.profile as RigProfileId)
    : null,
): RetargetedMotionClip {
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
