import { Quaternion, Vector3 } from "three";
import { assertValidParentGraph } from "@/core/parent-graph";
import {
  getRequiredRigRoles,
  getRigCompatibility,
  calculateRequiredChainCoverage,
  type RigDefinition,
  type RigInspection,
} from "@/rigs";
import type {
  Quat,
  RetargetedRigMotionV2,
  RigMotionTrack,
  RigMotionV2,
  RigRestTransform,
  RigMotionSolverId,
  Vec3,
} from "@/rig-motion";
import { validateRigMotion } from "@/rig-motion";

export function solveRigMotionToTarget({
  motion,
  target,
  targetFilename,
}: {
  motion: RigMotionV2;
  target: Omit<RigInspection, "nodesByRole" | "rolesByNode">;
  targetFilename: string;
}): RetargetedRigMotionV2 {
  const sourceValidation = validateRigMotion(motion);
  if (!sourceValidation.ok) {
    throw new Error(sourceValidation.issues.join(" "));
  }
  assertValidParentGraph({
    nodeIds: target.restPose.map((transform) => transform.role),
    edges: target.restPose.flatMap((transform) =>
      transform.parentRole
        ? [{ childId: transform.role, parentId: transform.parentRole }]
        : []
    ),
    label: "Target rig rest-pose hierarchy",
  });
  const compatibility = getRigCompatibility(
    {
      rigFamily: motion.family,
      rigDefinitionId: motion.rigDefinitionId,
    },
    {
      rigFamily: target.definition.family,
      rigDefinitionId: target.definition.id,
    },
  );
  if (!compatibility.compatible) {
    throw new Error(
      `Incompatible rigs: ${motion.rigDefinitionId} -> ${target.definition.id} (${compatibility.reason}).`,
    );
  }
  const sourceMissing = getRequiredRigRoles(target.definition).filter(
    (role) => !motion.restPose.some((transform) => transform.role === role),
  );
  if (sourceMissing.length > 0 || target.missingRequiredRoles.length > 0) {
    throw new Error(
      [
        sourceMissing.length > 0
          ? `Missing required source roles: ${sourceMissing.join(", ")}.`
          : "",
        target.missingRequiredRoles.length > 0
          ? `Missing required target roles: ${target.missingRequiredRoles.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  const sourceTopologyConflicts = motion.source.topologyConflicts ?? [];
  if (
    sourceTopologyConflicts.length > 0 ||
    target.topologyConflicts.length > 0
  ) {
    throw new Error(
      [
        sourceTopologyConflicts.length > 0
          ? `Source topology conflicts: ${sourceTopologyConflicts.map((item) => item.role).join(", ")}.`
          : "",
        target.topologyConflicts.length > 0
          ? `Target topology conflicts: ${target.topologyConflicts.map((item) => item.role).join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  const sourceRest = new Map(
    motion.restPose.map((transform) => [transform.role, transform]),
  );
  const targetRest = new Map(
    target.restPose.map((transform) => [transform.role, transform]),
  );
  const exact = motion.source.rigSignature === target.signature;
  const rootScale = exact
    ? 1
    : calculateRootScale(target.definition, sourceRest, targetRest);
  const tracks = exact
    ? motion.tracks.map((track) => ({
        ...track,
        times: [...track.times],
        values: [...track.values],
      }))
    : motion.family === "serpentine"
      ? transferSerpentineTracks(motion.tracks, sourceRest, targetRest, rootScale)
      : transferMappedTracks(motion.tracks, sourceRest, targetRest, rootScale);
  const mappedRoles = new Set(tracks.map((track) => track.role));
  const requiredRoles = getRequiredRigRoles(target.definition);
  const jointlyMappedRoles = new Set(
    target.definition.roles
      .map((role) => role.id)
      .filter((role) => sourceRest.has(role) && targetRest.has(role)),
  );
  const missingOptionalSource = target.definition.roles
    .filter((role) => !role.required && !sourceRest.has(role.id))
    .map((role) => role.id);
  const missingOptionalTarget = target.definition.roles
    .filter((role) => !role.required && !targetRest.has(role.id))
    .map((role) => role.id);
  const sourceAxisWarnings = motion.source.axisWarnings ?? [];
  const contacts = target.definition.contactRoles.filter(
    (role) => sourceRest.has(role) && targetRest.has(role),
  );
  const contactDrift = measureContactDrift(
    tracks,
    target.restPose,
    contacts,
  );
  const loopBoundary = measureLoopBoundary(tracks, target.definition.rootRole);

  return {
    ...motion,
    restPose: target.restPose,
    tracks,
    target: {
      kind: "gltf-rigged",
      filename: targetFilename,
      profileId: target.profile.id,
      rigSignature: target.signature,
    },
    diagnostics: {
      solver: {
        id: exact
          ? "same-rest-node-skin-signature"
          : solverIdForFamily(motion.family),
      },
      source: {
        family: motion.family,
        rigDefinitionId: motion.rigDefinitionId,
        profileId: motion.source.profileId,
        signature: motion.source.rigSignature,
        mappedRoles: sourceRest.size,
        requiredRoles: requiredRoles.length,
      },
      target: {
        family: target.definition.family,
        rigDefinitionId: target.definition.id,
        profileId: target.profile.id,
        signature: target.signature,
        mappedRoles: target.restPose.length,
        requiredRoles: requiredRoles.length,
      },
      mapping: {
        mappedRoles: mappedRoles.size,
        requiredRoles: requiredRoles.length,
        requiredChainCoverage:
          calculateRequiredChainCoverage(target.definition, jointlyMappedRoles),
        missingRequiredSourceRoles: sourceMissing,
        missingRequiredTargetRoles: target.missingRequiredRoles,
        unmappedSourceNodes: [],
        unmappedTargetNodes: target.unmappedNodes,
        topologyConflicts: {
          source: sourceTopologyConflicts,
          target: target.topologyConflicts,
        },
        axisWarnings: {
          source: sourceAxisWarnings,
          target: target.axisWarnings,
        },
      },
      contacts: {
        roles: [...target.definition.contactRoles],
        transferredRoles: contacts,
        drift: contactDrift,
      },
      rootScale,
      loopBoundary,
      warnings: [
        ...(missingOptionalSource.length > 0
          ? [`Optional source roles missing: ${missingOptionalSource.join(", ")}.`]
          : []),
        ...(missingOptionalTarget.length > 0
          ? [`Optional target roles missing: ${missingOptionalTarget.join(", ")}.`]
          : []),
        ...(sourceTopologyConflicts.length > 0
          ? [`Source topology conflicts: ${sourceTopologyConflicts.map((item) => item.role).join(", ")}.`]
          : []),
        ...(target.topologyConflicts.length > 0
          ? [`Target topology conflicts: ${target.topologyConflicts.map((item) => item.role).join(", ")}.`]
          : []),
        ...(sourceAxisWarnings.length > 0
          ? [`Source roles without a usable local primary axis: ${sourceAxisWarnings.join(", ")}.`]
          : []),
        ...(target.axisWarnings.length > 0
          ? [`Target roles without a usable local primary axis: ${target.axisWarnings.join(", ")}.`]
          : []),
      ],
      restPose: {
        source: motion.restPose.map(cloneRestTransform),
        target: target.restPose.map(cloneRestTransform),
      },
    },
  };
}

function solverIdForFamily(family: RigMotionV2["family"]): RigMotionSolverId {
  switch (family) {
    case "quadruped":
    case "avian":
    case "arachnid":
    case "creature":
      return "definition-mapped-swing-twist-v1";
    case "serpentine":
      return "serpentine-chain-resample-v1";
    default:
      throw new Error(
        `Rig Motion v2 solver is not active for ${family}; humanoids use Motion JSON v1.`,
      );
  }
}

function transferMappedTracks(
  tracks: readonly RigMotionTrack[],
  sourceRest: ReadonlyMap<string, RigRestTransform>,
  targetRest: ReadonlyMap<string, RigRestTransform>,
  rootScale: number,
) {
  return tracks.flatMap((track) => {
    const source = sourceRest.get(track.role);
    const destination = targetRest.get(track.role);
    if (!source || !destination) return [];
    return [
      track.path === "rotation"
        ? transferRotationTrack(track, source, destination)
        : transferTranslationTrack(track, source, destination, rootScale),
    ];
  });
}

function transferSerpentineTracks(
  tracks: readonly RigMotionTrack[],
  sourceRest: ReadonlyMap<string, RigRestTransform>,
  targetRest: ReadonlyMap<string, RigRestTransform>,
  rootScale: number,
) {
  const output = transferMappedTracks(
    tracks.filter((track) => axialPosition(track.role) === null),
    sourceRest,
    targetRest,
    rootScale,
  );
  const axialTracks = tracks
    .filter(
      (track) => track.path === "rotation" && axialPosition(track.role) !== null,
    )
    .sort(
      (left, right) => axialPosition(left.role)! - axialPosition(right.role)!,
    );
  for (const target of targetRest.values()) {
    const position = axialPosition(target.role);
    if (position === null || axialTracks.length === 0) continue;
    const exact = axialTracks.find(
      (track) => Math.abs(axialPosition(track.role)! - position) <= 1e-6,
    );
    if (exact) {
      const source = sourceRest.get(exact.role);
      if (source) output.push(transferRotationTrack(exact, source, target));
      continue;
    }
    const rightIndex = findFirstAxialTrackAfter(axialTracks, position);
    const left =
      axialTracks[Math.max(0, rightIndex < 0 ? axialTracks.length - 1 : rightIndex - 1)];
    const right = axialTracks[
      rightIndex < 0 ? axialTracks.length - 1 : rightIndex
    ];
    if (!left || !right) continue;
    const leftPosition = axialPosition(left.role)!;
    const rightPosition = axialPosition(right.role)!;
    const alpha =
      rightPosition - leftPosition <= 1e-6
        ? 0
        : (position - leftPosition) / (rightPosition - leftPosition);
    const times = [...new Set([...left.times, ...right.times])].sort(
      (a, b) => a - b,
    );
    const values = times.flatMap((time) => {
      const leftRotation = sampleRotationTrack(left, time);
      const rightRotation = sampleRotationTrack(right, time);
      const rotation = new Quaternion().slerpQuaternions(
        leftRotation,
        rightRotation,
        alpha,
      );
      return [round(rotation.x), round(rotation.y), round(rotation.z), round(rotation.w)];
    });
    const leftRest = sourceRest.get(left.role);
    const rightRest = sourceRest.get(right.role);
    if (!leftRest || !rightRest) continue;
    output.push(
      transferRotationTrack(
        { role: target.role, path: "rotation", times, values },
        interpolateRestTransform(leftRest, rightRest, alpha, target.role),
        target,
      ),
    );
  }
  return output;
}

function cloneRestTransform(transform: RigRestTransform): RigRestTransform {
  return {
    ...transform,
    translation: [...transform.translation],
    rotation: [...transform.rotation],
    worldTranslation: [...transform.worldTranslation],
    worldRotation: [...transform.worldRotation],
    ...(transform.primaryAxis
      ? { primaryAxis: [...transform.primaryAxis] }
      : {}),
  };
}

function transferRotationTrack(
  track: RigMotionTrack,
  source: RigRestTransform,
  target: RigRestTransform,
) {
  const sourceRest = toQuaternion(source.rotation);
  const targetRest = toQuaternion(target.rotation);
  const sourceAxis = toAxis(source.primaryAxis);
  const targetAxis = toAxis(target.primaryAxis);
  const basis =
    sourceAxis && targetAxis
      ? new Quaternion().setFromUnitVectors(sourceAxis, targetAxis).normalize()
      : new Quaternion();
  const basisInverse = basis.clone().invert();
  const values: number[] = [];
  let previous: Quaternion | null = null;
  for (let index = 0; index < track.values.length; index += 4) {
    const animated = new Quaternion(
      track.values[index] ?? 0,
      track.values[index + 1] ?? 0,
      track.values[index + 2] ?? 0,
      track.values[index + 3] ?? 1,
    ).normalize();
    const delta = sourceRest.clone().invert().multiply(animated).normalize();
    const mappedDelta =
      sourceAxis && targetAxis
        ? mapSwingTwist(delta, sourceAxis, basis, basisInverse)
        : delta;
    const output = targetRest.clone().multiply(mappedDelta).normalize();
    if (previous && previous.dot(output) < 0) {
      output.set(-output.x, -output.y, -output.z, -output.w);
    }
    values.push(round(output.x), round(output.y), round(output.z), round(output.w));
    previous = output;
  }
  return { ...track, values };
}

function mapSwingTwist(
  delta: Quaternion,
  sourceAxis: Vector3,
  basis: Quaternion,
  basisInverse: Quaternion,
) {
  const projected = sourceAxis
    .clone()
    .multiplyScalar(
      new Vector3(delta.x, delta.y, delta.z).dot(sourceAxis),
    );
  let twist = new Quaternion(projected.x, projected.y, projected.z, delta.w);
  if (twist.lengthSq() <= 1e-12) {
    twist = new Quaternion();
  } else {
    twist.normalize();
  }
  const swing = delta.clone().multiply(twist.clone().invert()).normalize();
  const mappedSwing = basis.clone().multiply(swing).multiply(basisInverse).normalize();
  const mappedTwist = basis.clone().multiply(twist).multiply(basisInverse).normalize();
  return mappedSwing.multiply(mappedTwist).normalize();
}

function transferTranslationTrack(
  track: RigMotionTrack,
  source: RigRestTransform,
  target: RigRestTransform,
  scale: number,
) {
  const values: number[] = [];
  for (let index = 0; index < track.values.length; index += 3) {
    values.push(
      round(target.translation[0] + ((track.values[index] ?? 0) - source.translation[0]) * scale),
      round(target.translation[1] + ((track.values[index + 1] ?? 0) - source.translation[1]) * scale),
      round(target.translation[2] + ((track.values[index + 2] ?? 0) - source.translation[2]) * scale),
    );
  }
  return { ...track, values };
}

function calculateRootScale(
  definition: RigDefinition,
  source: ReadonlyMap<string, RigRestTransform>,
  target: ReadonlyMap<string, RigRestTransform>,
) {
  const sourceSpan = measureSpan(definition.scaleRoles, source);
  const targetSpan = measureSpan(definition.scaleRoles, target);
  if (sourceSpan <= 1e-6 || targetSpan <= 1e-6) return 1;
  return Number((targetSpan / sourceSpan).toFixed(6));
}

function axialPosition(role: string) {
  const match = /^axial\.(\d+)$/i.exec(role);
  if (!match) return null;
  const ordinal = Number(match[1]);
  return Number.isFinite(ordinal) ? (ordinal - 1) / 19 : null;
}

function sampleRotationTrack(track: RigMotionTrack, time: number) {
  const lastIndex = track.times.length - 1;
  const rightIndex = lowerBound(track.times, time);
  const right = rightIndex < 0 ? lastIndex : rightIndex;
  const left = Math.max(0, right - 1);
  const start = readQuaternion(track.values, left);
  const end = readQuaternion(track.values, right);
  const startTime = track.times[left] ?? time;
  const endTime = track.times[right] ?? time;
  const alpha = endTime - startTime <= 1e-6
    ? 0
    : (time - startTime) / (endTime - startTime);
  return new Quaternion().slerpQuaternions(start, end, alpha).normalize();
}

function sampleTranslationTrack(track: RigMotionTrack, time: number) {
  const lastIndex = track.times.length - 1;
  const rightIndex = lowerBound(track.times, time);
  const right = rightIndex < 0 ? lastIndex : rightIndex;
  const left = Math.max(0, right - 1);
  const startTime = track.times[left] ?? time;
  const endTime = track.times[right] ?? time;
  const alpha = endTime - startTime <= 1e-6
    ? 0
    : (time - startTime) / (endTime - startTime);
  const startOffset = left * 3;
  const endOffset = right * 3;
  return new Vector3(
    lerp(track.values[startOffset] ?? 0, track.values[endOffset] ?? 0, alpha),
    lerp(track.values[startOffset + 1] ?? 0, track.values[endOffset + 1] ?? 0, alpha),
    lerp(track.values[startOffset + 2] ?? 0, track.values[endOffset + 2] ?? 0, alpha),
  );
}

function findFirstAxialTrackAfter(
  tracks: readonly RigMotionTrack[],
  position: number,
) {
  let low = 0;
  let high = tracks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (axialPosition(tracks[middle]!.role)! > position) high = middle;
    else low = middle + 1;
  }
  return low >= tracks.length ? -1 : low;
}

function lowerBound(values: readonly number[], target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle]! >= target) high = middle;
    else low = middle + 1;
  }
  return low >= values.length ? -1 : low;
}

