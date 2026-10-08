import { readFile } from "node:fs/promises";
import path from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";

// Deterministic avatar variants derived at test time from the committed CC0
// Studio Mannequin VRM 1.0 (see tests/fixtures/certification/golden-motion).
// No derived binary is committed; provenance is the source fixture.
export const STUDIO_MANNEQUIN_VRM =
  "tests/fixtures/certification/golden-motion/characters/studio-mannequin-male/studio-mannequin-male.vrm";

type GLTFJson = {
  nodes: GLTFNode[];
  accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }>;
  bufferViews: Array<{ byteOffset?: number; byteStride?: number }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
  skins: Array<{ joints: number[]; inverseBindMatrices: number }>;
  extensions: Record<string, unknown>;
  extensionsUsed?: string[];
};
type GLTFNode = {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
};
type GLB = { json: GLTFJson; bin: Uint8Array };

export async function readStudioMannequinVRM() {
  return Uint8Array.from(await readFile(path.join(process.cwd(), STUDIO_MANNEQUIN_VRM)));
}

/**
 * VRM 0.x variant. VRM 0.x avatars face -Z while VRM 1.0 faces +Z, so a 180°
 * rotation about Y is baked consistently into every node TRS, inverse bind
 * matrix, and vertex position/normal; the humanoid moves to the 0.x `VRM`
 * extension (thumb bones use 0.x names).
 */
export function deriveVRM0(bytes: Uint8Array) {
  const glb = parseGLB(bytes);
  const { json } = glb;
  const flip = new Matrix4().makeRotationY(Math.PI);
  for (const node of json.nodes) {
    if (node.translation) {
      const [x = 0, y = 0, z = 0] = node.translation;
      node.translation = [-x, y, -z];
    }
    if (node.rotation) {
      const [x = 0, y = 0, z = 0, w = 1] = node.rotation;
      node.rotation = [-x, y, -z, w];
    }
  }
  for (const accessor of new Set(
    json.meshes.flatMap((mesh) =>
      mesh.primitives.flatMap((primitive) =>
        [primitive.attributes.POSITION, primitive.attributes.NORMAL].filter(
          (index): index is number => index !== undefined,
        ),
      ),
    ),
  )) {
    mapVec3(glb, accessor, (value) => value.set(-value.x, value.y, -value.z));
  }
  const inverse = flip.clone().invert();
  mapMat4(glb, json.skins[0]!.inverseBindMatrices, (matrix) =>
    matrix.premultiply(flip).multiply(inverse),
  );

  const vrm1 = json.extensions.VRMC_vrm as {
    humanoid: { humanBones: Record<string, { node: number }> };
  };
  delete json.extensions.VRMC_vrm;
  json.extensions.VRM = {
    exporterVersion: "3dretarget-test-fixture",
    specVersion: "0.0",
    meta: {
      title: "Studio Mannequin (VRM 0.x test variant)",
      version: "1",
      author: "3dretarget tests",
      licenseName: "CC0",
      allowedUserName: "Everyone",
      commercialUssageName: "Allow",
    },
    humanoid: {
      humanBones: Object.entries(vrm1.humanoid.humanBones).map(([bone, { node }]) => ({
        bone: VRM1_TO_VRM0_BONES[bone] ?? bone,
        node,
        useDefaultValues: true,
      })),
    },
  };
  json.extensionsUsed = [
    ...(json.extensionsUsed ?? []).filter((name) => name !== "VRMC_vrm"),
    "VRM",
  ];
  return writeGLB(glb);
}

/**
 * Short-legged VRM 1.0 variant: lower legs and feet scaled by `legScale`, hips
 * lowered so the feet stay at their original height, and inverse bind matrices
 * recomputed from the new rest pose. The mesh is not refit; the variant tests
 * skeleton proportions only.
 */
export function deriveShortLegs(bytes: Uint8Array, legScale = 0.6) {
  const glb = parseGLB(bytes);
  const { json } = glb;
  const bones = (json.extensions.VRMC_vrm as {
    humanoid: { humanBones: Record<string, { node: number }> };
  }).humanoid.humanBones;
  const nodeOf = (bone: string) => bones[bone]!.node;
  const footBefore = worldMatrices(json)[nodeOf("leftFoot")]!;
  for (const bone of ["leftLowerLeg", "leftFoot", "rightLowerLeg", "rightFoot"]) {
    const node = json.nodes[nodeOf(bone)]!;
    node.translation = (node.translation ?? [0, 0, 0]).map((value) => value * legScale);
  }
  const footAfter = worldMatrices(json)[nodeOf("leftFoot")]!;
  const lift =
    new Vector3().setFromMatrixPosition(footAfter).y -
    new Vector3().setFromMatrixPosition(footBefore).y;
  const hips = json.nodes[nodeOf("hips")]!;
  const parentWorld = worldMatrices(json)[parentOf(json, nodeOf("hips"))] ?? new Matrix4();
  const parentRotation = new Quaternion().setFromRotationMatrix(parentWorld);
  const localDrop = new Vector3(0, -lift, 0).applyQuaternion(parentRotation.invert());
  const [x = 0, y = 0, z = 0] = hips.translation ?? [];
  hips.translation = [x + localDrop.x, y + localDrop.y, z + localDrop.z];

  const worlds = worldMatrices(json);
  const skin = json.skins[0]!;
  let joint = 0;
  mapMat4(glb, skin.inverseBindMatrices, (matrix) =>
    matrix.copy(worlds[skin.joints[joint++]!]!).invert(),
  );
  return writeGLB(glb);
}

