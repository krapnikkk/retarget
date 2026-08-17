import { Document, WebIO } from "@gltf-transform/core";
import { describe, expect, it, vi } from "vitest";
import { bindMotionClipToAvatar } from "@/browser/avatar-target-pipeline";
import { createImportedHumanoidMotionClip } from "@/import/humanoid-motion";
import { BVH_HUMANOID_PROFILE } from "@/profiles";
import { LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES } from "@/jobs/asset-input-safety";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

describe("avatar target binding", () => {
  it("binds an imported motion clip to a glTF humanoid avatar rig", async () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "pending.vrm" },
      fbxFile: { name: "idle.fbx" },
    });
    const avatarFile = new File([await createMinimalHumanoidGLB()], "avatar.glb", {
      type: "model/gltf-binary",
    });

    const boundClip = await bindMotionClipToAvatar({
      avatarFile,
      avatarFormatId: "gltf-humanoid",
      clip,
    });

    expect(boundClip.target).toMatchObject({
      kind: "gltf-humanoid",
      filename: "avatar.glb",
      profile: "generic-gltf-humanoid",
      pending: false,
    });
    expect(boundClip.target.rigSignature).toMatch(/^humanoid-rest-v1:/);
  });

  it("bakes imported motion tracks through the custom rig solver when binding a target", async () => {
    const sourceValues = [0.707107, 0, 0, 0.707107, 0.707107, 0, 0, 0.707107];
    const clip = createImportedHumanoidMotionClip({
      kind: "bvh",
      filename: "walk.bvh",
      profile: BVH_HUMANOID_PROFILE,
      tracks: [
        {
          bone: "hips",
          path: "translation",
          times: [0, 1],
          values: [0, 0, 0, 0, 0, 0],
        },
        {
          bone: "spine",
          path: "rotation",
          times: [0, 1],
          values: sourceValues,
        },
        ...[
          "leftUpperArm",
          "rightUpperArm",
          "leftUpperLeg",
          "rightUpperLeg",
        ].map((bone) => ({
          bone: bone as "leftUpperArm" | "rightUpperArm" | "leftUpperLeg" | "rightUpperLeg",
          path: "rotation" as const,
          times: [0, 1],
          values: [0, 0, 0, 1, 0, 0, 0, 1],
        })),
      ],
    });
    const avatarFile = new File([await createMinimalHumanoidGLB()], "avatar.glb", {
      type: "model/gltf-binary",
    });

    const boundClip = await bindMotionClipToAvatar({
      avatarFile,
      avatarFormatId: "gltf-humanoid",
      clip,
    });
    const spineTrack = boundClip.tracks.find(
      (track) => track.bone === "spine" && track.path === "rotation",
    );

    expect(boundClip.diagnostics?.solver.id).toBe("humanoid-custom-v4");
    expect(spineTrack?.values).not.toEqual(sourceValues);
    expect(boundClip.diagnostics?.assumptions.forwardAxisCorrection).toContain(
      "Solver v4 custom mapping",
    );
  });

  it("range-reads large GLB structure without eagerly reading the whole avatar", async () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "pending.vrm" },
      fbxFile: { name: "idle.fbx" },
    });
    const avatarFile = new VirtualLargeGLB(await createMinimalHumanoidGLB());

    const boundClip = await bindMotionClipToAvatar({
      avatarFile,
      avatarFormatId: "gltf-humanoid",
      clip,
    });

    expect(avatarFile.fullReadAttempts).toBe(0);
    expect(boundClip.target).toMatchObject({
      filename: "large-avatar.glb",
      profile: "generic-gltf-humanoid",
      pending: false,
    });
    expect(boundClip.target.rigSignature).toMatch(/^humanoid-rest-v1:/);
  });

  it("returns a structured target error for invalid large GLB structure", async () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "pending.vrm" },
      fbxFile: { name: "idle.fbx" },
    });

    await expect(bindMotionClipToAvatar({
      avatarFile: new VirtualLargeInvalidGLB(),
      avatarFormatId: "gltf-humanoid",
      clip,
    })).rejects.toMatchObject({ code: "TARGET_RIG_INVALID" });
  });
});

class VirtualLargeGLB extends File {
  readonly virtualSize = LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES;
  fullReadAttempts = 0;

  constructor(source: Uint8Array) {
    const bytes = source.slice();
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      8,
      LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES,
      true,
    );
    super([bytes], "large-avatar.glb", { type: "model/gltf-binary" });
  }

  override get size() {
    return this.virtualSize;
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    this.fullReadAttempts += 1;
    throw new Error("large avatar must not be read eagerly");
  }
}

class VirtualLargeInvalidGLB extends File {
  constructor() {
    super([new Uint8Array(20)], "invalid-large.glb");
  }

  override get size() {
    return LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES;
  }
}

async function createMinimalHumanoidGLB() {
  const document = new Document();
  const scene = document.createScene("scene");
  document.getRoot().setDefaultScene(scene);
  const hips = document.createNode("hips").setTranslation([0, 1, 0]);
  const spine = document.createNode("spine").setTranslation([0, 1.2, 0]);
  const head = document.createNode("head").setTranslation([0, 1.7, 0]);
  const leftUpperArm = document
    .createNode("leftUpperArm")
    .setTranslation([-0.35, 1.35, 0]);
  const rightUpperArm = document
    .createNode("rightUpperArm")
    .setTranslation([0.35, 1.35, 0]);
  const leftUpperLeg = document
    .createNode("leftUpperLeg")
    .setTranslation([-0.1, 0.9, 0]);
  const rightUpperLeg = document
    .createNode("rightUpperLeg")
    .setTranslation([0.1, 0.9, 0]);

  scene.addChild(hips);
  hips.addChild(spine).addChild(leftUpperLeg).addChild(rightUpperLeg);
  spine.addChild(head).addChild(leftUpperArm).addChild(rightUpperArm);

  return new WebIO().writeBinary(document);
}
