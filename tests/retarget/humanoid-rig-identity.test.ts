import { describe, expect, it } from "vitest";
import {
  assertHumanoidTargetIdentity,
  createHumanoidRigSignature,
} from "@/retarget";
import {
  bindSolvedMotionClipStub,
  createRetargetedMotionClipStub,
} from "../fixtures/retarget-stub";
import { solveHumanoidCustomRigMotion } from "@/solvers";

describe("humanoid target rig identity", () => {
  it("rejects exporting a solved clip to another semantic rig", () => {
    const rigA = createHumanoidRigSignature("generic-gltf-humanoid", [{
      bone: "hips",
      worldPosition: [0, 1, 0],
      worldQuaternion: [0, 0, 0, 1],
    }]);
    const rigB = createHumanoidRigSignature("generic-gltf-humanoid", [{
      bone: "hips",
      worldPosition: [0, 1.2, 0],
      worldQuaternion: [0, 0, 0, 1],
    }]);
    const canonical = createRetargetedMotionClipStub({
      fbxFile: { name: "walk.fbx" },
      vrmFile: { name: "avatar-a.glb" },
    });
    const solved = bindSolvedMotionClipStub(
      solveHumanoidCustomRigMotion(canonical),
      { filename: "avatar-a.glb", rigSignature: rigA },
    );

    expect(() => assertHumanoidTargetIdentity(solved, rigA)).not.toThrow();
    expect(() => assertHumanoidTargetIdentity(solved, rigB))
      .toThrow(expect.objectContaining({ code: "TARGET_RIG_MISMATCH" }));
  });
});
