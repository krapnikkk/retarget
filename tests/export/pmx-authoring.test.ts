import { Accessor, Document, type Node as GltfNode } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { parsePMX } from "@/export/avatar-conversion";
import { MMD_EXPORT_BONE_NAMES } from "@/export/bone-naming";
import {
  authorCanonicalGLBAsPMX,
  authorCanonicalGLBAsPMXBundle,
} from "@/export/pmx-authoring";
import { readZipArchive } from "@/export/zip";
import { REQUIRED_VRM_BONES, type HumanoidBoneName } from "@/retarget";

const MMD_BONE_NAMES = MMD_EXPORT_BONE_NAMES as Partial<
  Record<HumanoidBoneName, string>
>;

describe("PMX authoring", () => {
  it("authors a canonical character GLB as a reloadable PMX model", async () => {
    const bytes = await authorCanonicalGLBAsPMX(createCharacterDocument(), {
      name: "Test Character",
      author: "Rig Team",
      license: "CC0",
    });
    const parsed = parsePMX(bytes);
    const parsedBoneNames = new Set(parsed.bones.map((bone) => bone.name));

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("PMX ");
    expect(parsed.positions).toHaveLength(9);
    expect(parsed.materials).toHaveLength(1);
    expect(parsed.textures).toHaveLength(0);
    expect(parsed.materials[0].textureIndex).toBe(-1);
    expect(parsed.bones).toHaveLength(REQUIRED_VRM_BONES.length);
    for (const bone of REQUIRED_VRM_BONES) {
      expect(parsedBoneNames.has(MMD_BONE_NAMES[bone]!)).toBe(true);
    }
  });

  it("rejects canonical GLBs missing a required MMD-mapped humanoid bone", async () => {
    await expect(
      authorCanonicalGLBAsPMX(createCharacterDocument({ omit: "leftHand" }), {
        name: "Broken Character",
        author: "Rig Team",
        license: "CC0",
      }),
    ).rejects.toThrow(/missing required MMD-mapped humanoid bones leftHand/);
  });

  it("preserves the MMD upper-body-3 mapping and its skin weights", async () => {
    const bytes = await authorCanonicalGLBAsPMX(
      createCharacterDocument({ includeUpperChest: true }),
      {
        name: "Upper Chest Character",
        author: "Rig Team",
        license: "CC0",
      },
    );
    const parsed = parsePMX(bytes);
    const upperChestIndex = parsed.bones.findIndex(
      (bone) => bone.name === MMD_BONE_NAMES.upperChest,
    );
    const head = parsed.bones.find((bone) => bone.name === MMD_BONE_NAMES.head);

    expect(parsed.bones).toHaveLength(REQUIRED_VRM_BONES.length + 1);
    expect(upperChestIndex).toBeGreaterThanOrEqual(0);
    expect(head?.parentIndex).toBe(upperChestIndex);
    expect(Array.from(parsed.joints.slice(0, 4))).toEqual([
      upperChestIndex,
      0,
      0,
      0,
    ]);
    expect(Array.from(parsed.weights.slice(0, 4))).toEqual([1, 0, 0, 0]);
  });

  it("bundles an embedded baseColorTexture beside the PMX model", async () => {
    const bytes = await authorCanonicalGLBAsPMXBundle(
      createCharacterDocument({ textureMode: "single" }),
      {
        name: "Textured Character",
        author: "Rig Team",
        license: "CC0",
      },
    );
    const entries = readZipArchive(bytes);
    const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
    const pmx = entryByName.get("model.pmx");
    const texture = entryByName.get("skin.png");

    expect([...entryByName.keys()].sort()).toEqual(["model.pmx", "skin.png"]);
    expect(texture?.bytes).toEqual(PNG_1X1);

    const parsed = parsePMX(pmx!.bytes);
    expect(parsed.textures).toEqual(["skin.png"]);
    expect(parsed.materials).toHaveLength(1);
    expect(parsed.materials[0].textureIndex).toBe(0);
  });

  it("dedupes a shared baseColorTexture across PMX materials", async () => {
    const bytes = await authorCanonicalGLBAsPMXBundle(
      createCharacterDocument({ textureMode: "shared" }),
      {
        name: "Shared Texture Character",
        author: "Rig Team",
        license: "CC0",
      },
    );
    const entries = readZipArchive(bytes);
    const parsed = parsePMX(entries.find((entry) => entry.name === "model.pmx")!.bytes);

    expect(entries.map((entry) => entry.name).sort()).toEqual(["model.pmx", "skin.png"]);
    expect(parsed.textures).toEqual(["skin.png"]);
    expect(parsed.materials).toHaveLength(2);
    expect(parsed.materials.map((material) => material.textureIndex)).toEqual([0, 0]);
  });
});

