import { WebIO, type Document, type Node } from "@gltf-transform/core";
import { VRMC_VRM_EXTENSIONS } from "gltf-transform-vrm-extensions";
import {
  LoadingManager,
  Matrix4,
  Quaternion,
  Texture,
  Vector3,
  type Loader,
  type Object3D,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import {
  assertValidParentGraph,
  collectParentChain,
} from "@/core/parent-graph";
import type { AvatarFormatId } from "@/formats";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { convertMMDModelToGLBDocument } from "@/export/avatar-conversion";
import { createGLTFHumanoidRigSignature } from "@/export/gltf-target-binding";
import { inspectRawGLTFHumanoidRigSignature } from "@/export/raw-gltf-target-binding";
import { resolveProfileBoneName } from "@/import/humanoid-motion";
import { skinFirstNodeIndices } from "@/core/skin-node-order";
import { normalizeBoneAlias } from "@/import/humanoid-motion";
import { isTextGLTF, readGLTFDocument } from "@/import/gltf-document";
import { createTransferableAssetPackageResolver } from "@/import/asset-package";
import type { TransferableAssetPackage } from "@/import/asset-package";
import {
  getRigProfile,
  HUMANOID_RIG_PROFILES,
  type RigProfile,
  type RigProfileId,
} from "@/profiles";
import {
  REQUIRED_VRM_BONES,
  HUMANOID_BONES,
  createHumanoidRigSignature,
  readBindingRigRevision,
  createRetargetError,
  isHumanoidBoneName,
  type HumanoidBoneName,
  type RetargetSkeletonNode,
} from "@/retarget";
import type {
  SerializedGLTFResources,
  SerializedHumanoidAvatarRig,
} from "./types";

export async function inspectHumanoidAvatarBytes({
  assetPackage,
  bytes,
  filename,
  formatId,
  resources,
  structuralJSONBytes,
}: {
  assetPackage?: TransferableAssetPackage;
  bytes: ArrayBuffer;
  filename: string;
  formatId: AvatarFormatId;
  resources?: SerializedGLTFResources;
  structuralJSONBytes?: ArrayBuffer;
}): Promise<SerializedHumanoidAvatarRig> {
  const profile = getRigProfile(profileIdForFormat(formatId));
  if (!profile) throw createRetargetError("UNSUPPORTED_FORMAT", formatId);

  if (structuralJSONBytes) {
    let structuralJSON: Record<string, unknown>;
    try {
      structuralJSON = JSON.parse(
        new TextDecoder().decode(structuralJSONBytes),
      ) as Record<string, unknown>;
    } catch (cause) {
      throw createRetargetError("TARGET_RIG_INVALID", cause);
    }
    return inspectStructuralJSON(structuralJSON, formatId, filename, profile);
  }

  if (formatId === "mmd-model") {
    const document = convertMMDModelToGLBDocument(
      new Uint8Array(bytes),
      filename,
      createTransferableAssetPackageResolver(assetPackage),
    );
    return inspectDocument(document, formatId, filename, profile);
  }

  if (isGLTFFormat(formatId, filename)) {
    const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
    const document = await readGLTFDocument(
      new Uint8Array(bytes),
      undefined,
      restoreResources(resources) ?? collectPackageGLTFResources(bytes, assetPackage),
      io,
    );
    return inspectDocument(document, formatId, filename, profile);
  }

  return inspectObject(
    parseFBXRig(bytes),
    formatId,
    filename,
    profile,
  );
}

function inspectDocument(
  document: Document,
  format: AvatarFormatId,
  filename: string,
  profile: RigProfile,
): SerializedHumanoidAvatarRig {
  const nodesByBone = collectHumanoidNodes(document);
  if (nodesByBone.size === 0) {
    throw createRetargetError("VRM_MISSING_HUMANOID_BONE", filename);
  }
  const hipsHeight = nodesByBone.get("hips")?.getWorldTranslation()[1];
  return {
    format,
    filename,
    profile,
    bones: [...nodesByBone.keys()],
    skeleton: createNodeSkeleton(filename, nodesByBone),
    missingRequiredBones: REQUIRED_VRM_BONES.filter(
      (bone) => !nodesByBone.has(bone),
    ),
    restHipsHeight: hipsHeight && hipsHeight > 0 ? hipsHeight : undefined,
    rigSignature: createGLTFHumanoidRigSignature(nodesByBone, profile.id),
  };
}

function inspectObject(
  root: Object3D,
  format: AvatarFormatId,
  filename: string,
  profile: RigProfile,
): SerializedHumanoidAvatarRig {
  root.updateMatrixWorld(true);
  const bones = new Map<HumanoidBoneName, Object3D>();
  root.traverse((object) => {
    const bone = resolveProfileBoneName(profile, object.name);
    if (bone && !bones.has(bone)) bones.set(bone, object);
  });
  if (bones.size === 0) {
    throw createRetargetError("VRM_MISSING_HUMANOID_BONE", filename);
  }
  const hipsHeight = bones.get("hips")?.getWorldPosition(new Vector3()).y;
  return {
    format,
    filename,
    profile,
    bones: [...bones.keys()],
    skeleton: createObjectSkeleton(filename, bones),
    missingRequiredBones: REQUIRED_VRM_BONES.filter((bone) => !bones.has(bone)),
    restHipsHeight: hipsHeight && hipsHeight > 0 ? hipsHeight : undefined,
    rigSignature: createObjectRigSignature(profile.id, bones),
  };
}

function inspectStructuralJSON(
  json: Record<string, unknown>,
  format: AvatarFormatId,
  filename: string,
  profile: RigProfile,
): SerializedHumanoidAvatarRig {
  try {
    const nodes = readRawNodes(json.nodes);
    const nodesByBone = collectRawHumanoidNodeIndices(json, nodes);
    if (nodesByBone.size === 0) {
      throw createRetargetError("VRM_MISSING_HUMANOID_BONE", filename);
    }
    const parents = collectRawParents(nodes);
    const boneByIndex = new Map(
      Array.from(nodesByBone, ([bone, index]) => [index, bone] as const),
    );
    const entries = new Map<HumanoidBoneName, RetargetSkeletonNode>(
      Array.from(nodesByBone, ([bone, index]) => [
        bone,
        {
          name: typeof nodes[index]?.name === "string" ? nodes[index]!.name as string : bone,
          bone,
          children: [],
        },
      ]),
    );
    const roots: RetargetSkeletonNode[] = [];
    for (const [bone, index] of nodesByBone) {
      let parentIndex = parents.get(index);
      let parentBone: HumanoidBoneName | undefined;
      while (parentIndex !== undefined && !parentBone) {
        parentBone = boneByIndex.get(parentIndex);
        parentIndex = parents.get(parentIndex);
      }
      const entry = entries.get(bone)!;
      if (parentBone) entries.get(parentBone)?.children.push(entry);
      else roots.push(entry);
    }
    const hipsIndex = nodesByBone.get("hips");
    const hipsHeight = hipsIndex === undefined
      ? undefined
      : getRawWorldMatrix(nodes, parents, hipsIndex).elements[13];
    return {
      format,
      filename,
      profile,
      bones: [...nodesByBone.keys()],
      skeleton: { name: filename, children: roots },
      missingRequiredBones: REQUIRED_VRM_BONES.filter(
        (bone) => !nodesByBone.has(bone),
      ),
      restHipsHeight: hipsHeight && hipsHeight > 0 ? hipsHeight : undefined,
      rigSignature: inspectRawGLTFHumanoidRigSignature(
        nodes,
        nodesByBone,
        profile.id,
      ),
    };
  } catch (cause) {
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause as { code?: unknown }).code === "VRM_MISSING_HUMANOID_BONE"
    ) {
      throw cause;
    }
    throw createRetargetError("TARGET_RIG_INVALID", cause);
  }
}