function readQuaternion(values: readonly number[], index: number) {
  const offset = index * 4;
  return new Quaternion(
    values[offset] ?? 0,
    values[offset + 1] ?? 0,
    values[offset + 2] ?? 0,
    values[offset + 3] ?? 1,
  ).normalize();
}

function interpolateRestTransform(
  left: RigRestTransform,
  right: RigRestTransform,
  alpha: number,
  role: string,
): RigRestTransform {
  const localRotation = new Quaternion().slerpQuaternions(
    toQuaternion(left.rotation),
    toQuaternion(right.rotation),
    alpha,
  );
  const worldRotation = new Quaternion().slerpQuaternions(
    toQuaternion(left.worldRotation),
    toQuaternion(right.worldRotation),
    alpha,
  );
  const primaryAxis =
    left.primaryAxis && right.primaryAxis
      ? new Vector3(...left.primaryAxis)
          .lerp(new Vector3(...right.primaryAxis), alpha)
          .normalize()
      : null;
  return {
    role,
    nodeName: role,
    translation: lerpTuple(left.translation, right.translation, alpha),
    rotation: [localRotation.x, localRotation.y, localRotation.z, localRotation.w],
    worldTranslation: lerpTuple(
      left.worldTranslation,
      right.worldTranslation,
      alpha,
    ),
    worldRotation: [
      worldRotation.x,
      worldRotation.y,
      worldRotation.z,
      worldRotation.w,
    ],
    ...(primaryAxis
      ? { primaryAxis: [primaryAxis.x, primaryAxis.y, primaryAxis.z] as Vec3 }
      : {}),
  };
}

