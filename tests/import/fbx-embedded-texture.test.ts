import { Document, type Node as GltfNode } from "@gltf-transform/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFBXAvatarSceneBinary } from "@/export/fbx";
import { runRetargetJobInline } from "@/jobs/browser-retarget-job";
import { resolveExportBoneName } from "@/profiles/bone-naming";
import type { HumanoidBoneName } from "@/retarget";
import { solveHumanoidCustomRigMotion } from "@/solvers";
import {
  bindSolvedMotionClipStub,
  createRetargetedMotionClipStub,
} from "../fixtures/retarget-stub";

// A 1x1 RGBA PNG. FBXLoader only needs non-empty embedded `Video.Content`.
const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

const HIERARCHY: ReadonlyArray<[HumanoidBoneName, HumanoidBoneName | null]> = [
  ["hips", null],
  ["spine", "hips"],
  ["leftUpperArm", "spine"],
  ["rightUpperArm", "spine"],
  ["leftUpperLeg", "hips"],
  ["rightUpperLeg", "hips"],
];

describe("FBX motion import with embedded textures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("imports a Mixamo-style With Skin FBX like its texture-free variant", async () => {
    // Node and Worker globals both lack `window`; this mirrors the Worker path.
    expect("window" in globalThis).toBe(false);
    const createObjectURL = vi.spyOn(URL, "createObjectURL");

    const withoutSkin = await importMixamoFBX(createMixamoFBX({ texture: false }));
    const withSkin = await importMixamoFBX(createMixamoFBX({ texture: true }));

    expect(withSkin.tracks.length).toBeGreaterThan(0);
    expect(withSkin.duration).toBe(withoutSkin.duration);
    expect(withSkin.tracks).toEqual(withoutSkin.tracks);
    // The scoped shim must not leak globals or create blob URLs.
    expect("window" in globalThis).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

function createMixamoFBX({ texture }: { texture: boolean }) {
  const canonical = createRetargetedMotionClipStub({
    fbxFile: { name: "walk.fbx" },
    vrmFile: { name: "avatar.vrm" },
  });
  const clip = bindSolvedMotionClipStub(solveHumanoidCustomRigMotion(canonical), {
    rigSignature: "mixamo-texture-fixture",
  });

  const document = new Document();
  const scene = document.createScene("Scene");
  document.getRoot().setDefaultScene(scene);
  const nodes = new Map<HumanoidBoneName, GltfNode>();
  for (const [bone, parent] of HIERARCHY) {
    const node = document
      .createNode(resolveExportBoneName(bone, "mixamo"))
      .setTranslation(parent ? [0, 0.25, 0] : [0, 1, 0]);
    nodes.set(bone, node);
    if (parent) nodes.get(parent)!.addChild(node);
    else scene.addChild(node);
  }

  const buffer = document.createBuffer();
  const position = document
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const material = document.createMaterial("Body");
  if (texture) {
    material.setBaseColorTexture(
      document
        .createTexture("Body_diffuse")
        .setMimeType("image/png")
        .setImage(PNG_1X1),
    );
  }
  const mesh = document
    .createMesh("Body")
    .addPrimitive(
      document.createPrimitive().setAttribute("POSITION", position).setMaterial(material),
    );
  scene.addChild(document.createNode("Body").setMesh(mesh));

  return createFBXAvatarSceneBinary(document, nodes, clip);
}

async function importMixamoFBX(bytes: Uint8Array) {
  return runRetargetJobInline({
    type: "import-motion",
    formatId: "mixamo-fbx",
    filename: "motion.fbx",
    bytes: Uint8Array.from(bytes).buffer,
  });
}
