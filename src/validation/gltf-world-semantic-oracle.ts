import type {
  Animation,
  AnimationSampler,
  Document,
  Node,
} from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { assertParentChains } from "@/core/parent-graph";
import {
  getMotionTargetBinding,
  HUMANOID_BONES,
  type HumanoidBoneName,
  type RetargetedMotionClip,
} from "@/retarget";
import {
  isNativeMMDRootMotion,
  resolveRestHipsHeight,
} from "@/retarget/target-binding";
import {
  createSemanticSampleTimes,
  solveSemanticWorldPose,
  type SemanticWorldBone,
} from "./semantic-fk-oracle";
import { createGLTFHumanoidSemanticRestPose } from "./gltf-rest-pose";
import type {
  SemanticMotionValidationResult,
  SemanticValidationThresholds,
} from "./semantic-motion";

export function validateGLTFWorldSemantics({
  animationName,
  document,
  expected,
  nodesByBone,
  thresholds,
  worldAxisCorrection = new Quaternion(),
}: {
  animationName: string;
  document: Document;
  expected: RetargetedMotionClip;
  nodesByBone: ReadonlyMap<HumanoidBoneName, Node>;
  thresholds: SemanticValidationThresholds;
  worldAxisCorrection?: Quaternion;
}): SemanticMotionValidationResult {
  const documentNodes = document.getRoot().listNodes();
  assertParentChains(documentNodes, (node) => node.getParentNode(), {
    label: "glTF semantic document hierarchy",
  });
  const animation = selectAnimation(document, animationName);
  const { channels, issues: channelIssues } = collectChannels(
    animation,
    expected,
    nodesByBone,
  );
  const actualDuration = getAnimationDuration(animation);
  const restPose = createGLTFHumanoidSemanticRestPose(nodesByBone);
  // Same rest-hips definition and native VMD-on-MMD rule as target binding.
  const targetProfileId = getMotionTargetBinding(expected)?.profile;
  const measuredRestHipsHeight = resolveRestHipsHeight(
    targetProfileId,
    (bone) => restPose.get(bone)?.worldPosition[1],
  );
  const targetRestHipsHeight = isNativeMMDRootMotion(expected, targetProfileId)
    ? expected.metadata?.restHipsHeight ?? measuredRestHipsHeight
    : measuredRestHipsHeight;
  const rootScale = resolveExpectedRootScale(expected, targetRestHipsHeight);
  const sampleTimes = createSemanticSampleTimes({
    actual: expected,
    additionalKeyTimes: animation
      .listSamplers()
      .flatMap((sampler) => readTimes(sampler)),
    expected,
    restPose,
    rootScale,
    worldAxisCorrection,
  });
  const issues = [...channelIssues];
  const comparesRootTranslation = expected.tracks.some(
    (track) => track.bone === "hips" && track.path === "translation",
  );
  if (
    comparesRootTranslation &&
    !hasBoundRootScaleEvidence(expected, targetRestHipsHeight)
  ) {
    issues.push("root displacement cannot be certified without meter-normalized tracks");
  }
  const durationErrorSeconds = Math.abs(expected.duration - actualDuration);
  if (durationErrorSeconds > thresholds.durationSeconds) {
    issues.push(
      `duration drift ${durationErrorSeconds.toFixed(6)}s exceeds ${thresholds.durationSeconds.toFixed(6)}s`,
    );
  }

  const comparedRotationBones = HUMANOID_BONES.filter((bone) =>
    expected.tracks.some(
      (track) => track.bone === bone && track.path === "rotation",
    ),
  );
  const missingRotationTracks = comparedRotationBones.filter(
    (bone) => !channels.get(nodesByBone.get(bone)!)?.rotation,
  );
  if (missingRotationTracks.length > 0) {
    issues.push(`missing rotation tracks: ${missingRotationTracks.join(", ")}`);
  }

  const expectedOrigin = solveSemanticWorldPose({
    clip: expected,
    restPose,
    rootScale,
    time: sampleTimes[0] ?? 0,
    worldAxisCorrection,
  }).get("hips")?.position;
  const actualOrigin = solveGLTFWorldPose({
    channels,
    nodesByBone,
    time: sampleTimes[0] ?? 0,
  }).get("hips")?.position;
  let maxRotationErrorDegrees = 0;
  let maxRootDisplacementErrorMeters = 0;
  let maxRootDirectionErrorDegrees = 0;
  let maxEndEffectorErrorMeters = 0;
  let maxSymmetryErrorMeters = 0;

  for (const time of sampleTimes) {
    const expectedWorld = solveSemanticWorldPose({
      clip: expected,
      restPose,
      rootScale,
      time,
      worldAxisCorrection,
    });
    const actualWorld = solveGLTFWorldPose({ channels, nodesByBone, time });
    for (const bone of comparedRotationBones) {
      const expectedBone = expectedWorld.get(bone);
      const actualBone = actualWorld.get(bone);
      if (!expectedBone || !actualBone || missingRotationTracks.includes(bone)) continue;
      maxRotationErrorDegrees = Math.max(
        maxRotationErrorDegrees,
        expectedBone.quaternion.angleTo(actualBone.quaternion) * (180 / Math.PI),
      );
    }

    const expectedRoot = relativeRoot(expectedWorld.get("hips"), expectedOrigin);
    const actualRoot = relativeRoot(actualWorld.get("hips"), actualOrigin);
    maxRootDisplacementErrorMeters = Math.max(
      maxRootDisplacementErrorMeters,
      expectedRoot.distanceTo(actualRoot),
    );
    const expectedHorizontal = new Vector3(expectedRoot.x, 0, expectedRoot.z);
    const actualHorizontal = new Vector3(actualRoot.x, 0, actualRoot.z);
    if (expectedHorizontal.lengthSq() > 1e-10 && actualHorizontal.lengthSq() > 1e-10) {
      maxRootDirectionErrorDegrees = Math.max(
        maxRootDirectionErrorDegrees,
        expectedHorizontal.angleTo(actualHorizontal) * (180 / Math.PI),
      );
    }

    for (const bone of ["leftHand", "rightHand", "leftFoot", "rightFoot"] as const) {
      const expectedPosition = expectedWorld.get(bone)?.position;
      const actualPosition = actualWorld.get(bone)?.position;
      if (!expectedPosition || !actualPosition) continue;
      maxEndEffectorErrorMeters = Math.max(
        maxEndEffectorErrorMeters,
        expectedPosition.distanceTo(actualPosition),
      );
    }
    for (const [left, right] of [
      ["leftHand", "rightHand"],
      ["leftFoot", "rightFoot"],
    ] as const) {
      const expectedLeft = expectedWorld.get(left)?.position;
      const expectedRight = expectedWorld.get(right)?.position;
      const actualLeft = actualWorld.get(left)?.position;
      const actualRight = actualWorld.get(right)?.position;
      if (!expectedLeft || !expectedRight || !actualLeft || !actualRight) continue;
      maxSymmetryErrorMeters = Math.max(
        maxSymmetryErrorMeters,
        Math.abs(
          expectedLeft.distanceTo(expectedRight) -
            actualLeft.distanceTo(actualRight),
        ),
      );
    }
  }

  if (maxRotationErrorDegrees > thresholds.rotationDegrees) {
    issues.push(
      `rotation error ${maxRotationErrorDegrees.toFixed(6)}deg exceeds ${thresholds.rotationDegrees.toFixed(6)}deg`,
    );
  }
  if (maxRootDisplacementErrorMeters > thresholds.rootDisplacementMeters) {
    issues.push(
      `root displacement error ${maxRootDisplacementErrorMeters.toFixed(6)}m exceeds ${thresholds.rootDisplacementMeters.toFixed(6)}m`,
    );
  }
  if (maxRootDirectionErrorDegrees > thresholds.rootDirectionDegrees) {
    issues.push(
      `root direction error ${maxRootDirectionErrorDegrees.toFixed(6)}deg exceeds ${thresholds.rootDirectionDegrees.toFixed(6)}deg`,
    );
  }
  if (maxEndEffectorErrorMeters > thresholds.endEffectorMeters) {
    issues.push(
      `end-effector error ${maxEndEffectorErrorMeters.toFixed(6)}m exceeds ${thresholds.endEffectorMeters.toFixed(6)}m`,
    );
  }
  if (maxSymmetryErrorMeters > thresholds.symmetryMeters) {
    issues.push(
      `left/right symmetry error ${maxSymmetryErrorMeters.toFixed(6)}m exceeds ${thresholds.symmetryMeters.toFixed(6)}m`,
    );
  }

  return {
    level: "semantic",
    ok: issues.length === 0,
    sampleTimes,
    issues,
    missingRotationTracks,
    metrics: {
      durationErrorSeconds,
      maxRotationErrorDegrees,
      maxRootDisplacementErrorMeters,
      maxRootDirectionErrorDegrees,
      maxEndEffectorErrorMeters,
      maxSymmetryErrorMeters,
    },
  };
}

