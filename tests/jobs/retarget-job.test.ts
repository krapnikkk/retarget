import { describe, expect, it } from "vitest";
import { executeRetargetJob } from "@/jobs/execute-retarget-job";
import {
  DEFAULT_PROCESSING_BUDGET,
  ProcessingBudgetError,
  assertRigMotionProcessingBudget,
  assertRetargetSolveBudget,
} from "@/processing-budget";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";
import type { RigMotionV2 } from "@/rig-motion";
import { RETARGET_JOB_PROTOCOL_VERSION } from "@/jobs/types";

describe("retarget job runtime", () => {
  it("runs export and independent structural/semantic validation phases", async () => {
    const clip = createRetargetedMotionClipStub({
      fbxFile: { name: "walk.fbx" },
      vrmFile: { name: "avatar.vrm" },
    });
    clip.metadata = {
      ...clip.metadata,
      normalizationVersion: 1,
      canonicalProfile: "vrm-humanoid",
      rootTranslationSpace: "offset-meters",
      restHipsHeight: 1,
    };
    const phases: string[] = [];
    const bytes = await executeRetargetJob(
      {
        schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
        jobId: "export",
        task: { type: "export-motion", formatId: "vrma", clip },
      },
      (phase) => phases.push(phase),
    );
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(phases).toEqual(
      expect.arrayContaining(["validate", "export", "complete"]),
    );

    const validated = (await executeRetargetJob({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "validate",
      task: {
        type: "validate-motion-export",
        formatId: "vrma",
        bytes: copyBuffer(bytes as Uint8Array),
        expected: clip,
      },
    })) as {
      structural: { ok: boolean };
      semantic: { ok: boolean; metrics: { maxRootDisplacementErrorMeters: number } };
    };
    expect(validated.structural.ok).toBe(true);
    expect(validated.semantic.ok).toBe(true);
    expect(validated.semantic.metrics.maxRootDisplacementErrorMeters).toBeLessThan(
      1e-5,
    );
  });

  it("enforces only caller-supplied input and output budgets", async () => {
    await expect(executeRetargetJob({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "input-budget",
      budget: { parse: { maxInputBytes: 4 } },
      task: {
        type: "import-motion",
        formatId: "bvh",
        filename: "walk.bvh",
        bytes: new ArrayBuffer(8),
      },
    })).rejects.toMatchObject({ code: "PARSE_BUDGET_EXCEEDED" });

    const clip = createRetargetedMotionClipStub({
      fbxFile: { name: "walk.fbx" },
      vrmFile: { name: "avatar.vrm" },
    });
    await expect(executeRetargetJob({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "output-budget",
      budget: { processing: { maxOutputBytes: 1 } },
      task: { type: "export-motion", formatId: "motion-json", clip },
    })).rejects.toMatchObject({ code: "PROCESSING_BUDGET_EXCEEDED" });
  });

  it("does not reject large finite solve requests using product policy", () => {
    expect(() =>
      assertRetargetSolveBudget({
        boneCount: 53,
        duration: 1_200,
        fps: 120,
        options: {
          armOffsetDegrees: 0,
          heightScale: 1,
          rootMotion: true,
        },
      }),
    ).not.toThrow();
  });

  it("still rejects requests whose generated counts are not safely representable", () => {
    expect(() =>
      assertRetargetSolveBudget({
        boneCount: Number.MAX_SAFE_INTEGER,
        duration: Number.MAX_VALUE,
        fps: Number.MAX_VALUE,
        options: {
          armOffsetDegrees: 0,
          heightScale: 1,
          rootMotion: true,
        },
      }),
    ).toThrowError(ProcessingBudgetError);
  });

  it("rejects forged serialized target inspections before parsing source bytes", async () => {
    await expect(executeRetargetJob({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "forged-inspection",
      task: {
        type: "retarget-rigged-gltf",
        motionBytes: new ArrayBuffer(8),
        motionFilename: "motion.glb",
        targetFilename: "target.glb",
        targetInspection: {} as never,
      },
    })).rejects.toMatchObject({ code: "TARGET_RIG_INVALID" });
  });

  it("rejects non-finite and out-of-range solver options", () => {
    expect(() =>
      assertRetargetSolveBudget({
        boneCount: 20,
        duration: 2,
        fps: 30,
        options: {
          armOffsetDegrees: 0,
          heightScale: Number.NaN,
          rootMotion: true,
        },
      }),
    ).toThrow(/heightScale/);
  });

  it("bounds generated non-humanoid scalar values before export", () => {
    const motion: RigMotionV2 = {
      schemaVersion: 2,
      rigDefinitionId: "quadruped-v1",
      family: "quadruped",
      name: "bounded",
      duration: 1,
      fps: 30,
      source: {
        kind: "gltf-animation",
        filename: "bounded.glb",
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
          path: "translation",
          times: [0, 1],
          values: [0, 0, 0, 0, 0, 1],
        },
      ],
      createdAt: "2026-08-13T00:00:00.000Z",
    };

    expect(() =>
      assertRigMotionProcessingBudget(motion, {
        ...DEFAULT_PROCESSING_BUDGET,
        maxGeneratedValues: 5,
      }),
    ).toThrow(/rig motion scalar values/);
  });
});

function copyBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
