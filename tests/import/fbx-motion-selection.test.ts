import { AnimationClip } from "three";
import { describe, expect, it } from "vitest";
import { selectFBXAnimation } from "@/import/fbx-motion";

describe("FBX animation selection", () => {
  const animations = [
    new AnimationClip("Idle", 1, []),
    new AnimationClip("Walk", 2, []),
  ];

  it("requires explicit selection for multi-action FBX files", () => {
    expect(() => selectFBXAnimation(animations)).toThrow(
      expect.objectContaining({ code: "FBX_ANIMATION_SELECTION_REQUIRED" }),
    );
  });

  it("selects an action by stable index or unique name", () => {
    expect(selectFBXAnimation(animations, { animationIndex: 1 }).name).toBe("Walk");
    expect(selectFBXAnimation(animations, { animationName: "Idle" }).name).toBe("Idle");
  });

  it("rejects missing, conflicting, and ambiguous selections", () => {
    expect(() => selectFBXAnimation(animations, {
      animationIndex: 0,
      animationName: "Walk",
    })).toThrow(expect.objectContaining({ code: "FBX_ANIMATION_NOT_FOUND" }));
    expect(() => selectFBXAnimation(animations, {
      animationName: "Run",
    })).toThrow(expect.objectContaining({ code: "FBX_ANIMATION_NOT_FOUND" }));
    expect(() => selectFBXAnimation([
      new AnimationClip("Take", 1, []),
      new AnimationClip("Take", 2, []),
    ], { animationName: "Take" })).toThrow(
      expect.objectContaining({ code: "FBX_ANIMATION_SELECTION_REQUIRED" }),
    );
  });
});