function lerpTuple(left: Vec3, right: Vec3, alpha: number): Vec3 {
  return [
    left[0] + (right[0] - left[0]) * alpha,
    left[1] + (right[1] - left[1]) * alpha,
    left[2] + (right[2] - left[2]) * alpha,
  ];
}

function lerp(left: number, right: number, alpha: number) {
  return left + (right - left) * alpha;
}

function measureLoopBoundary(
  tracks: readonly RigMotionTrack[],
  rootRole: string,
) {
  let maxRotationDeltaDegrees = 0;
  let rootTranslationDelta = 0;
  for (const track of tracks) {
    if (track.path === "rotation" && track.values.length >= 8) {
      const first = readQuaternion(track.values, 0);
      const last = readQuaternion(track.values, track.times.length - 1);
      const radians = 2 * Math.acos(Math.min(1, Math.abs(first.dot(last))));
      maxRotationDeltaDegrees = Math.max(
        maxRotationDeltaDegrees,
        (radians * 180) / Math.PI,
      );
    }
    if (
      track.role === rootRole &&
      track.path === "translation" &&
      track.values.length >= 6
    ) {
      const end = track.values.length - 3;
      rootTranslationDelta = Math.hypot(
        (track.values[end] ?? 0) - (track.values[0] ?? 0),
        (track.values[end + 1] ?? 0) - (track.values[1] ?? 0),
        (track.values[end + 2] ?? 0) - (track.values[2] ?? 0),
      );
    }
  }
  return {
    maxRotationDeltaDegrees: round(maxRotationDeltaDegrees),
    rootTranslationDelta: round(rootTranslationDelta),
  };
}

