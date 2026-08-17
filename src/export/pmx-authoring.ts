import type {
  Document,
  Material as GltfMaterial,
  Node as GltfNode,
  Primitive as GltfPrimitive,
  Texture as GltfTexture,
} from "@gltf-transform/core";
import { Matrix3, Matrix4, Vector3 } from "three";
import {
  assertValidParentGraph,
  collectParentChain,
} from "@/core/parent-graph";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { MMD_EXPORT_BONE_NAMES } from "@/export/bone-naming";
import { parsePMX } from "@/export/avatar-conversion";
import { createZipArchive, readZipArchive } from "@/archive/zip";
import { GrowableBuffer } from "@/parsers/binary-writer";
import type { PMXConfig } from "@/parsers/pmx-binary";
import { REQUIRED_VRM_BONES, type HumanoidBoneName } from "@/retarget";

const MMD_BONE_NAMES = MMD_EXPORT_BONE_NAMES as Partial<
  Record<HumanoidBoneName, string>
>;

export type PMXAuthoringMetadata = {
  name: string;
  author: string;
  license: string;
};

type PMXVertex = {
  position: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
  joints: [number, number, number, number];
  weights: [number, number, number, number];
};

type PMXMaterial = {
  name: string;
  diffuse: [number, number, number, number];
  ambient: [number, number, number];
  doubleSided: boolean;
  indexCount: number;
  textureIndex: number;
};

type PMXTextureEntry = {
  filename: string;
  bytes: Uint8Array;
};

type PMXBone = {
  bone: HumanoidBoneName;
  childIndices: number[];
  index: number;
  layer: number;
  name: string;
  parentIndex: number;
  position: [number, number, number];
};

type PMXModel = {
  bones: PMXBone[];
  indices: number[];
  materials: PMXMaterial[];
  textures: PMXTextureEntry[];
  vertices: PMXVertex[];
};

// Experimental by design: this writes a loadable mesh/skin/bone PMX, but omits
// the MMD workflow pieces users expect next: leg IK, physics, and morphs.
export async function authorCanonicalGLBAsPMX(
  document: Document,
  metadata: PMXAuthoringMetadata,
): Promise<Uint8Array> {
  return (await authorCanonicalGLBPMXPayload(document, metadata)).pmxBytes;
}

export async function authorCanonicalGLBAsPMXBundle(
  document: Document,
  metadata: PMXAuthoringMetadata,
): Promise<Uint8Array> {
  const payload = await authorCanonicalGLBPMXPayload(document, metadata);
  const bytes = createZipArchive([
    { name: "model.pmx", bytes: payload.pmxBytes },
    ...payload.textures.map((texture) => ({
      name: texture.filename,
      bytes: texture.bytes,
    })),
  ]);
  validateAuthoredPMXBundle(bytes, payload, metadata.name);
  return bytes;
}

async function authorCanonicalGLBPMXPayload(
  document: Document,
  metadata: PMXAuthoringMetadata,
) {
  const nodesByBone = collectHumanoidNodes(document);
  const missingBones = REQUIRED_VRM_BONES.filter(
    (bone) => !nodesByBone.has(bone) || !MMD_BONE_NAMES[bone],
  );
  if (missingBones.length > 0) {
    throw new Error(
      `Cannot author PMX: missing required MMD-mapped humanoid bones ${missingBones.join(", ")}.`,
    );
  }

  const model = collectPMXModel(document, nodesByBone);
  if (model.vertices.length === 0) {
    throw new Error("Cannot author PMX: source document does not contain mesh vertices.");
  }

  const writer = new PMXModelWriter(createPMXConfig(model));
  writer.writeHeader(metadata);
  writer.writeVertices(model.vertices);
  writer.writeFaces(model.indices);
  writer.writeTextures(model.textures);
  writer.writeMaterials(model.materials);
  writer.writeBones(model.bones);
  writer.writeMorphs();
  writer.writeDisplayFrames(model.bones);
  writer.writePhysics();
  const bytes = writer.toUint8Array();

  validateAuthoredPMX(bytes, model, metadata.name);
  return { pmxBytes: bytes, textures: model.textures };
}

