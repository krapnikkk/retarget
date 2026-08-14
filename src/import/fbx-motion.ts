import {
  LoadingManager,
  Quaternion,
  Texture,
  Vector3,
  type AnimationClip,
  type KeyframeTrack,
  type Loader,
  type Object3D,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { RigProfile } from "@/profiles";
import {
  createRetargetError,
  type CanonicalMotionSourceKind,
  type MotionTrack,
  type MotionTrackPath,
  type HumanoidBoneName,
} from "@/retarget";
import type { SourceBoneRestTransform } from "@/retarget/source-normalization";
import { assertMotionFileWithinLimit } from "@/jobs/asset-memory-policy";
import {
  DEFAULT_PARSE_BUDGET,
  assertInputWithinBudget,
} from "./parse-budget";
import {
  createImportedHumanoidMotionClip,
  normalizeImportedTracks,
  resolveProfileBoneName,
} from "./humanoid-motion";

export async function importFBXHumanoidMotion({
  file,
  kind,
  profile,
  animationIndex,
  animationName,
}: {
  file: File;
  kind: Extract<
    CanonicalMotionSourceKind,
    "mixamo-fbx" | "actorcore-fbx" | "generic-fbx"
  >;
  profile: RigProfile;
  animationIndex?: number;
  animationName?: string;
}) {
  assertMotionFileWithinLimit(file);
  return importFBXHumanoidMotionBytes({
    bytes: await file.arrayBuffer(),
    filename: file.name,
    kind,
    profile,
    animationIndex,
    animationName,
  });
}

export function importFBXHumanoidMotionBytes({
  bytes,
  filename,
  kind,
  profile,
  animationIndex,
  animationName,
}: {
  bytes: ArrayBuffer;
  filename: string;
  kind: Extract<
    CanonicalMotionSourceKind,
    "mixamo-fbx" | "actorcore-fbx" | "generic-fbx"
  >;
  profile: RigProfile;
  animationIndex?: number;
  animationName?: string;
}) {
  assertInputWithinBudget(bytes.byteLength, DEFAULT_PARSE_BUDGET, {
    filename,
    section: kind,
  });
  const group = parseFBX(bytes);
  const animationClip = selectFBXAnimation(group.animations, {
    animationIndex,
    animationName,
  });
  if (animationClip.duration <= 0) {
    throw createRetargetError("FBX_NO_ANIMATION");
  }

  return createImportedFBXMotionClipFromAnimation({
    animationClip,
    filename,
    kind,
    profile: applyFBXUnitEvidence(profile, group),
    rootName: group.name || "FBX animation",
    sourceRoot: group,
  });
}

export function selectFBXAnimation(
  animations: readonly AnimationClip[],
  {
    animationIndex,
    animationName,
  }: { animationIndex?: number; animationName?: string } = {},
) {
  if (animations.length === 0) {
    throw createRetargetError("FBX_NO_ANIMATION");
  }
  let selectedIndex = animationIndex;
  if (animationName !== undefined) {
    const matches = animations.flatMap((animation, index) =>
      animation.name === animationName ? [index] : [],
    );
    if (matches.length !== 1) {
      throw createRetargetError(
        matches.length === 0
          ? "FBX_ANIMATION_NOT_FOUND"
          : "FBX_ANIMATION_SELECTION_REQUIRED",
      );
    }
    if (selectedIndex !== undefined && selectedIndex !== matches[0]) {
      throw createRetargetError("FBX_ANIMATION_NOT_FOUND");
    }
    selectedIndex = matches[0];
  }
  if (selectedIndex === undefined) {
    if (animations.length !== 1) {
      throw createRetargetError("FBX_ANIMATION_SELECTION_REQUIRED");
    }
    selectedIndex = 0;
  }
  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= animations.length
  ) {
    throw createRetargetError("FBX_ANIMATION_NOT_FOUND");
  }
  return animations[selectedIndex]!;
}

function applyFBXUnitEvidence(profile: RigProfile, root: Object3D): RigProfile {
  if (profile.scaleUnit !== "unknown") return profile;
  const factor = root.userData.unitScaleFactor;
  const scaleUnit = factor === 100
    ? "meters"
    : factor === 1
      ? "centimeters"
      : "unknown";
  return scaleUnit === "unknown" ? profile : { ...profile, scaleUnit };
}

