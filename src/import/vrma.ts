import { WebIO, type Document, type Node } from "@gltf-transform/core";
import {
  VRMCVRMAnimation,
  VRMC_VRM_EXTENSIONS,
  assertVRMADocument,
} from "gltf-transform-vrm-extensions";
import {
  isHumanoidBoneName,
  validateMotionClip,
  type CanonicalHumanoidMotionClip,
  type HumanoidBoneName,
  type MotionTrack,
  type MotionTrackPath,
} from "@/retarget";
import type { SourceBoneRestTransform } from "@/retarget/source-normalization";
import { VRM_HUMANOID_PROFILE } from "@/profiles";
import { createImportedHumanoidMotionClip } from "./humanoid-motion";
import { readGLTFAnimationTrack } from "./gltf-interpolation";
import {
  DEFAULT_PARSE_BUDGET,
  ParseDomainError,
  assertCountWithinBudget,
  assertInputWithinBudget,
  type ParseBudget,
} from "./parse-budget";

type VRMAAnimationExtension = VRMCVRMAnimation & {
  getHumanoidBoneNodes: () => ReadonlyMap<string, Node>;
  getHumanoidBoneNameByNode: (node: Node) => string | undefined;
};

const DEFAULT_IMPORTED_FPS = 30;
const SUPPORTED_TARGET_PATHS = new Set(["rotation", "translation"]);

export async function importVRMA(
  bytes: Uint8Array,
  filename = "motion.vrma",
  budget: ParseBudget = DEFAULT_PARSE_BUDGET,
): Promise<CanonicalHumanoidMotionClip> {
  assertInputWithinBudget(bytes.byteLength, budget, {
    filename,
    section: "VRMA",
  });
  const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
  const document = await io.readBinary(bytes);
  assertVRMADocument(document);

  const clip = createMotionClipFromVRMADocument(document, filename, budget);
  const validation = validateMotionClip(clip);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  return clip;
}

export function createMotionClipFromVRMADocument(
  document: Document,
  filename = "motion.vrma",
  budget: ParseBudget = DEFAULT_PARSE_BUDGET,
): CanonicalHumanoidMotionClip {
  const extension = getVRMAAnimationExtension(document);
  const restHipsHeight = getRestHipsHeight(extension);
  const restTransforms = collectRestTransforms(extension);
  const animation = document.getRoot().listAnimations()[0];
  if (!animation) {
    throw new Error("VRMA file does not contain an animation.");
  }

  const tracksByKey = new Map<string, MotionTrack>();
  let duration = 0;
  let totalSamples = 0;
  let resampledTrackCount = 0;

  const channels = animation.listChannels();
  assertCountWithinBudget(
    channels.length,
    budget.maxTracks,
    "VRMA animation channel count",
    { filename, section: "animation" },
  );
  for (const channel of channels) {
    const targetPath = channel.getTargetPath();
    if (!isMotionTrackPath(targetPath)) {
      continue;
    }

    const targetNode = channel.getTargetNode();
    if (!targetNode) {
      continue;
    }

    const bone = resolveVRMABoneName(extension, targetNode);
    if (!bone) {
      continue;
    }

    const sampler = channel.getSampler();
    const input = sampler?.getInput();
    const output = sampler?.getOutput();
    if (!sampler || !input || !output) {
      continue;
    }

    const importedTrack = readGLTFAnimationTrack({
      budget,
      filename,
      input,
      interpolation: sampler.getInterpolation() || "LINEAR",
      output,
      path: targetPath,
      section: `${bone}.${targetPath}`,
    });

    if (importedTrack.times.length === 0 || importedTrack.values.length === 0) {
      continue;
    }
    totalSamples += importedTrack.times.length;
    assertCountWithinBudget(
      totalSamples,
      budget.maxTotalSamples,
      "VRMA total animation samples",
      { filename, section: "animation" },
    );
    if (importedTrack.resampled) resampledTrackCount += 1;

    const key = `${bone}.${targetPath}`;
    if (tracksByKey.has(key)) {
      throw new ParseDomainError(
        "VRMA_DUPLICATE_TRACK",
        `VRMA contains duplicate ${key} tracks`,
        { filename, section: key },
      );
    }

    duration = Math.max(duration, importedTrack.times.at(-1) ?? 0);
    tracksByKey.set(key, {
      bone,
      path: targetPath,
      times: importedTrack.times,
      values: importedTrack.values,
    });
  }

  const tracks = [...tracksByKey.values()];
  if (tracks.length === 0) {
    throw new Error("VRMA file does not contain supported humanoid tracks.");
  }

  return createImportedHumanoidMotionClip({
    duration: Math.max(duration, 1 / DEFAULT_IMPORTED_FPS),
    filename,
    fps: estimateFPS(tracks),
    kind: "vrma",
    profile: VRM_HUMANOID_PROFILE,
    restHipsHeight,
    restTransforms,
    rootName: animation.getName() || stripExtension(filename),
    rotationSemantics: "absolute-local",
    translationSemantics: "absolute-local",
    resampledTrackCount,
    tracks,
  });
}