function readRawNodes(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new Error("glTF nodes must be an array.");
  }
  return value.map((node, index) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new Error(`glTF node ${index} must be an object.`);
    }
    return node as Record<string, unknown>;
  });
}

function collectRawHumanoidNodeIndices(
  json: Record<string, unknown>,
  nodes: readonly Record<string, unknown>[],
) {
  const result = new Map<HumanoidBoneName, number>();
  const extensions = asRecord(json.extensions);
  const vrm1HumanBones = asRecord(
    asRecord(asRecord(extensions?.VRMC_vrm)?.humanoid)?.humanBones,
  );
  if (vrm1HumanBones) {
    for (const [bone, value] of Object.entries(vrm1HumanBones)) {
      const index = asRecord(value)?.node;
      if (isHumanoidBoneName(bone) && isValidNodeIndex(index, nodes.length)) {
        result.set(bone, index);
      }
    }
  }

  const vrm0HumanBones = asRecord(asRecord(extensions?.VRM)?.humanoid)?.humanBones;
  if (Array.isArray(vrm0HumanBones)) {
    for (const value of vrm0HumanBones) {
      const entry = asRecord(value);
      const bone = entry?.bone;
      const index = entry?.node;
      if (
        typeof bone === "string" &&
        isHumanoidBoneName(bone) &&
        isValidNodeIndex(index, nodes.length) &&
        !result.has(bone)
      ) {
        result.set(bone, index);
      }
    }
  }

  const aliases = new Map<string, HumanoidBoneName>();
  for (const bone of HUMANOID_BONES) aliases.set(normalizeBoneAlias(bone), bone);
  for (const candidateProfile of HUMANOID_RIG_PROFILES) {
    for (const bone of candidateProfile.bones) {
      for (const alias of bone.aliases) {
        aliases.set(normalizeBoneAlias(alias), bone.humanoid);
      }
    }
  }
  for (const index of skinFirstNodeIndices(json, nodes)) {
    const node = nodes[index];
    if (typeof node.name !== "string") continue;
    const bone = aliases.get(normalizeBoneAlias(node.name));
    if (bone && !result.has(bone)) result.set(bone, index);
  }
  return result;
}

