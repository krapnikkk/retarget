import {
  Accessor,
  Document,
  WebIO,
  type Material,
} from "@gltf-transform/core";
import type { Object3D } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { AvatarFormatId } from "@/formats";
import { assertValidParentGraph } from "@/core/parent-graph";
import { DEFAULT_PARSE_BUDGET } from "@/import/parse-budget";
import {
  PMXBinaryReader,
  readPMXHeader,
  readPMXWeight,
} from "@/parsers/pmx-binary";
import {
  createAssetResourceScope,
  collectTransferableAssetPackage,
  getGLTFPackageResources,
} from "@/import/asset-package";
import { runRetargetJob } from "@/jobs/browser-retarget-job";
import { disposeObject } from "@/resources/dispose-three";
import {
  assertAvatarFileWithinLimit,
  getAvatarEagerInputLimit,
} from "@/jobs/asset-memory-policy";
import { readFileArrayBufferWithSignal } from "@/browser/read-file";
import {
  NODE_PEAK_MEMORY_LIMIT_BYTES,
  assertMemoryEstimateWithinBudget,
  estimateMMDConversionMemory,
} from "@/jobs/memory-budget";

export async function readAvatarAsGLBDocument({
  avatarFile,
  avatarFormatId,
  io,
  signal,
}: {
  avatarFile: File;
  avatarFormatId?: AvatarFormatId | null;
  io: WebIO;
  signal?: AbortSignal;
}): Promise<Document> {
  assertAvatarFileWithinLimit(avatarFile);
  if (shouldReadAsGLB(avatarFile, avatarFormatId)) {
    return readGLTFDocument(
      io,
      new Uint8Array(await readFileArrayBufferWithSignal(
        avatarFile,
        getAvatarEagerInputLimit(avatarFile),
        "avatar",
        signal,
      )),
      avatarFile,
    );
  }

  if (avatarFormatId === "mmd-model" || /\.(pmx|pmd)$/i.test(avatarFile.name)) {
    const bytes = await runRetargetJob(
      {
        type: "convert-mmd-avatar",
        bytes: await readFileArrayBufferWithSignal(
          avatarFile,
          getAvatarEagerInputLimit(avatarFile),
          "avatar",
          signal,
        ),
        filename: avatarFile.name,
        assetPackage: await collectTransferableAssetPackage(avatarFile),
      },
      { signal },
    );
    return io.readBinary(bytes);
  }

  const { resourceScope, root } = await parseFBXAvatarObject(
    avatarFile,
    avatarFormatId,
    signal,
  );
  try {
    const glbBytes = await exportObjectAsGLB(root);
    return io.readBinary(glbBytes);
  } finally {
    resourceScope.dispose();
    disposeObject(root);
  }
}

function shouldReadAsGLB(file: File, avatarFormatId?: AvatarFormatId | null) {
  if (avatarFormatId === "vrm") {
    return true;
  }

  return /\.(glb|gltf|vrm)$/i.test(file.name);
}

async function readGLTFDocument(io: WebIO, bytes: Uint8Array, file: File) {
  if (isTextGLTF(bytes)) {
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return io.readJSON({
      json,
      resources: await getGLTFPackageResources(
        file,
        json as Record<string, unknown>,
      ),
    });
  }

  return io.readBinary(bytes);
}

function isTextGLTF(bytes: Uint8Array) {
  const first = new TextDecoder().decode(bytes.slice(0, 16)).trimStart();
  return first.startsWith("{");
}

async function parseFBXAvatarObject(
  file: File,
  avatarFormatId?: AvatarFormatId | null,
  signal?: AbortSignal,
): Promise<{
  root: Object3D;
  resourceScope: ReturnType<typeof createAssetResourceScope>;
}> {
  const bytes = await readFileArrayBufferWithSignal(
    file,
    getAvatarEagerInputLimit(file),
    "avatar",
    signal,
  );
  if (
    avatarFormatId === "mixamo-rigged" ||
    avatarFormatId === "reallusion" ||
    avatarFormatId === "generic-fbx-avatar" ||
    /\.fbx$/i.test(file.name)
  ) {
    const resources = createAssetResourceScope(file);
    try {
      return {
        root: new FBXLoader(resources.manager).parse(bytes, ""),
        resourceScope: resources,
      };
    } catch (cause) {
      resources.dispose();
      throw cause;
    }
  }

  throw new Error(`Unsupported avatar conversion format: ${file.name}`);
}