function measureContactDrift(
  tracks: readonly RigMotionTrack[],
  restPose: readonly RigRestTransform[],
  contactRoles: readonly string[],
) {
  const tracksByRoleAndPath = new Map(
    tracks.map((track) => [`${track.role}:${track.path}`, track]),
  );
  const restByRole = new Map(restPose.map((transform) => [transform.role, transform]));
  return contactRoles.map((role) => {
    const chain: RigRestTransform[] = [];
    for (let current = restByRole.get(role); current; ) {
      chain.unshift(current);
      current = current.parentRole ? restByRole.get(current.parentRole) : undefined;
    }
    const times = [...new Set(chain.flatMap((item) => [
      ...(tracksByRoleAndPath.get(`${item.role}:rotation`)?.times ?? []),
      ...(tracksByRoleAndPath.get(`${item.role}:translation`)?.times ?? []),
    ]))]
      .sort((left, right) => left - right);
    const samples = times.map((time) =>
      sampleContactWorld(chain, tracksByRoleAndPath, time),
    );
    let minimumHeight = 0;
    if (samples.length > 0) {
      minimumHeight = Number.POSITIVE_INFINITY;
      for (const sample of samples) {
        minimumHeight = Math.min(minimumHeight, sample.y);
      }
    }
    const grounded = samples
      .map((sample, index) => ({ sample, index }))
      .filter(({ sample }) => sample.y <= minimumHeight + 0.015);
    let maxGroundedDrift = 0;
    for (let index = 1; index < grounded.length; index += 1) {
      const previous = grounded[index - 1];
      const current = grounded[index];
      if (!previous || !current || current.index !== previous.index + 1) continue;
      maxGroundedDrift = Math.max(
        maxGroundedDrift,
        Math.hypot(
          current.sample.x - previous.sample.x,
          current.sample.z - previous.sample.z,
        ),
      );
    }
    return {
      role,
      space: "world" as const,
      sampledFrames: samples.length,
      groundedFrames: grounded.length,
      maxGroundedDrift: round(maxGroundedDrift),
    };
  });
}

