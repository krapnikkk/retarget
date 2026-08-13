import { Matrix4, Quaternion, Vector3 } from "three";
import type { AxisName, RigProfile } from "@/profiles";
import type { HumanoidBoneName, MotionTrack } from "@/retarget";

export type RetargetBasisProfiles = {
  sourceProfile: RigProfile;
  targetProfile: RigProfile;
  targetMetaVersion?: string;
};

export type RetargetBasis = {
  sourceProfileId: RigProfile["id"];
  targetProfileId: RigProfile["id"];
  sourceForwardAxis: RigProfile["forwardAxis"];
  targetForwardAxis: RigProfile["forwardAxis"];
  sourceScaleUnit: RigProfile["scaleUnit"];
  targetScaleUnit: RigProfile["scaleUnit"];
  axisCorrection: Quaternion;
  axisCorrectionApplied: boolean;
  forwardAxisCorrection: string;
};

export type HumanoidChainConfig = {
  id: "spine" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg";
  bones: readonly HumanoidBoneName[];
  twistAxis: [number, number, number];
  interpolationWeights?: Partial<Record<HumanoidBoneName, number>>;
};

export type SwingTwistDecomposition = {
  swing: Quaternion;
  twist: Quaternion;
};

export const HUMANOID_CHAIN_CONFIGS = [
  {
    id: "spine",
    bones: ["spine", "chest", "upperChest", "neck", "head"],
    twistAxis: [0, 1, 0],
    interpolationWeights: {
      spine: 0.2,
      chest: 0.35,
      upperChest: 0.3,
      neck: 0.1,
      head: 0.05,
    },
  },
  {
    id: "leftArm",
    bones: ["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"],
    twistAxis: [1, 0, 0],
  },
  {
    id: "rightArm",
    bones: ["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"],
    twistAxis: [-1, 0, 0],
  },
  {
    id: "leftLeg",
    bones: ["leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes"],
    twistAxis: [0, -1, 0],
  },
  {
    id: "rightLeg",
    bones: ["rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"],
    twistAxis: [0, -1, 0],
  },
] as const satisfies readonly HumanoidChainConfig[];

export function createRetargetBasis({
  sourceProfile,
  targetProfile,
  targetMetaVersion,
}: RetargetBasisProfiles): RetargetBasis {
  const axisCorrection = createAxisCorrectionQuaternion({
    sourceProfile,
    targetProfile,
    targetMetaVersion,
  });
  const axisCorrectionApplied = axisCorrection.angleTo(new Quaternion()) > 1e-6;

  return {
    sourceProfileId: sourceProfile.id,
    targetProfileId: targetProfile.id,
    sourceForwardAxis: sourceProfile.forwardAxis,
    targetForwardAxis: targetProfile.forwardAxis,
    sourceScaleUnit: sourceProfile.scaleUnit,
    targetScaleUnit: targetProfile.scaleUnit,
    axisCorrection,
    axisCorrectionApplied,
    forwardAxisCorrection: axisCorrectionApplied
      ? `${sourceProfile.forwardAxis} -> ${targetProfile.forwardAxis} via profile axis basis`
      : `${sourceProfile.forwardAxis} -> ${targetProfile.forwardAxis} uses normalized humanoid basis`,
  };
}

export function applyAxisCorrectionToQuaternion(
  quaternion: Quaternion,
  basis: Pick<RetargetBasis, "axisCorrection" | "axisCorrectionApplied">,
) {
  if (!basis.axisCorrectionApplied) {
    return;
  }

  quaternion
    .premultiply(basis.axisCorrection)
    .multiply(basis.axisCorrection.clone().invert())
    .normalize();
}

export function applyAxisCorrectionToVector(
  vector: Vector3,
  basis: Pick<RetargetBasis, "axisCorrection" | "axisCorrectionApplied">,
) {
  if (basis.axisCorrectionApplied) {
    vector.applyQuaternion(basis.axisCorrection);
  }
}