function collectRawParents(nodes: readonly Record<string, unknown>[]) {
  const parents = new Map<number, number>();
  for (const [parentIndex, node] of nodes.entries()) {
    if (node.children === undefined) continue;
    if (!Array.isArray(node.children)) {
      throw new Error(`glTF node ${parentIndex} children must be an array.`);
    }
    for (const child of node.children) {
      if (!isValidNodeIndex(child, nodes.length)) {
        throw new Error(`glTF node ${parentIndex} has an invalid child index.`);
      }
      if (parents.has(child)) {
        throw new Error(`glTF node ${child} has more than one parent.`);
      }
      parents.set(child, parentIndex);
    }
  }
  assertValidParentGraph({
    nodeIds: nodes.keys(),
    edges: Array.from(parents, ([childId, parentId]) => ({ childId, parentId })),
    label: "glTF node hierarchy",
  });
  return parents;
}

function getRawWorldMatrix(
  nodes: readonly Record<string, unknown>[],
  parents: ReadonlyMap<number, number>,
  targetIndex: number,
) {
  const cache = new Map<number, Matrix4>();
  const visiting = new Set<number>();
  const visit = (index: number): Matrix4 => {
    const cached = cache.get(index);
    if (cached) return cached;
    if (visiting.has(index)) throw new Error("glTF node hierarchy contains a cycle.");
    visiting.add(index);
    const local = readRawLocalMatrix(nodes[index]!, index);
    const parent = parents.get(index);
    const world = parent === undefined ? local : visit(parent).clone().multiply(local);
    visiting.delete(index);
    cache.set(index, world);
    return world;
  };
  return visit(targetIndex);
}

function readRawLocalMatrix(node: Record<string, unknown>, index: number) {
  if (node.matrix !== undefined) {
    return new Matrix4().fromArray(readRawTuple(node.matrix, 16, `node ${index} matrix`));
  }
  const translation = readRawTuple(
    node.translation ?? [0, 0, 0],
    3,
    `node ${index} translation`,
  );
  const rotation = readRawTuple(
    node.rotation ?? [0, 0, 0, 1],
    4,
    `node ${index} rotation`,
  );
  const scale = readRawTuple(node.scale ?? [1, 1, 1], 3, `node ${index} scale`);
  return new Matrix4().compose(
    new Vector3(translation[0], translation[1], translation[2]),
    new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]).normalize(),
    new Vector3(scale[0], scale[1], scale[2]),
  );
}