export function createImportedFBXMotionClipFromAnimation({
  animationClip,
  filename = "motion.fbx",
  kind,
  profile,
  rootName,
  sourceRoot,
}: {
  animationClip: AnimationClip;
  filename?: string;
  kind: Extract<
    CanonicalMotionSourceKind,
    "mixamo-fbx" | "actorcore-fbx" | "generic-fbx"
  >;
  profile: RigProfile;
  rootName?: string;
  sourceRoot?: Object3D;
}) {
  const tracks = normalizeImportedTracks(
    animationClip.tracks
      .map((track) => createMotionTrackFromFBXTrack(track, profile))
      .filter((track): track is MotionTrack => Boolean(track)),
  );

  if (tracks.length === 0) {
    throw createRetargetError(
      kind === "mixamo-fbx" ? "FBX_NOT_MIXAMO" : "UNSUPPORTED_FORMAT",
      filename,
    );
  }

  const sourceRest = sourceRoot
    ? collectSourceRestTransforms(sourceRoot, profile)
    : undefined;
  return createImportedHumanoidMotionClip({
    kind,
    filename,
    profile,
    tracks,
    duration: animationClip.duration,
    rootName: rootName ?? animationClip.name,
    restHipsHeight: sourceRest?.restHipsHeight,
    restTransforms: sourceRest?.transforms,
    rotationSemantics: sourceRest ? "absolute-local" : "delta-local",
    translationSemantics: sourceRest ? "absolute-local" : "root-offset",
  });
}

function collectSourceRestTransforms(root: Object3D, profile: RigProfile) {
  root.updateMatrixWorld(true);
  const transforms = new Map<HumanoidBoneName, SourceBoneRestTransform>();
  let restHipsHeight: number | undefined;
  root.traverse((object) => {
    const bone = resolveFBXBoneName(profile, object.name);
    if (!bone || transforms.has(bone)) return;
    const parentWorld = object.parent
      ? object.parent.getWorldQuaternion(new Quaternion())
      : new Quaternion();
    const world = object.getWorldQuaternion(new Quaternion());
    transforms.set(bone, {
      localPosition: vectorTuple(object.position),
      parentWorldQuaternion: quaternionTuple(parentWorld),
      worldQuaternion: quaternionTuple(world),
    });
    if (bone === "hips") {
      const height = object.getWorldPosition(new Vector3()).y;
      restHipsHeight = height > 0 ? height : undefined;
    }
  });
  return { restHipsHeight, transforms };
}

function vectorTuple(value: Vector3): [number, number, number] {
  return [value.x, value.y, value.z];
}

function quaternionTuple(value: Quaternion): [number, number, number, number] {
  return [value.x, value.y, value.z, value.w];
}

function parseFBX(arrayBuffer: ArrayBuffer) {
  try {
    return new FBXLoader(createMotionOnlyLoadingManager()).parse(arrayBuffer, "");
  } catch (cause) {
    throw createRetargetError("FBX_PARSE_FAILED", cause);
  }
}

function createMotionOnlyLoadingManager() {
  const manager = new LoadingManager();
  manager.addHandler(
    /.*/,
    {
      load: () => new Texture(),
    } as unknown as Loader<Texture>,
  );
  return manager;
}

function createMotionTrackFromFBXTrack(
  track: KeyframeTrack,
  profile: RigProfile,
): MotionTrack | null {
  const parsed = parseFBXTrackName(track.name);
  if (!parsed) {
    return null;
  }

  const bone = resolveFBXBoneName(profile, parsed.nodeName);
  if (!bone) {
    return null;
  }

  const path = normalizeFBXTrackPath(parsed.propertyName);
  if (!path || (path === "translation" && bone !== "hips")) {
    return null;
  }

  return {
    bone,
    path,
    times: Array.from(track.times),
    values: Array.from(track.values),
  };
}

function resolveFBXBoneName(profile: RigProfile, nodeName: string) {
  return (
    resolveProfileBoneName(profile, nodeName) ??
    (/^Model.+/.test(nodeName)
      ? resolveProfileBoneName(profile, nodeName.slice("Model".length))
      : null)
  );
}

function parseFBXTrackName(trackName: string) {
  const bracketBone = trackName.match(/\.bones\[([^\]]+)\]\.(\w+)$/);
  if (bracketBone) {
    return {
      nodeName: stripNodePath(bracketBone[1] ?? ""),
      propertyName: bracketBone[2] ?? "",
    };
  }

  const dotIndex = trackName.lastIndexOf(".");
  if (dotIndex < 0) {
    return null;
  }

  return {
    nodeName: stripNodePath(trackName.slice(0, dotIndex)),
    propertyName: trackName.slice(dotIndex + 1),
  };
}

function stripNodePath(nodeName: string) {
  return nodeName
    .replace(/^['"]|['"]$/g, "")
    .split(/[|/\\]/)
    .at(-1)
    ?.trim() ?? nodeName;
}

function normalizeFBXTrackPath(propertyName: string): MotionTrackPath | null {
  const normalized = propertyName.toLowerCase();
  if (normalized === "quaternion" || normalized === "rotation") {
    return "rotation";
  }
  if (normalized === "position" || normalized === "translation") {
    return "translation";
  }

  return null;
}
