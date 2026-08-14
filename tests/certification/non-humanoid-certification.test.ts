import { describe, expect, it } from "vitest";
import {
  getNonHumanoidBetaPromotions,
  NON_HUMANOID_PIPELINE_CERTIFICATION,
} from "@/certification";

describe("non-humanoid pipeline certification", () => {
  it("publishes only the pinned Fox-to-Fox/Dog/Horse Animated GLB matrix as beta", () => {
    expect(NON_HUMANOID_PIPELINE_CERTIFICATION).toMatchObject({
      schemaVersion: 3,
      validatorVersion: 3,
    });
    expect(getNonHumanoidBetaPromotions()).toEqual([
      expect.objectContaining({
        assurance: "beta",
        sourceFormat: "gltf-rigged",
        targetFormat: "gltf-rigged",
        outputFormat: "animated-glb",
        publicEntry: "3dretarget/browser#runRiggedGLTFPipeline",
        evidence: {
          structural: expect.objectContaining({ status: "passed" }),
          semantic: expect.objectContaining({ status: "passed" }),
          ecosystem: expect.objectContaining({ status: "pending" }),
        },
      }),
    ]);

    const promoted = NON_HUMANOID_PIPELINE_CERTIFICATION.cases.filter(
      (item) => item.promotion !== undefined,
    );
    expect(promoted).toHaveLength(1);
    expect(promoted[0]).toMatchObject({
      rigDefinitionId: "quadruped-v1",
      profileId: "mesh2motion-fox",
      actions: ["Idle", "Walk", "Run", "Jump"],
      targetFixtures: [
        { filename: "fox-base.glb" },
        { filename: "fox-dog.glb" },
        { filename: "fox-horse.glb" },
      ],
    });
  });
});
