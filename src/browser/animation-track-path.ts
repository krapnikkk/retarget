import type { Object3D } from "three";

export function createObjectAnimationTrackPath(
  object: Object3D,
  property: "position" | "quaternion",
) {
  return `${object.uuid}.${property}`;
}