function getRestHipsHeight(extension: VRMAAnimationExtension) {
  const hipsNode = extension.getHumanoidBoneNodes().get("hips");
  const hipsY = hipsNode?.getWorldTranslation()[1] ?? 0;
  return hipsY > 0 ? roundSample(hipsY) : undefined;
}

function collectRestTransforms(extension: VRMAAnimationExtension) {
  const transforms = new Map<HumanoidBoneName, SourceBoneRestTransform>();
  for (const [name, node] of extension.getHumanoidBoneNodes()) {
    if (!isHumanoidBoneName(name) || transforms.has(name)) continue;
    transforms.set(name, {
      localPosition: tuple3(node.getTranslation()),
      parentWorldQuaternion: tuple4(
        node.getParentNode()?.getWorldRotation() ?? [0, 0, 0, 1],
      ),
      worldQuaternion: tuple4(node.getWorldRotation()),
    });
  }
  return transforms;
}

function getVRMAAnimationExtension(document: Document) {
  const extension = document
    .getRoot()
    .listExtensionsUsed()
    .find(
      (item): item is VRMAAnimationExtension =>
        item.extensionName === VRMCVRMAnimation.EXTENSION_NAME,
    );

  if (!extension) {
    throw new Error("VRMA extension is missing.");
  }

  return extension;
}

function resolveVRMABoneName(
  extension: VRMAAnimationExtension,
  node: Node,
): HumanoidBoneName | null {
  const extensionBone = extension.getHumanoidBoneNameByNode(node);
  if (extensionBone && isHumanoidBoneName(extensionBone)) {
    return extensionBone;
  }

  const nodeName = node.getName();
  return isHumanoidBoneName(nodeName) ? nodeName : null;
}

function isMotionTrackPath(value: string | null): value is MotionTrackPath {
  return Boolean(value && SUPPORTED_TARGET_PATHS.has(value));
}

function estimateFPS(tracks: MotionTrack[]) {
  const deltas = tracks
    .flatMap((track) =>
      track.times
        .slice(1)
        .map((time, index) => time - (track.times[index] ?? time))
        .filter((delta) => delta > 1e-6),
    )
    .sort((a, b) => a - b);

  if (deltas.length === 0) {
    return DEFAULT_IMPORTED_FPS;
  }

  const median = deltas[Math.floor(deltas.length / 2)] ?? 1 / DEFAULT_IMPORTED_FPS;
  return Math.min(Math.max(Math.round(1 / median), 1), 120);
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "") || "imported-vrma";
}

function tuple3(value: readonly number[]): [number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function tuple4(value: readonly number[]): [number, number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
}

function roundSample(value: number) {
  return Number(value.toFixed(6));
}