function collectPMXModel(
  document: Document,
  nodesByBone: ReadonlyMap<HumanoidBoneName, GltfNode>,
): PMXModel {
  const boneContext = collectPMXBones(nodesByBone);
  const vertices: PMXVertex[] = [];
  const indices: number[] = [];
  const materials: PMXMaterial[] = [];
  const textureContext = createPMXTextureContext();

  for (const node of collectMeshNodes(document)) {
    const mesh = node.getMesh();
    if (!mesh) {
      continue;
    }

    const skin = node.getSkin();
    if (!skin) {
      throw new Error(`Cannot author PMX: mesh node ${node.getName() || "(unnamed)"} has no skin.`);
    }

    const world = new Matrix4().fromArray(Array.from(node.getWorldMatrix()));
    const normalMatrix = new Matrix3().getNormalMatrix(world);
    for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
      const startVertex = vertices.length;
      const primitiveVertices = collectPrimitiveVertices(
        primitive,
        skin.listJoints(),
        boneContext.resolveSkinJointIndex,
        world,
        normalMatrix,
      );
      vertices.push(...primitiveVertices);

      const primitiveIndices = collectPrimitiveIndices(primitive, primitiveVertices.length)
        .map((index) => index + startVertex);
      indices.push(...primitiveIndices);
      materials.push(
        collectMaterial(
          primitive.getMaterial(),
          `${mesh.getName() || node.getName() || "mesh"}-${primitiveIndex}`,
          primitiveIndices.length,
          textureContext,
        ),
      );
    }
  }

  return { bones: boneContext.bones, indices, materials, textures: textureContext.textures, vertices };
}

function collectPMXBones(nodesByBone: ReadonlyMap<HumanoidBoneName, GltfNode>) {
  const nodeToBone = new Map<GltfNode, HumanoidBoneName>();
  for (const [bone, node] of nodesByBone) {
    if (!nodeToBone.has(node)) {
      nodeToBone.set(node, bone);
    }
  }

  const bones = [...nodesByBone.entries()]
    .filter(([bone]) => Boolean(MMD_BONE_NAMES[bone]))
    .sort((left, right) => nodeDepth(left[1]) - nodeDepth(right[1]))
    .map(([bone, node], index): PMXBone => ({
      bone,
      childIndices: [],
      index,
      layer: nodeDepth(node),
      name: MMD_BONE_NAMES[bone]!,
      parentIndex: -1,
      position: toVector3(node.getWorldTranslation()),
    }));

  const indexByBone = new Map(bones.map((bone) => [bone.bone, bone.index]));

  const resolveSkinJointIndex = (joint: GltfNode) => {
    for (const node of collectParentChain(
      joint,
      (candidate) => candidate.getParentNode(),
      { label: "PMX skin joint parent chain" },
    )) {
      const bone = nodeToBone.get(node);
      if (!bone) {
        continue;
      }
      const index = indexByBone.get(bone);
      if (index !== undefined) {
        return index;
      }
    }
    return 0;
  };

  for (const item of bones) {
    const node = nodesByBone.get(item.bone);
    if (!node) {
      continue;
    }
    item.parentIndex = findNearestIncludedAncestorIndex(
      node.getParentNode(),
      nodeToBone,
      indexByBone,
    );
    if (item.parentIndex >= 0) {
      const parent = bones[item.parentIndex];
      if (!parent) {
        throw new Error(`Missing PMX parent bone ${item.parentIndex}.`);
      }
      parent.childIndices.push(item.index);
    }
  }

  assertValidParentGraph({
    nodeIds: bones.map((bone) => bone.index),
    edges: bones.flatMap((bone) =>
      bone.parentIndex >= 0
        ? [{ childId: bone.index, parentId: bone.parentIndex }]
        : []
    ),
    label: "Authored PMX bone hierarchy",
  });

  return { bones, resolveSkinJointIndex };
}

