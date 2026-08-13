import type {
  Animation,
  AnimationSampler,
  Document,
  Node,
} from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { DEFAULT_PARSE_BUDGET } from "@/import/parse-budget";
import type {
  RigMotionTrack,
  RigMotionV2,
  RigRestTransform,
} from "@/rig-motion";
import { getRigDefinition } from "@/rigs";
import {
  DEFAULT_SEMANTIC_THRESHOLDS,
  type SemanticValidationThresholds,
} from "./semantic-motion";

export type RigMotionSemanticValidationResult = {
  level: "semantic";
  ok: boolean;
  sampleTimes: number[];
  issues: string[];
  missingTracks: string[];
  metrics: {
    durationErrorSeconds: number;
    maxRotationErrorDegrees: number;
    maxRootDisplacementErrorMeters: number;
    maxRootDirectionErrorDegrees: number;
    maxEndEffectorErrorMeters: number;
    maxSymmetryErrorMeters: number;
  };
};

type TrackPath = RigMotionTrack["path"];

type SampledTrack = {
  path: TrackPath;
  times: number[];
  values: number[];
};

type NodeChannels = Partial<Record<TrackPath, SampledTrack>>;

type WorldTransform = {
  position: Vector3;
  quaternion: Quaternion;
};

export function validateRigMotionDocumentSemantics({
  document,
  expected,
  thresholds = DEFAULT_SEMANTIC_THRESHOLDS,
}: {
  document: Document;
  expected: RigMotionV2;
  thresholds?: SemanticValidationThresholds;
}): RigMotionSemanticValidationResult {
  const issues: string[] = [];
  const definition = getRigDefinition(expected.rigDefinitionId);
  if (!definition) {
    issues.push(`unknown rig definition: ${expected.rigDefinitionId}`);
  }

  const animation = selectAnimation(document, expected.name || "rig-motion");
  const { nodesByRole, roleByNode, issues: nodeIssues } = resolveRoleNodes(
    document,
    expected.restPose,
  );
  issues.push(...nodeIssues);
  const expectedChannels = compileExpectedChannels(expected, nodesByRole);
  const {
    channels: actualChannels,
    issues: channelIssues,
    missingTracks,
    keyTimes: actualKeyTimes,
    duration: actualDuration,
  } = compileActualChannels(animation, expected, nodesByRole, roleByNode);
  issues.push(...channelIssues);

  const durationErrorSeconds = Math.abs(expected.duration - actualDuration);
  if (durationErrorSeconds > thresholds.durationSeconds) {
    issues.push(
      `duration drift ${durationErrorSeconds.toFixed(6)}s exceeds ${thresholds.durationSeconds.toFixed(6)}s`,
    );
  }

  const sampleTimes = createSampleTimes(expected, actualKeyTimes);
  const rootRole = definition?.rootRole ?? expected.restPose[0]?.role;
  const endEffectorRoles = new Set([
    ...(definition?.contactRoles ?? []),
    ...(definition?.chains.flatMap((chain) => chain.roles.at(-1) ?? []) ?? []),
  ]);
  const symmetryPairs = createSymmetryPairs(definition?.roles ?? []);
  const expectedRootOrigin = rootRole
    ? solveWorldPose({
        channels: expectedChannels,
        nodesByRole,
        time: 0,
      }).get(rootRole)?.position
    : undefined;
  const actualRootOrigin = rootRole
    ? solveWorldPose({
        channels: actualChannels,
        nodesByRole,
        time: 0,
      }).get(rootRole)?.position
    : undefined;

  let maxRotationErrorDegrees = 0;
  let maxRootDisplacementErrorMeters = 0;
  let maxRootDirectionErrorDegrees = 0;
  let maxEndEffectorErrorMeters = 0;
  let maxSymmetryErrorMeters = 0;

  for (const time of sampleTimes) {
    const expectedWorld = solveWorldPose({
      channels: expectedChannels,
      nodesByRole,
      time,
    });
    const actualWorld = solveWorldPose({
      channels: actualChannels,
      nodesByRole,
      time,
    });
    for (const track of expected.tracks) {
      if (track.path !== "rotation") continue;
      const expectedTransform = expectedWorld.get(track.role);
      const actualTransform = actualWorld.get(track.role);
      if (!expectedTransform || !actualTransform) continue;
      maxRotationErrorDegrees = Math.max(
        maxRotationErrorDegrees,
        expectedTransform.quaternion.angleTo(actualTransform.quaternion) *
          (180 / Math.PI),
      );
    }

    if (rootRole) {
      const expectedRoot = relativePosition(
        expectedWorld.get(rootRole)?.position,
        expectedRootOrigin,
      );
      const actualRoot = relativePosition(
        actualWorld.get(rootRole)?.position,
        actualRootOrigin,
      );
      maxRootDisplacementErrorMeters = Math.max(
        maxRootDisplacementErrorMeters,
        expectedRoot.distanceTo(actualRoot),
      );
      const expectedHorizontal = new Vector3(expectedRoot.x, 0, expectedRoot.z);
      const actualHorizontal = new Vector3(actualRoot.x, 0, actualRoot.z);
      if (
        expectedHorizontal.lengthSq() > 1e-10 &&
        actualHorizontal.lengthSq() > 1e-10
      ) {
        maxRootDirectionErrorDegrees = Math.max(
          maxRootDirectionErrorDegrees,
          expectedHorizontal.angleTo(actualHorizontal) * (180 / Math.PI),
        );
      }
    }

    for (const role of endEffectorRoles) {
      const expectedPosition = expectedWorld.get(role)?.position;
      const actualPosition = actualWorld.get(role)?.position;
      if (!expectedPosition || !actualPosition) continue;
      maxEndEffectorErrorMeters = Math.max(
        maxEndEffectorErrorMeters,
        expectedPosition.distanceTo(actualPosition),
      );
    }
    for (const [left, right] of symmetryPairs) {
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

  appendThresholdIssues(issues, thresholds, {
    maxEndEffectorErrorMeters,
    maxRootDirectionErrorDegrees,
    maxRootDisplacementErrorMeters,
    maxRotationErrorDegrees,
    maxSymmetryErrorMeters,
  });

  return {
    level: "semantic",
    ok: issues.length === 0,
    sampleTimes,
    issues,
    missingTracks,
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

function selectAnimation(document: Document, name: string) {
  const animation = [...document.getRoot().listAnimations()]
    .reverse()
    .find((candidate) => candidate.getName() === name);
  if (!animation) {
    throw new Error(`glTF file does not contain animation ${name}.`);
  }
  return animation;
}

function resolveRoleNodes(
  document: Document,
  restPose: readonly RigRestTransform[],
) {
  const nodesByName = new Map<string, Node[]>();
  for (const node of document.getRoot().listNodes()) {
    const matches = nodesByName.get(node.getName()) ?? [];
    matches.push(node);
    nodesByName.set(node.getName(), matches);
  }
  const nodesByRole = new Map<string, Node>();
  const roleByNode = new Map<Node, string>();
  const issues: string[] = [];
  for (const transform of restPose) {
    const matches = nodesByName.get(transform.nodeName) ?? [];
    if (matches.length !== 1) {
      issues.push(
        matches.length === 0
          ? `missing semantic node: ${transform.role} (${transform.nodeName})`
          : `ambiguous semantic node: ${transform.role} (${transform.nodeName})`,
      );
      continue;
    }
    const node = matches[0]!;
    if (roleByNode.has(node)) {
      issues.push(`semantic node is mapped to multiple roles: ${transform.nodeName}`);
      continue;
    }
    nodesByRole.set(transform.role, node);
    roleByNode.set(node, transform.role);
  }
  return { nodesByRole, roleByNode, issues };
}

function compileExpectedChannels(
  expected: RigMotionV2,
  nodesByRole: ReadonlyMap<string, Node>,
) {
  const channels = new Map<Node, NodeChannels>();
  for (const track of expected.tracks) {
    const node = nodesByRole.get(track.role);
    if (!node) continue;
    const set = channels.get(node) ?? {};
    set[track.path] = {
      path: track.path,
      times: track.times,
      values: track.values,
    };
    channels.set(node, set);
  }
  return channels;
}

function compileActualChannels(
  animation: Animation,
  expected: RigMotionV2,
  nodesByRole: ReadonlyMap<string, Node>,
  roleByNode: ReadonlyMap<Node, string>,
) {
  const channels = new Map<Node, NodeChannels>();
  const issues: string[] = [];
  const keyTimes: number[] = [];
  const expectedTracks = new Set(
    expected.tracks.map((track) => `${track.role}.${track.path}`),
  );
  const actualTracks = new Set<string>();
  let duration = 0;
  let totalSamples = 0;
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const path = channel.getTargetPath();
    const sampler = channel.getSampler();
    if (!node || !sampler || (path !== "rotation" && path !== "translation")) {
      issues.push("exported animation contains an incomplete or unsupported channel");
      continue;
    }
    const role = roleByNode.get(node);
    if (!role) {
      issues.push(`unexpected exported node track: ${node.getName()}.${path}`);
    } else if (!expectedTracks.has(`${role}.${path}`)) {
      issues.push(`unexpected exported track: ${role}.${path}`);
    } else {
      actualTracks.add(`${role}.${path}`);
    }
    const compiled = compileSampler(sampler, path);
    totalSamples += compiled.times.length;
    if (totalSamples > DEFAULT_PARSE_BUDGET.maxTotalSamples) {
      throw new Error("glTF animation samples exceed the semantic validation limit.");
    }
    keyTimes.push(...compiled.times);
    duration = Math.max(duration, compiled.times.at(-1) ?? 0);
    const set = channels.get(node) ?? {};
    if (set[path]) {
      throw new Error(`glTF animation duplicates ${node.getName()}.${path}.`);
    }
    set[path] = compiled;
    channels.set(node, set);
  }
  const missingTracks = [...expectedTracks].filter(
    (track) => !actualTracks.has(track),
  );
  if (missingTracks.length > 0) {
    issues.push(`missing exported tracks: ${missingTracks.join(", ")}`);
  }
  return { channels, duration, issues, keyTimes, missingTracks };
}

function compileSampler(sampler: AnimationSampler, path: TrackPath): SampledTrack {
  if (sampler.getInterpolation() !== "LINEAR") {
    throw new Error(
      `Independent Rig Motion oracle requires LINEAR exported tracks; received ${sampler.getInterpolation()}.`,
    );
  }
  const input = sampler.getInput();
  const output = sampler.getOutput();
  const size = path === "rotation" ? 4 : 3;
  const expectedType = path === "rotation" ? "VEC4" : "VEC3";
  if (
    !input ||
    !output ||
    input.getType() !== "SCALAR" ||
    output.getType() !== expectedType ||
    output.getCount() !== input.getCount()
  ) {
    throw new Error("glTF animation sampler layout is invalid.");
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
  const values: number[] = [];
  const value: number[] = [];
  for (let index = 0; index < output.getCount(); index += 1) {
    value.length = 0;
    output.getElement(index, value);
    for (let component = 0; component < size; component += 1) {
      const entry = value[component];
      if (entry === undefined || !Number.isFinite(entry)) {
        throw new Error("glTF animation output must contain finite numbers.");
      }
      values.push(entry);
    }
    if (
      path === "rotation" &&
      Math.hypot(...values.slice(values.length - 4)) < 1e-8
    ) {
      throw new Error("glTF animation output contains a zero quaternion.");
    }
  }
  return { path, times, values };
}

function createSampleTimes(expected: RigMotionV2, actualKeyTimes: readonly number[]) {
  const duration = expected.duration;
  const keys = new Set<number>([
    0,
    duration,
    duration * 0.25,
    duration * 0.5,
    duration * 0.75,
    ...actualKeyTimes,
    ...expected.tracks.flatMap((track) => track.times),
  ]);
  const sortedKeys = [...keys]
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= duration)
    .sort((left, right) => left - right);
  const epsilon = Math.min(1e-5, Math.max(duration * 1e-7, Number.EPSILON));
  const samples = new Set(sortedKeys);
  for (let index = 0; index < sortedKeys.length; index += 1) {
    const time = sortedKeys[index]!;
    if (time > 0) samples.add(Math.max(0, time - epsilon));
    if (time < duration) samples.add(Math.min(duration, time + epsilon));
    const next = sortedKeys[index + 1];
    if (next !== undefined && next > time) samples.add((time + next) / 2);
  }
  if (samples.size > DEFAULT_PARSE_BUDGET.maxTotalSamples) {
    throw new Error("Semantic sample schedule exceeds the validation limit.");
  }
  return [...samples].sort((left, right) => left - right);
}

function solveWorldPose({
  channels,
  nodesByRole,
  time,
}: {
  channels: ReadonlyMap<Node, NodeChannels>;
  nodesByRole: ReadonlyMap<string, Node>;
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
      ? sampleTrack(channel.translation, time) as [number, number, number]
      : node.getTranslation();
    const rotation = channel?.rotation
      ? sampleTrack(channel.rotation, time) as [number, number, number, number]
      : node.getRotation();
    const local = new Matrix4().compose(
      new Vector3(...translation),
      new Quaternion(...rotation).normalize(),
      new Vector3(...node.getScale()),
    );
    const parent = node.getParentNode();
    const world = parent ? solveNode(parent).clone().multiply(local) : local;
    visiting.delete(node);
    worldByNode.set(node, world);
    return world;
  };

  const output = new Map<string, WorldTransform>();
  for (const [role, node] of nodesByRole) {
    const position = new Vector3();
    const quaternion = new Quaternion();
    solveNode(node).decompose(position, quaternion, new Vector3());
    output.set(role, { position, quaternion: quaternion.normalize() });
  }
  return output;
}

function sampleTrack(track: SampledTrack, time: number) {
  const size = track.path === "rotation" ? 4 : 3;
  if (track.times.length === 0) {
    return track.path === "rotation" ? [0, 0, 0, 1] : [0, 0, 0];
  }
  if (track.times.length === 1 || time <= track.times[0]!) {
    return track.values.slice(0, size);
  }
  const last = track.times.length - 1;
  if (time >= track.times[last]!) {
    return track.values.slice(last * size, last * size + size);
  }
  let low = 0;
  let high = last;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (track.times[middle]! <= time) low = middle;
    else high = middle;
  }
  const alpha =
    (time - track.times[low]!) /
    (track.times[low + 1]! - track.times[low]!);
  if (track.path === "translation") {
    return new Vector3(...track.values.slice(low * 3, low * 3 + 3) as [number, number, number])
      .lerp(
        new Vector3(...track.values.slice((low + 1) * 3, (low + 1) * 3 + 3) as [number, number, number]),
        alpha,
      )
      .toArray();
  }
  const left = new Quaternion(
    ...track.values.slice(low * 4, low * 4 + 4) as [number, number, number, number]
  ).normalize();
  const right = new Quaternion(
    ...track.values.slice((low + 1) * 4, (low + 1) * 4 + 4) as [number, number, number, number]
  ).normalize();
  if (left.dot(right) < 0) {
    right.set(-right.x, -right.y, -right.z, -right.w);
  }
  return left.slerp(right, alpha).normalize().toArray();
}

function createSymmetryPairs(
  roles: readonly { id: string; side?: "left" | "right" | "center" }[],
) {
  const leftByKey = new Map<string, string>();
  const rightByKey = new Map<string, string>();
  for (const role of roles) {
    const key = role.id.toLowerCase().replaceAll("left", "side").replaceAll("right", "side");
    if (role.side === "left") leftByKey.set(key, role.id);
    if (role.side === "right") rightByKey.set(key, role.id);
  }
  return [...leftByKey].flatMap(([key, left]) => {
    const right = rightByKey.get(key);
    return right ? [[left, right] as const] : [];
  });
}

function relativePosition(position?: Vector3, origin?: Vector3) {
  return position?.clone().sub(origin ?? new Vector3()) ?? new Vector3();
}

function appendThresholdIssues(
  issues: string[],
  thresholds: SemanticValidationThresholds,
  metrics: Omit<RigMotionSemanticValidationResult["metrics"], "durationErrorSeconds">,
) {
  const checks = [
    [metrics.maxRotationErrorDegrees, thresholds.rotationDegrees, "rotation", "deg"],
    [metrics.maxRootDisplacementErrorMeters, thresholds.rootDisplacementMeters, "root displacement", "m"],
    [metrics.maxRootDirectionErrorDegrees, thresholds.rootDirectionDegrees, "root direction", "deg"],
    [metrics.maxEndEffectorErrorMeters, thresholds.endEffectorMeters, "end-effector", "m"],
    [metrics.maxSymmetryErrorMeters, thresholds.symmetryMeters, "left/right symmetry", "m"],
  ] as const;
  for (const [actual, limit, label, unit] of checks) {
    if (actual > limit) {
      issues.push(
        `${label} error ${actual.toFixed(6)}${unit} exceeds ${limit.toFixed(6)}${unit}`,
      );
    }
  }
}
