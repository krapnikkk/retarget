import { describe, expect, it } from "vitest";
import {
  type CanonicalHumanoidMotionClip,
  type HumanoidBoneName,
} from "@/retarget";
import {
  createCustomChainConfigs,
  solveHumanoidMotion,
  solveHumanoidCustomRigMotion,
} from "@/solvers";
import { createImportedHumanoidMotionClip } from "@/import/humanoid-motion";
import { BVH_HUMANOID_PROFILE, READY_PLAYER_ME_PROFILE } from "@/profiles";

describe("humanoid custom rig solver v4", () => {
  it("records one solve pass and rejects solved clips from re-entering the solver", () => {
    const source = createTestClip();
    const solved = solveHumanoidCustomRigMotion(source);

    expect(solved.processing).toEqual({
      stage: "solved",
      sourceCanonicalId: source.processing.sourceCanonicalId,
      solverId: "humanoid-custom-v4",
      solverRevision: 4,
      solvePass: 1,
      targetRigRevision: undefined,
    });
    expect(() =>
      solveHumanoidCustomRigMotion(
        solved as unknown as CanonicalHumanoidMotionClip,
      ),
    ).toThrow(/solved clip cannot enter the solver again/i);
  });

  it("applies height, root-motion, and arm-offset solve options", () => {
    const source = createTestClip();
    const scaled = solveHumanoidCustomRigMotion(
      source,
      undefined,
      undefined,
      {
        heightScale: 2,
        rootMotion: true,
        armOffsetDegrees: 20,
      },
    );
    const rootDisabled = solveHumanoidCustomRigMotion(
      source,
      undefined,
      undefined,
      {
        heightScale: 2,
        rootMotion: false,
        armOffsetDegrees: 0,
      },
    );
    const scaledHips = scaled.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    );
    const disabledHips = rootDisabled.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    );
    const sourceArm = source.tracks.find(
      (track) => track.bone === "rightUpperArm" && track.path === "rotation",
    );
    const solvedArm = scaled.tracks.find(
      (track) => track.bone === "rightUpperArm" && track.path === "rotation",
    );

    expect(scaledHips?.values).toEqual([0, 0, 0, 0, 0.2, 0, 0, 0, 0]);
    expect(disabledHips?.values).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(solvedArm?.values).not.toEqual(sourceArm?.values);
    expect(scaled.diagnostics?.pose.armOffsetDegrees).toBe(20);
    expect(scaled.metadata?.rootScale).toBe(2);
    expect(rootDisabled.diagnostics?.assumptions.rootMotionNormalization).toContain(
      "disabled by solve options",
    );
  });

  it("applies manual source-to-target bone mapping and updates diagnostics", () => {
    const clip = createTestClip();

    const solved = solveHumanoidCustomRigMotion(clip, {
      enabled: true,
      chainPreset: "upper-body",
      footCleanup: false,
      boneMap: {
        leftHand: "rightUpperArm",
      },
    });

    expect(solved.diagnostics?.solver.id).toBe("humanoid-custom-v4");
    expect(solved.tracks.some((track) => track.bone === "leftHand")).toBe(true);
    expect(solved.metadata?.customManualOverrides).toBe(1);
    expect(solved.diagnostics?.assumptions.forwardAxisCorrection).toContain(
      "Solver v4 custom mapping upper-body",
    );
  });

  it("lifts negative hips translation when basic foot cleanup is enabled", () => {
    const clip = createTestClip();
    const dirtyClip = {
      ...clip,
      tracks: clip.tracks.map((track) =>
        track.bone === "hips" && track.path === "translation"
          ? {
              ...track,
              values: [0, -0.2, 0, 0, -0.1, 0, 0, 0, 0],
            }
          : track,
      ),
    };

    const solved = solveHumanoidCustomRigMotion(dirtyClip, {
      enabled: true,
      chainPreset: "full-body",
      footCleanup: true,
      boneMap: {},
    });
    const hipsTranslation = solved.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    );

    expect(hipsTranslation?.values.filter((_, index) => index % 3 === 1)).toEqual([
      0,
      0.1,
      0.2,
    ]);
    expect(solved.metadata?.customFootCleanup).toBe(1);
  });

  it("does not reinterpret already-normalized tracks when profiles are overridden", () => {
    const clip = createTestClip();

    const solved = solveHumanoidCustomRigMotion(clip, {
      enabled: true,
      sourceProfileOverride: "actorcore",
      targetProfileOverride: "vrm-humanoid",
      chainPreset: "full-body",
      footCleanup: false,
      boneMap: {},
    });
    const hipsTranslation = solved.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    );

    expect(solved.diagnostics?.profiles.source.id).toBe("actorcore");
    expect(solved.diagnostics?.profiles.target.id).toBe("vrm-humanoid");
    expect(hipsTranslation?.values).toEqual([0, 0, 0, 0, 0.1, 0, 0, 0, 0]);
    expect(solved.diagnostics?.assumptions.forwardAxisCorrection).toContain(
      "profile override transform actorcore -> vrm-humanoid",
    );
  });

  it("maps against the loaded target rig before solving", () => {
    const targetSkeleton = {
      name: "loaded RPM avatar",
      children: [{ name: "hips", bone: "hips" as const, children: [] }],
    };
    const solved = solveHumanoidMotion({
      motion: createTestClip(),
      targetRig: {
        profile: READY_PLAYER_ME_PROFILE,
        bones: new Set(["hips"] as const),
        skeleton: targetSkeleton,
        restHipsHeight: 0.88,
      },
    });

    expect(solved.tracks.map((track) => track.bone)).toEqual(["hips"]);
    expect(solved.diagnostics?.profiles.target.id).toBe("ready-player-me");
    expect(solved.diagnostics?.skeletons.target).toBe(targetSkeleton);
    expect(solved.diagnostics?.mapping.mappedTargetBones).toBe(1);
    expect(solved.metadata?.targetHeight).toBe(0.88);
    expect(solved.processing.targetRigRevision).toContain("ready-player-me");
  });

  it("fails closed when no source tracks map to the target", () => {
    expect(() =>
      solveHumanoidMotion({
        motion: createTestClip(),
        targetRig: createTargetRig(["head"]),
      }),
    ).toThrow(expect.objectContaining({ code: "TARGET_MAPPING_EMPTY" }));
  });

  it("fails closed when all available mappings are disabled", () => {
    expect(() =>
      solveHumanoidCustomRigMotion(createTestClip(), {
        enabled: true,
        chainPreset: "full-body",
        footCleanup: false,
        boneMap: {
          hips: "none",
          rightUpperArm: "none",
          leftHand: "none",
        },
      }),
    ).toThrow(expect.objectContaining({ code: "TARGET_MAPPING_EMPTY" }));
  });

  it("rejects a mapping that only preserves an optional finger", () => {
    const motion = createTestClip();
    motion.tracks = [{
      bone: "leftIndexDistal",
      path: "rotation",
      times: [0, 1],
      values: [0, 0, 0, 1, 0, 0, 0, 1],
    }];
    expect(() =>
      solveHumanoidMotion({
        motion,
        targetRig: createTargetRig(["leftIndexDistal"]),
      }),
    ).toThrow(expect.objectContaining({ code: "TARGET_MAPPING_INSUFFICIENT" }));
  });

  it("requires mapped bones to cover the selected chain preset", () => {
    const motion = createTestClip();
    motion.tracks = motion.tracks.filter(
      (track) => track.bone === "rightUpperArm",
    );
    expect(() =>
      solveHumanoidMotion({
        motion,
        mapping: {
          enabled: true,
          chainPreset: "lower-body",
          footCleanup: false,
          boneMap: {},
        },
        targetRig: createTargetRig(["rightUpperArm"]),
      }),
    ).toThrow(expect.objectContaining({ code: "TARGET_REQUIRED_CHAIN_MISSING" }));
  });

  it("creates custom chain presets for upper and lower body solving", () => {
    expect(createCustomChainConfigs("upper-body").map((config) => config.id)).toEqual([
      "spine",
      "leftArm",
      "rightArm",
    ]);
    expect(createCustomChainConfigs("lower-body").map((config) => config.id)).toEqual([
      "leftLeg",
      "rightLeg",
    ]);
  });
});

function createTestClip() {
  return createImportedHumanoidMotionClip({
    kind: "bvh",
    filename: "walk.bvh",
    profile: BVH_HUMANOID_PROFILE,
    tracks: [
      {
        bone: "hips",
        path: "translation",
        times: [0, 1, 2],
        values: [0, 0, 0, 0, 0.1, 0, 0, 0, 0],
      },
      {
        bone: "rightUpperArm",
        path: "rotation",
        times: [0, 1],
        values: [0, 0, 0, 1, 0.1, 0, 0, 0.995],
      },
      {
        bone: "leftHand",
        path: "rotation",
        times: [0, 1],
        values: [0, 0, 0, 1, 0, 0, 0, 1],
      },
    ],
  });
}

function createTargetRig(bones: readonly HumanoidBoneName[]) {
  return {
    profile: READY_PLAYER_ME_PROFILE,
    bones: new Set(bones),
    skeleton: {
      name: "test target",
      children: bones.map((bone) => ({ name: bone, bone, children: [] })),
    },
    restHipsHeight: 0.88,
  };
}