function exportObjectAsGLB(root: Object3D): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Uint8Array(result));
          return;
        }

        resolve(new TextEncoder().encode(JSON.stringify(result)));
      },
      reject,
      {
        binary: true,
        animations: [],
        includeCustomExtensions: true,
      },
    );
  });
}

export type ParsedMMDModel = {
  name: string;
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  joints: Int32Array<ArrayBuffer>;
  weights: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  materials: ParsedMMDMaterial[];
  bones: ParsedMMDBone[];
  textures: string[];
};

export type MMDConversionCapabilityStatus =
  | "preserved"
  | "approximated"
  | "stored-in-extras"
  | "dropped";

export type MMDConversionCapabilityReport = {
  schemaVersion: 1;
  sourceFormat: "pmx" | "pmd";
  targetFormat: "glb";
  features: Array<{
    id: string;
    status: MMDConversionCapabilityStatus;
    note: string;
  }>;
};

export type ParsedMMDMaterial = {
  name: string;
  diffuse: [number, number, number, number];
  specular: [number, number, number];
  shininess: number;
  ambient: [number, number, number];
  flags?: number;
  edgeColor?: [number, number, number, number];
  edgeSize?: number;
  indexCount: number;
  textureIndex: number;
  sphereTextureIndex?: number;
  sphereMode?: number;
  toonTextureIndex?: number;
  sharedToon?: boolean;
};

export type ParsedMMDBone = {
  name: string;
  parentIndex: number;
  position: [number, number, number];
  flags?: number;
  tailIndex?: number;
  appendParentIndex?: number;
  appendRatio?: number;
  fixedAxis?: [number, number, number];
  localAxisX?: [number, number, number];
  localAxisZ?: [number, number, number];
  externalParentKey?: number;
  ik?: {
    targetIndex: number;
    iterations: number;
    angleLimit: number;
    links: Array<{
      boneIndex: number;
      minimumAngle?: [number, number, number];
      maximumAngle?: [number, number, number];
    }>;
  };
};

export type MMDConversionOptions = {
  maxPeakBytes?: number;
};

export function convertMMDModelToGLBDocument(
  bytes: Uint8Array,
  filename = "avatar.pmx",
  resolveResource?: (uri: string) => Uint8Array | null,
  options: MMDConversionOptions = {},
) {
  const sourceFormat = filename.toLowerCase().endsWith(".pmd") ? "pmd" : "pmx";
  const parsed = sourceFormat === "pmd"
    ? parsePMD(bytes, options)
    : parsePMX(bytes, options);
  return createMMDGLBDocument(parsed, sourceFormat, resolveResource);
}

export function createMMDConversionCapabilityReport(
  sourceFormat: "pmx" | "pmd",
): MMDConversionCapabilityReport {
  return {
    schemaVersion: 1,
    sourceFormat,
    targetFormat: "glb",
    features: [
      {
        id: "mesh-geometry-and-uvs",
        status: "preserved",
        note: "Positions, normals, UVs, and triangle indices are retained after the documented MMD-to-glTF coordinate conversion.",
      },
      {
        id: "bone-hierarchy-and-names",
        status: "preserved",
        note: "Bone names, hierarchy, and local rest translations are represented as glTF nodes and joints.",
      },
      {
        id: "vertex-skinning",
        status: "approximated",
        note: "MMD BDEF, SDEF, and QDEF inputs are reduced to normalized four-weight glTF skinning with derived inverse bind matrices.",
      },
      {
        id: "material-shading",
        status: "approximated",
        note: "MMD diffuse, ambient, shininess, culling, alpha, and available base textures are mapped to metallic-roughness PBR.",
      },
      {
        id: "mmd-material-and-bone-metadata",
        status: "stored-in-extras",
        note: "MMD toon and sphere references, material flags, edge data, bone flags, axes, append transforms, external parents, and IK metadata are retained in extras.",
      },
      {
        id: "morph-semantics",
        status: "dropped",
        note: "Vertex, material, bone, UV, group, and impulse morph semantics are not converted by this pipeline.",
      },
      {
        id: "mmd-physics-and-render-behavior",
        status: "dropped",
        note: "Rigid bodies, physics joints, soft bodies, outline rendering, sphere modes, toon lighting, and MMD runtime behavior are not reproduced in glTF.",
      },
    ],
  };
}

