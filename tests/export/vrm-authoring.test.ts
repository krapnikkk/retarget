import { Accessor, Document, WebIO, type Node as GltfNode } from "@gltf-transform/core";
import {
  VRMCVRM,
  VRMC_VRM_EXTENSIONS,
  VRM_REQUIRED_HUMAN_BONE_NAMES,
  assertVRMDocument,
  isVRMDocument,
} from "gltf-transform-vrm-extensions";
import { describe, expect, it } from "vitest";
import { authorCanonicalGLBAsVRM } from "@/export/vrm-authoring";

type ReadableVRMExtension = VRMCVRM & {
  data?: {
    meta?: Record<string, unknown>;
  };
};

describe("VRM authoring", () => {
  it("authors a canonical character GLB as a reloadable VRM", async () => {
    const bytes = await authorCanonicalGLBAsVRM(createCharacterDocument({ textured: true }), {
      name: "Test Character",
      author: "Rig Team",
      license: "CC0-1.0",
      sourceUrl: "https://example.com/test-character",
    });
    const document = await new WebIO()
      .registerExtensions(VRMC_VRM_EXTENSIONS)
      .readBinary(bytes);
    const extension = getVRMExtension(document);
    const meta = (extension as ReadableVRMExtension).data?.meta;

    expect(isVRMDocument(document)).toBe(true);
    expect(() => assertVRMDocument(document)).not.toThrow();
    expect(document.getRoot().listTextures()).toHaveLength(1);
    for (const bone of VRM_REQUIRED_HUMAN_BONE_NAMES) {
      expect(extension.getHumanoidBoneNodes().get(bone)?.getName()).toBe(bone);
    }
    expect(meta).toMatchObject({
      name: "Test Character",
      authors: ["Rig Team"],
      licenseUrl: "https://vrm.dev/licenses/1.0/",
      copyrightInformation: "Rig Team; CC0 1.0",
      references: ["https://example.com/test-character"],
      thirdPartyLicenses: "CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/",
      otherLicenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      creditNotation: "unnecessary",
      allowPoliticalOrReligiousUsage: true,
      allowAntisocialOrHateUsage: true,
      allowRedistribution: true,
      modification: "allowModificationRedistribution",
      allowExcessivePolygonTriangle: true,
      allowExcessiveDeformation: true,
      allowExcessiveTransparency: true,
      allowExcessiveBlendshapes: true,
    });
  });

  it("maps CC BY 4.0 into redistributable commercial VRM permissions", async () => {
    const bytes = await authorCanonicalGLBAsVRM(createCharacterDocument(), {
      name: "Attributed Character",
      author: "Rig Team",
      license: "CC-BY-4.0",
      sourceUrl: "https://example.com/attributed-character",
    });
    const document = await new WebIO()
      .registerExtensions(VRMC_VRM_EXTENSIONS)
      .readBinary(bytes);
    const meta = (getVRMExtension(document) as ReadableVRMExtension).data?.meta;

    expect(meta).toMatchObject({
      authors: ["Rig Team"],
      thirdPartyLicenses: "CC BY 4.0: https://creativecommons.org/licenses/by/4.0/",
      otherLicenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      creditNotation: "required",
      allowRedistribution: true,
      modification: "allowModificationRedistribution",
    });
  });

  it("rejects canonical GLBs missing a required humanoid bone", async () => {
    await expect(
      authorCanonicalGLBAsVRM(createCharacterDocument({ omit: "leftHand" }), {
        name: "Broken Character",
        author: "Rig Team",
        license: "CC0-1.0",
      }),
    ).rejects.toThrow(/missing required humanoid bones leftHand/);
  });
});

function getVRMExtension(document: Document) {
  const extension = document
    .getRoot()
    .listExtensionsUsed()
    .find((item): item is VRMCVRM => item.extensionName === VRMCVRM.EXTENSION_NAME);
  if (!extension) {
    throw new Error("Missing VRMC_vrm extension.");
  }
  return extension;
}

function createCharacterDocument(options: { omit?: string; textured?: boolean } = {}) {
  const document = new Document();
  const buffer = document.createBuffer("buffer");
  const scene = document.createScene("scene");
  document.getRoot().setDefaultScene(scene);

  const bones = createRequiredBoneNodes(document, options.omit);
  scene.addChild(bones.get("hips")!);

  const skin = document.createSkin("skin").setSkeleton(bones.get("hips")!);
  for (const bone of VRM_REQUIRED_HUMAN_BONE_NAMES) {
    const node = bones.get(bone);
    if (node) {
      skin.addJoint(node);
    }
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

  const material = document.createMaterial("material").setBaseColorFactor([1, 1, 1, 1]);
  if (options.textured) {
    material.setBaseColorTexture(
      document
        .createTexture("base-color")
        .setURI("base-color.png")
        .setMimeType("image/png")
        .setImage(PNG_1X1),
    );
  }

  const primitive = document
    .createPrimitive()
    .setAttribute(
      "POSITION",
      document
        .createAccessor("POSITION")
        .setType(Accessor.Type.VEC3)
        .setArray(new Float32Array([0, 1, 0, 0.1, 1, 0, 0, 1.1, 0]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      document
        .createAccessor("NORMAL")
        .setType(Accessor.Type.VEC3)
        .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "TEXCOORD_0",
      document
        .createAccessor("TEXCOORD_0")
        .setType(Accessor.Type.VEC2)
        .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "JOINTS_0",
      document
        .createAccessor("JOINTS_0")
        .setType(Accessor.Type.VEC4)
        .setArray(new Uint16Array([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "WEIGHTS_0",
      document
        .createAccessor("WEIGHTS_0")
        .setType(Accessor.Type.VEC4)
        .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
        .setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor("indices")
        .setType(Accessor.Type.SCALAR)
        .setArray(new Uint16Array([0, 1, 2]))
        .setBuffer(buffer),
    )
    .setMaterial(material);

  const mesh = document.createMesh("mesh").addPrimitive(primitive);
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

function createRequiredBoneNodes(document: Document, omit?: string) {
  const nodes = new Map<string, GltfNode>();
  for (const bone of VRM_REQUIRED_HUMAN_BONE_NAMES) {
    if (bone !== omit) {
      nodes.set(bone, document.createNode(bone));
    }
  }

  nodes.get("hips")?.setTranslation([0, 1, 0]);
  nodes.get("spine")?.setTranslation([0, 0.35, 0]);
  nodes.get("head")?.setTranslation([0, 0.55, 0]);
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
  addChild(nodes, "spine", "head");
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