function findNearestIncludedAncestorIndex(
  node: GltfNode | null,
  nodeToBone: ReadonlyMap<GltfNode, HumanoidBoneName>,
  indexByBone: ReadonlyMap<HumanoidBoneName, number>,
) {
  for (const current of collectParentChain(
    node,
    (candidate) => candidate.getParentNode(),
    { label: "PMX included ancestor chain" },
  )) {
    const bone = nodeToBone.get(current);
    if (!bone) {
      continue;
    }
    const index = indexByBone.get(bone);
    if (index !== undefined) {
      return index;
    }
  }
  return -1;
}

function collectMeshNodes(document: Document) {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const nodes: GltfNode[] = [];
  scene?.traverse((node) => {
    if (node.getMesh()) {
      nodes.push(node);
    }
  });
  return nodes;
}

function collectPrimitiveVertices(
  primitive: GltfPrimitive,
  skinJoints: readonly GltfNode[],
  resolveSkinJointIndex: (joint: GltfNode) => number,
  world: Matrix4,
  normalMatrix: Matrix3,
) {
  const positions = primitive.getAttribute("POSITION");
  if (!positions) {
    throw new Error("Cannot author PMX: primitive is missing POSITION.");
  }
  const normals = primitive.getAttribute("NORMAL");
  const uvs = primitive.getAttribute("TEXCOORD_0");
  const joints = primitive.getAttribute("JOINTS_0");
  const weights = primitive.getAttribute("WEIGHTS_0");
  if (!joints || !weights) {
    throw new Error("Cannot author PMX: skinned primitive is missing JOINTS_0 or WEIGHTS_0.");
  }

  const vertices: PMXVertex[] = [];
  const position = [0, 0, 0];
  const normal = [0, 1, 0];
  const uv = [0, 0];
  const jointElement = [0, 0, 0, 0];
  const weightElement = [0, 0, 0, 0];

  for (let vertex = 0; vertex < positions.getCount(); vertex += 1) {
    positions.getElement(vertex, position);
    normals?.getElement(vertex, normal);
    uvs?.getElement(vertex, uv);
    joints.getElement(vertex, jointElement);
    weights.getElement(vertex, weightElement);

    const transformedPosition = new Vector3(position[0], position[1], position[2])
      .applyMatrix4(world);
    const transformedNormal = new Vector3(normal[0], normal[1], normal[2])
      .applyMatrix3(normalMatrix)
      .normalize();

    const pmxJoints: [number, number, number, number] = [0, 0, 0, 0];
    const pmxWeights: [number, number, number, number] = [0, 0, 0, 0];
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = weightElement[slot] ?? 0;
      pmxWeights[slot] = weight;
      if (weight > 0) {
        const joint = skinJoints[jointElement[slot] ?? -1];
        pmxJoints[slot] = joint ? resolveSkinJointIndex(joint) : 0;
      }
    }

    vertices.push({
      joints: pmxJoints,
      normal: [transformedNormal.x, transformedNormal.y, transformedNormal.z],
      position: [transformedPosition.x, transformedPosition.y, transformedPosition.z],
      uv: [uv[0] ?? 0, uv[1] ?? 0],
      weights: pmxWeights,
    });
  }

  return vertices;
}

function collectPrimitiveIndices(primitive: GltfPrimitive, vertexCount: number) {
  const raw = primitive.getIndices()?.getArray();
  const indices = raw
    ? Array.from(raw)
    : Array.from({ length: vertexCount }, (_, index) => index);
  if (indices.length % 3 !== 0) {
    throw new Error("Cannot author PMX: primitive indices are not triangles.");
  }
  return indices;
}

function collectMaterial(
  material: GltfMaterial | null,
  fallbackName: string,
  indexCount: number,
  textureContext: PMXTextureContext,
): PMXMaterial {
  const diffuse = toColor4(material?.getBaseColorFactor() ?? [0.8, 0.8, 0.8, 1]);
  return {
    ambient: [diffuse[0] * 0.35, diffuse[1] * 0.35, diffuse[2] * 0.35],
    diffuse,
    doubleSided: material?.getDoubleSided() ?? false,
    indexCount,
    name: material?.getName() || fallbackName,
    textureIndex: textureContext.indexTexture(
      material?.getBaseColorTexture() ?? null,
      material?.getName() || fallbackName,
    ),
  };
}

