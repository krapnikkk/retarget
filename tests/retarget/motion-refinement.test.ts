import { describe, expect, it } from "vitest";
import {
  estimateArmRaiseOffsetDegrees,
  refineRootTranslationSamples,
} from "@/retarget";

describe("motion refinement", () => {
  it("pushes root translation up when projected feet would go below ground", () => {
    const refined = refineRootTranslationSamples({
      footSamples: [{ leftFoot: [0, -0.2, 0], rightFoot: [0.2, 0, 0] }],
      rootMotion: true,
      rootOffsets: [[0, 0, 0]],
      sourceRestFeet: {
        leftFoot: [0, 0, 0],
        rightFoot: [0.2, 0, 0],
      },
      sourceToTargetScale: 1,
      targetHeight: 1.7,
      targetRestFeet: {
        leftFoot: [0, 0, 0],
        rightFoot: [0.2, 0, 0],
      },
      times: [0],
    });

    expect(refined[0][1]).toBeCloseTo(0.2);
  });

  it("locks a contacted foot by compensating horizontal root drift", () => {
    const refined = refineRootTranslationSamples({
      footSamples: [
        { leftFoot: [0, 0, 0] },
        { leftFoot: [0.02, 0, 0] },
        { leftFoot: [0.02, 0, 0.03] },
      ],
      rootMotion: true,
      rootOffsets: [
        [0, 0, 0],
        [0.2, 0, 0],
        [0.4, 0, 0],
      ],
      sourceRestFeet: {
        leftFoot: [0, 0, 0],
      },
      sourceToTargetScale: 1,
      targetHeight: 1.7,
      targetRestFeet: {
        leftFoot: [0, 0, 0],
      },
      times: [0, 0.1, 0.2],
    });

    expect(refined[1][0]).toBeLessThan(0.2);
    expect(refined[2][0]).toBeLessThan(0.4);
  });

  it("preserves hips bobbing while the feet stay planted", () => {
    // A planted foot keeps its world position while the hips dip; the ground
    // constraint must not read that as foot penetration and cancel the bob,
    // which showed up as per-frame vertical popping.
    const plantedFeet = {
      leftFoot: [-0.1, 0, 0] as [number, number, number],
      rightFoot: [0.1, 0, 0] as [number, number, number],
    };
    const refined = refineRootTranslationSamples({
      footSamples: [plantedFeet, plantedFeet, plantedFeet],
      rootMotion: true,
      rootOffsets: [
        [0, 0, 0],
        [0, -0.05, 0],
        [0, -0.02, 0],
      ],
      sourceRestFeet: plantedFeet,
      sourceToTargetScale: 1,
      targetHeight: 1.7,
      targetRestFeet: plantedFeet,
      times: [0, 0.1, 0.2],
    });

    expect(refined[1][1]).toBeCloseTo(-0.05, 6);
    expect(refined[2][1]).toBeCloseTo(-0.02, 6);
  });

  it("does not rubber-band root motion against a planted foot", () => {
    // While a foot is planted the raw root keeps advancing; the foot lock
    // must only counter genuine sliding, not pull the root back every frame.
    const plantedFoot = { leftFoot: [0, 0, 0] as [number, number, number] };
    const refined = refineRootTranslationSamples({
      footSamples: [plantedFoot, plantedFoot, plantedFoot],
      rootMotion: true,
      rootOffsets: [
        [0, 0, 0],
        [0.2, 0, 0],
        [0.4, 0, 0],
      ],
      sourceRestFeet: plantedFoot,
      sourceToTargetScale: 1,
      targetHeight: 1.7,
      targetRestFeet: plantedFoot,
      times: [0, 0.1, 0.2],
    });

    expect(refined[1][0]).toBeCloseTo(0.2, 6);
    expect(refined[2][0]).toBeCloseTo(0.4, 6);
  });

  it("keeps foot-lock smoothing stable across 30, 60, and 120 FPS", () => {
    const runs = [30, 60, 120].map((fps) => {
      const times = Array.from({ length: fps + 1 }, (_, index) => index / fps);
      const footSamples = times.map((time) => ({
        leftFoot: [time * 0.04, 0, 0] as [number, number, number],
      }));
      const refined = refineRootTranslationSamples({
        footSamples,
        rootMotion: true,
        rootOffsets: times.map((time) => [time * 0.2, 0, 0]),
        sourceRestFeet: { leftFoot: [0, 0, 0] },
        sourceToTargetScale: 1,
        targetHeight: 1.7,
        targetRestFeet: { leftFoot: [0, 0, 0] },
        times,
      });
      return refined[refined.length - 1]![0];
    });

    expect(Math.max(...runs) - Math.min(...runs)).toBeLessThan(0.002);
  });

  it("raises an A-pose target arm to follow a T-pose source", () => {
    expect(estimateArmRaiseOffsetDegrees([1, 0, 0], [1, -1, 0])).toBeCloseTo(
      45,
      0,
    );
  });

  it("lowers a T-pose target arm to follow an A-pose source", () => {
    expect(estimateArmRaiseOffsetDegrees([1, -1, 0], [1, 0, 0])).toBeCloseTo(
      -45,
      0,
    );
  });
});
