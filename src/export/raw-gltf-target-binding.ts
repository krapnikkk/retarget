import { Matrix4, Quaternion, Vector3 } from "three";
import { assertValidParentGraph } from "@/core/parent-graph";
import { getRigProfile, type RigProfile, type RigProfileId } from "@/profiles";
import {
  assertHumanoidTargetIdentity,
  createHumanoidRigSignature,
  type HumanoidBoneName,
  type TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import {
  bindCanonicalTracksToTargetRest,
  type TargetBoneRestTransform,
} from "@/retarget/target-binding";

type RawGLTFNode = Record<string, unknown>;

export function bindCanonicalClipToRawGLTFTarget(
  clip: TargetBoundSolvedHumanoidMotionClip,
  nodes: readonly RawGLTFNode[],
  nodesByBone: ReadonlyMap<HumanoidBoneName, number>,
  profile: RigProfile | null = clip.target.profile
    ? getRigProfile(clip.target.profile as RigProfileId)
    : null,
) {
  const parents = collectParents(nodes);
  const worldMatrices = new Map<number, Matrix4>();
  const visiting = new Set<number>();
  const getWorldMatrix = (index: number): Matrix4 => {
    const cached = worldMatrices.get(index);
    if (cached) return cached;
    if (visiting.has(index)) {
      throw new Error("glTF node hierarchy contains a cycle.");
    }
    visiting.add(index);
    const local = readLocalMatrix(nodes[index]!, index);
    const parentIndex = parents.get(index);
    const world = parentIndex === undefined
      ? local
      : getWorldMatrix(parentIndex).clone().multiply(local);
    visiting.delete(index);
    worldMatrices.set(index, world);
    return world;
  };

  const bones = new Map<HumanoidBoneName, TargetBoneRestTransform>();
  for (const [bone, nodeIndex] of nodesByBone) {
    const parentIndex = parents.get(nodeIndex);
    const parentWorld = parentIndex === undefined
      ? new Matrix4()
      : getWorldMatrix(parentIndex);
    const world = getWorldMatrix(nodeIndex);
    const worldPosition = new Vector3();
    const worldQuaternion = new Quaternion();
    world.decompose(worldPosition, worldQuaternion, new Vector3());
    const parentWorldQuaternion = new Quaternion();
    parentWorld.decompose(new Vector3(), parentWorldQuaternion, new Vector3());
    bones.set(bone, {
      parentWorldMatrixInverse: parentWorld.clone().invert(),
      parentWorldQuaternionInverse: parentWorldQuaternion.invert(),
      worldPosition,
      worldQuaternion,
    });
  }

  assertHumanoidTargetIdentity(
    clip,
    createRawGLTFHumanoidRigSignature({
      nodesByBone,
      parents,
      profileId: profile?.id ?? "unknown",
      getWorldMatrix,
    }),
  );

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

function createRawGLTFHumanoidRigSignature({
  nodesByBone,
  parents,
  profileId,
  getWorldMatrix,
}: {
  nodesByBone: ReadonlyMap<HumanoidBoneName, number>;
  parents: ReadonlyMap<number, number>;
  profileId: string;
  getWorldMatrix: (index: number) => Matrix4;
}) {
  const boneByIndex = new Map(
    Array.from(nodesByBone, ([bone, index]) => [index, bone] as const),
  );
  return createHumanoidRigSignature(
    profileId,
    Array.from(nodesByBone, ([bone, index]) => {
      let parentIndex = parents.get(index);
      let parentBone: HumanoidBoneName | undefined;
      while (parentIndex !== undefined && !parentBone) {
        parentBone = boneByIndex.get(parentIndex);
        parentIndex = parents.get(parentIndex);
      }
      const position = new Vector3();
      const rotation = new Quaternion();
      getWorldMatrix(index).decompose(position, rotation, new Vector3());
      return {
        bone,
        parentBone,
        worldPosition: [position.x, position.y, position.z],
        worldQuaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
      };
    }),
  );
}

export function inspectRawGLTFHumanoidRigSignature(
  nodes: readonly RawGLTFNode[],
  nodesByBone: ReadonlyMap<HumanoidBoneName, number>,
  profileId: string,
) {
  const parents = collectParents(nodes);
  const worldMatrices = new Map<number, Matrix4>();
  const visiting = new Set<number>();
  const getWorldMatrix = (index: number): Matrix4 => {
    const cached = worldMatrices.get(index);
    if (cached) return cached;
    if (visiting.has(index)) throw new Error("glTF node hierarchy contains a cycle.");
    visiting.add(index);
    const parent = parents.get(index);
    const local = readLocalMatrix(nodes[index]!, index);
    const world = parent === undefined
      ? local
      : getWorldMatrix(parent).clone().multiply(local);
    visiting.delete(index);
    worldMatrices.set(index, world);
    return world;
  };
  return createRawGLTFHumanoidRigSignature({
    nodesByBone,
    parents,
    profileId,
    getWorldMatrix,
  });
}

function collectParents(nodes: readonly RawGLTFNode[]) {
  const parents = new Map<number, number>();
  for (const [parentIndex, node] of nodes.entries()) {
    if (node.children === undefined) continue;
    if (!Array.isArray(node.children)) {
      throw new Error(`glTF node ${parentIndex} children must be an array.`);
    }
    for (const child of node.children) {
      if (!Number.isInteger(child) || (child as number) < 0 || (child as number) >= nodes.length) {
        throw new Error(`glTF node ${parentIndex} has an invalid child index.`);
      }
      if (parents.has(child as number)) {
        throw new Error(`glTF node ${String(child)} has more than one parent.`);
      }
      parents.set(child as number, parentIndex);
    }
  }
  assertValidParentGraph({
    nodeIds: nodes.keys(),
    edges: Array.from(parents, ([childId, parentId]) => ({ childId, parentId })),
    label: "glTF node hierarchy",
  });
  return parents;
}

function readLocalMatrix(node: RawGLTFNode, index: number) {
  if (node.matrix !== undefined) {
    return new Matrix4().fromArray(readTuple(node.matrix, 16, `node ${index} matrix`));
  }
  const translation = readTuple(node.translation ?? [0, 0, 0], 3, `node ${index} translation`);
  const rotation = readTuple(node.rotation ?? [0, 0, 0, 1], 4, `node ${index} rotation`);
  const scale = readTuple(node.scale ?? [1, 1, 1], 3, `node ${index} scale`);
  return new Matrix4().compose(
    new Vector3(...translation),
    new Quaternion(...rotation).normalize(),
    new Vector3(...scale),
  );
}

function readTuple(value: unknown, size: 3, label: string): [number, number, number];
function readTuple(value: unknown, size: 4, label: string): [number, number, number, number];
function readTuple(value: unknown, size: 16, label: string): number[];
function readTuple(value: unknown, size: number, label: string) {
  if (
    !Array.isArray(value) ||
    value.length !== size ||
    value.some((component) => typeof component !== "number" || !Number.isFinite(component))
  ) {
    throw new Error(`glTF ${label} is invalid.`);
  }
  return value as number[];
}
