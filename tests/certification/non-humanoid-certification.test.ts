import { describe, expect, it } from "vitest";
import {
  getNonHumanoidBetaPromotions,
  NON_HUMANOID_PIPELINE_CERTIFICATION,
} from "@/certification";

describe("non-humanoid pipeline certification", () => {
  it("publishes only pinned real-action Animated GLB matrices as beta", () => {
    expect(NON_HUMANOID_PIPELINE_CERTIFICATION).toMatchObject({
      schemaVersion: 4,
      validatorVersion: 4,
    });
    const promotions = getNonHumanoidBetaPromotions();
    expect(promotions).toHaveLength(5);
    for (const promotion of promotions) {
      expect(promotion).toEqual(expect.objectContaining({
        assurance: "beta",
        sourceFormat: "gltf-rigged",
        targetFormat: "gltf-rigged",
        outputFormat: "animated-glb",
        publicEntry: "@krapnik/retarget/browser#runRiggedGLTFPipeline",
        evidence: {
          structural: expect.objectContaining({ status: "passed" }),
          semantic: expect.objectContaining({ status: "passed" }),
          ecosystem: expect.objectContaining({ status: "pending" }),
        },
      }));
    }

    const promoted = NON_HUMANOID_PIPELINE_CERTIFICATION.cases.filter(
      (item) => item.promotion !== undefined,
    );
    expect(promoted.map((item) => [
      item.rigDefinitionId,
      item.actions?.length,
    ])).toEqual([
      ["quadruped-v1", 4],
      ["avian-v1", 4],
      ["serpentine-v1", 7],
      ["arachnid-v1", 9],
      ["creature-v1", 4],
    ]);
  });
});
