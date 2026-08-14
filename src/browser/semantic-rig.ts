import { Object3D, type Group } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createAssetResourceScope } from "@/import/asset-package";
import { readGLTFDocument } from "@/import/gltf-document";
import {
  assertAvatarFileWithinLimit,
  getAvatarEagerInputLimit,
  isRangeLoadableGLB,
} from "@/jobs/asset-memory-policy";
import { readFileArrayBufferWithSignal } from "@/browser/read-file";
import { loadStructuralGLBScene } from "@/browser/avatar-rig";
import { readGLTFStructuralDocument } from "@/import/gltf-structural-document";
import {
  inspectGLTFRig,
  normalizeRigNodeName,
  type RigDefinition,
  type RigInspectionOptions,
  type SemanticRigProfile,
} from "@/rigs";

export type LoadedSemanticRig = {
  filename: string;
  root: Group | Object3D;
  definition: RigDefinition;
  profile: SemanticRigProfile;
  signature: string;
  nodesByRole: Map<string, Object3D>;
};

type GltfLoader = {
  parse: (
    data: ArrayBuffer | string,
    path: string,
    onLoad: (gltf: GLTF) => void,
    onError?: (error: unknown) => void,
  ) => void;
};

export async function loadSemanticAvatarRig(
  file: File,
  options: RigInspectionOptions = {},
): Promise<LoadedSemanticRig> {
  assertAvatarFileWithinLimit(file);
  if (isRangeLoadableGLB(file)) {
    const [{ document }, scene] = await Promise.all([
      readGLTFStructuralDocument(file),
      loadStructuralGLBScene(file),
    ]);
    const inspection = inspectGLTFRig(document, options);
    if (inspection.missingRequiredRoles.length > 0) {
      scene.root.clear();
      throw new Error(
        `Missing required ${inspection.definition.id} roles: ${inspection.missingRequiredRoles.join(", ")}.`,
      );
    }
    try {
      return mapSemanticScene(file, inspection, scene.root);
    } catch (error) {
      scene.root.clear();
      throw error;
    }
  }
  const bytes = new Uint8Array(
    await readFileArrayBufferWithSignal(
      file,
      getAvatarEagerInputLimit(file),
      "avatar",
    ),
  );
  const document = await readGLTFDocument(bytes, file);
  const inspection = inspectGLTFRig(document, options);
  if (inspection.missingRequiredRoles.length > 0) {
    throw new Error(
      `Missing required ${inspection.definition.id} roles: ${inspection.missingRequiredRoles.join(", ")}.`,
    );
  }
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const resources = createAssetResourceScope(file);
  let gltf: GLTF;
  try {
    gltf = await parseGLTF(
      new GLTFLoader(resources.manager),
      file.name.toLowerCase().endsWith(".gltf")
        ? new TextDecoder().decode(bytes)
        : bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
    );
  } finally {
    resources.dispose();
  }
  try {
    return mapSemanticScene(file, inspection, gltf.scene);
  } catch (error) {
    const { disposeObject } = await import("@/resources/dispose-three");
    disposeObject(gltf.scene);
    throw error;
  }
}

function mapSemanticScene(
  file: File,
  inspection: ReturnType<typeof inspectGLTFRig>,
  root: Group | Object3D,
) {
  const objectsByName = new Map<string, Object3D[]>();
  root.traverse((object) => {
    const key = normalizeRigNodeName(object.name);
    objectsByName.set(key, [...(objectsByName.get(key) ?? []), object]);
  });
  const claimed = new Set<Object3D>();
  const nodesByRole = new Map<string, Object3D>();
  for (const transform of inspection.restPose) {
    const object = (
      objectsByName.get(normalizeRigNodeName(transform.nodeName)) ?? []
    ).find((candidate) => !claimed.has(candidate));
    if (object) {
      nodesByRole.set(transform.role, object);
      claimed.add(object);
    }
  }
  if (nodesByRole.size !== inspection.nodesByRole.size) {
    throw new Error(
      `Three.js scene mapped ${nodesByRole.size}/${inspection.nodesByRole.size} semantic rig roles.`,
    );
  }
  return {
    filename: file.name,
    root,
    definition: inspection.definition,
    profile: inspection.profile,
    signature: inspection.signature,
    nodesByRole,
  };
}

function parseGLTF(loader: GltfLoader, input: ArrayBuffer | string) {
  return new Promise<GLTF>((resolve, reject) => {
    loader.parse(input, "", resolve, reject);
  });
}
