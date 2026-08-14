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
      return mapSemanticScene(
        file,
        inspection,
        scene.root,
        new Map(scene.nodes.map((object, index) => [index, object])),
      );
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
    return mapSemanticScene(
      file,
      inspection,
      gltf.scene,
      collectGLTFObjectsByNodeIndex(gltf),
    );
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
  objectsByNodeIndex: ReadonlyMap<number, Object3D>,
) {
  const nodesByRole = new Map<string, Object3D>();
  for (const transform of inspection.restPose) {
    const object = transform.nodeIdentity
      ? objectsByNodeIndex.get(transform.nodeIdentity.nodeIndex)
      : undefined;
    if (object) {
      nodesByRole.set(transform.role, object);
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

function collectGLTFObjectsByNodeIndex(gltf: GLTF) {
  const result = new Map<number, Object3D>();
  for (const [object, reference] of gltf.parser.associations) {
    if (object instanceof Object3D && reference.nodes !== undefined) {
      result.set(reference.nodes, object);
    }
  }
  return result;
}

function parseGLTF(loader: GltfLoader, input: ArrayBuffer | string) {
  return new Promise<GLTF>((resolve, reject) => {
    loader.parse(input, "", resolve, reject);
  });
}
