import type { Node } from "@gltf-transform/core";
import { collectParentChain } from "@/core/parent-graph";
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
      const parentBone = collectParentChain(
        node.getParentNode(),
        (parent) => parent.getParentNode(),
        { label: "glTF semantic rest-pose parent chain" },
      )
        .map((parent) => boneByNode.get(parent))
        .find((candidate): candidate is HumanoidBoneName => Boolean(candidate));
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