function hasBoundRootScaleEvidence(
  expected: RetargetedMotionClip,
  targetRestHipsHeight?: number,
) {
  if (expected.metadata?.rootTranslationSpace === "offset-meters") return true;
  const sourceRestHipsHeight = expected.metadata?.restHipsHeight;
  const evidence = expected.metadata?.rootMotionEvidence;
  return (
    expected.metadata?.rootTranslationSpace === "offset-source-units" &&
    evidence?.status === "preserved" &&
    evidence.scaleSource !== "unknown" &&
    sourceRestHipsHeight !== undefined &&
    sourceRestHipsHeight > 0 &&
    targetRestHipsHeight !== undefined &&
    targetRestHipsHeight > 0
  );
}

function selectAnimation(document: Document, name: string) {
  const animation = [...document.getRoot().listAnimations()]
    .reverse()
    .find((candidate) => candidate.getName() === name);
  if (!animation) {
    throw new Error(`glTF file does not contain animation ${name}.`);
  }
  return animation;
}

type ChannelSet = {
  rotation?: AnimationSampler;
  translation?: AnimationSampler;
};

function collectChannels(
  animation: Animation,
  expected: RetargetedMotionClip,
  nodesByBone: ReadonlyMap<HumanoidBoneName, Node>,
) {
  const semanticNodes = new Set(nodesByBone.values());
  const boneByNode = new Map(
    [...nodesByBone].map(([bone, node]) => [node, bone]),
  );
  const expectedTracks = new Set(
    expected.tracks.map((track) => `${track.bone}.${track.path}`),
  );
  const channels = new Map<Node, ChannelSet>();
  const issues: string[] = [];
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const path = channel.getTargetPath();
    const sampler = channel.getSampler();
    if (!node || !semanticNodes.has(node) || !sampler) {
      continue;
    }
    const bone = boneByNode.get(node)!;
    if (path !== "rotation" && path !== "translation") {
      issues.push(`unexpected exported track: ${bone}.${path ?? "unknown"}`);
      continue;
    }
    if (!expectedTracks.has(`${bone}.${path}`)) {
      issues.push(`unexpected exported track: ${bone}.${path}`);
    }
    if (sampler.getInterpolation() !== "LINEAR") {
      throw new Error(
        `Independent glTF oracle requires LINEAR exported tracks; received ${sampler.getInterpolation()}.`,
      );
    }
    const set = channels.get(node) ?? {};
    if (set[path]) {
      throw new Error(`glTF animation duplicates ${node.getName()}.${path}.`);
    }
    set[path] = sampler;
    channels.set(node, set);
  }
  return { channels, issues };
}

