import { describe, expect, it } from "vitest";
import {
  sampleRotationTrack,
  sampleTranslationTrack,
} from "@/solvers/rig-chain-swing-twist";

describe("rig-chain track sampling", () => {
  it("holds the first and last translation samples outside the track range", () => {
    const track = {
      role: "root",
      path: "translation" as const,
      times: [1, 2],
      values: [1, 2, 3, 4, 5, 6],
    };

    expect(sampleTranslationTrack(track, 0).toArray()).toEqual([1, 2, 3]);
    expect(sampleTranslationTrack(track, 1).toArray()).toEqual([1, 2, 3]);
    expect(sampleTranslationTrack(track, 1.5).toArray()).toEqual([2.5, 3.5, 4.5]);
    expect(sampleTranslationTrack(track, 2).toArray()).toEqual([4, 5, 6]);
    expect(sampleTranslationTrack(track, 3).toArray()).toEqual([4, 5, 6]);
  });

  it("holds the first and last rotation samples outside the track range", () => {
    const track = {
      role: "spine",
      path: "rotation" as const,
      times: [1, 2],
      values: [0, 0, 0, 1, 0, 1, 0, 0],
    };

    expect(sampleRotationTrack(track, 0).toArray()).toEqual([0, 0, 0, 1]);
    expect(sampleRotationTrack(track, 1).toArray()).toEqual([0, 0, 0, 1]);
    expect(sampleRotationTrack(track, 2).toArray()).toEqual([0, 1, 0, 0]);
    expect(sampleRotationTrack(track, 3).toArray()).toEqual([0, 1, 0, 0]);
  });
});