function createPMXConfig(model: PMXModel): PMXConfig {
  return {
    additionalUvCount: 0,
    boneIndexSize: signedIndexSize(model.bones.length),
    encoding: "utf-8",
    materialIndexSize: signedIndexSize(model.materials.length),
    morphIndexSize: 1,
    rigidBodyIndexSize: 1,
    textureIndexSize: signedIndexSize(model.textures.length),
    vertexIndexSize: unsignedIndexSize(model.vertices.length),
  };
}

function validateAuthoredPMX(bytes: Uint8Array, model: PMXModel, modelName: string) {
  const parsed = parsePMX(bytes);
  const vertexCount = parsed.positions.length / 3;
  if (vertexCount !== model.vertices.length) {
    throw new Error(
      `PMX reload validation failed for ${modelName}: expected ${model.vertices.length} vertices, parsed ${vertexCount}.`,
    );
  }
  if (parsed.bones.length !== model.bones.length) {
    throw new Error(
      `PMX reload validation failed for ${modelName}: expected ${model.bones.length} bones, parsed ${parsed.bones.length}.`,
    );
  }
  if (parsed.textures.length !== model.textures.length) {
    throw new Error(
      `PMX reload validation failed for ${modelName}: expected ${model.textures.length} textures, parsed ${parsed.textures.length}.`,
    );
  }
  for (const [index, material] of parsed.materials.entries()) {
    if (
      material.textureIndex < -1 ||
      material.textureIndex >= parsed.textures.length
    ) {
      throw new Error(
        `PMX reload validation failed for ${modelName}: material ${index} has invalid texture index ${material.textureIndex}.`,
      );
    }
  }

  const parsedBoneNames = new Set(parsed.bones.map((bone) => bone.name));
  const missingBones = REQUIRED_VRM_BONES
    .map((bone) => MMD_BONE_NAMES[bone])
    .filter(
      (name): name is string =>
        typeof name === "string" && !parsedBoneNames.has(name),
    );
  if (missingBones.length > 0) {
    throw new Error(
      `PMX reload validation failed for ${modelName}: missing required PMX bones ${missingBones.join(", ")}.`,
    );
  }
}

function validateAuthoredPMXBundle(
  bytes: Uint8Array,
  payload: { pmxBytes: Uint8Array; textures: readonly PMXTextureEntry[] },
  modelName: string,
) {
  const entries = readZipArchive(bytes);
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  const pmx = entryByName.get("model.pmx");
  if (!pmx) {
    throw new Error(`PMX bundle validation failed for ${modelName}: missing model.pmx.`);
  }
  const parsed = parsePMX(pmx.bytes);
  const textureByName = new Map(
    payload.textures.map((texture) => [texture.filename, texture]),
  );
  for (const filename of parsed.textures) {
    const zipEntry = entryByName.get(filename);
    const source = textureByName.get(filename);
    if (!zipEntry || !source) {
      throw new Error(
        `PMX bundle validation failed for ${modelName}: missing texture ${filename}.`,
      );
    }
    if (zipEntry.bytes.byteLength !== source.bytes.byteLength) {
      throw new Error(
        `PMX bundle validation failed for ${modelName}: texture ${filename} byte length drifted.`,
      );
    }
  }
}

class PMXModelWriter {
  private buf = new GrowableBuffer();
  private encoder = new TextEncoder();

  constructor(private config: PMXConfig) {}

  writeHeader(metadata: PMXAuthoringMetadata) {
    this.buf.writeAscii("PMX ");
    this.buf.writeFloat32(2);
    this.buf.writeUint8(8);
    this.buf.writeUint8(this.config.encoding === "utf-16le" ? 0 : 1);
    this.buf.writeUint8(this.config.additionalUvCount);
    this.buf.writeUint8(this.config.vertexIndexSize);
    this.buf.writeUint8(this.config.textureIndexSize);
    this.buf.writeUint8(this.config.materialIndexSize);
    this.buf.writeUint8(this.config.boneIndexSize);
    this.buf.writeUint8(this.config.morphIndexSize);
    this.buf.writeUint8(this.config.rigidBodyIndexSize);
    this.writeText(metadata.name);
    this.writeText(metadata.name);
    this.writeText(`Author: ${metadata.author}\nLicense: ${metadata.license}`);
    this.writeText(`Author: ${metadata.author}\nLicense: ${metadata.license}`);
  }

