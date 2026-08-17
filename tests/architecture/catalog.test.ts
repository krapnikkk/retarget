import { describe, expect, it } from "vitest";
import {
  AVATAR_EXPORT_FORMATS,
  AVATAR_FORMATS,
  MOTION_EXPORT_FORMATS,
  MOTION_FORMATS,
} from "@/formats";
import { getRigProfile } from "@/profiles";

describe("format and profile catalog", () => {
  it("keeps the first beta vertical slice registered", () => {
    expect(MOTION_FORMATS.find((format) => format.id === "mixamo-fbx")).toMatchObject({
      assurance: "beta",
      role: "motion",
    });
    expect(AVATAR_FORMATS.find((format) => format.id === "vrm")).toMatchObject({
      assurance: "beta",
      role: "avatar",
    });
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "vrma")).toMatchObject({
      assurance: "beta",
      role: "motion-export",
    });
  });

  it("keeps assurance scoped to evidence", () => {
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "gltf-animation")).toMatchObject({
      assurance: "beta",
    });
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "bvh")).toMatchObject({
      assurance: "beta",
    });
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "vmd")).toMatchObject({
      assurance: "experimental",
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "animated-glb")).toMatchObject({
      assurance: "experimental",
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "baked-vrm")).toMatchObject({
      assurance: "experimental",
    });
    expect(AVATAR_FORMATS.find((format) => format.id === "mmd-model")).toMatchObject({
      assurance: "beta",
      extensions: [".pmx", ".pmd"],
    });
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "fbx-animation")).toMatchObject({
      assurance: "beta",
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "vrm-external-vrma")).toMatchObject({
      assurance: "beta",
      extensions: [".zip"],
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "fbx-avatar-animation")).toMatchObject({
      label: "Animated FBX",
      assurance: "experimental",
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "animated-pmx")).toMatchObject({
      label: "PMX Motion Morphs",
      assurance: "experimental",
    });
    expect(
      [...MOTION_FORMATS, ...AVATAR_FORMATS, ...MOTION_EXPORT_FORMATS, ...AVATAR_EXPORT_FORMATS],
    ).not.toContainEqual(expect.objectContaining({ assurance: "certified" }));
  });

  it("documents active Mixamo and VRM rig profiles", () => {
    expect(getRigProfile("mixamo")).toMatchObject({
      label: "Mixamo Humanoid",
      restPose: "t-pose",
    });
    expect(getRigProfile("vrm-humanoid")).toMatchObject({
      label: "VRM Humanoid",
      restPose: "normalized",
    });
  });
});
