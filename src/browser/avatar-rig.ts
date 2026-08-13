import {
  Box3,
  Bone,
  Group,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import type { MMD } from "@moeru/three-mmd";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { findAvatarImportAdapter } from "@/adapters/avatar";
import type { AvatarFormatId } from "@/formats";
import {
  getRigProfile,
  VRM_HUMANOID_PROFILE,
  type RigProfile,
} from "@/profiles";
import {
  HUMANOID_BONES,
  REQUIRED_VRM_BONES,
  createRetargetError,
  isHumanoidBoneName,
  type HumanoidBoneName,
  type RetargetSkeletonNode,
} from "@/retarget";
import { resolveProfileBoneName } from "@/import/humanoid-motion";
import {
  createAssetResourceScope,
  type AssetResourceScope,
} from "@/import/asset-package";
import { isRangeLoadableGLB } from "@/jobs/asset-memory-policy";
import { readGLTFRigMetadata } from "@/import/glb-range";
import type { TargetBoneRestTransform } from "@/retarget/target-binding";

export type LoadedAvatarRig = {
  format: AvatarFormatId;
  filename: string;
  profile: RigProfile;
  root: Object3D;
  bones: Map<HumanoidBoneName, Object3D>;
  restTransforms: Map<HumanoidBoneName, HumanoidBoneRestTransform>;
  skeleton: RetargetSkeletonNode;
  missingRequiredBones: HumanoidBoneName[];
  restHipsHeight?: number;
  vrm?: VRM;
  vrm0FacingCorrection?: boolean;
  structuralOnly?: boolean;
  nativeMMD?: MMD;
  resourceScope?: AssetResourceScope;
};

export type LoadCanonicalAvatarRigOptions = {
  nativeMMD?: boolean;
  physics?: boolean;
};

export type HumanoidBoneRestTransform = TargetBoneRestTransform;

type GltfLoader = {
  parse: (
    data: ArrayBuffer | string,
    path: string,
    onLoad: (gltf: GLTF) => void,
    onError?: (error: unknown) => void,
  ) => void;
};

export async function loadCanonicalAvatarRig(
  file: File,
  preferredFormat?: AvatarFormatId | null,
  options: LoadCanonicalAvatarRigOptions = {},
): Promise<LoadedAvatarRig> {
  const adapter = await findAvatarImportAdapter(
    file,
    preferredFormat ?? undefined,
  );
  if (!adapter) {
    throw createRetargetError("UNSUPPORTED_FORMAT", file.name);
  }

  const profile =
    (adapter.profileId ? getRigProfile(adapter.profileId) : null) ??
    VRM_HUMANOID_PROFILE;

  if (isRangeLoadableGLB(file)) {
    return loadStructuralGLBRig(file, adapter.id, profile);
  }

  if (adapter.id === "vrm") {
    return loadVRMRig(file, profile);
  }

  if (adapter.id === "mmd-model") {
    if (options.nativeMMD && /\.(?:pmx|pmd)$/i.test(file.name)) {
      return loadNativeMMDRig(file, profile, options.physics ?? true);
    }
    return loadMMDModelRig(file, profile);
  }

  if (file.name.toLowerCase().endsWith(".fbx")) {
    const {createMixamoFBXLoader} = await import("@/browser/fbx-loader");
    const resources = createAssetResourceScope(file);
    try {
      return loadObjectRig({
        file,
        format: adapter.id,
        profile,
        resourceScope: resources,
        root: createMixamoFBXLoader(resources.manager).parse(
          await file.arrayBuffer(),
          "",
        ),
      });
    } catch (cause) {
      resources.dispose();
      throw cause;
    }
  }

  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const resources = createAssetResourceScope(file);
  try {
    const gltf = await parseGLTF(
      new GLTFLoader(resources.manager),
      await readGLTFLoaderInput(file),
    );
    return loadObjectRig({
      file,
      format: adapter.id,
      profile,
      root: gltf.scene,
    });
  } finally {
    resources.dispose();
  }
}

async function loadNativeMMDRig(
  file: File,
  profile: RigProfile,
  physics: boolean,
) {
  const [{ MMDLoader }, physicsModule] = await Promise.all([
    import("@moeru/three-mmd"),
    physics
      ? import("@moeru/three-mmd-physics-ammo")
      : Promise.resolve(null),
  ]);
  const resources = createAssetResourceScope(file);
  const loader = new MMDLoader(resources.manager);
  if (physicsModule) {
    loader.register(physicsModule.MMDAmmoPlugin);
  }
  try {
    const mmd = await loader.loadAsync(file.name);
    return loadObjectRig({
      file,
      format: "mmd-model",
      profile,
      root: mmd.mesh,
      nativeMMD: mmd,
    });
  } catch (cause) {
    throw cause;
  } finally {
    resources.dispose();
  }
}

async function loadStructuralGLBRig(
  file: File,
  format: AvatarFormatId,
  profile: RigProfile,
): Promise<LoadedAvatarRig> {
  const { json, nodes, root } = await loadStructuralGLBScene(file);
  const bones = collectStructuralHumanoidBones(json, nodes, profile);
  if (bones.size === 0) {
    disposeStructuralRoot(root);
    throw createRetargetError("VRM_MISSING_HUMANOID_BONE", file.name);
  }
  return {
    format,
    filename: file.name,
    profile,
    root,
    bones,
    restTransforms: collectBoneRestTransforms(bones),
    skeleton: createSkeletonTree(root, bones),
    missingRequiredBones: REQUIRED_VRM_BONES.filter((bone) => !bones.has(bone)),
    restHipsHeight: estimateRestHipsHeight(bones),
    vrm0FacingCorrection: hasVRM0Extension(json),
    structuralOnly: true,
  };
}

export async function loadStructuralGLBScene(file: File) {
  const { json, nodes: nodesJSON } = await readGLTFRigMetadata(file);
  if (nodesJSON.length === 0) {
    throw createRetargetError("VRM_MISSING_HUMANOID_BONE", file.name);
  }
  const nodes = nodesJSON.map((node, index) => {
    const object = new Bone();
    object.name = typeof node.name === "string" ? node.name : `node-${index}`;
    applyGLTFNodeTransform(object, node);
    return object;
  });
  const childIndices = new Set<number>();
  for (const [index, node] of nodesJSON.entries()) {
    for (const childIndex of toIndexArray(node.children)) {
      const child = nodes[childIndex];
      if (child && child !== nodes[index]) {
        nodes[index]!.add(child);
        childIndices.add(childIndex);
      }
    }
  }
  const root = new Group();
  root.name = `${file.name} structural rig`;
  for (const [index, node] of nodes.entries()) {
    if (!childIndices.has(index)) root.add(node);
  }
  root.updateMatrixWorld(true);
  return { json, nodes, root };
}

function applyGLTFNodeTransform(object: Object3D, node: Record<string, unknown>) {
  if (isNumberArray(node.matrix, 16)) {
    const matrix = new Matrix4().fromArray(node.matrix);
    matrix.decompose(object.position, object.quaternion, object.scale);
    return;
  }
  if (isNumberArray(node.translation, 3)) object.position.fromArray(node.translation);
  if (isNumberArray(node.rotation, 4)) object.quaternion.fromArray(node.rotation);
  if (isNumberArray(node.scale, 3)) object.scale.fromArray(node.scale);
}

function collectStructuralHumanoidBones(
  json: Record<string, unknown>,
  nodes: readonly Object3D[],
  profile: RigProfile,
) {
  const bones = new Map<HumanoidBoneName, Object3D>();
  const extensions = json.extensions as Record<string, unknown> | undefined;
  const vrm1 = extensions?.VRMC_vrm as Record<string, unknown> | undefined;
  const vrm1Humanoid = vrm1?.humanoid as Record<string, unknown> | undefined;
  const vrm1Bones = vrm1Humanoid?.humanBones as
    | Record<string, { node?: unknown }>
    | undefined;
  for (const [bone, definition] of Object.entries(vrm1Bones ?? {})) {
    if (isHumanoidBoneName(bone) && Number.isInteger(definition?.node)) {
      const object = nodes[definition.node as number];
      if (object) bones.set(bone, object);
    }
  }
  const vrm0 = extensions?.VRM as Record<string, unknown> | undefined;
  const vrm0Humanoid = vrm0?.humanoid as Record<string, unknown> | undefined;
  const vrm0Bones = Array.isArray(vrm0Humanoid?.humanBones)
    ? vrm0Humanoid.humanBones as Array<Record<string, unknown>>
    : [];
  for (const definition of vrm0Bones) {
    const bone = definition.bone;
    const node = definition.node;
    if (typeof bone === "string" && isHumanoidBoneName(bone) && Number.isInteger(node)) {
      const object = nodes[node as number];
      if (object) bones.set(bone, object);
    }
  }
  if (bones.size === 0) {
    for (const object of nodes) {
      const bone = resolveProfileBoneName(profile, object.name);
      if (bone && !bones.has(bone)) bones.set(bone, object);
    }
  }
  return bones;
}

function hasVRM0Extension(json: Record<string, unknown>) {
  const extensions = json.extensions;
  return Boolean(extensions && typeof extensions === "object" && "VRM" in extensions);
}

function toIndexArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => Number.isInteger(item) && item >= 0)
    : [];
}

function isNumberArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function disposeStructuralRoot(root: Object3D) {
  root.clear();
}

async function loadMMDModelRig(
  file: File,
  profile: RigProfile,
): Promise<LoadedAvatarRig> {
  const { WebIO } = await import("@gltf-transform/core");
  const { readAvatarAsGLBDocument } = await import(
    "@/export/avatar-conversion"
  );
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const io = new WebIO();
  const document = await readAvatarAsGLBDocument({
    avatarFile: file,
    avatarFormatId: "mmd-model",
    io,
  });
  const bytes = await io.writeBinary(document);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await parseGLTF(new GLTFLoader(), arrayBuffer);
  return loadObjectRig({
    file,
    format: "mmd-model",
    profile,
    root: gltf.scene,
  });
}

async function loadVRMRig(
  file: File,
  profile: RigProfile,
): Promise<LoadedAvatarRig> {
  const {createVRMLoader} = await import("@/browser/vrm-loader");
  let gltf: GLTF;
  const resources = createAssetResourceScope(file);
  try {
    gltf = await parseGLTF(
      createVRMLoader(resources.manager),
      await file.arrayBuffer(),
    );
  } catch (cause) {
    throw createRetargetError("VRM_PARSE_FAILED", cause);
  } finally {
    resources.dispose();
  }

  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    throw createRetargetError("VRM_PARSE_FAILED");
  }

  const bones = new Map<HumanoidBoneName, Object3D>();
  for (const bone of HUMANOID_BONES) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName);
    if (node) {
      bones.set(bone, node);
    }
  }

  return {
    format: "vrm",
    filename: file.name,
    profile,
    root: vrm.scene,
    bones,
    restTransforms: collectBoneRestTransforms(bones),
    skeleton: createSkeletonTree(vrm.scene, bones),
    missingRequiredBones: REQUIRED_VRM_BONES.filter((bone) => !bones.has(bone)),
    restHipsHeight: estimateRestHipsHeight(bones),
    vrm,
    vrm0FacingCorrection: vrm.meta?.metaVersion === "0",
  };
}

