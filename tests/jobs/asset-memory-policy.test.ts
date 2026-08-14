import { describe, expect, it } from "vitest";
import {
  LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES,
  MAX_MOTION_FILE_BYTES,
  assertInputByteLength,
  assertMotionFileWithinLimit,
  getAvatarEagerInputLimit,
} from "@/jobs/asset-memory-policy";

describe("asset input byte budgets", () => {
  it("rejects oversized files before reading their contents", () => {
    expect(() => assertMotionFileWithinLimit({
      name: "oversized.bvh",
      size: MAX_MOTION_FILE_BYTES + 1,
    })).toThrow(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });

  it("rejects invalid and oversized transferable lengths with registered codes", () => {
    expect(() => assertInputByteLength(-1, 10, "motion:test"))
      .toThrow(expect.objectContaining({ code: "PARSE_INVALID_LENGTH" }));
    expect(() => assertInputByteLength(11, 10, "motion:test"))
      .toThrow(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });

  it("keeps full-read GLB jobs below the segmented range threshold", () => {
    expect(getAvatarEagerInputLimit({ name: "avatar.glb", size: 0 })).toBe(
      LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES - 1,
    );
    expect(getAvatarEagerInputLimit({ name: "avatar.fbx", size: 0 })).toBe(
      MAX_MOTION_FILE_BYTES,
    );
    expect(getAvatarEagerInputLimit({ name: "avatar.pmx", size: 0 })).toBe(
      200 * 1024 * 1024,
    );
  });
});