export function readRestHipsHeight(bytes: Uint8Array) {
  const { json } = parseGLB(bytes);
  const vrm1 = json.extensions.VRMC_vrm as
    | { humanoid: { humanBones: Record<string, { node: number }> } }
    | undefined;
  const hips = vrm1?.humanoid.humanBones.hips?.node;
  if (hips === undefined) throw new Error("VRM 1.0 hips bone is required.");
  return new Vector3().setFromMatrixPosition(worldMatrices(json)[hips]!).y;
}

/** Horizontal facing derived from geometry (left foot -> toes), not metadata. */
export function readAvatarForward(bytes: Uint8Array) {
  const { json } = parseGLB(bytes);
  const worlds = worldMatrices(json);
  const position = (bone: string) =>
    new Vector3().setFromMatrixPosition(worlds[humanoidNode(json, bone)]!);
  const forward = position("leftToes").sub(position("leftFoot"));
  return forward.setY(0).normalize();
}

/** World-space horizontal hips travel from the first to the last key. */
export function readHipsWorldTravel(bytes: Uint8Array) {
  const glb = parseGLB(bytes);
  const { json } = glb;
  const hips = humanoidNode(json, "hips");
  const animation = (json as unknown as {
    animations: Array<{
      channels: Array<{ sampler: number; target: { node: number; path: string } }>;
      samplers: Array<{ output: number }>;
    }>;
  }).animations[0]!;
  const channel = animation.channels.find(
    ({ target }) => target.node === hips && target.path === "translation",
  );
  if (!channel) throw new Error("Hips translation channel is required.");
  const view = floatView(glb, animation.samplers[channel.sampler]!.output, 3);
  const parentWorld = worldMatrices(json)[parentOf(json, hips)] ?? new Matrix4();
  const at = (item: number) =>
    new Vector3(view.read(item, 0), view.read(item, 1), view.read(item, 2)).applyMatrix4(
      parentWorld,
    );
  return at(view.count - 1).sub(at(0)).setY(0);
}

function humanoidNode(json: GLTFJson, bone: string) {
  const vrm1 = json.extensions.VRMC_vrm as
    | { humanoid: { humanBones: Record<string, { node: number }> } }
    | undefined;
  const vrm0 = json.extensions.VRM as
    | { humanoid: { humanBones: Array<{ bone: string; node: number }> } }
    | undefined;
  const node =
    vrm1?.humanoid.humanBones[bone]?.node ??
    vrm0?.humanoid.humanBones.find((entry) => entry.bone === bone)?.node;
  if (node === undefined) throw new Error(`Humanoid bone ${bone} is required.`);
  return node;
}

const VRM1_TO_VRM0_BONES: Record<string, string> = {
  leftThumbMetacarpal: "leftThumbProximal",
  leftThumbProximal: "leftThumbIntermediate",
  rightThumbMetacarpal: "rightThumbProximal",
  rightThumbProximal: "rightThumbIntermediate",
};

function worldMatrices(json: GLTFJson) {
  const worlds: Matrix4[] = [];
  const visit = (index: number, parent: Matrix4) => {
    const node = json.nodes[index]!;
    const local = new Matrix4().compose(
      new Vector3(...(node.translation ?? [0, 0, 0])),
      new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
      new Vector3(1, 1, 1),
    );
    worlds[index] = parent.clone().multiply(local);
    for (const child of node.children ?? []) visit(child, worlds[index]!);
  };
  const children = new Set(json.nodes.flatMap((node) => node.children ?? []));
  json.nodes.forEach((_, index) => {
    if (!children.has(index)) visit(index, new Matrix4());
  });
  return worlds;
}

function parentOf(json: GLTFJson, child: number) {
  return json.nodes.findIndex((node) => node.children?.includes(child));
}

function floatView(glb: GLB, accessorIndex: number, components: number) {
  const accessor = glb.json.accessors[accessorIndex]!;
  if (accessor.componentType !== 5126) throw new Error("Float accessor required.");
  const view = glb.json.bufferViews[accessor.bufferView]!;
  const stride = view.byteStride ?? components * 4;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(glb.bin.buffer, glb.bin.byteOffset, glb.bin.byteLength);
  return {
    count: accessor.count,
    read: (item: number, component: number) =>
      data.getFloat32(base + item * stride + component * 4, true),
    write: (item: number, component: number, value: number) =>
      data.setFloat32(base + item * stride + component * 4, value, true),
  };
}

function mapVec3(glb: GLB, accessor: number, map: (value: Vector3) => void) {
  const view = floatView(glb, accessor, 3);
  const value = new Vector3();
  for (let item = 0; item < view.count; item += 1) {
    value.set(view.read(item, 0), view.read(item, 1), view.read(item, 2));
    map(value);
    view.write(item, 0, value.x);
    view.write(item, 1, value.y);
    view.write(item, 2, value.z);
  }
}

function mapMat4(glb: GLB, accessor: number, map: (value: Matrix4) => void) {
  const view = floatView(glb, accessor, 16);
  const value = new Matrix4();
  for (let item = 0; item < view.count; item += 1) {
    value.fromArray(Array.from({ length: 16 }, (_, component) => view.read(item, component)));
    map(value);
    value.elements.forEach((element, component) => view.write(item, component, element));
  }
}

function parseGLB(bytes: Uint8Array): GLB {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binOffset = 20 + jsonLength;
  const binLength = view.getUint32(binOffset, true);
  return { json, bin: bytes.slice(binOffset + 8, binOffset + 8 + binLength) };
}

function writeGLB({ json, bin }: GLB) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.byteLength / 4) * 4;
  const binLength = Math.ceil(bin.byteLength / 4) * 4;
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(encoded, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  output.set(bin, 28 + jsonLength);
  return output;
}