function sampleContactWorld(
  chain: readonly RigRestTransform[],
  tracksByRoleAndPath: ReadonlyMap<string, RigMotionTrack>,
  time: number,
) {
  const position = new Vector3();
  const rotation = new Quaternion();
  for (const transform of chain) {
    const translationTrack = tracksByRoleAndPath.get(
      `${transform.role}:translation`,
    );
    const localPosition = translationTrack
      ? sampleTranslationTrack(translationTrack, time)
      : new Vector3(...transform.translation);
    position.add(localPosition.applyQuaternion(rotation));
    const rotationTrack = tracksByRoleAndPath.get(`${transform.role}:rotation`);
    rotation.multiply(
      rotationTrack
        ? sampleRotationTrack(rotationTrack, time)
        : toQuaternion(transform.rotation),
    );
  }
  return position;
}

function measureSpan(
  roles: readonly string[],
  transforms: ReadonlyMap<string, RigRestTransform>,
) {
  const points = roles
    .map((role) => transforms.get(role)?.worldTranslation)
    .filter((point): point is Vec3 => Boolean(point));
  const first = points[0];
  if (!first || points.length < 2) return 0;
  const min = [...first];
  const max = [...first];
  for (const point of points.slice(1)) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? 0, point[axis] ?? 0);
      max[axis] = Math.max(max[axis] ?? 0, point[axis] ?? 0);
    }
  }
  return Math.hypot(
    (max[0] ?? 0) - (min[0] ?? 0),
    (max[1] ?? 0) - (min[1] ?? 0),
    (max[2] ?? 0) - (min[2] ?? 0),
  );
}

function toQuaternion(value: Quat) {
  return new Quaternion(value[0], value[1], value[2], value[3]).normalize();
}

function toAxis(value?: Vec3) {
  if (!value) return null;
  const axis = new Vector3(value[0], value[1], value[2]);
  return axis.lengthSq() > 1e-12 ? axis.normalize() : null;
}

function round(value: number) {
  return Number(value.toFixed(6));
}