  writeVertices(vertices: readonly PMXVertex[]) {
    this.buf.writeInt32(vertices.length);
    for (const vertex of vertices) {
      vertex.position.forEach((value) => this.buf.writeFloat32(value));
      vertex.normal.forEach((value) => this.buf.writeFloat32(value));
      vertex.uv.forEach((value) => this.buf.writeFloat32(value));
      this.buf.writeUint8(2); // BDEF4
      vertex.joints.forEach((index) =>
        this.writeIndex(index, this.config.boneIndexSize),
      );
      vertex.weights.forEach((value) => this.buf.writeFloat32(value));
      this.buf.writeFloat32(1);
    }
  }

  writeFaces(indices: readonly number[]) {
    this.buf.writeInt32(indices.length);
    for (const index of indices) {
      this.writeUnsignedIndex(index, this.config.vertexIndexSize);
    }
  }

  writeTextures(textures: readonly PMXTextureEntry[]) {
    this.buf.writeInt32(textures.length);
    for (const texture of textures) {
      this.writeText(texture.filename);
    }
  }

  writeMaterials(materials: readonly PMXMaterial[]) {
    this.buf.writeInt32(materials.length);
    for (const material of materials) {
      this.writeText(material.name);
      this.writeText(material.name);
      material.diffuse.forEach((value) => this.buf.writeFloat32(value));
      [0.12, 0.12, 0.12].forEach((value) => this.buf.writeFloat32(value));
      this.buf.writeFloat32(8);
      material.ambient.forEach((value) => this.buf.writeFloat32(value));
      this.buf.writeUint8(material.doubleSided ? 0x01 : 0x00);
      [0, 0, 0, 1].forEach((value) => this.buf.writeFloat32(value));
      this.buf.writeFloat32(0);
      this.writeIndex(material.textureIndex, this.config.textureIndexSize);
      this.writeIndex(-1, this.config.textureIndexSize);
      this.buf.writeUint8(0);
      this.buf.writeUint8(0);
      this.writeIndex(-1, this.config.textureIndexSize);
      this.writeText("");
      this.buf.writeInt32(material.indexCount);
    }
  }

  writeBones(bones: readonly PMXBone[]) {
    this.buf.writeInt32(bones.length);
    for (const bone of bones) {
      const singleChild = bone.childIndices.length === 1
        ? bone.childIndices[0] ?? null
        : null;
      const flags = 0x0002 | 0x0008 | 0x0010 | (singleChild === null ? 0 : 0x0001);
      this.writeText(bone.name);
      this.writeText(bone.bone);
      bone.position.forEach((value) => this.buf.writeFloat32(value));
      this.writeIndex(bone.parentIndex, this.config.boneIndexSize);
      this.buf.writeInt32(bone.layer);
      this.buf.writeUint16(flags);
      if (singleChild === null) {
        tailOffset(bone.bone).forEach((value) => this.buf.writeFloat32(value));
      } else {
        this.writeIndex(singleChild, this.config.boneIndexSize);
      }
    }
  }

  writeMorphs() {
    this.buf.writeInt32(0);
  }

  writeDisplayFrames(bones: readonly PMXBone[]) {
    this.buf.writeInt32(2);
    this.writeText("Root");
    this.writeText("Root");
    this.buf.writeUint8(1);
    this.buf.writeInt32(bones.length > 0 ? 1 : 0);
    if (bones.length > 0) {
      this.buf.writeUint8(0);
      this.writeIndex(0, this.config.boneIndexSize);
    }

    this.writeText("Body");
    this.writeText("Body");
    this.buf.writeUint8(0);
    this.buf.writeInt32(bones.length);
    for (const bone of bones) {
      this.buf.writeUint8(0);
      this.writeIndex(bone.index, this.config.boneIndexSize);
    }
  }

  writePhysics() {
    this.buf.writeInt32(0);
    this.buf.writeInt32(0);
  }

