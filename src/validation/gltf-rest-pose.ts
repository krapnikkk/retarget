import type { Node } from "@gltf-transform/core";
import type { HumanoidBoneName } from "@/retarget";
import type { HumanoidSemanticRestPose } from "./semantic-motion";

export function createGLTFHumanoidSemanticRestPose(
  nodesByBone: ReadonlyMap<HumanoidBoneName, Node>,
): HumanoidSemanticRestPose {
  const boneByNode = new Map(
    [...nodesByBone].map(([bone, node]) => [node, bone]),
  );
  return new Map(
    [...nodesByBone].map(([bone, node]) => {
      let parent = node.getParentNode();
      let parentBone: HumanoidBoneName | undefined;
      while (parent && !parentBone) {
        parentBone = boneByNode.get(parent);
        parent = parent.getParentNode();
      }
      return [
        bone,
        {
          parent: parentBone,
          worldPosition: tuple3(node.getWorldTranslation()),
          worldQuaternion: tuple4(node.getWorldRotation()),
          worldScale: tuple3(node.getWorldScale()),
        },
      ];
    }),
  );
}

function tuple3(value: readonly number[]): [number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function tuple4(value: readonly number[]): [number, number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
}
