import { describe, expect, it } from "vitest";
import {
  AVATAR_EXPORT_FORMATS,
  AVATAR_FORMATS,
  MOTION_EXPORT_FORMATS,
  MOTION_FORMATS,
} from "@/formats";
import { getRigProfile } from "@/profiles";

describe("format and profile catalog", () => {
  it("keeps the first available beta vertical slice registered", () => {
    expect(MOTION_FORMATS.find((format) => format.id === "mixamo-fbx")).toMatchObject({
      availability: "available",
      assurance: "beta",
      role: "motion",
    });
    expect(AVATAR_FORMATS.find((format) => format.id === "vrm")).toMatchObject({
      availability: "available",
      assurance: "beta",
      role: "avatar",
    });
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "vrma")).toMatchObject({
      availability: "available",
      assurance: "beta",
      role: "motion-export",
    });
  });

  it("separates available formats from evidence-backed assurance", () => {
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "gltf-animation")).toMatchObject({
      availability: "available",
      assurance: "beta",
    });
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "bvh")).toMatchObject({
      availability: "available",
      assurance: "beta",
    });
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "vmd")).toMatchObject({
      availability: "available",
      assurance: "experimental",
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "animated-glb")).toMatchObject({
      availability: "available",
      assurance: "experimental",
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "baked-vrm")).toMatchObject({
      availability: "available",
      assurance: "experimental",
    });
    expect(AVATAR_FORMATS.find((format) => format.id === "mmd-model")).toMatchObject({
      availability: "available",
      assurance: "beta",
      extensions: [".pmx", ".pmd"],
    });
    expect(MOTION_EXPORT_FORMATS.find((format) => format.id === "fbx-animation")).toMatchObject({
      availability: "available",
      assurance: "beta",
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "vrm-external-vrma")).toMatchObject({
      availability: "available",
      assurance: "beta",
      extensions: [".zip"],
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "fbx-avatar-animation")).toMatchObject({
      label: "Animated FBX",
      availability: "available",
      assurance: "experimental",
    });
    expect(AVATAR_EXPORT_FORMATS.find((format) => format.id === "animated-pmx")).toMatchObject({
      label: "PMX Motion Morphs",
      availability: "available",
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
