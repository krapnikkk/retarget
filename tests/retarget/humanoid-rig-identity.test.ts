import { describe, expect, it } from "vitest";
import {
  assertHumanoidTargetIdentity,
  createHumanoidRigSignature,
} from "@/retarget";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";

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
    const solved = {
      ...canonical,
      target: { ...canonical.target, rigSignature: rigA },
      processing: {
        stage: "solved" as const,
        sourceCanonicalId: canonical.processing.sourceCanonicalId,
        solverId: "humanoid-custom-v4" as const,
        solverRevision: 4 as const,
        solvePass: 1 as const,
      },
    };

    expect(() => assertHumanoidTargetIdentity(solved, rigA)).not.toThrow();
    expect(() => assertHumanoidTargetIdentity(solved, rigB))
      .toThrow(expect.objectContaining({ code: "TARGET_RIG_MISMATCH" }));
  });
});
