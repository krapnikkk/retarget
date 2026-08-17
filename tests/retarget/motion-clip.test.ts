import { describe, expect, it } from "vitest";
import {
  createCanonicalMotionFromRetargetedClip,
  createMotionArtifactEnvelope,
  parseCanonicalMotion,
  parseMotionClip,
  serializeCanonicalMotion,
  serializeMotionClip,
  validateCanonicalMotion,
  validateMotionClip,
} from "@/retarget";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";

const clip = createRetargetedMotionClipStub({
  vrmFile: { name: "avatar.vrm" },
  fbxFile: { name: "walk.fbx" },
});
const canonicalMotion = createCanonicalMotionFromRetargetedClip(clip);

describe("CanonicalMotion", () => {
  it("validates independently from a target binding", () => {
    expect(validateCanonicalMotion(canonicalMotion)).toMatchObject({ ok: true });
    expect(validateMotionClip(canonicalMotion)).toMatchObject({ ok: false });
  });

  it("roundtrips through canonical Motion JSON", () => {
    expect(parseCanonicalMotion(serializeCanonicalMotion(canonicalMotion))).toEqual(
      canonicalMotion,
    );
  });

  it("derives target-neutral identity from stable semantic content", () => {
    const anotherTarget = createRetargetedMotionClipStub({
      vrmFile: { name: "another-avatar.vrm" },
      fbxFile: { name: "walk.fbx" },
    });

    expect(anotherTarget.processing.sourceCanonicalId).toBe(
      clip.processing.sourceCanonicalId,
    );
    const serialized = JSON.parse(serializeMotionClip(anotherTarget));
    expect(serialized).not.toHaveProperty("createdAt");
    expect(serialized).not.toHaveProperty("target");
  });

  it("keeps artifact identity and time outside canonical motion", () => {
    const envelope = createMotionArtifactEnvelope({
      artifactId: "motion-artifact-1",
      createdAt: "2026-08-17T00:00:00.000Z",
      motion: canonicalMotion,
      toolVersion: "0.6.0",
    });

    expect(envelope).toMatchObject({
      artifactId: "motion-artifact-1",
      createdAt: "2026-08-17T00:00:00.000Z",
      sourceHash: clip.processing.sourceCanonicalId,
    });
    expect(() => createMotionArtifactEnvelope({
      artifactId: "motion-artifact-1",
      createdAt: "August 17, 2026",
      motion: canonicalMotion,
      toolVersion: "0.6.0",
    })).toThrow(/ISO timestamp/);
  });
});

describe("RetargetedMotionClip", () => {
  it("validates the initialized stub clip schema", () => {
    expect(validateMotionClip(clip)).toMatchObject({ ok: true });
  });

  it("roundtrips through Motion JSON", () => {
    expect(parseMotionClip(serializeMotionClip(clip))).toEqual(clip);
  });

  it("rejects clips without explicit processing evidence", () => {
    const { processing: _, ...legacyClip } = clip;

    expect(validateMotionClip(legacyClip)).toMatchObject({ ok: false });
    expect(() => parseMotionClip(JSON.stringify(legacyClip))).toThrow(
      /processing must describe/,
    );
  });

  it("allows target bindings only after solve with verified rig identity", () => {
    expect(validateMotionClip({
      ...clip,
      target: { kind: "vrm", filename: "avatar.vrm" },
    })).toMatchObject({ ok: false });
  });

  it("rejects tracks with invalid sample lengths", () => {
    const result = validateMotionClip({
      ...clip,
      tracks: [
        {
          bone: "hips",
          path: "rotation",
          times: [0, 1],
          values: [0, 0, 0, 1],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("fails closed for malformed track containers without throwing TypeError", () => {
    expect(() =>
      validateMotionClip({
        ...clip,
        tracks: [
          {
            bone: "hips",
            path: "translation",
            times: null,
            values: {},
          },
        ],
      }),
    ).not.toThrow();
    expect(
      validateMotionClip({
        ...clip,
        tracks: [
          {
            bone: "hips",
            path: "translation",
            times: null,
            values: {},
          },
        ],
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects non-finite, unordered, duplicate, and over-budget motion data", () => {
    const invalid = {
      ...clip,
      duration: Number.POSITIVE_INFINITY,
      fps: 121,
      tracks: [
        {
          bone: "hips",
          path: "translation",
          times: [0, 0],
          values: [0, 0, 0, Number.NaN, 0, 0],
        },
        {
          bone: "hips",
          path: "translation",
          times: [0, 1],
          values: [0, 0, 0, 1, 0, 0],
        },
      ],
    };
    const result = validateMotionClip(invalid, { maxSamplesPerTrack: 1 });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Expected invalid motion data.");
    expect(result.issues.join(" ")).toMatch(
      /finite|strictly increasing|duplicates|more than 1 samples/,
    );
  });
});
