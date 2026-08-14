import { describe, expect, it } from "vitest";
import {
  RIG_MOTION_SCHEMA_VERSION,
  parseRigMotion,
  serializeRigMotion,
  validateRigMotion,
  type RigMotionV2,
} from "@/rig-motion";

describe("Rig Motion v2 validation", () => {
  it.each([
    ["duration", Number.POSITIVE_INFINITY, /duration.*finite/i],
    ["fps", Number.NaN, /fps.*finite/i],
  ] as const)("rejects invalid %s", (field, value, issue) => {
    const motion = createValidRigMotion();
    motion[field] = value;
    expect(validateRigMotion(motion)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.stringMatching(issue)]),
    });
  });

  it.each([
    [[0, Number.NaN], /times\[1\].*finite/i],
    [[-1, 0], /times\[0\].*non-negative/i],
    [[0, 0], /strictly increasing/i],
    [[0, 2], /exceeds duration/i],
  ] as const)("rejects unsafe track times %j", (times, issue) => {
    const motion = createValidRigMotion();
    motion.tracks[0]!.times = [...times];
    expect(validateRigMotion(motion)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.stringMatching(issue)]),
    });
  });

  it("rejects non-finite values, invalid quaternions, and duplicate tracks", () => {
    const nonFinite = createValidRigMotion();
    nonFinite.tracks[0]!.values[2] = Number.POSITIVE_INFINITY;
    expect(validateRigMotion(nonFinite)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.stringMatching(/values\[2\].*finite/i)]),
    });

    const zeroQuaternion = createValidRigMotion();
    zeroQuaternion.tracks[0]!.values = [0, 0, 0, 0, 0, 0, 0, 1];
    expect(validateRigMotion(zeroQuaternion)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.stringMatching(/zero.*quaternion/i)]),
    });

    const duplicate = createValidRigMotion();
    duplicate.tracks.push(structuredClone(duplicate.tracks[0]!));
    expect(validateRigMotion(duplicate)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.stringMatching(/duplicates root\.rotation/i)]),
    });
  });

  it("validates rest-pose roles, uniqueness, and quaternion normalization", () => {
    const motion = createValidRigMotion();
    motion.restPose.push({
      ...structuredClone(motion.restPose[0]!),
      rotation: [0, 0, 0, 2],
    });
    expect(validateRigMotion(motion)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.stringMatching(/duplicates role root/i),
        expect.stringMatching(/non-normalized quaternion/i),
      ]),
    });

    motion.restPose[0]!.role = "not-a-role";
    expect(validateRigMotion(motion)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.stringMatching(/role is not defined/i)]),
    });
  });

  it.each([
    {
      label: "missing parent",
      configure(motion: RigMotionV2) {
        motion.restPose[0]!.parentRole = "pelvis";
      },
      issue: /parent graph.*missing parent pelvis/i,
    },
    {
      label: "self parent",
      configure(motion: RigMotionV2) {
        motion.restPose[0]!.parentRole = "root";
      },
      issue: /parent graph.*itself as parent/i,
    },
    {
      label: "cycle",
      configure(motion: RigMotionV2) {
        motion.restPose[0]!.parentRole = "pelvis";
        motion.restPose.push({
          ...structuredClone(motion.restPose[0]!),
          role: "pelvis",
          nodeName: "pelvis",
          parentRole: "root",
        });
      },
      issue: /parent graph.*cycle detected/i,
    },
  ])("rejects rest-pose $label", ({ configure, issue }) => {
    const motion = createValidRigMotion();
    configure(motion);
    expect(validateRigMotion(motion)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.stringMatching(issue)]),
    });
  });

  it("enforces duration, FPS, track, per-track, and total-sample budgets", () => {
    const motion = createValidRigMotion();
    expect(
      validateRigMotion(motion, {
        maxDurationSeconds: 0.5,
        maxFps: 20,
        maxSamplesPerTrack: 1,
        maxTotalSamples: 1,
        maxTracks: 0,
      }),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.stringMatching(/duration must not exceed/i),
        expect.stringMatching(/fps must not exceed/i),
        expect.stringMatching(/tracks must not contain more/i),
        expect.stringMatching(/must not contain more than 1 samples/i),
        expect.stringMatching(/tracks contain 2 samples/i),
      ]),
    });
  });

  it("requires valid selected-action and interpolation provenance", () => {
    const motion = createValidRigMotion();
    motion.source.animation.index = -1;
    motion.source.animation.name = "";
    motion.source.animation.interpolationModes = [];
    motion.source.animation.resampledTracks = -1;
    expect(validateRigMotion(motion)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.stringMatching(/animation\.index.*non-negative integer/i),
        expect.stringMatching(/animation\.name.*non-empty string/i),
        expect.stringMatching(/interpolationModes.*supported/i),
        expect.stringMatching(/resampledTracks.*non-negative integer/i),
      ]),
    });
  });

  it("uses structured public errors for Rig Motion serialization failures", () => {
    expect(() => parseRigMotion("{")).toThrow(
      expect.objectContaining({ code: "ARTIFACT_INVALID" }),
    );
    const invalid = createValidRigMotion();
    invalid.tracks = [];
    expect(() => serializeRigMotion(invalid)).toThrow(
      expect.objectContaining({ code: "PROCESSING_RIG_MOTION_INVALID" }),
    );
  });
});

function createValidRigMotion(): RigMotionV2 {
  return {
    schemaVersion: RIG_MOTION_SCHEMA_VERSION,
    rigDefinitionId: "quadruped-v1",
    family: "quadruped",
    name: "walk",
    duration: 1,
    fps: 30,
    source: {
      kind: "gltf-animation",
      filename: "walk.glb",
      profileId: "canonical-quadruped-v1",
      rigSignature: "fixture",
      animation: {
        index: 0,
        name: "Walk",
        interpolationModes: ["LINEAR"],
        resampledTracks: 0,
      },
    },
    restPose: [
      {
        role: "root",
        nodeName: "root",
        translation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        worldTranslation: [0, 0, 0],
        worldRotation: [0, 0, 0, 1],
      },
    ],
    tracks: [
      {
        role: "root",
        path: "rotation",
        times: [0, 1],
        values: [0, 0, 0, 1, 0, 0.1, 0, 0.994987],
      },
    ],
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}