function createMMDGLBDocument(
  model: ParsedMMDModel,
  sourceFormat: "pmx" | "pmd",
  resolveResource?: (uri: string) => Uint8Array | null,
) {
  const document = new Document();
  document.getRoot().setExtras({
    mmdConversionCapabilityReport:
      createMMDConversionCapabilityReport(sourceFormat),
  });
  const buffer = document.createBuffer("mmd-avatar-buffer");
  const scene = document.createScene(model.name || "MMD avatar scene");
  document.getRoot().setDefaultScene(scene);

  const root = document.createNode(model.name || "MMDAvatar");
  scene.addChild(root);

  const boneNodes = model.bones.map((bone) => {
    const parentBone = model.bones[bone.parentIndex];
    const translation = parentBone
      ? subtractVector3(bone.position, parentBone.position)
      : bone.position;
    return document
      .createNode(bone.name)
      .setTranslation(translation)
      .setExtras({
        mmd: {
          flags: bone.flags,
          tailIndex: bone.tailIndex,
          appendParentIndex: bone.appendParentIndex,
          appendRatio: bone.appendRatio,
          fixedAxis: bone.fixedAxis,
          localAxisX: bone.localAxisX,
          localAxisZ: bone.localAxisZ,
          externalParentKey: bone.externalParentKey,
          ik: bone.ik,
        },
      });
  });
  for (const [index, bone] of model.bones.entries()) {
    const node = boneNodes[index];
    const parent = boneNodes[bone.parentIndex];
    if (!node) {
      throw new Error(`Missing generated MMD bone node at index ${index}.`);
    }
    if (parent) {
      parent.addChild(node);
    } else {
      root.addChild(node);
    }
  }

  if (model.positions.length > 0 && model.indices.length > 0) {
    const mesh = document.createMesh(`${model.name || "mmd"}-mesh`);
    const materialLookup = createMaterials(
      document,
      model.materials,
      model.textures,
      resolveResource,
    );
    const vertexCount = model.positions.length / 3;
    const skinning = createSkinningAttributes(model, vertexCount);

    const positionAccessor = document
      .createAccessor("POSITION")
      .setArray(model.positions)
      .setType(Accessor.Type.VEC3!)
      .setBuffer(buffer);
    const normalAccessor = document
      .createAccessor("NORMAL")
      .setArray(model.normals)
      .setType(Accessor.Type.VEC3!)
      .setBuffer(buffer);
    const uvAccessor = document
      .createAccessor("TEXCOORD_0")
      .setArray(model.uvs)
      .setType(Accessor.Type.VEC2!)
      .setBuffer(buffer);
    const jointsAccessor = skinning
      ? document
          .createAccessor("JOINTS_0")
          .setArray(skinning.joints)
          .setType(Accessor.Type.VEC4!)
          .setBuffer(buffer)
      : null;
    const weightsAccessor = skinning
      ? document
          .createAccessor("WEIGHTS_0")
          .setArray(skinning.weights)
          .setType(Accessor.Type.VEC4!)
          .setBuffer(buffer)
      : null;

    let indexOffset = 0;
    for (const [materialIndex, material] of model.materials.entries()) {
      const count = Math.max(0, material.indexCount);
      const indices = model.indices.slice(indexOffset, indexOffset + count);
      indexOffset += count;
      if (indices.length === 0) {
        continue;
      }

      const primitive = document
        .createPrimitive()
        .setName(`${material.name || `material-${materialIndex}`}-primitive`)
        .setAttribute("POSITION", positionAccessor)
        .setAttribute("NORMAL", normalAccessor)
        .setAttribute("TEXCOORD_0", uvAccessor)
        .setIndices(
          document
            .createAccessor("indices")
            .setArray(indices)
            .setType(Accessor.Type.SCALAR!)
            .setBuffer(buffer),
        )
        .setMaterial(materialLookup[materialIndex] ?? materialLookup[0] ?? null);
      if (jointsAccessor && weightsAccessor) {
        primitive
          .setAttribute("JOINTS_0", jointsAccessor)
          .setAttribute("WEIGHTS_0", weightsAccessor);
      }
      mesh.addPrimitive(primitive);
    }

    if (mesh.listPrimitives().length > 0) {
      const meshNode = document
        .createNode(`${model.name || "mmd"}-mesh-node`)
        .setMesh(mesh);
      root.addChild(meshNode);

      if (skinning && boneNodes.length > 0) {
        const skin = document.createSkin(`${model.name || "mmd"}-skin`);
        for (const node of boneNodes) {
          skin.addJoint(node);
        }
        skin.setInverseBindMatrices(
          document
            .createAccessor("inverseBindMatrices")
            .setArray(createInverseBindMatrices(model.bones))
            .setType(Accessor.Type.MAT4!)
            .setBuffer(buffer),
        );
        meshNode.setSkin(skin);
      }
    }
  }

  return document;
}

