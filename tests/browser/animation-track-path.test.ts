import { Object3D } from "three";
import { describe, expect, it } from "vitest";
import { createObjectAnimationTrackPath } from "@/browser/animation-track-path";

describe("animation track paths", () => {
  it("binds duplicate or empty node names by object UUID", () => {
    const first = new Object3D();
    const second = new Object3D();
    first.name = "bone";
    second.name = "bone";

    expect(createObjectAnimationTrackPath(first, "quaternion")).toBe(
      `${first.uuid}.quaternion`,
    );
    expect(createObjectAnimationTrackPath(second, "quaternion")).not.toBe(
      createObjectAnimationTrackPath(first, "quaternion"),
    );
    expect(createObjectAnimationTrackPath(new Object3D(), "position")).toMatch(
      /^[0-9a-f-]+\.position$/i,
    );
  });
});