function createCharacterDocument(
  options: {
    includeUpperChest?: boolean;
    omit?: HumanoidBoneName;
    textureMode?: "single" | "shared";
  } = {},
) {
  const document = new Document();
  const buffer = document.createBuffer("buffer");
  const scene = document.createScene("scene");
  document.getRoot().setDefaultScene(scene);

  const bones = createRequiredBoneNodes(document, options);
  scene.addChild(bones.get("hips")!);

  const skin = document.createSkin("skin").setSkeleton(bones.get("hips")!);
  for (const bone of REQUIRED_VRM_BONES) {
    const node = bones.get(bone);
    if (node) {
      skin.addJoint(node);
    }
  }
  const upperChest = bones.get("upperChest");
  if (upperChest) {
    skin.addJoint(upperChest);
  }
  skin.setInverseBindMatrices(
    document
      .createAccessor("inverseBindMatrices")
      .setType(Accessor.Type.MAT4)
      .setArray(new Float32Array(skin.listJoints().length * 16).map((_, index) =>
        index % 5 === 0 ? 1 : 0,
      ))
      .setBuffer(buffer),
  );

  const upperChestJoint = upperChest ? skin.listJoints().indexOf(upperChest) : 0;
  const positionAccessor = document
    .createAccessor("POSITION")
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 1, 0, 0.1, 1, 0, 0, 1.1, 0]))
    .setBuffer(buffer);
  const normalAccessor = document
    .createAccessor("NORMAL")
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const uvAccessor = document
    .createAccessor("TEXCOORD_0")
    .setType(Accessor.Type.VEC2)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const jointsAccessor = document
    .createAccessor("JOINTS_0")
    .setType(Accessor.Type.VEC4)
    .setArray(new Uint16Array([
      upperChestJoint, 0, 0, 0,
      0, 1, 2, 3,
      0, 1, 2, 3,
    ]))
    .setBuffer(buffer);
  const weightsAccessor = document
    .createAccessor("WEIGHTS_0")
    .setType(Accessor.Type.VEC4)
    .setArray(new Float32Array([
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
    ]))
    .setBuffer(buffer);
  const indicesAccessor = document
    .createAccessor("indices")
    .setType(Accessor.Type.SCALAR)
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);

  const sharedTexture = options.textureMode
    ? document
        .createTexture("skin")
        .setURI("skin.png")
        .setMimeType("image/png")
        .setImage(PNG_1X1)
    : null;
  const createMaterial = (name: string) => {
    const material = document
      .createMaterial(name)
      .setBaseColorFactor([0.8, 0.6, 0.4, 1])
      .setDoubleSided(true);
    if (sharedTexture) {
      material.setBaseColorTexture(sharedTexture);
    }
    return material;
  };
  const createPrimitive = (materialName: string) => document
    .createPrimitive()
    .setAttribute("POSITION", positionAccessor)
    .setAttribute("NORMAL", normalAccessor)
    .setAttribute("TEXCOORD_0", uvAccessor)
    .setAttribute("JOINTS_0", jointsAccessor)
    .setAttribute("WEIGHTS_0", weightsAccessor)
    .setIndices(indicesAccessor)
    .setMaterial(createMaterial(materialName));

  const mesh = document.createMesh("mesh").addPrimitive(createPrimitive("material"));
  if (options.textureMode === "shared") {
    mesh.addPrimitive(createPrimitive("material-copy"));
  }
  scene.addChild(document.createNode("mesh-node").setMesh(mesh).setSkin(skin));

  return document;
}

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function createRequiredBoneNodes(
  document: Document,
  options: { includeUpperChest?: boolean; omit?: HumanoidBoneName },
) {
  const nodes = new Map<string, GltfNode>();
  for (const bone of REQUIRED_VRM_BONES) {
    if (bone !== options.omit) {
      nodes.set(bone, document.createNode(bone));
    }
  }
  if (options.includeUpperChest) {
    nodes.set("upperChest", document.createNode("upperChest"));
  }

  nodes.get("hips")?.setTranslation([0, 1, 0]);
  nodes.get("spine")?.setTranslation([0, 0.35, 0]);
  nodes.get("upperChest")?.setTranslation([0, 0.25, 0]);
  nodes.get("head")?.setTranslation([0, 0.3, 0]);
  nodes.get("leftUpperArm")?.setTranslation([-0.25, 0.3, 0]);
  nodes.get("leftLowerArm")?.setTranslation([-0.35, 0, 0]);
  nodes.get("leftHand")?.setTranslation([-0.25, 0, 0]);
  nodes.get("rightUpperArm")?.setTranslation([0.25, 0.3, 0]);
  nodes.get("rightLowerArm")?.setTranslation([0.35, 0, 0]);
  nodes.get("rightHand")?.setTranslation([0.25, 0, 0]);
  nodes.get("leftUpperLeg")?.setTranslation([-0.12, -0.45, 0]);
  nodes.get("leftLowerLeg")?.setTranslation([0, -0.45, 0]);
  nodes.get("leftFoot")?.setTranslation([0, -0.1, -0.2]);
  nodes.get("rightUpperLeg")?.setTranslation([0.12, -0.45, 0]);
  nodes.get("rightLowerLeg")?.setTranslation([0, -0.45, 0]);
  nodes.get("rightFoot")?.setTranslation([0, -0.1, -0.2]);

  addChild(nodes, "hips", "spine");
  if (options.includeUpperChest) {
    addChild(nodes, "spine", "upperChest");
    addChild(nodes, "upperChest", "head");
  } else {
    addChild(nodes, "spine", "head");
  }
  addChild(nodes, "spine", "leftUpperArm");
  addChild(nodes, "leftUpperArm", "leftLowerArm");
  addChild(nodes, "leftLowerArm", "leftHand");
  addChild(nodes, "spine", "rightUpperArm");
  addChild(nodes, "rightUpperArm", "rightLowerArm");
  addChild(nodes, "rightLowerArm", "rightHand");
  addChild(nodes, "hips", "leftUpperLeg");
  addChild(nodes, "leftUpperLeg", "leftLowerLeg");
  addChild(nodes, "leftLowerLeg", "leftFoot");
  addChild(nodes, "hips", "rightUpperLeg");
  addChild(nodes, "rightUpperLeg", "rightLowerLeg");
  addChild(nodes, "rightLowerLeg", "rightFoot");

  return nodes;
}

function addChild(
  nodes: ReadonlyMap<string, GltfNode>,
  parent: string,
  child: string,
) {
  const parentNode = nodes.get(parent);
  const childNode = nodes.get(child);
  if (parentNode && childNode) {
    parentNode.addChild(childNode);
  }
}