function loadObjectRig({
  file,
  format,
  profile,
  root,
  nativeMMD,
  resourceScope,
}: {
  file: File;
  format: AvatarFormatId;
  profile: RigProfile;
  root: Group | Object3D;
  nativeMMD?: MMD;
  resourceScope?: AssetResourceScope;
}): LoadedAvatarRig {
  const bones = new Map<HumanoidBoneName, Object3D>();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const bone = resolveProfileBoneName(profile, object.name);
    if (bone && !bones.has(bone)) {
      bones.set(bone, object);
    }
  });

  if (bones.size === 0) {
    throw createRetargetError("VRM_MISSING_HUMANOID_BONE", file.name);
  }

  return {
    format,
    filename: file.name,
    profile,
    root,
    bones,
    restTransforms: collectBoneRestTransforms(bones),
    skeleton: createSkeletonTree(root, bones),
    missingRequiredBones: REQUIRED_VRM_BONES.filter((bone) => !bones.has(bone)),
    restHipsHeight: estimateRestHipsHeight(bones),
    nativeMMD,
    resourceScope,
  };
}

function collectBoneRestTransforms(
  bones: ReadonlyMap<HumanoidBoneName, Object3D>,
) {
  const transforms = new Map<HumanoidBoneName, HumanoidBoneRestTransform>();
  for (const [bone, object] of bones) {
    object.updateWorldMatrix(true, false);
    const parent = object.parent;
    parent?.updateWorldMatrix(true, false);
    transforms.set(bone, {
      parentWorldMatrixInverse: (
        parent?.matrixWorld.clone() ?? new Matrix4()
      ).invert(),
      parentWorldQuaternionInverse: parent
        ? parent.getWorldQuaternion(new Quaternion()).normalize().invert()
        : new Quaternion(),
      worldPosition: object.getWorldPosition(new Vector3()),
      worldQuaternion: object.getWorldQuaternion(new Quaternion()).normalize(),
    });
  }
  return transforms;
}

