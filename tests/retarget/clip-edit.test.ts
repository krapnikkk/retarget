import { describe, expect, it } from "vitest";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";
import { createCanonicalHumanoidMotionClip, createCanonicalMotionFromRetargetedClip } from "@/retarget/canonical-motion";
import { editHumanoidMotion } from "@/retarget/clip-edit";
import { DEFAULT_PROCESSING_BUDGET } from "@/processing-budget";
import { executeRetargetJob } from "@/jobs/execute-retarget-job";
import { RETARGET_JOB_PROTOCOL_VERSION } from "@/jobs/types";
import { assertRetargetJobResponse } from "@/jobs/runtime-protocol";
import { exportVRMA } from "@/export/vrma";
import { importVRMA } from "@/import/vrma";

function motion() {
  const clip = createRetargetedMotionClipStub({ fbxFile: { name: "five.fbx" }, vrmFile: { name: "avatar.vrm" } });
  for (const track of clip.tracks) track.times = [0, 2, 5];
  clip.tracks.find((track) => track.bone === "hips" && track.path === "translation")!.values = [0, 0, 0, 20, 0, 0, 50, 0, 0];
  clip.tracks.find((track) => track.bone === "hips" && track.path === "rotation")!.values =
    [0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0, 1, 0, 0];
  return createCanonicalHumanoidMotionClip({ ...createCanonicalMotionFromRetargetedClip(clip), duration: 5 });
}
const edit = { schemaVersion: 1, startSeconds: 1, endSeconds: 3, speed: 0.5 } as const;

describe("canonical clip edit v1", () => {
  it("interpolates boundaries, preserves root offsets, and derives reproducible identity without mutating the original", async () => {
    const source = motion();
    const original = structuredClone(source);
    const output = editHumanoidMotion(source, edit);
    expect(source).toEqual(original);
    expect(output.duration).toBe(4);
    const translation = output.tracks.find((track) => track.bone === "hips" && track.path === "translation")!;
    expect(translation.times).toEqual([0, 2, 4]);
    expect(translation.values).toEqual([10, 0, 0, 20, 0, 0, 30, 0, 0]);
    const rotation = output.tracks.find((track) => track.bone === "hips" && track.path === "rotation")!;
    expect(rotation.values[1]).toBeCloseTo(Math.sin(Math.PI / 8), 10);
    expect(rotation.values[rotation.values.length - 3]).toBeCloseTo(Math.sin(Math.PI / 3), 10);
    expect(output.processing.sourceCanonicalId).not.toBe(source.processing.sourceCanonicalId);
    expect(editHumanoidMotion(source, edit)).toEqual(output);
    expect(output.metadata?.clipEdit).toEqual({ sourceCanonicalId: source.processing.sourceCanonicalId, settings: edit });
    const reloaded = await importVRMA(await exportVRMA(output), "edited.vrma");
    expect(reloaded.duration).toBeCloseTo(4);
    expect(reloaded.tracks.find((track) => track.bone === "hips" && track.path === "translation")!.values).toEqual(translation.values);
  });

  it.each([
    { schemaVersion: 2 }, { startSeconds: -1 }, { startSeconds: 3 }, { endSeconds: 6 },
    { speed: 0 }, { speed: -1 }, { speed: Infinity }, { endSeconds: NaN },
  ])("rejects invalid edit settings %j", (invalid) => {
    expect(() => editHumanoidMotion(motion(), { ...edit, ...invalid } as typeof edit))
      .toThrow(expect.objectContaining({ code: "PROCESSING_OPTION_INVALID" }));
  });

  it("checks output budgets before generating values and rejects solved input", () => {
    expect(() => editHumanoidMotion(motion(), edit, { ...DEFAULT_PROCESSING_BUDGET, maxGeneratedValues: 1 }))
      .toThrow(expect.objectContaining({ code: "PROCESSING_BUDGET_EXCEEDED" }));
    expect(() => editHumanoidMotion(motion(), { ...edit, speed: Number.MIN_VALUE }))
      .toThrow(expect.objectContaining({ code: "PROCESSING_DURATION_LIMIT" }));
    const source = motion();
    const solved = { ...source, processing: { stage: "solved", sourceCanonicalId: source.processing.sourceCanonicalId, solverId: "humanoid-custom-v4", solverRevision: 4, solvePass: 1 } };
    expect(() => editHumanoidMotion(solved as never, edit))
      .toThrow(expect.objectContaining({ code: "PROCESSING_CLIP_INVALID" }));
  });

  it("runs the same contract through the Worker job and rejects a stale result", async () => {
    const request = { schemaVersion: RETARGET_JOB_PROTOCOL_VERSION, jobId: "edit", task: { type: "edit-humanoid", motion: motion(), edit } } as const;
    const result = await executeRetargetJob(request);
    expect(result).toEqual(editHumanoidMotion(request.task.motion, edit));
    expect(() => assertRetargetJobResponse({ schemaVersion: RETARGET_JOB_PROTOCOL_VERSION, jobId: "edit", type: "result", result: request.task.motion }, request))
      .toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
  });
});