function readRawTuple(value: unknown, length: number, label: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some((component) => typeof component !== "number" || !Number.isFinite(component))
  ) {
    throw new Error(`glTF ${label} is invalid.`);
  }
  return value as number[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isValidNodeIndex(value: unknown, nodeCount: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < nodeCount;
}

function createNodeSkeleton(
  filename: string,
  bones: ReadonlyMap<HumanoidBoneName, Node>,
) {
  return createSemanticSkeleton(
    filename,
    bones,
    (node) => node.getName(),
    (node) => node.getParentNode(),
  );
}

function createObjectSkeleton(
  filename: string,
  bones: ReadonlyMap<HumanoidBoneName, Object3D>,
) {
  return createSemanticSkeleton(
    filename,
    bones,
    (object) => object.name,
    (object) => object.parent,
  );
}

function createSemanticSkeleton<T extends object>(
  filename: string,
  bones: ReadonlyMap<HumanoidBoneName, T>,
  getName: (node: T) => string,
  getParent: (node: T) => T | null,
): RetargetSkeletonNode {
  const boneByNode = new Map(Array.from(bones, ([bone, node]) => [node, bone]));
  const entries = new Map<HumanoidBoneName, RetargetSkeletonNode>(
    Array.from(bones, ([bone, node]) => [
      bone,
      { name: getName(node) || bone, bone, children: [] },
    ]),
  );
  const roots: RetargetSkeletonNode[] = [];
  for (const [bone, node] of bones) {
    const parentBone = collectParentChain(getParent(node), getParent, {
      label: `${filename} skeleton parent chain`,
    })
      .map((parent) => boneByNode.get(parent))
      .find((candidate): candidate is HumanoidBoneName => Boolean(candidate));
    const entry = entries.get(bone)!;
    if (parentBone) entries.get(parentBone)?.children.push(entry);
    else roots.push(entry);
  }
  return { name: filename, children: roots };
}

function createObjectRigSignature(
  profileId: string,
  bones: ReadonlyMap<HumanoidBoneName, Object3D>,
) {
  const boneByObject = new Map(
    Array.from(bones, ([bone, object]) => [object, bone] as const),
  );
  return createHumanoidRigSignature(
    profileId,
    Array.from(bones, ([bone, object]) => {
      const parentBone = collectParentChain(
        object.parent,
        (parent) => parent.parent,
        { label: `${profileId} object rig parent chain` },
      )
        .map((parent) => boneByObject.get(parent))
        .find((candidate): candidate is HumanoidBoneName => Boolean(candidate));
      const position = object.getWorldPosition(new Vector3());
      const rotation = object.getWorldQuaternion(new Quaternion());
      return {
        bone,
        parentBone,
        worldPosition: [position.x, position.y, position.z],
        worldQuaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
        bindingRevision: readBindingRigRevision(object.userData),
        worldScale: object.getWorldScale(new Vector3()).toArray(),
      };
    }),
  );
}

function parseFBXRig(bytes: ArrayBuffer) {
  const manager = new LoadingManager();
  manager.addHandler(/.*/, {
    load: () => new Texture(),
  } as unknown as Loader<Texture>);
  try {
    return new FBXLoader(manager).parse(bytes, "");
  } catch (cause) {
    throw createRetargetError("FBX_PARSE_FAILED", cause);
  }
}

function restoreResources(resources?: SerializedGLTFResources) {
  return resources
    ? Object.fromEntries(
        Object.entries(resources).map(([uri, value]) => [uri, new Uint8Array(value)]),
      )
    : undefined;
}

function collectPackageGLTFResources(
  bytes: ArrayBuffer,
  assetPackage?: TransferableAssetPackage,
) {
  const input = new Uint8Array(bytes);
  if (!assetPackage || !isTextGLTF(input)) return undefined;
  const json = JSON.parse(new TextDecoder().decode(input)) as Record<string, unknown>;
  const resolve = createTransferableAssetPackageResolver(assetPackage);
  const uris = [
    ...readResourceUris(json.buffers),
    ...readResourceUris(json.images),
  ];
  return Object.fromEntries(
    uris.flatMap((uri) => {
      const resource = resolve(uri);
      return resource ? [[uri, resource] as const] : [];
    }),
  );
}

function readResourceUris(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const uri = entry && typeof entry === "object"
          ? (entry as Record<string, unknown>).uri
          : undefined;
        return typeof uri === "string" && !uri.startsWith("data:") ? [uri] : [];
      })
    : [];
}

function isGLTFFormat(format: AvatarFormatId, filename: string) {
  return format === "vrm" || format === "gltf-humanoid" ||
    /\.(?:glb|gltf|vrm)$/i.test(filename);
}

function profileIdForFormat(format: AvatarFormatId): RigProfileId {
  if (format === "vrm") return "vrm-humanoid";
  if (format === "mixamo-rigged") return "mixamo";
  if (format === "ready-player-me") return "ready-player-me";
  if (format === "reallusion") return "actorcore";
  if (format === "mmd-model") return "mmd-body";
  if (format === "generic-fbx-avatar") return "generic-fbx-humanoid";
  return "generic-gltf-humanoid";
}