async function readGLTFLoaderInput(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  if (!file.name.toLowerCase().endsWith(".gltf")) {
    return arrayBuffer;
  }

  return new TextDecoder().decode(arrayBuffer);
}

function parseGLTF(
  loader: GltfLoader,
  input: ArrayBuffer | string,
): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.parse(input, "", resolve, reject);
  });
}

function createSkeletonTree(
  root: Object3D,
  bones: ReadonlyMap<HumanoidBoneName, Object3D>,
): RetargetSkeletonNode {
  const nodesByUuid = new Map<string, HumanoidBoneName>();
  for (const [bone, object] of bones) {
    nodesByUuid.set(object.uuid, bone);
  }

  return createSkeletonNode(root, nodesByUuid);
}

function createSkeletonNode(
  object: Object3D,
  nodesByUuid: ReadonlyMap<string, HumanoidBoneName>,
): RetargetSkeletonNode {
  return {
    name: object.name || object.type,
    bone: nodesByUuid.get(object.uuid),
    children: object.children.map((child) => createSkeletonNode(child, nodesByUuid)),
  };
}

function estimateRestHipsHeight(
  bones: ReadonlyMap<HumanoidBoneName, Object3D>,
) {
  const hips = bones.get("hips");
  if (!hips) {
    return undefined;
  }

  hips.updateWorldMatrix(true, false);
  return Number(new Vector3().setFromMatrixPosition(hips.matrixWorld).y.toFixed(6));
}

export function fitObjectToPreview(object: Object3D) {
  object.position.set(0, 0, 0);
  object.scale.setScalar(1);
  object.updateMatrixWorld(true);

  const initialBox = new Box3().setFromObject(object);
  if (initialBox.isEmpty()) {
    return 1;
  }

  const size = initialBox.getSize(new Vector3());
  if (size.y > 0) {
    const scale = Math.min(Math.max(1.65 / size.y, 0.15), 3);
    object.scale.setScalar(scale);
    object.updateMatrixWorld(true);
  }

  const fittedBox = new Box3().setFromObject(object);
  const center = fittedBox.getCenter(new Vector3());
  object.position.x -= center.x;
  object.position.y -= fittedBox.min.y;
  object.position.z -= center.z;
  object.updateMatrixWorld(true);
  return object.scale.x;
}
