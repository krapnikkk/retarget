import { Matrix4, Quaternion, Vector3 } from "three";
import type { AxisName } from "@/profiles";

export type AxisFrame = {
  forwardAxis: AxisName;
  upAxis: AxisName;
};

export const CANONICAL_AXIS_FRAME = {
  forwardAxis: "-z",
  upAxis: "y",
} as const satisfies AxisFrame;

export function createAxisCorrection(source: AxisFrame, target: AxisFrame) {
  const sourceBasis = createAxisBasis(
    axisNameToVector(source.forwardAxis),
    axisNameToVector(source.upAxis),
  );
  const targetBasis = createAxisBasis(
    axisNameToVector(target.forwardAxis),
    axisNameToVector(target.upAxis),
  );
  return targetBasis.multiply(sourceBasis.clone().invert()).normalize();
}

function createAxisBasis(forward: Vector3, up: Vector3) {
  const z = forward.clone().normalize();
  const y = up.clone().normalize();
  const x = new Vector3().crossVectors(y, z).normalize();
  const correctedY = new Vector3().crossVectors(z, x).normalize();
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, correctedY, z),
  );
}

function axisNameToVector(axis: AxisName) {
  const sign = axis.startsWith("-") ? -1 : 1;
  const dimension = axis.replace("-", "");
  return new Vector3(
    dimension === "x" ? sign : 0,
    dimension === "y" ? sign : 0,
    dimension === "z" ? sign : 0,
  );
}
