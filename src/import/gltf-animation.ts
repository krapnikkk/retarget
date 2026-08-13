import { type Document, type Node } from "@gltf-transform/core";
import { GENERIC_GLTF_HUMANOID_PROFILE } from "@/profiles";
import type { HumanoidBoneName, MotionTrack, MotionTrackPath } from "@/retarget";
import type { SourceBoneRestTransform } from "@/retarget/source-normalization";
import {
  createImportedHumanoidMotionClip,
  normalizeImportedTracks,
  resolveProfileBoneName,
} from "./humanoid-motion";
import { readGLTFDocument } from "./gltf-document";
import {
  DEFAULT_PARSE_BUDGET,
  assertCountWithinBudget,
  assertInputWithinBudget,
} from "./parse-budget";
import { readGLTFAnimationTrack } from "./gltf-interpolation";

const SUPPORTED_TARGET_PATHS = new Set(["rotation", "translation"]);

export async function importGLTFAnimation(
  bytes: Uint8Array,
  filename = "motion.glb",
  sourceFile?: File,
  animationName?: string,
) {
  assertInputWithinBudget(bytes.byteLength, DEFAULT_PARSE_BUDGET, {
    filename,
    section: "glTF animation",
  });
  const document = await readGLTFDocument(bytes, sourceFile);
  const animations = document.getRoot().listAnimations();
  const animation = animationName
    ? [...animations]
        .reverse()
        .find((candidate) => candidate.getName() === animationName)
    : animations[0];
  if (!animation) {
    throw new Error(
      animationName
        ? `glTF file does not contain animation ${animationName}.`
        : "glTF file does not contain an animation.",
    );
  }

  const channels = animation.listChannels();
  assertCountWithinBudget(
    channels.length,
    DEFAULT_PARSE_BUDGET.maxTracks,
    "glTF animation channel count",
    { filename, section: "animation" },
  );
  const tracksByKey = new Map<string, MotionTrack>();
  let totalSamples = 0;
  let resampledTrackCount = 0;
  for (const channel of channels) {
    const path = normalizeTargetPath(channel.getTargetPath());
    const node = channel.getTargetNode();
    const bone = node ? resolveGLTFBoneName(node) : null;
    const sampler = channel.getSampler();
    const input = sampler?.getInput();
    const output = sampler?.getOutput();
    if (!path || !bone || !sampler || !input || !output) {
      continue;
    }
    if (path === "translation" && bone !== "hips") {
      continue;
    }

    const importedTrack = readGLTFAnimationTrack({
      filename,
      input,
      interpolation: sampler.getInterpolation() || "LINEAR",
      output,
      path,
      section: `${bone}.${path}`,
    });
    totalSamples += importedTrack.times.length;
    assertCountWithinBudget(
      totalSamples,
      DEFAULT_PARSE_BUDGET.maxTotalSamples,
      "glTF total animation samples",
      { filename, section: "animation" },
    );
    if (importedTrack.times.length === 0 || importedTrack.values.length === 0) {
      continue;
    }
    if (importedTrack.resampled) resampledTrackCount += 1;

    const key = `${bone}.${path}`;
    if (tracksByKey.has(key)) {
      throw new Error(`glTF animation contains duplicate ${key} channels.`);
    }
    tracksByKey.set(key, {
      bone,
      path,
      times: importedTrack.times,
      values: importedTrack.values,
    });
  }

  const tracks = normalizeImportedTracks([...tracksByKey.values()]);
  if (tracks.length === 0) {
    throw new Error("glTF animation does not contain supported humanoid tracks.");
  }

  const restTransforms = collectSourceRestTransforms(document);
  return createImportedHumanoidMotionClip({
    kind: "gltf-animation",
    filename,
    profile: GENERIC_GLTF_HUMANOID_PROFILE,
    restHipsHeight: getRestHipsHeight(document),
    restTransforms,
    rotationSemantics: "absolute-local",
    translationSemantics: "absolute-local",
    resampledTrackCount,
    tracks,
    rootName: animation.getName() || "glTF animation",
  });
}

function collectSourceRestTransforms(document: Document) {
  const transforms = new Map<HumanoidBoneName, SourceBoneRestTransform>();
  for (const node of document.getRoot().listNodes()) {
    const bone = resolveGLTFBoneName(node);
    if (!bone || transforms.has(bone)) continue;
    transforms.set(bone, {
      localPosition: tuple3(node.getTranslation()),
      parentWorldQuaternion: tuple4(
        node.getParentNode()?.getWorldRotation() ?? [0, 0, 0, 1],
      ),
      worldQuaternion: tuple4(node.getWorldRotation()),
    });
  }
  return transforms;
}

function tuple3(value: readonly number[]): [number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function tuple4(value: readonly number[]): [number, number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
}

function getRestHipsHeight(document: Document) {
  const hips = document
    .getRoot()
    .listNodes()
    .find((node) => resolveGLTFBoneName(node) === "hips");
  const height = hips?.getWorldTranslation()[1];
  return height && height > 0 ? Number(height.toFixed(6)) : undefined;
}

function resolveGLTFBoneName(node: Node): HumanoidBoneName | null {
  return resolveProfileBoneName(GENERIC_GLTF_HUMANOID_PROFILE, node.getName());
}

function normalizeTargetPath(path: string | null): MotionTrackPath | null {
  if (path === "scale") {
    return null;
  }
  if (path === "translation") {
    return "translation";
  }
  if (path === "rotation") {
    return "rotation";
  }

  return path && SUPPORTED_TARGET_PATHS.has(path) ? (path as MotionTrackPath) : null;
}