// Sanitizes raw PMX/PMD vertex weights into glTF-conformant JOINTS_0 / WEIGHTS_0:
// negative bone references are dropped and weights re-normalized to sum to 1.
function createSkinningAttributes(model: ParsedMMDModel, vertexCount: number) {
  if (
    model.bones.length === 0 ||
    model.joints.length !== vertexCount * 4 ||
    model.weights.length !== vertexCount * 4
  ) {
    return null;
  }

  const joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  const maxJoint = model.bones.length - 1;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 4;
    let sum = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const joint = model.joints[offset + slot];
      const weight = model.weights[offset + slot];
      if (
        joint !== undefined &&
        weight !== undefined &&
        joint >= 0 &&
        joint <= maxJoint &&
        weight > 0
      ) {
        joints[offset + slot] = joint;
        weights[offset + slot] = weight;
        sum += weight;
      }
    }
    if (sum <= 0) {
      weights[offset] = 1;
      continue;
    }
    if (Math.abs(sum - 1) > 1e-6) {
      for (let slot = 0; slot < 4; slot += 1) {
        weights[offset + slot] = (weights[offset + slot] ?? 0) / sum;
      }
    }
  }

  return { joints, weights };
}

// PMX/PMD rest bones carry no rotation, so each inverse bind matrix is a pure
// translation by the negated absolute bone position (column-major mat4).
function createInverseBindMatrices(bones: ParsedMMDBone[]) {
  const matrices = new Float32Array(bones.length * 16);
  for (const [index, bone] of bones.entries()) {
    const offset = index * 16;
    matrices[offset] = 1;
    matrices[offset + 5] = 1;
    matrices[offset + 10] = 1;
    matrices[offset + 12] = -(bone.position[0] ?? 0);
    matrices[offset + 13] = -(bone.position[1] ?? 0);
    matrices[offset + 14] = -(bone.position[2] ?? 0);
    matrices[offset + 15] = 1;
  }
  return matrices;
}

function subtractVector3(
  value: [number, number, number],
  parent: [number, number, number],
): [number, number, number] {
  return [value[0] - parent[0], value[1] - parent[1], value[2] - parent[2]];
}