function solveGLTFWorldPose({
  channels,
  nodesByBone,
  time,
}: {
  channels: ReadonlyMap<Node, ChannelSet>;
  nodesByBone: ReadonlyMap<HumanoidBoneName, Node>;
  time: number;
}) {
  const worldByNode = new Map<Node, Matrix4>();
  const visiting = new Set<Node>();
  const solveNode = (node: Node): Matrix4 => {
    const cached = worldByNode.get(node);
    if (cached) return cached;
    if (visiting.has(node)) throw new Error("glTF node hierarchy contains a cycle.");
    visiting.add(node);
    const channel = channels.get(node);
    const translation = channel?.translation
      ? new Vector3(...(sampleSampler(channel.translation, time, 3) as [number, number, number]))
      : new Vector3(...node.getTranslation());
    const rotation = channel?.rotation
      ? new Quaternion(
          ...(sampleSampler(channel.rotation, time, 4) as [number, number, number, number]),
        ).normalize()
      : new Quaternion(...node.getRotation()).normalize();
    const local = new Matrix4().compose(
      translation,
      rotation,
      new Vector3(...node.getScale()),
    );
    const parent = node.getParentNode();
    const world = parent ? solveNode(parent).clone().multiply(local) : local;
    visiting.delete(node);
    worldByNode.set(node, world);
    return world;
  };

  const output = new Map<HumanoidBoneName, SemanticWorldBone>();
  for (const [bone, node] of nodesByBone) {
    const matrix = solveNode(node);
    const position = new Vector3();
    const quaternion = new Quaternion();
    matrix.decompose(position, quaternion, new Vector3());
    output.set(bone, { matrix, position, quaternion });
  }
  return output;
}