export function bakeSwingTwistTracks(
  tracks: MotionTrack[],
  configs: readonly HumanoidChainConfig[] = HUMANOID_CHAIN_CONFIGS,
) {
  const configsByBone = new Map<HumanoidBoneName, HumanoidChainConfig>();
  for (const config of configs) {
    for (const bone of config.bones) {
      configsByBone.set(bone, config);
    }
  }

  return tracks.map((track) => {
    if (track.path !== "rotation") {
      return track;
    }

    const config = configsByBone.get(track.bone);
    if (!config) {
      return normalizeQuaternionTrack(track);
    }

    return {
      ...track,
      values: bakeSwingTwistValues({
        axis: new Vector3(...config.twistAxis).normalize(),
        values: track.values,
        weight: config.interpolationWeights?.[track.bone] ?? 1,
      }),
    };
  });
}

export function decomposeSwingTwist(
  quaternion: Quaternion,
  axis: Vector3,
): SwingTwistDecomposition {
  const normalizedAxis = axis.clone().normalize();
  const rotationVector = new Vector3(quaternion.x, quaternion.y, quaternion.z);
  const projected = normalizedAxis.multiplyScalar(rotationVector.dot(normalizedAxis));
  const twist = new Quaternion(
    projected.x,
    projected.y,
    projected.z,
    quaternion.w,
  ).normalize();
  const swing = quaternion.clone().multiply(twist.clone().invert()).normalize();

  return { swing, twist };
}

function bakeSwingTwistValues({
  axis,
  values,
  weight,
}: {
  axis: Vector3;
  values: number[];
  weight: number;
}) {
  const output: number[] = [];
  let previous: Quaternion | null = null;

  for (let index = 0; index < values.length; index += 4) {
    const source = new Quaternion(
      values[index] ?? 0,
      values[index + 1] ?? 0,
      values[index + 2] ?? 0,
      values[index + 3] ?? 1,
    ).normalize();
    const { swing, twist } = decomposeSwingTwist(source, axis);
    const weightedSwing =
      weight === 1 ? swing : new Quaternion().slerpQuaternions(new Quaternion(), swing, weight);
    const baked = weightedSwing.multiply(twist).normalize();
    if (previous && previous.dot(baked) < 0) {
      baked.set(-baked.x, -baked.y, -baked.z, -baked.w);
    }
    previous = baked.clone();
    output.push(round(baked.x), round(baked.y), round(baked.z), round(baked.w));
  }

  return output;
}

function normalizeQuaternionTrack(track: MotionTrack): MotionTrack {
  return {
    ...track,
    values: bakeSwingTwistValues({
      axis: new Vector3(0, 1, 0),
      values: track.values,
      weight: 1,
    }),
  };
}

function createAxisCorrectionQuaternion({
  sourceProfile,
  targetProfile,
  targetMetaVersion,
}: RetargetBasisProfiles) {
  const targetForwardAxis =
    targetProfile.id === "vrm-humanoid" && targetMetaVersion !== "0"
      ? sourceProfile.forwardAxis
      : targetProfile.forwardAxis;
  const targetUpAxis =
    targetProfile.id === "vrm-humanoid" && targetMetaVersion !== "0"
      ? sourceProfile.upAxis
      : targetProfile.upAxis;
  const sourceBasis = createAxisBasis(
    axisNameToVector(sourceProfile.forwardAxis),
    axisNameToVector(sourceProfile.upAxis),
  );
  const targetBasis = createAxisBasis(
    axisNameToVector(targetForwardAxis),
    axisNameToVector(targetUpAxis),
  );

  return targetBasis.multiply(sourceBasis.clone().invert()).normalize();
}

function createAxisBasis(forward: Vector3, up: Vector3) {
  const z = forward.clone().normalize();
  const x = new Vector3().crossVectors(up, z).normalize();
  const correctedY = new Vector3().crossVectors(z, x).normalize();
  return new Quaternion()
    .setFromRotationMatrix(new Matrix4().makeBasis(x, correctedY, z))
    .normalize();
}

function axisNameToVector(axis: AxisName) {
  switch (axis) {
    case "x":
      return new Vector3(1, 0, 0);
    case "-x":
      return new Vector3(-1, 0, 0);
    case "y":
      return new Vector3(0, 1, 0);
    case "-y":
      return new Vector3(0, -1, 0);
    case "z":
      return new Vector3(0, 0, 1);
    case "-z":
      return new Vector3(0, 0, -1);
  }
}

function round(value: number) {
  return Number(value.toFixed(6));
}
