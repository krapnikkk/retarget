import type { CanonicalHumanoidMotionClip, HumanoidClipEdit } from "./types";
import { RetargetError } from "./errors";
import { createCanonicalHumanoidMotionClip, createCanonicalMotionFromRetargetedClip } from "./canonical-motion";
import { sampleMotionClipPose } from "./pose-sampler";
import {
  assertMotionProcessingBudget, assertSafeCount, DEFAULT_PROCESSING_BUDGET,
  ProcessingBudgetError, type ProcessingBudget,
} from "@/processing-budget";

export function assertHumanoidClipEdit(value: unknown, sourceDuration: number): asserts value is HumanoidClipEdit {
  const edit = value as Partial<HumanoidClipEdit> | null;
  if (!edit || typeof edit !== "object" || Array.isArray(edit) ||
    Object.keys(edit).some((key) => !["schemaVersion", "startSeconds", "endSeconds", "speed"].includes(key)) ||
    edit.schemaVersion !== 1 || !Number.isFinite(sourceDuration) || sourceDuration <= 0 ||
    !Number.isFinite(edit.startSeconds) || !Number.isFinite(edit.endSeconds) || !Number.isFinite(edit.speed) ||
    edit.startSeconds! < 0 || edit.endSeconds! > sourceDuration ||
    edit.startSeconds! >= edit.endSeconds! || edit.speed! <= 0) {
    throw new RetargetError("PROCESSING_OPTION_INVALID", {
      message: "Clip edit v1 requires 0 <= startSeconds < endSeconds <= source duration and positive finite speed.",
    });
  }
}

/** Crop one canonical interval, rebase time to zero, and divide time by speed.
 * Spatial root offsets are preserved. Translation is linear; rotation is shortest-path SLERP.
 */
export function editHumanoidMotion(
  source: CanonicalHumanoidMotionClip,
  edit: HumanoidClipEdit,
  budget: ProcessingBudget = DEFAULT_PROCESSING_BUDGET,
): CanonicalHumanoidMotionClip {
  assertMotionProcessingBudget(source, budget);
  if (source.processing.stage !== "canonical") {
    throw new RetargetError("PROCESSING_CLIP_INVALID", { message: "Edit an original canonical clip before solving." });
  }
  assertHumanoidClipEdit(edit, source.duration);
  const duration = (edit.endSeconds - edit.startSeconds) / edit.speed;
  if (!Number.isFinite(duration) || duration < 1 / budget.maxFps || duration > budget.maxDurationSeconds) {
    throw new ProcessingBudgetError({
      code: "PROCESSING_DURATION_LIMIT", declared: duration, limit: budget.maxDurationSeconds,
      message: "Edited duration is outside the processing budget.", phase: "edit",
    });
  }
  let totalSamples = 0;
  let totalValues = 0;
  const windows = source.tracks.map((track) => {
    let start = 0;
    while (start < track.times.length && track.times[start]! <= edit.startSeconds) start++;
    let end = start;
    while (end < track.times.length && track.times[end]! < edit.endSeconds) end++;
    const samples = end - start + 2;
    totalSamples += samples;
    totalValues += samples * (track.path === "rotation" ? 4 : 3);
    assertSafeCount(samples, budget.maxFrames, "edited track samples", "edit");
    assertSafeCount(totalSamples, budget.maxTotalSamples, "edited samples", "edit");
    assertSafeCount(totalValues, budget.maxGeneratedValues, "edited scalar values", "edit");
    return { track, start, end };
  });
  const first = sampleMotionClipPose(source, edit.startSeconds, false);
  const last = sampleMotionClipPose(source, edit.endSeconds, false);
  const tracks = windows.map(({ track, start, end }) => {
    const width = track.path === "rotation" ? 4 : 3;
    const key = track.path === "rotation" ? "rotation" : "position";
    const times = [0];
    const values = [...first[track.bone]![key]!];
    for (let index = start; index < end; index++) {
      times.push((track.times[index]! - edit.startSeconds) / edit.speed);
      for (let component = 0; component < width; component++) {
        values.push(track.values[index * width + component]!);
      }
    }
    times.push(duration);
    values.push(...last[track.bone]![key]!);
    return { ...track, times, values };
  });
  const { tracks: originalTracks, ...properties } = createCanonicalMotionFromRetargetedClip(source);
  void originalTracks;
  const result = structuredClone(properties);
  if (result.diagnostics) result.diagnostics.stats.duration = duration;
  const edited = createCanonicalHumanoidMotionClip({
    ...result, duration, tracks,
    metadata: {
      ...result.metadata,
      clipEdit: { sourceCanonicalId: source.processing.sourceCanonicalId, settings: { ...edit } },
    },
  });
  assertMotionProcessingBudget(edited, budget);
  return edited;
}
