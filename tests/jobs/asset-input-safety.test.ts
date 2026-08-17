import { describe, expect, it } from "vitest";
import {
  LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES,
  assertInputByteLength,
  isRangeLoadableGLB,
} from "@/jobs/asset-input-safety";

describe("asset input byte safety", () => {
  it("supports explicit caller ceilings with registered error codes", () => {
    expect(() => assertInputByteLength(-1, 10, "motion:test"))
      .toThrow(expect.objectContaining({ code: "PARSE_INVALID_LENGTH" }));
    expect(() => assertInputByteLength(11, 10, "motion:test"))
      .toThrow(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });

  it("keeps range loading as an optimization instead of a rejection policy", () => {
    expect(isRangeLoadableGLB({
      name: "avatar.glb",
      size: LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES,
    })).toBe(true);
  });
});