function createMaterials(
  document: Document,
  materials: ParsedMMDMaterial[],
  texturePaths: string[],
  resolveResource?: (uri: string) => Uint8Array | null,
) {
  if (materials.length === 0) {
    return [document.createMaterial("MMD default material")];
  }

  return materials.map((item, index): Material => {
    const material = document
      .createMaterial(item.name || `MMD material ${index + 1}`)
      .setBaseColorFactor(item.diffuse)
      .setMetallicFactor(0)
      .setRoughnessFactor(shininessToRoughness(item.shininess))
      .setEmissiveFactor(item.ambient)
      .setDoubleSided(item.flags === undefined ? true : Boolean(item.flags & 0x01))
      .setExtras({
        mmd: {
          specular: item.specular,
          shininess: item.shininess,
          ambient: item.ambient,
          flags: item.flags,
          edgeColor: item.edgeColor,
          edgeSize: item.edgeSize,
          sphereTexture: texturePaths[item.sphereTextureIndex ?? -1],
          sphereMode: item.sphereMode,
          toonTexture: item.sharedToon
            ? `toon${String((item.toonTextureIndex ?? 0) + 1).padStart(2, "0")}.bmp`
            : texturePaths[item.toonTextureIndex ?? -1],
          sharedToon: item.sharedToon,
        },
      });
    if (item.diffuse[3] < 1) {
      material.setAlphaMode("BLEND");
    }
    const texturePath = texturePaths[item.textureIndex];
    const textureBytes = texturePath ? resolveResource?.(texturePath) : null;
    const mimeType = texturePath ? inferImageMimeType(texturePath) : null;
    if (textureBytes && mimeType) {
      material.setBaseColorTexture(
        document
          .createTexture(texturePath)
          .setImage(textureBytes)
          .setMimeType(mimeType),
      );
    }
    return material;
  });
}

function shininessToRoughness(shininess: number) {
  if (!Number.isFinite(shininess) || shininess <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0.04, Math.sqrt(2 / (shininess + 2))));
}

function inferImageMimeType(filename: string) {
  const extension = filename.toLowerCase().split(".").at(-1);
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return null;
}

