import { describe, expect, it } from "vitest";
import {
  getMissingRequiredBones,
  normalizeMixamoBoneName,
  resolveMixamoBoneName,
} from "@/retarget";

describe("Mixamo humanoid mapping", () => {
  it("normalizes Mixamo bone prefixes and separators", () => {
    expect(normalizeMixamoBoneName("mixamorig:LeftForeArm")).toBe(
      "leftforearm",
    );
    expect(normalizeMixamoBoneName("mixamorig_RightUpLeg")).toBe(
      "rightupleg",
    );
  });

  it("maps common Mixamo bones into the internal humanoid subset", () => {
    expect(resolveMixamoBoneName("mixamorig:Hips")).toBe("hips");
    expect(resolveMixamoBoneName("mixamorig:LeftArm")).toBe("leftUpperArm");
    expect(resolveMixamoBoneName("mixamorig:RightLeg")).toBe("rightLowerLeg");
  });

  it("maps Mixamo finger chains into VRM humanoid finger bones", () => {
    expect(resolveMixamoBoneName("mixamorig:LeftHandIndex2")).toBe(
      "leftIndexIntermediate",
    );
    expect(resolveMixamoBoneName("mixamorig:RightHandPinky3")).toBe(
      "rightLittleDistal",
    );
    expect(resolveMixamoBoneName("mixamorig:LeftHandThumb1")).toBe(
      "leftThumbMetacarpal",
    );
  });

  it("reports missing required VRM bones", () => {
    expect(getMissingRequiredBones(["hips", "spine"])).toContain("head");
  });
});
