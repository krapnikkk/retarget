import { describe, expect, it } from "vitest";
import type { HumanoidBoneName } from "@/retarget";
import {
  isNativeMMDRootMotion,
  resolveRestHipsHeight,
} from "@/retarget/target-binding";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";

// #15: rest hips height means the hips joint at about leg-root height. MMD rigs
// map hips to センター, which sits below the leg roots.
describe("target rest hips height", () => {
  const gene: Partial<Record<HumanoidBoneName, number>> = {
    hips: 9.237,
    leftUpperLeg: 10.48,
    rightUpperLeg: 10.48,
  };

  it("uses the leg-root average for MMD targets", () => {
    expect(resolveRestHipsHeight("mmd-body", (bone) => gene[bone])).toBeCloseTo(10.48, 6);
  });

  it("falls back to the hips joint when an MMD rig has no leg roots", () => {
    expect(resolveRestHipsHeight("mmd-body", (bone) => (bone === "hips" ? 9.237 : undefined)))
      .toBe(9.237);
  });

  it("keeps the hips joint for every other profile", () => {
    for (const profile of ["vrm-humanoid", "vrm1-humanoid", "generic-gltf-humanoid", undefined]) {
      expect(resolveRestHipsHeight(profile, (bone) => gene[bone])).toBe(9.237);
    }
  });

  it("ignores non-positive heights", () => {
    expect(resolveRestHipsHeight("generic-gltf-humanoid", () => 0)).toBeUndefined();
    expect(resolveRestHipsHeight("mmd-body", (bone) => (bone === "hips" ? 1 : -2))).toBe(1);
  });

  it("plays only VMD sources natively on MMD targets", () => {
    const vmd = createRetargetedMotionClipStub({
      vrmFile: { name: "Gene.pmx" },
      fbxFile: { name: "stand.vmd" },
    });
    vmd.source = { ...vmd.source, kind: "vmd" };
    const gltf = { ...vmd, source: { ...vmd.source, kind: "gltf-animation" as const } };

    expect(isNativeMMDRootMotion(vmd, "mmd-body")).toBe(true);
    expect(isNativeMMDRootMotion(vmd, "vrm1-humanoid")).toBe(false);
    expect(isNativeMMDRootMotion(gltf, "mmd-body")).toBe(false);
  });
});