export function parsePMX(
  bytes: Uint8Array,
  options: MMDConversionOptions = {},
): ParsedMMDModel {
  const reader = new PMXBinaryReader(bytes);
  const { config } = readPMXHeader(reader);
  const { encoding, additionalUvCount, vertexIndexSize, textureIndexSize, boneIndexSize } = config;

  const localName = reader.readText(encoding);
  const englishName = reader.readText(encoding);
  reader.readText(encoding);
  reader.readText(encoding);
  const name = localName || englishName || "PMX Avatar";

  const vertexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxVertices,
    label: "PMX vertices",
  });
  assertMemoryEstimateWithinBudget(
    estimateMMDConversionMemory(bytes.byteLength, vertexCount),
    options.maxPeakBytes ?? NODE_PEAK_MEMORY_LIMIT_BYTES,
    "PMX conversion",
  );
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const joints = new Int32Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let index = 0; index < vertexCount; index += 1) {
    positions.set(flipMMDVector(reader.readVector3()), index * 3);
    normals.set(flipMMDVector(reader.readVector3()), index * 3);
    uvs.set(reader.readVector2(), index * 2);
    reader.skip(additionalUvCount * 16);
    const weight = readPMXWeight(reader, boneIndexSize);
    joints.set(weight.joints, index * 4);
    weights.set(weight.weights, index * 4);
    reader.readFloat32();
  }

  const indexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxIndices,
    label: "PMX indices",
  });
  const indices = new Uint32Array(indexCount);
  for (let index = 0; index < indexCount; index += 1) {
    indices[index] = reader.readUnsignedIndex(vertexIndexSize);
  }
  validateTriangleIndices(indices, vertexCount, "PMX");
  reverseTriangleWinding(indices);

  const textureCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMaterials,
    label: "PMX textures",
  });
  const textures: string[] = [];
  for (let index = 0; index < textureCount; index += 1) {
    textures.push(reader.readText(encoding));
  }

  const materialCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMaterials,
    label: "PMX materials",
  });
  const materials: ParsedMMDMaterial[] = [];
  for (let index = 0; index < materialCount; index += 1) {
    const materialName = reader.readText(encoding) || `PMX Material ${index + 1}`;
    reader.readText(encoding);
    const diffuse = reader.readColor4();
    const specular = reader.readVector3();
    const shininess = reader.readFloat32();
    const ambient = reader.readVector3();
    const flags = reader.readUint8();
    const edgeColor = reader.readColor4();
    const edgeSize = reader.readFloat32();
    const textureIndex = reader.readIndex(textureIndexSize);
    const sphereTextureIndex = reader.readIndex(textureIndexSize);
    const sphereMode = reader.readUint8();
    const sharedToon = reader.readUint8() === 1;
    let toonTextureIndex: number;
    if (!sharedToon) {
      toonTextureIndex = reader.readIndex(textureIndexSize);
    } else {
      toonTextureIndex = reader.readUint8();
    }
    reader.readText(encoding);
    const materialIndexCount = reader.readCount({
      max: DEFAULT_PARSE_BUDGET.maxIndices,
      label: "PMX material indices",
    });
    materials.push({
      name: materialName,
      diffuse,
      specular,
      shininess,
      ambient,
      flags,
      edgeColor,
      edgeSize,
      indexCount: materialIndexCount,
      textureIndex,
      sphereTextureIndex,
      sphereMode,
      toonTextureIndex,
      sharedToon,
    });
  }

  const boneCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxBones,
    label: "PMX bones",
  });
  const bones: ParsedMMDBone[] = [];
  for (let index = 0; index < boneCount; index += 1) {
    const boneName = reader.readText(encoding) || `PMX Bone ${index + 1}`;
    reader.readText(encoding);
    const position = flipMMDVector(reader.readVector3());
    const parentIndex = reader.readIndex(boneIndexSize);
    reader.readInt32();
    const flags = reader.readUint16();
    let tailIndex: number | undefined;
    if (flags & 0x0001) {
      tailIndex = reader.readIndex(boneIndexSize);
    } else {
      reader.skip(3 * 4);
    }
    let appendParentIndex: number | undefined;
    let appendRatio: number | undefined;
    if (flags & 0x0100 || flags & 0x0200) {
      appendParentIndex = reader.readIndex(boneIndexSize);
      appendRatio = reader.readFloat32();
    }
    let fixedAxis: [number, number, number] | undefined;
    if (flags & 0x0400) {
      fixedAxis = flipMMDVector(reader.readVector3());
    }
    let localAxisX: [number, number, number] | undefined;
    let localAxisZ: [number, number, number] | undefined;
    if (flags & 0x0800) {
      localAxisX = flipMMDVector(reader.readVector3());
      localAxisZ = flipMMDVector(reader.readVector3());
    }
    let externalParentKey: number | undefined;
    if (flags & 0x2000) {
      externalParentKey = reader.readInt32();
    }
    let ik: ParsedMMDBone["ik"];
    if (flags & 0x0020) {
      const targetIndex = reader.readIndex(boneIndexSize);
      const iterations = reader.readInt32();
      const angleLimit = reader.readFloat32();
      const linkCount = reader.readCount({
        max: DEFAULT_PARSE_BUDGET.maxBones,
        label: "PMX IK links",
      });
      const links: NonNullable<ParsedMMDBone["ik"]>["links"] = [];
      for (let link = 0; link < linkCount; link += 1) {
        const boneIndex = reader.readIndex(boneIndexSize);
        if (reader.readUint8()) {
          links.push({
            boneIndex,
            minimumAngle: flipMMDVector(reader.readVector3()),
            maximumAngle: flipMMDVector(reader.readVector3()),
          });
        } else {
          links.push({ boneIndex });
        }
      }
      ik = { targetIndex, iterations, angleLimit, links };
    }
    bones.push({
      name: boneName,
      parentIndex,
      position,
      flags,
      tailIndex,
      appendParentIndex,
      appendRatio,
      fixedAxis,
      localAxisX,
      localAxisZ,
      externalParentKey,
      ik,
    });
  }

  validateMMDStructure({
    bones,
    indices,
    joints,
    materials,
    textureCount,
    label: "PMX",
    weights,
  });

  return { bones, indices, joints, materials, name, normals, positions, textures, uvs, weights };
}

