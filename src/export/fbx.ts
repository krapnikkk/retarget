import { Euler, Matrix4, Quaternion } from "three";
import type {
  Document,
  Node as GltfDocumentNode,
  Primitive as GltfPrimitive,
  Texture as GltfTexture,
} from "@gltf-transform/core";
import {
  type HumanoidBoneName,
  type MotionTrack,
  type RetargetedMotionClip,
} from "@/retarget";
import { validateMotionClip } from "@/retarget";
import { GrowableBuffer } from "@/parsers/binary-writer";
import {
  resolveExportBoneName,
  type BoneNamingOptions,
  type BoneNamingProfileId,
} from "./bone-naming";

const FBX_VERSION = 7400;
const FBX_TIME_SECOND = 46186158000;
const FBX_BINARY_HEADER = "Kaydara FBX Binary  \0\x1a\0";
const FBX_NULL_RECORD_LENGTH = 13;

const FOOTER_MAGIC_A = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e] as const;
const FOOTER_MAGIC_B = [0xf8, 0x5a, 0x8c, 0x6a] as const;
const FOOTER_MAGIC_C = [0xd9, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b] as const;

type FBXBoneNode = {
  bone: HumanoidBoneName;
  offset: readonly [number, number, number];
  children: readonly FBXBoneNode[];
};

type ExportBone = {
  bone: HumanoidBoneName;
  id: number;
  name: string;
  parent?: HumanoidBoneName;
  offset: readonly [number, number, number];
};

type ExportCurveNode = {
  id: number;
  modelId: number;
  kind: "T" | "R";
  curves: ExportCurve[];
};

type ExportCurve = {
  id: number;
  axis: "X" | "Y" | "Z";
  times: number[];
  values: number[];
};

type FBXProperty =
  | { type: "C"; value: boolean }
  | { type: "D"; value: number }
  | { type: "F"; value: number }
  | { type: "I"; value: number }
  | { type: "L"; value: number }
  | { type: "R"; value: Uint8Array }
  | { type: "S"; value: string }
  | { type: "d" | "f" | "i" | "l"; value: number[] };

type FBXNode = {
  name: string;
  properties?: FBXProperty[];
  children?: FBXNode[];
};