function sampleSampler(sampler: AnimationSampler, time: number, size: 3 | 4) {
  const input = sampler.getInput();
  const output = sampler.getOutput();
  if (!input || !output || input.getType() !== "SCALAR") {
    throw new Error("glTF animation sampler is incomplete.");
  }
  const expectedType = size === 4 ? "VEC4" : "VEC3";
  if (output.getType() !== expectedType || output.getCount() !== input.getCount()) {
    throw new Error("glTF animation sampler layout is invalid.");
  }
  const times = readTimes(sampler);
  if (times.length === 0) return size === 4 ? [0, 0, 0, 1] : [0, 0, 0];
  if (times.length === 1 || time <= times[0]!) return readElement(output, 0, size);
  const last = times.length - 1;
  if (time >= times[last]!) return readElement(output, last, size);
  let left = 0;
  while (left + 1 < times.length && time >= times[left + 1]!) left += 1;
  const alpha = (time - times[left]!) / (times[left + 1]! - times[left]!);
  const leftValue = readElement(output, left, size);
  const rightValue = readElement(output, left + 1, size);
  if (size === 3) {
    return new Vector3(...(leftValue as [number, number, number]))
      .lerp(new Vector3(...(rightValue as [number, number, number])), alpha)
      .toArray();
  }
  const leftQuaternion = new Quaternion(
    ...(leftValue as [number, number, number, number]),
  ).normalize();
  const rightQuaternion = new Quaternion(
    ...(rightValue as [number, number, number, number]),
  ).normalize();
  if (leftQuaternion.dot(rightQuaternion) < 0) {
    rightQuaternion.set(
      -rightQuaternion.x,
      -rightQuaternion.y,
      -rightQuaternion.z,
      -rightQuaternion.w,
    );
  }
  return leftQuaternion.slerp(rightQuaternion, alpha).normalize().toArray();
}

function readTimes(sampler: AnimationSampler) {
  const input = sampler.getInput();
  if (!input) return [];
  if (input.getType() !== "SCALAR") {
    throw new Error("glTF animation time accessor must be SCALAR.");
  }
  const times = Array.from({ length: input.getCount() }, (_, index) =>
    input.getScalar(index),
  );
  if (
    times.some(
      (time, index) =>
        !Number.isFinite(time) ||
        time < 0 ||
        (index > 0 && time <= times[index - 1]!),
    )
  ) {
    throw new Error(
      "glTF animation times must be finite, non-negative, and strictly increasing.",
    );
  }
  return times;
}

function readElement(
  accessor: NonNullable<ReturnType<AnimationSampler["getOutput"]>>,
  index: number,
  size: number,
) {
  const value: number[] = [];
  accessor.getElement(index, value);
  const output = Array.from(
    { length: size },
    (_, component) => value[component] ?? 0,
  );
  if (output.some((component) => !Number.isFinite(component))) {
    throw new Error("glTF animation output must contain finite numbers.");
  }
  if (size === 4 && Math.hypot(...output) < 1e-8) {
    throw new Error("glTF animation output contains a zero quaternion.");
  }
  return output;
}

function getAnimationDuration(animation: Animation) {
  return Math.max(
    0,
    ...animation.listSamplers().map((sampler) => readTimes(sampler).at(-1) ?? 0),
  );
}

function resolveExpectedRootScale(
  expected: RetargetedMotionClip,
  targetRestHipsHeight?: number,
) {
  const sourceRestHipsHeight = expected.metadata?.restHipsHeight;
  return sourceRestHipsHeight &&
    sourceRestHipsHeight > 0 &&
    targetRestHipsHeight &&
    targetRestHipsHeight > 0
    ? targetRestHipsHeight / sourceRestHipsHeight
    : 1;
}

function relativeRoot(bone: SemanticWorldBone | undefined, origin?: Vector3) {
  return bone?.position.clone().sub(origin ?? new Vector3()) ?? new Vector3();
}