function parsePMD(
  bytes: Uint8Array,
  options: MMDConversionOptions = {},
): ParsedMMDModel {
  const reader = new PMXBinaryReader(bytes);
  if (reader.readAscii(3) !== "Pmd") {
    throw new Error("PMD header is invalid.");
  }
  reader.readFloat32();
  const name = reader.readShiftJISString(20) || "PMD Avatar";
  reader.skip(256);

  const vertexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxVertices,
    label: "PMD vertices",
  });
  assertMemoryEstimateWithinBudget(
    estimateMMDConversionMemory(bytes.byteLength, vertexCount),
    options.maxPeakBytes ?? NODE_PEAK_MEMORY_LIMIT_BYTES,
    "PMD conversion",
  );
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const joints = new Int32Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let index = 0; index < vertexCount; index += 1) {
    positions.set(flipMMDVector(reader.readVector3()), index * 3);
    normals.set(flipMMDVector(reader.readVector3()), index * 3);
    uvs.set(reader.readVector2(), index * 2);
    const bone0 = reader.readUint16();
    const bone1 = reader.readUint16();
    const weight0 = reader.readUint8() / 100;
    if (weight0 > 1) {
      throw new Error("PMD vertex weight percentage exceeds 100.");
    }
    reader.readUint8();
    joints.set([bone0, bone1, 0, 0], index * 4);
    weights.set([weight0, 1 - weight0, 0, 0], index * 4);
  }

  const indexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxIndices,
    label: "PMD indices",
  });
  const indices = new Uint32Array(indexCount);
  for (let index = 0; index < indexCount; index += 1) {
    indices[index] = reader.readUint16();
  }
  validateTriangleIndices(indices, vertexCount, "PMD");
  reverseTriangleWinding(indices);

  const materialCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMaterials,
    label: "PMD materials",
  });
  const materials: ParsedMMDMaterial[] = [];
  const textures: string[] = [];
  for (let index = 0; index < materialCount; index += 1) {
    const diffuse = reader.readColor4();
    const shininess = reader.readFloat32();
    const specular = reader.readVector3();
    const ambient = reader.readVector3();
    const toonTextureIndex = reader.readUint8();
    const edgeFlag = reader.readUint8();
    const materialIndexCount = reader.readUnsignedCount({
      max: DEFAULT_PARSE_BUDGET.maxIndices,
      label: "PMD material indices",
    });
    const [textureName = "", sphereTextureName = ""] = reader
      .readShiftJISString(20)
      .split("*")
      .map((value) => value.trim());
    const textureIndex = textureName
      ? Math.max(0, textures.push(textureName) - 1)
      : -1;
    const sphereTextureIndex = sphereTextureName
      ? Math.max(0, textures.push(sphereTextureName) - 1)
      : -1;
    materials.push({
      name: `PMD Material ${index + 1}`,
      diffuse,
      specular,
      shininess,
      ambient,
      flags: edgeFlag ? 0x10 : 0,
      indexCount: materialIndexCount,
      textureIndex,
      sphereTextureIndex,
      sphereMode: sphereTextureName.toLowerCase().endsWith(".spa") ? 2 : 1,
      toonTextureIndex,
      sharedToon: true,
    });
  }

  const boneCount = reader.readUnsignedCount({
    max: DEFAULT_PARSE_BUDGET.maxBones,
    label: "PMD bones",
    size: 2,
  });
  const bones: ParsedMMDBone[] = [];
  for (let index = 0; index < boneCount; index += 1) {
    const boneName = reader.readShiftJISString(20) || `PMD Bone ${index + 1}`;
    const parentIndex = normalizePMDIndex(reader.readUint16());
    const tailIndex = normalizePMDIndex(reader.readUint16());
    const type = reader.readUint8();
    const ikParentIndex = normalizePMDIndex(reader.readUint16());
    const position = flipMMDVector(reader.readVector3());
    bones.push({
      name: boneName,
      parentIndex,
      position,
      flags: type,
      tailIndex,
      appendParentIndex: ikParentIndex,
    });
  }

  if (reader.remaining >= 2) {
    const ikCount = reader.readUint16();
    if (ikCount > 100_000) {
      throw new Error(`PMD IK count is invalid: ${ikCount}.`);
    }
    for (let index = 0; index < ikCount; index += 1) {
      const ikBoneIndex = reader.readUint16();
      const targetIndex = reader.readUint16();
      const linkCount = reader.readUint8();
      const iterations = reader.readUint16();
      const angleLimit = reader.readFloat32();
      const links = Array.from({ length: linkCount }, () => ({
        boneIndex: reader.readUint16(),
      }));
      const bone = bones[ikBoneIndex];
      if (bone) {
        bone.ik = { targetIndex, iterations, angleLimit, links };
      }
    }
  }

  validateMMDStructure({
    bones,
    indices,
    joints,
    materials,
    textureCount: textures.length,
    label: "PMD",
    weights,
  });

  return { bones, indices, joints, materials, name, normals, positions, textures, uvs, weights };
}