const FBX_HUMANOID_TREE = {
  bone: "hips",
  offset: [0, 0, 0],
  children: [
    {
      bone: "spine",
      offset: [0, 12, 0],
      children: [
        {
          bone: "chest",
          offset: [0, 18, 0],
          children: [
            {
              bone: "upperChest",
              offset: [0, 12, 0],
              children: [
                {
                  bone: "neck",
                  offset: [0, 14, 0],
                  children: [
                    { bone: "head", offset: [0, 16, 0], children: [] },
                  ],
                },
                {
                  bone: "leftShoulder",
                  offset: [-8, 10, 0],
                  children: [
                    {
                      bone: "leftUpperArm",
                      offset: [-18, 0, 0],
                      children: [
                        {
                          bone: "leftLowerArm",
                          offset: [-28, 0, 0],
                          children: [
                            { bone: "leftHand", offset: [-24, 0, 0], children: [] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  bone: "rightShoulder",
                  offset: [8, 10, 0],
                  children: [
                    {
                      bone: "rightUpperArm",
                      offset: [18, 0, 0],
                      children: [
                        {
                          bone: "rightLowerArm",
                          offset: [28, 0, 0],
                          children: [
                            { bone: "rightHand", offset: [24, 0, 0], children: [] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      bone: "leftUpperLeg",
      offset: [-11, -8, 0],
      children: [
        {
          bone: "leftLowerLeg",
          offset: [0, -42, 0],
          children: [
            {
              bone: "leftFoot",
              offset: [0, -40, 0],
              children: [
                { bone: "leftToes", offset: [0, -5, 14], children: [] },
              ],
            },
          ],
        },
      ],
    },
    {
      bone: "rightUpperLeg",
      offset: [11, -8, 0],
      children: [
        {
          bone: "rightLowerLeg",
          offset: [0, -42, 0],
          children: [
            {
              bone: "rightFoot",
              offset: [0, -40, 0],
              children: [
                { bone: "rightToes", offset: [0, -5, 14], children: [] },
              ],
            },
          ],
        },
      ],
    },
  ],
} as const satisfies FBXBoneNode;

export async function exportFBXAnimation(
  clip: RetargetedMotionClip,
  options: BoneNamingOptions = {},
): Promise<Uint8Array> {
  return createFBXAnimationBinary(clip, options);
}

export function createFBXAnimationBinary(
  clip: RetargetedMotionClip,
  { boneNamingProfile = "canonical" }: BoneNamingOptions = {},
) {
  const validation = validateMotionClip(clip);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  const bones = collectExportBones(clip, boneNamingProfile);
  const boneByName = new Map(bones.map((bone) => [bone.bone, bone]));
  const stackId = 2000;
  const layerId = 2001;
  const curves = createExportCurveNodes(
    clip,
    new Map(bones.map((bone) => [bone.bone, bone.id])),
  );

  return writeFBXFile(
    [
      ...bones.map(createModelNode),
      node("AnimationStack", [long(stackId), string(`AnimStack::${clip.name || "retargeted-motion"}`), string("")]),
      node("AnimationLayer", [long(layerId), string("AnimLayer::BaseLayer"), string("")]),
      ...curves.flatMap(createCurveNodes),
    ],
    [
      ...bones.map((bone) =>
        node("C", [
          string("OO"),
          long(bone.id),
          long(bone.parent ? boneByName.get(bone.parent)?.id ?? 0 : 0),
        ]),
      ),
      node("C", [string("OO"), long(layerId), long(stackId)]),
      ...curves.flatMap((curveNode) => createCurveConnections(curveNode, layerId)),
    ],
  );
}

function writeFBXFile(objects: FBXNode[], connections: FBXNode[]) {
  const nodes: FBXNode[] = [
    node("FBXHeaderExtension", [], [
      single("FBXHeaderVersion", int(1003)),
      single("FBXVersion", int(FBX_VERSION)),
    ]),
    node("GlobalSettings", [], [
      single("Version", int(1000)),
      node("Properties70", [], [
        property("UpAxis", "int", [int(1)]),
        property("UpAxisSign", "int", [int(1)]),
        property("FrontAxis", "int", [int(2)]),
        property("FrontAxisSign", "int", [int(1)]),
        property("CoordAxis", "int", [int(0)]),
        property("CoordAxisSign", "int", [int(1)]),
        property("UnitScaleFactor", "double", [double(1)]),
      ]),
    ]),
    node("Objects", [], objects),
    node("Connections", [], connections),
    node("Takes", [], [single("Current", string(""))]),
  ];

  const writer = new FBXBinaryWriter();
  writer.writeAscii(FBX_BINARY_HEADER);
  writer.writeUint32(FBX_VERSION);
  for (const item of nodes) {
    writer.writeNode(item);
  }
  writer.writeNullRecord();
  writer.writeFooter(FBX_VERSION);
  return writer.toUint8Array();
}

async function parseFBXWithThree(bytes: Uint8Array) {
  const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new FBXLoader().parse(arrayBuffer, "");
}

export async function validateFBXAnimationBytes(bytes: Uint8Array) {
  const group = await parseFBXWithThree(bytes);
  if (!group.animations || group.animations.length === 0) {
    throw new Error("FBX export does not contain an animation.");
  }
  const animation = group.animations[0];
  if (!animation || animation.tracks.length === 0) {
    throw new Error("FBX export animation does not contain tracks.");
  }
  return group;
}

function createModelNode(bone: ExportBone): FBXNode {
  const [x, y, z] = bone.offset;
  return node(
    "Model",
    [long(bone.id), string(`Model::${bone.name}`), string(bone.parent ? "LimbNode" : "Root")],
    [
      single("Version", int(232)),
      node("Properties70", [], [
        property("Lcl Translation", "Lcl Translation", [double(round(x)), double(round(y)), double(round(z))]),
        property("Lcl Rotation", "Lcl Rotation", [double(0), double(0), double(0)]),
        property("Lcl Scaling", "Lcl Scaling", [double(1), double(1), double(1)]),
      ]),
    ],
  );
}

function createCurveNodes(curveNode: ExportCurveNode): FBXNode[] {
  return [
    node("AnimationCurveNode", [long(curveNode.id), string(curveNode.kind), string("")]),
    ...curveNode.curves.map(createCurveNode),
  ];
}

function createCurveNode(curve: ExportCurve): FBXNode {
  const keyAttrFlags = curve.times.map(() => 24840);
  const keyAttrData = curve.times.flatMap(() => [0, 0, 0, 0]);
  const keyAttrRefCount = curve.times.map(() => 1);
  return node("AnimationCurve", [long(curve.id), string(`AnimCurve::${curve.axis}`), string("")], [
    single("Default", double(0)),
    single("KeyVer", int(4008)),
    single("KeyTime", longArray(curve.times.map((time) => Math.round(time * FBX_TIME_SECOND)))),
    single("KeyValueFloat", floatArray(curve.values.map(round))),
    single("KeyAttrFlags", intArray(keyAttrFlags)),
    single("KeyAttrDataFloat", floatArray(keyAttrData)),
    single("KeyAttrRefCount", intArray(keyAttrRefCount)),
  ]);
}

function createCurveConnections(curveNode: ExportCurveNode, layerId: number) {
  const propertyName = curveNode.kind === "T" ? "d|Lcl Translation" : "d|Lcl Rotation";
  return [
    node("C", [string("OP"), long(curveNode.id), long(curveNode.modelId), string(propertyName)]),
    node("C", [string("OO"), long(curveNode.id), long(layerId)]),
    ...curveNode.curves.map((curve) =>
      node("C", [string("OP"), long(curve.id), long(curveNode.id), string(`d|${curve.axis}`)]),
    ),
  ];
}

function collectExportBones(
  clip: RetargetedMotionClip,
  boneNamingProfile: BoneNamingProfileId,
) {
  const trackedBones = new Set(clip.tracks.map((track) => track.bone));
  trackedBones.add("hips");
  addAncestors(trackedBones, FBX_HUMANOID_TREE);
  const bones: ExportBone[] = [];
  collectTreeBones(FBX_HUMANOID_TREE, trackedBones, boneNamingProfile, bones);
  return bones;
}

function addAncestors(trackedBones: Set<HumanoidBoneName>, item: FBXBoneNode) {
  for (const child of item.children) {
    addAncestors(trackedBones, child);
    if (trackedBones.has(child.bone)) {
      trackedBones.add(item.bone);
    }
  }
}

function collectTreeBones(
  item: FBXBoneNode,
  trackedBones: ReadonlySet<HumanoidBoneName>,
  boneNamingProfile: BoneNamingProfileId,
  bones: ExportBone[],
  parent?: HumanoidBoneName,
) {
  if (!trackedBones.has(item.bone)) {
    return;
  }

  bones.push({
    bone: item.bone,
    id: 1000 + bones.length,
    name: resolveExportBoneName(item.bone, boneNamingProfile),
    parent,
    offset: item.offset,
  });

  for (const child of item.children) {
    collectTreeBones(child, trackedBones, boneNamingProfile, bones, item.bone);
  }
}

function createExportCurveNodes(
  clip: RetargetedMotionClip,
  modelIdByBone: ReadonlyMap<HumanoidBoneName, number>,
) {
  const tracksByBone = new Map<HumanoidBoneName, MotionTrack[]>();
  for (const track of clip.tracks) {
    const items = tracksByBone.get(track.bone) ?? [];
    items.push(track);
    tracksByBone.set(track.bone, items);
  }

  const nodes: ExportCurveNode[] = [];
  let curveNodeId = 3000;
  let curveId = 4000;
  for (const [bone, tracks] of tracksByBone) {
    const modelId = modelIdByBone.get(bone);
    if (modelId === undefined) {
      continue;
    }

    const translation = tracks.find((track) => track.path === "translation");
    if (translation) {
      const curves = splitVectorTrack(translation, 3).map((curve) => ({
        ...curve,
        id: curveId++,
      }));
      nodes.push({ id: curveNodeId++, kind: "T", modelId, curves });
    }

    const rotation = tracks.find((track) => track.path === "rotation");
    if (rotation) {
      const eulerTrack = quaternionTrackToEulerDegrees(rotation);
      const curves = splitVectorTrack(eulerTrack, 3).map((curve) => ({
        ...curve,
        id: curveId++,
      }));
      nodes.push({ id: curveNodeId++, kind: "R", modelId, curves });
    }
  }
  return nodes;
}

function splitVectorTrack(track: MotionTrack, size: 3) {
  const axes = ["X", "Y", "Z"] as const;
  return axes.map((axis, axisIndex) => ({
    axis,
    times: track.times,
    values: track.times.map((_, index) => track.values[index * size + axisIndex] ?? 0),
  }));
}

function quaternionTrackToEulerDegrees(track: MotionTrack): MotionTrack {
  const values: number[] = [];
  for (let index = 0; index < track.times.length; index += 1) {
    const offset = index * 4;
    const quaternion = new Quaternion(
      track.values[offset] ?? 0,
      track.values[offset + 1] ?? 0,
      track.values[offset + 2] ?? 0,
      track.values[offset + 3] ?? 1,
    );
    const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
    values.push(
      radiansToDegrees(euler.x),
      radiansToDegrees(euler.y),
      radiansToDegrees(euler.z),
    );
  }

  return { ...track, path: "rotation", values };
}

function node(name: string, properties: FBXProperty[] = [], children: FBXNode[] = []): FBXNode {
  return { name, properties, children };
}

function single(name: string, value: FBXProperty): FBXNode {
  return node(name, [value]);
}

function property(name: string, type: string, values: FBXProperty[]) {
  return node("P", [string(name), string(type), string(""), string("A"), ...values]);
}

function int(value: number): FBXProperty {
  return { type: "I", value };
}

function long(value: number): FBXProperty {
  return { type: "L", value };
}

function double(value: number): FBXProperty {
  return { type: "D", value };
}

function string(value: string): FBXProperty {
  return { type: "S", value };
}

function raw(value: Uint8Array): FBXProperty {
  return { type: "R", value };
}

function intArray(value: number[]): FBXProperty {
  return { type: "i", value };
}

function longArray(value: number[]): FBXProperty {
  return { type: "l", value };
}

function floatArray(value: number[]): FBXProperty {
  return { type: "f", value };
}

function doubleArray(value: number[]): FBXProperty {
  return { type: "d", value };
}

// --- Avatar scene export -----------------------------------------------
//
// Builds a full FBX scene (models, mesh geometry, materials, skin
// deformers, and the retargeted animation) from an avatar that has been
// normalized into a glTF Document by readAvatarAsGLBDocument.

type SceneModelEntry = {
  id: number;
  name: string;
  node: GltfDocumentNode;
  parentId: number;
};

export function createFBXAvatarSceneBinary(
  document: Document,
  humanoidNodes: ReadonlyMap<HumanoidBoneName, GltfDocumentNode>,
  clip: RetargetedMotionClip,
): Uint8Array {
  const validation = validateMotionClip(clip);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  const entries = collectSceneModelEntries(document);
  if (entries.length === 0) {
    throw new Error("Avatar scene does not contain any nodes to export.");
  }
  const entryByNode = new Map(entries.map((entry) => [entry.node, entry]));

  const modelIdByBone = new Map<HumanoidBoneName, number>();
  for (const [bone, gltfNode] of humanoidNodes) {
    const entry = entryByNode.get(gltfNode);
    if (entry && !modelIdByBone.has(bone)) {
      modelIdByBone.set(bone, entry.id);
    }
  }
  if (modelIdByBone.size === 0) {
    throw new Error(
      "Avatar does not contain humanoid bones matching the retargeted clip.",
    );
  }

  const objects: FBXNode[] = [];
  const connections: FBXNode[] = [];
  for (const entry of entries) {
    objects.push(createSceneModelNode(entry));
    connections.push(
      node("C", [string("OO"), long(entry.id), long(entry.parentId)]),
    );
  }

  const ids = { next: 5_000_000 };
  for (const entry of entries) {
    appendMeshObjects(entry, entryByNode, ids, objects, connections);
  }

  const stackId = 2000;
  const layerId = 2001;
  const curves = createExportCurveNodes(clip, modelIdByBone);
  objects.push(
    node("AnimationStack", [long(stackId), string(`AnimStack::${clip.name || "retargeted-motion"}`), string("")]),
    node("AnimationLayer", [long(layerId), string("AnimLayer::BaseLayer"), string("")]),
    ...curves.flatMap(createCurveNodes),
  );
  connections.push(
    node("C", [string("OO"), long(layerId), long(stackId)]),
    ...curves.flatMap((curveNode) => createCurveConnections(curveNode, layerId)),
  );

  return writeFBXFile(objects, connections);
}

function collectSceneModelEntries(document: Document) {
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const entries: SceneModelEntry[] = [];
  let nextId = 1_000_000;

  const visit = (gltfNode: GltfDocumentNode, parentId: number) => {
    const entry: SceneModelEntry = {
      id: nextId,
      name: gltfNode.getName() || `node-${nextId}`,
      node: gltfNode,
      parentId,
    };
    nextId += 1;
    entries.push(entry);
    for (const child of gltfNode.listChildren()) {
      visit(child, entry.id);
    }
  };

  for (const child of scene?.listChildren() ?? []) {
    visit(child, 0);
  }
  return entries;
}

function createSceneModelNode(entry: SceneModelEntry): FBXNode {
  const [tx, ty, tz] = entry.node.getTranslation();
  const [rx, ry, rz, rw] = entry.node.getRotation();
  const [sx, sy, sz] = entry.node.getScale();
  const euler = new Euler().setFromQuaternion(new Quaternion(rx, ry, rz, rw), "XYZ");
  return node(
    "Model",
    [
      long(entry.id),
      string(`Model::${entry.name}`),
      string(entry.node.getMesh() ? "Mesh" : "LimbNode"),
    ],
    [
      single("Version", int(232)),
      node("Properties70", [], [
        property("Lcl Translation", "Lcl Translation", [double(round(tx)), double(round(ty)), double(round(tz))]),
        property("Lcl Rotation", "Lcl Rotation", [
          double(round(radiansToDegrees(euler.x))),
          double(round(radiansToDegrees(euler.y))),
          double(round(radiansToDegrees(euler.z))),
        ]),
        property("Lcl Scaling", "Lcl Scaling", [double(round(sx)), double(round(sy)), double(round(sz))]),
      ]),
    ],
  );
}

function appendMeshObjects(
  entry: SceneModelEntry,
  entryByNode: ReadonlyMap<GltfDocumentNode, SceneModelEntry>,
  ids: { next: number },
  objects: FBXNode[],
  connections: FBXNode[],
) {
  const mesh = entry.node.getMesh();
  if (!mesh) {
    return;
  }

  const meshWorld = entry.node.getWorldMatrix();
  for (const [primIndex, primitive] of mesh.listPrimitives().entries()) {
    const positions = primitive.getAttribute("POSITION")?.getArray();
    if (!positions || positions.length === 0) {
      continue;
    }

    // FBX models carry a single geometry, so extra primitives become
    // identity-transform child models under the mesh model.
    let modelId = entry.id;
    if (primIndex > 0) {
      modelId = ids.next++;
      objects.push(
        node(
          "Model",
          [long(modelId), string(`Model::${entry.name}-part-${primIndex}`), string("Mesh")],
          [
            single("Version", int(232)),
            node("Properties70", [], [
              property("Lcl Translation", "Lcl Translation", [double(0), double(0), double(0)]),
              property("Lcl Rotation", "Lcl Rotation", [double(0), double(0), double(0)]),
              property("Lcl Scaling", "Lcl Scaling", [double(1), double(1), double(1)]),
            ]),
          ],
        ),
      );
      connections.push(node("C", [string("OO"), long(modelId), long(entry.id)]));
    }

    const geometryId = ids.next++;
    objects.push(
      createGeometryNode(primitive, geometryId, `${entry.name}-${primIndex}`, positions),
    );
    connections.push(node("C", [string("OO"), long(geometryId), long(modelId)]));

    const material = primitive.getMaterial();
    const materialId = ids.next++;
    const baseColor = material?.getBaseColorFactor() ?? [0.8, 0.8, 0.8, 1];
    const materialName = material?.getName() || `${entry.name}-material-${primIndex}`;
    objects.push(
      node("Material", [long(materialId), string(`Material::${materialName}`), string("")], [
        single("Version", int(102)),
        single("ShadingModel", string("lambert")),
        single("MultiLayer", int(0)),
        node("Properties70", [], [
          property("DiffuseColor", "Color", [
            double(round(baseColor[0])),
            double(round(baseColor[1])),
            double(round(baseColor[2])),
          ]),
        ]),
      ]),
    );
    connections.push(node("C", [string("OO"), long(materialId), long(modelId)]));
    appendMaterialTextureObjects(material?.getBaseColorTexture() ?? null, materialName, materialId, ids, objects, connections);

    appendSkinObjects({
      connections,
      entry,
      entryByNode,
      geometryId,
      ids,
      meshWorld,
      objects,
      primitive,
    });
  }
}

function appendMaterialTextureObjects(
  texture: GltfTexture | null,
  materialName: string,
  materialId: number,
  ids: { next: number },
  objects: FBXNode[],
  connections: FBXNode[],
) {
  const image = texture?.getImage();
  if (!texture || !image) {
    return;
  }

  const textureId = ids.next++;
  const videoId = ids.next++;
  const filename = `${sanitizeFBXFilename(texture.getURI() || texture.getName() || materialName || "texture")}.${textureExtension(texture)}`;
  objects.push(
    node("Video", [long(videoId), string(`Video::${filename}`), string("Clip")], [
      single("Type", string("Clip")),
      single("Filename", string(filename)),
      single("RelativeFilename", string(filename)),
      single("Content", raw(image)),
    ]),
    node("Texture", [long(textureId), string(`Texture::${filename}`), string("TextureVideoClip")], [
      single("Type", string("TextureVideoClip")),
      single("Version", int(202)),
      single("TextureName", string(`Texture::${filename}`)),
      single("FileName", string(filename)),
      single("RelativeFilename", string(filename)),
    ]),
  );
  connections.push(
    node("C", [string("OP"), long(textureId), long(materialId), string("DiffuseColor")]),
    node("C", [string("OO"), long(videoId), long(textureId)]),
  );
}

function sanitizeFBXFilename(value: string) {
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

function createGeometryNode(
  primitive: GltfPrimitive,
  geometryId: number,
  name: string,
  positions: ArrayLike<number>,
): FBXNode {
  const vertexCount = positions.length / 3;
  const indices = primitive.getIndices()?.getArray()
    ?? Array.from({ length: vertexCount }, (_, index) => index);
  const polygonIndices: number[] = [];
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const first = indices[index];
    const second = indices[index + 1];
    const third = indices[index + 2];
    if (first === undefined || second === undefined || third === undefined) {
      continue;
    }
    polygonIndices.push(first, second, third ^ -1);
  }

  const normals = primitive.getAttribute("NORMAL")?.getArray();
  const uvs = primitive.getAttribute("TEXCOORD_0")?.getArray();
  const layerEntries: FBXNode[] = [];
  const children: FBXNode[] = [
    single("GeometryVersion", int(124)),
    single("Vertices", doubleArray(Array.from(positions))),
    single("PolygonVertexIndex", intArray(polygonIndices)),
  ];

  if (normals && normals.length === positions.length) {
    children.push(
      node("LayerElementNormal", [int(0)], [
        single("Version", int(101)),
        single("Name", string("")),
        single("MappingInformationType", string("ByVertice")),
        single("ReferenceInformationType", string("Direct")),
        single("Normals", doubleArray(Array.from(normals))),
      ]),
    );
    layerEntries.push(createLayerElementRef("LayerElementNormal"));
  }
  if (uvs && uvs.length === vertexCount * 2) {
    children.push(
      node("LayerElementUV", [int(0)], [
        single("Version", int(101)),
        single("Name", string("uv0")),
        single("MappingInformationType", string("ByVertice")),
        single("ReferenceInformationType", string("Direct")),
        single("UV", doubleArray(Array.from(uvs))),
      ]),
    );
    layerEntries.push(createLayerElementRef("LayerElementUV"));
  }
  children.push(
    node("LayerElementMaterial", [int(0)], [
      single("Version", int(101)),
      single("Name", string("")),
      single("MappingInformationType", string("AllSame")),
      single("ReferenceInformationType", string("IndexToDirect")),
      single("Materials", intArray([0])),
    ]),
  );
  layerEntries.push(createLayerElementRef("LayerElementMaterial"));
  children.push(
    node("Layer", [int(0)], [single("Version", int(100)), ...layerEntries]),
  );

  return node(
    "Geometry",
    [long(geometryId), string(`Geometry::${name}`), string("Mesh")],
    children,
  );
}

function createLayerElementRef(type: string): FBXNode {
  return node("LayerElement", [], [
    single("Type", string(type)),
    single("TypedIndex", int(0)),
  ]);
}

function appendSkinObjects({
  connections,
  entry,
  entryByNode,
  geometryId,
  ids,
  meshWorld,
  objects,
  primitive,
}: {
  connections: FBXNode[];
  entry: SceneModelEntry;
  entryByNode: ReadonlyMap<GltfDocumentNode, SceneModelEntry>;
  geometryId: number;
  ids: { next: number };
  meshWorld: ArrayLike<number>;
  objects: FBXNode[];
  primitive: GltfPrimitive;
}) {
  const skin = entry.node.getSkin();
  const jointsAttribute = primitive.getAttribute("JOINTS_0");
  const weightsAttribute = primitive.getAttribute("WEIGHTS_0");
  if (!skin || !jointsAttribute || !weightsAttribute) {
    return;
  }

  const joints = skin.listJoints();
  if (joints.length === 0) {
    return;
  }

  const perJoint = joints.map(() => ({ indices: [] as number[], weights: [] as number[] }));
  const jointElement: number[] = [];
  const weightElement: number[] = [];
  for (let vertex = 0; vertex < jointsAttribute.getCount(); vertex += 1) {
    jointsAttribute.getElement(vertex, jointElement);
    weightsAttribute.getElement(vertex, weightElement);
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = weightElement[slot] ?? 0;
      const jointData = perJoint[jointElement[slot] ?? -1];
      if (weight > 0 && jointData) {
        jointData.indices.push(vertex);
        jointData.weights.push(weight);
      }
    }
  }

  const skinId = ids.next++;
  objects.push(
    node("Deformer", [long(skinId), string(`Deformer::${entry.name}-skin`), string("Skin")], [
      single("Version", int(100)),
      single("Link_DeformAcuracy", double(50)),
    ]),
  );
  connections.push(node("C", [string("OO"), long(skinId), long(geometryId)]));

  const inverseBindMatrices = skin.getInverseBindMatrices()?.getArray();
  for (const [jointIndex, joint] of joints.entries()) {
    const jointEntry = entryByNode.get(joint);
    if (!jointEntry) {
      continue;
    }

    // Clusters are emitted for every joint (even zero-weight ones) so the
    // reloaded skeleton has no holes in its bone list.
    const transformLink =
      inverseBindMatrices && inverseBindMatrices.length >= (jointIndex + 1) * 16
        ? new Matrix4()
            .fromArray(Array.from(inverseBindMatrices).slice(jointIndex * 16, jointIndex * 16 + 16))
            .invert()
            .toArray()
        : joint.getWorldMatrix();
    const clusterId = ids.next++;
    const jointWeights = perJoint[jointIndex];
    if (!jointWeights) {
      throw new Error(`Missing FBX skin weights for joint ${jointIndex}.`);
    }
    objects.push(
      node("Deformer", [long(clusterId), string(`SubDeformer::${jointEntry.name}`), string("Cluster")], [
        single("Version", int(100)),
        node("UserData", [string(""), string("")]),
        single("Indexes", intArray(jointWeights.indices)),
        single("Weights", doubleArray(jointWeights.weights)),
        single("Transform", doubleArray(Array.from(meshWorld))),
        single("TransformLink", doubleArray(Array.from(transformLink))),
      ]),
    );
    connections.push(
      node("C", [string("OO"), long(clusterId), long(skinId)]),
      node("C", [string("OO"), long(jointEntry.id), long(clusterId)]),
    );
  }
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function round(value: number) {
  return Number(value.toFixed(6));
}

class FBXBinaryWriter {
  private buf = new GrowableBuffer();
  private encoder = new TextEncoder();

  get offset() {
    return this.buf.offset;
  }

  writeNode(item: FBXNode) {
    const nameBytes = this.encoder.encode(item.name);
    const properties = item.properties ?? [];
    const children = item.children ?? [];
    const startOffset = this.offset;
    this.buf.writeUint32(0);
    this.buf.writeUint32(properties.length);
    const propertyListLengthOffset = this.offset;
    this.buf.writeUint32(0);
    this.buf.writeUint8(nameBytes.length);
    this.buf.writeBytes(nameBytes);

    const propertyStart = this.offset;
    for (const property of properties) {
      this.writeProperty(property);
    }
    this.buf.patchUint32(propertyListLengthOffset, this.offset - propertyStart);

    for (const child of children) {
      this.writeNode(child);
    }
    if (children.length > 0) {
      this.writeNullRecord();
    }
    this.buf.patchUint32(startOffset, this.offset);
  }

  writeNullRecord() {
    for (let index = 0; index < FBX_NULL_RECORD_LENGTH; index += 1) {
      this.buf.writeUint8(0);
    }
  }

  writeFooter(version: number) {
    for (const value of FOOTER_MAGIC_A) {
      this.buf.writeUint8(value);
    }
    const padding = 16 - (this.offset % 16);
    for (let index = 0; index < padding; index += 1) {
      this.buf.writeUint8(0);
    }
    for (const value of FOOTER_MAGIC_B) {
      this.buf.writeUint8(value);
    }
    this.buf.writeUint32(version);
    for (let index = 0; index < 120; index += 1) {
      this.buf.writeUint8(0);
    }
    for (const value of FOOTER_MAGIC_C) {
      this.buf.writeUint8(value);
    }
  }

  writeProperty(property: FBXProperty) {
    this.buf.writeAscii(property.type);
    if (property.type === "C") {
      this.buf.writeUint8(property.value ? 1 : 0);
    } else if (property.type === "D") {
      this.buf.writeFloat64(property.value);
    } else if (property.type === "F") {
      this.buf.writeFloat32(property.value);
    } else if (property.type === "I") {
      this.buf.writeInt32(property.value);
    } else if (property.type === "L") {
      this.buf.writeInt64(property.value);
    } else if (property.type === "R") {
      this.buf.writeUint32(property.value.length);
      this.buf.writeBytes(property.value);
    } else if (property.type === "S") {
      const encoded = this.encoder.encode(property.value);
      this.buf.writeUint32(encoded.length);
      this.buf.writeBytes(encoded);
    } else {
      this.writeArrayProperty(property.type, property.value);
    }
  }

  writeArrayProperty(type: "d" | "f" | "i" | "l", values: number[]) {
    this.buf.writeUint32(values.length);
    this.buf.writeUint32(0);
    const byteLength = values.length * (type === "l" || type === "d" ? 8 : 4);
    this.buf.writeUint32(byteLength);
    for (const value of values) {
      if (type === "d") {
        this.buf.writeFloat64(value);
      } else if (type === "f") {
        this.buf.writeFloat32(value);
      } else if (type === "i") {
        this.buf.writeInt32(value);
      } else {
        this.buf.writeInt64(value);
      }
    }
  }

  writeAscii(value: string) {
    this.buf.writeAscii(value);
  }

  writeUint32(value: number) {
    this.buf.writeUint32(value);
  }

  toUint8Array() {
    return this.buf.toUint8Array();
  }
}
