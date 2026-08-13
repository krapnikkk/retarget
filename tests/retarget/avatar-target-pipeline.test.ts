import { Document, WebIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { bindMotionClipToAvatar } from "@/browser/avatar-target-pipeline";
import { createImportedHumanoidMotionClip } from "@/import/humanoid-motion";
import { BVH_HUMANOID_PROFILE } from "@/profiles";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";

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
  });

  it("bakes imported motion tracks through the custom rig solver when binding a target", async () => {
    const sourceValues = [0.707107, 0, 0, 0.707107, 0.707107, 0, 0, 0.707107];
    const clip = createImportedHumanoidMotionClip({
      kind: "bvh",
      filename: "walk.bvh",
      profile: BVH_HUMANOID_PROFILE,
      tracks: [
        {
          bone: "spine",
          path: "rotation",
          times: [0, 1],
          values: sourceValues,
        },
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
});

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

  scene.addChild(hips);
  hips.addChild(spine);
  spine.addChild(head).addChild(leftUpperArm).addChild(rightUpperArm);

  return new WebIO().writeBinary(document);
}