function normalizePMDIndex(index: number) {
  return index === 0xffff ? -1 : index;
}

function flipMMDVector(
  value: [number, number, number],
): [number, number, number] {
  return [value[0], value[1], -value[2]];
}

function reverseTriangleWinding(indices: Uint32Array) {
  for (let index = 0; index + 2 < indices.length; index += 3) {
    [indices[index + 1], indices[index + 2]] = [
      indices[index + 2]!,
      indices[index + 1]!,
    ];
  }
}

function validateTriangleIndices(
  indices: ArrayLike<number>,
  vertexCount: number,
  label: string,
) {
  if (indices.length % 3 !== 0) {
    throw new Error(`${label} index count must be divisible by three.`);
  }
  for (let index = 0; index < indices.length; index += 1) {
    const vertexIndex = indices[index]!;
    if (vertexIndex < 0 || vertexIndex >= vertexCount) {
      throw new Error(`${label} triangle references invalid vertex index ${vertexIndex}.`);
    }
  }
}

function validateMMDStructure({
  bones,
  indices,
  joints,
  materials,
  textureCount,
  label,
  weights,
}: {
  bones: readonly ParsedMMDBone[];
  indices: ArrayLike<number>;
  joints: ArrayLike<number>;
  materials: readonly ParsedMMDMaterial[];
  textureCount: number;
  label: string;
  weights: ArrayLike<number>;
}) {
  const materialIndexCount = materials.reduce(
    (total, material) => total + material.indexCount,
    0,
  );
  if (materialIndexCount !== indices.length) {
    throw new Error(
      `${label} materials reference ${materialIndexCount} indices, but the mesh contains ${indices.length}.`,
    );
  }
  for (const [index, material] of materials.entries()) {
    for (const textureIndex of [
      material.textureIndex,
      material.sphereTextureIndex ?? -1,
      material.sharedToon ? -1 : (material.toonTextureIndex ?? -1),
    ]) {
      if (textureIndex < -1 || textureIndex >= textureCount) {
        throw new Error(
          `${label} material ${index} references invalid texture index ${textureIndex}.`,
        );
      }
    }
  }
  for (const [index, bone] of bones.entries()) {
    if (bone.parentIndex < -1 || bone.parentIndex >= bones.length || bone.parentIndex === index) {
      throw new Error(
        `${label} bone ${index} references invalid parent index ${bone.parentIndex}.`,
      );
    }
  }
  if (joints.length !== weights.length || joints.length % 4 !== 0) {
    throw new Error(`${label} skinning arrays have inconsistent lengths.`);
  }
  for (let vertex = 0; vertex < joints.length / 4; vertex += 1) {
    let weightSum = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const offset = vertex * 4 + slot;
      const joint = joints[offset]!;
      const weight = weights[offset]!;
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new Error(`${label} vertex ${vertex} has an invalid skin weight.`);
      }
      if (weight > 0 && (!Number.isInteger(joint) || joint < 0 || joint >= bones.length)) {
        throw new Error(`${label} vertex ${vertex} references invalid bone ${joint}.`);
      }
      weightSum += weight;
    }
    if (!Number.isFinite(weightSum) || Math.abs(weightSum - 1) > 1e-4) {
      throw new Error(`${label} vertex ${vertex} skin weights do not sum to one.`);
    }
  }
  assertValidParentGraph({
    nodeIds: bones.keys(),
    edges: bones.flatMap((bone, childId) =>
      bone.parentIndex >= 0
        ? [{ childId, parentId: bone.parentIndex }]
        : []
    ),
    label: `${label} bone hierarchy`,
  });
}
