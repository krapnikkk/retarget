import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETARGET_OPTIONS,
  selectRetargetSolveOptions,
} from "@/retarget";

describe("retarget option contract", () => {
  it("keeps preview controls out of the solver payload", () => {
    expect(
      selectRetargetSolveOptions({
        ...DEFAULT_RETARGET_OPTIONS,
        heightScale: 1.2,
        playbackSpeed: 1.5,
        loop: true,
      }),
    ).toEqual({
      armOffsetDegrees: 0,
      heightScale: 1.2,
      rootMotion: true,
    });
  });
});
