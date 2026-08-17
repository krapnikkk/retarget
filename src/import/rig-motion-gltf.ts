import type { Animation, Document } from "@gltf-transform/core";
import { inspectGLTFRig, type RigInspectionOptions } from "@/rigs";
import {
  RIG_MOTION_SCHEMA_VERSION,
  type RigMotionTrack,
  type RigMotionV2,
} from "@/rig-motion";
import { readGLTFDocument } from "./gltf-document";
import { readGLTFAnimationTrack } from "./gltf-interpolation";

export type RigMotionImportOptions = RigInspectionOptions & {
  animationIndex?: number;
  animationName?: string;
  createdAt?: string;
};

export type RigMotionAction = {
  index: number;
  name: string;
};

export async function importRigMotionGLTF(
  bytes: Uint8Array,
  filename = "motion.glb",
  options: RigMotionImportOptions = {},
  sourceFile?: File,
): Promise<RigMotionV2> {
  const document = await readGLTFDocument(bytes, sourceFile);
  return importRigMotionDocument(document, filename, options);
}

export function importRigMotionDocument(
  document: Document,
  filename: string,
  options: RigMotionImportOptions = {},
): RigMotionV2 {
  const inspection = inspectGLTFRig(document, options);
  if (inspection.missingRequiredRoles.length > 0) {
    throw new Error(
      `Missing required ${inspection.definition.id} roles: ${inspection.missingRequiredRoles.join(", ")}.`,
    );
  }
  const animations = document.getRoot().listAnimations();
  const { animation, animationIndex } = selectRigMotionAnimation(
    animations,
    options,
  );
  const tracks = new Map<string, RigMotionTrack>();
  const interpolationModes = new Set<"LINEAR" | "STEP" | "CUBICSPLINE">();
  let resampledTracks = 0;
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const role = node ? inspection.rolesByNode.get(node) : undefined;
    const path = channel.getTargetPath();
    const sampler = channel.getSampler();
    const input = sampler?.getInput();
    const output = sampler?.getOutput();
    if (
      !role ||
      !sampler ||
      !input ||
      !output ||
      (path !== "rotation" && path !== "translation") ||
      (path === "translation" && role !== inspection.definition.translationRole)
    ) {
      continue;
    }
    const interpolation = sampler.getInterpolation();
    const track = readGLTFAnimationTrack({
      filename,
      input,
      interpolation,
      output,
      path,
      section: `animation ${animationIndex} ${role}.${path}`,
    });
    if (track.times.length === 0) continue;
    const key = `${role}.${path}`;
    if (tracks.has(key)) {
      throw new Error(`glTF animation duplicates mapped track ${key}.`);
    }
    interpolationModes.add(interpolation);
    if (track.resampled) resampledTracks += 1;
    tracks.set(key, {
      role,
      path,
      times: track.times,
      values: track.values,
    });
  }
  if (tracks.size === 0) {
    throw new Error(
      `glTF animation does not contain supported ${inspection.definition.id} tracks.`,
    );
  }
  const trackList = [...tracks.values()];
  const duration = Math.max(...trackList.flatMap((track) => track.times));
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("glTF animation duration must be positive.");
  }
  return {
    schemaVersion: RIG_MOTION_SCHEMA_VERSION,
    rigDefinitionId: inspection.definition.id,
    family: inspection.definition.family,
    name: animation.getName() || filename.replace(/\.(gltf|glb)$/i, ""),
    duration,
    fps: inferFPS(trackList),
    source: {
      kind: "gltf-animation",
      filename,
      profileId: inspection.profile.id,
      rigSignature: inspection.signature,
      animation: {
        index: animationIndex,
        name: animation.getName() || `Animation ${animationIndex + 1}`,
        interpolationModes: [...interpolationModes].sort(),
        resampledTracks,
      },
      topologyConflicts: inspection.topologyConflicts,
      axisWarnings: inspection.axisWarnings,
    },
    restPose: inspection.restPose,
    tracks: trackList,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

export function listRigMotionActions(document: Document): RigMotionAction[] {
  return document
    .getRoot()
    .listAnimations()
    .map((animation, index) => ({
      index,
      name: animation.getName() || `Animation ${index + 1}`,
    }));
}

function selectRigMotionAnimation(
  animations: Animation[],
  options: RigMotionImportOptions,
) {
  if (animations.length === 0) {
    throw new Error("glTF file does not contain an animation.");
  }
  let animationIndex = options.animationIndex;
  if (options.animationName !== undefined) {
    const matches = animations.flatMap((animation, index) =>
      animation.getName() === options.animationName ? [index] : [],
    );
    if (matches.length !== 1) {
      throw new Error(`glTF animation ${options.animationName} was not found.`);
    }
    const namedIndex = matches[0]!;
    if (animationIndex !== undefined && animationIndex !== namedIndex) {
      throw new Error("animationName and animationIndex select different actions.");
    }
    animationIndex = namedIndex;
  }
  if (animationIndex === undefined) {
    if (animations.length > 1) {
      throw new Error(
        `glTF contains ${animations.length} animations; select animationName or animationIndex explicitly.`,
      );
    }
    animationIndex = 0;
  }
  if (
    !Number.isInteger(animationIndex) ||
    animationIndex < 0 ||
    animationIndex >= animations.length
  ) {
    throw new Error(`animationIndex ${animationIndex} is out of range.`);
  }
  return { animation: animations[animationIndex]!, animationIndex };
}

function inferFPS(tracks: readonly RigMotionTrack[]) {
  const deltas = tracks
    .flatMap((track) =>
      track.times
        .slice(1)
        .map((time, index) => time - (track.times[index] ?? time)),
    )
    .filter((delta) => delta > 1e-6)
    .sort((left, right) => left - right);
  const median = deltas[Math.floor(deltas.length / 2)];
  return median ? Number((1 / median).toFixed(3)) : 30;
}