  toUint8Array() {
    return this.buf.toUint8Array();
  }

  private writeText(value: string) {
    const encoded = this.config.encoding === "utf-16le"
      ? encodeUTF16LE(value)
      : this.encoder.encode(value);
    this.buf.writeInt32(encoded.length);
    this.buf.writeBytes(encoded);
  }

  private writeIndex(value: number, size: number) {
    if (size === 1) {
      this.buf.writeInt8(value);
    } else if (size === 2) {
      this.buf.writeInt16(value);
    } else {
      this.buf.writeInt32(value);
    }
  }

  private writeUnsignedIndex(value: number, size: number) {
    if (size === 1) {
      this.buf.writeUint8(value);
    } else if (size === 2) {
      this.buf.writeUint16(value);
    } else {
      this.buf.writeUint32(value);
    }
  }
}

function unsignedIndexSize(count: number) {
  if (count <= 0xff) return 1;
  if (count <= 0xffff) return 2;
  return 4;
}

function signedIndexSize(count: number) {
  if (count <= 0x80) return 1;
  if (count <= 0x8000) return 2;
  return 4;
}

type PMXTextureContext = ReturnType<typeof createPMXTextureContext>;

function createPMXTextureContext() {
  const indexByTexture = new Map<GltfTexture, number>();
  const usedFilenames = new Set<string>();
  const textures: PMXTextureEntry[] = [];

  const indexTexture = (texture: GltfTexture | null, materialName: string) => {
    const image = texture?.getImage();
    if (!texture) {
      return -1;
    }
    if (!image) {
      throw new Error(
        `Cannot author PMX: ${materialName} baseColorTexture has no embedded image bytes.`,
      );
    }

    const existing = indexByTexture.get(texture);
    if (existing !== undefined) {
      return existing;
    }

    const filename = uniqueTextureFilename(
      texture.getURI() || texture.getName() || materialName || "texture",
      texture,
      usedFilenames,
    );
    const index = textures.length;
    textures.push({ filename, bytes: image });
    indexByTexture.set(texture, index);
    return index;
  };

  return { indexTexture, textures };
}

function uniqueTextureFilename(
  sourceName: string,
  texture: GltfTexture,
  usedFilenames: Set<string>,
) {
  const base = sanitizePMXFilename(sourceName);
  const extension = textureExtension(texture);
  let filename = `${base}.${extension}`;
  for (let suffix = 2; usedFilenames.has(filename); suffix += 1) {
    filename = `${base}-${suffix}.${extension}`;
  }
  usedFilenames.add(filename);
  return filename;
}

function sanitizePMXFilename(value: string) {
  return value.replace(/\.[^.\\/]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "_") || "texture";
}

function textureExtension(texture: GltfTexture) {
  const uriExtension = texture.getURI().match(/\.([A-Za-z0-9]+)(?:[?#].*)?$/)?.[1]?.toLowerCase();
  if (uriExtension) {
    return uriExtension;
  }
  if (texture.getMimeType() === "image/jpeg") {
    return "jpg";
  }
  if (texture.getMimeType() === "image/webp") {
    return "webp";
  }
  return "png";
}

function nodeDepth(node: GltfNode) {
  return collectParentChain(
    node.getParentNode(),
    (parent) => parent.getParentNode(),
    { label: "PMX node depth chain" },
  ).length;
}

function tailOffset(bone: HumanoidBoneName): [number, number, number] {
  if (bone.includes("Foot") || bone.includes("Toes")) return [0, 0, -0.08];
  if (bone.startsWith("left")) return [-0.08, 0, 0];
  if (bone.startsWith("right")) return [0.08, 0, 0];
  if (bone === "head") return [0, 0.12, 0];
  return [0, 0.08, 0];
}

function toVector3(value: ArrayLike<number>): [number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function toColor4(value: ArrayLike<number>): [number, number, number, number] {
  return [
    value[0] ?? 0.8,
    value[1] ?? 0.8,
    value[2] ?? 0.8,
    value[3] ?? 1,
  ];
}

function encodeUTF16LE(value: string) {
  const output = new Uint8Array(value.length * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index), true);
  }
  return output;
}
