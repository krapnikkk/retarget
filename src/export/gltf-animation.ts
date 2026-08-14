import { Accessor, Document, WebIO, type Node } from "@gltf-transform/core";
import { Quaternion } from "three";
import { GENERIC_GLTF_HUMANOID_PROFILE } from "@/profiles";
import type { HumanoidBoneName, RetargetedMotionClip } from "@/retarget";
import {
  bindCanonicalRotationDeltasToTargetLocal,
  bindCanonicalTranslationOffsetsToTargetLocal,
  createCanonicalToTargetWorldCorrection,
} from "@/retarget/target-binding";
import { validateMotionClip } from "@/retarget";
import {
  resolveExportBoneName,
  type BoneNamingOptions,
  type BoneNamingProfileId,
} from "./bone-naming";

export async function exportGLTFAnimation(
  clip: RetargetedMotionClip,
  options: BoneNamingOptions = {},
): Promise<Uint8Array> {
  const document = createGLTFAnimationDocument(clip, options);
  return new WebIO().writeBinary(document);
}

export function createGLTFAnimationDocument(
  clip: RetargetedMotionClip,
  { boneNamingProfile = "canonical" }: BoneNamingOptions = {},
) {
  const validation = validateMotionClip(clip);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  const document = new Document();
  const buffer = document.createBuffer("animation-buffer");
  const scene = document.createScene("humanoid motion scene");
  document.getRoot().setDefaultScene(scene);
  const restHipsHeight = getGLTFAnimationRestHipsHeight(clip);

  const nodesByBone = createHumanoidNodes(
    document,
    scene,
    [...new Set(clip.tracks.map((track) => track.bone))],
    boneNamingProfile,
    restHipsHeight,
  );
  addClipAnimation(
    document,
    buffer,
    nodesByBone,
    bindCanonicalClipToStandaloneGLTF(clip, restHipsHeight),
  );

  return document;
}

function bindCanonicalClipToStandaloneGLTF(
  clip: RetargetedMotionClip,
  restHipsHeight: number,
): RetargetedMotionClip {
  const identity = new Quaternion();
  const canonicalToGLTF = createCanonicalToTargetWorldCorrection(
    GENERIC_GLTF_HUMANOID_PROFILE,
  );
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.path === "rotation") {
        return {
          ...track,
          values: bindCanonicalRotationDeltasToTargetLocal(
            track.values,
            identity,
            canonicalToGLTF,
          ),
        };
      }
      const offsets = bindCanonicalTranslationOffsetsToTargetLocal(
        track.values,
        identity,
        canonicalToGLTF,
      );
      return {
        ...track,
        values: offsets.map((value, index) =>
          index % 3 === 1 ? value + restHipsHeight : value,
        ),
      };
    }),
  };
}

export function addClipAnimation(
  document: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  nodesByBone: ReadonlyMap<HumanoidBoneName, Node>,
  clip: RetargetedMotionClip,
) {
  const animation = document.createAnimation(clip.name || "retargeted-motion");

  for (const track of clip.tracks) {
    const node = nodesByBone.get(track.bone);
    if (!node) {
      continue;
    }

    const input = document
      .createAccessor(`${track.bone}.${track.path}.time`)
      .setArray(new Float32Array(track.times))
      .setType(Accessor.Type.SCALAR!)
      .setBuffer(buffer);
    const output = document
      .createAccessor(`${track.bone}.${track.path}.value`)
      .setArray(new Float32Array(track.values))
      .setType(
        track.path === "rotation" ? Accessor.Type.VEC4! : Accessor.Type.VEC3!,
      )
      .setBuffer(buffer);
    const sampler = document
      .createAnimationSampler(`${track.bone}.${track.path}.sampler`)
      .setInput(input)
      .setOutput(output)
      .setInterpolation("LINEAR");
    const channel = document
      .createAnimationChannel(`${track.bone}.${track.path}.channel`)
      .setTargetNode(node)
      .setTargetPath(track.path)
      .setSampler(sampler);

    animation.addSampler(sampler).addChannel(channel);
  }
}

const HUMANOID_BONE_PARENT: Partial<Record<HumanoidBoneName, HumanoidBoneName>> = {
  spine: "hips",
  chest: "spine",
  upperChest: "chest",
  neck: "upperChest",
  head: "neck",
  leftShoulder: "upperChest",
  leftUpperArm: "leftShoulder",
  leftLowerArm: "leftUpperArm",
  leftHand: "leftLowerArm",
  leftThumbMetacarpal: "leftHand",
  leftThumbProximal: "leftThumbMetacarpal",
  leftThumbDistal: "leftThumbProximal",
  leftIndexProximal: "leftHand",
  leftIndexIntermediate: "leftIndexProximal",
  leftIndexDistal: "leftIndexIntermediate",
  leftMiddleProximal: "leftHand",
  leftMiddleIntermediate: "leftMiddleProximal",
  leftMiddleDistal: "leftMiddleIntermediate",
  leftRingProximal: "leftHand",
  leftRingIntermediate: "leftRingProximal",
  leftRingDistal: "leftRingIntermediate",
  leftLittleProximal: "leftHand",
  leftLittleIntermediate: "leftLittleProximal",
  leftLittleDistal: "leftLittleIntermediate",
  rightShoulder: "upperChest",
  rightUpperArm: "rightShoulder",
  rightLowerArm: "rightUpperArm",
  rightHand: "rightLowerArm",
  rightThumbMetacarpal: "rightHand",
  rightThumbProximal: "rightThumbMetacarpal",
  rightThumbDistal: "rightThumbProximal",
  rightIndexProximal: "rightHand",
  rightIndexIntermediate: "rightIndexProximal",
  rightIndexDistal: "rightIndexIntermediate",
  rightMiddleProximal: "rightHand",
  rightMiddleIntermediate: "rightMiddleProximal",
  rightMiddleDistal: "rightMiddleIntermediate",
  rightRingProximal: "rightHand",
  rightRingIntermediate: "rightRingProximal",
  rightRingDistal: "rightRingIntermediate",
  rightLittleProximal: "rightHand",
  rightLittleIntermediate: "rightLittleProximal",
  rightLittleDistal: "rightLittleIntermediate",
  leftUpperLeg: "hips",
  leftLowerLeg: "leftUpperLeg",
  leftFoot: "leftLowerLeg",
  leftToes: "leftFoot",
  rightUpperLeg: "hips",
  rightLowerLeg: "rightUpperLeg",
  rightFoot: "rightLowerLeg",
  rightToes: "rightFoot",
};

function createHumanoidNodes(
  document: Document,
  scene: ReturnType<Document["createScene"]>,
  bones: HumanoidBoneName[],
  boneNamingProfile: BoneNamingProfileId,
  restHipsHeight: number,
) {
  const needed = new Set(bones);
  needed.add("hips");
  for (const bone of bones) {
    let ancestor = HUMANOID_BONE_PARENT[bone];
    while (ancestor && !needed.has(ancestor)) {
      needed.add(ancestor);
      ancestor = HUMANOID_BONE_PARENT[ancestor];
    }
  }

  const nodesByBone = new Map<HumanoidBoneName, Node>();
  const hips = document
    .createNode(resolveExportBoneName("hips", boneNamingProfile))
    .setTranslation([0, restHipsHeight, 0]);
  scene.addChild(hips);
  nodesByBone.set("hips", hips);

  for (const bone of needed) {
    if (bone === "hips") continue;
    const node = document.createNode(resolveExportBoneName(bone, boneNamingProfile));
    const parentBone = HUMANOID_BONE_PARENT[bone];
    const parent = parentBone ? nodesByBone.get(parentBone) : undefined;
    (parent ?? hips).addChild(node);
    nodesByBone.set(bone, node);
  }

  return nodesByBone;
}

function getGLTFAnimationRestHipsHeight(clip: RetargetedMotionClip) {
  const sourceRestHipsHeight = clip.metadata?.restHipsHeight;
  if (
    typeof sourceRestHipsHeight === "number" &&
    Number.isFinite(sourceRestHipsHeight) &&
    sourceRestHipsHeight > 0
  ) {
    return sourceRestHipsHeight;
  }

  const targetRestHipsHeight = clip.target.restHipsHeight;
  if (
    typeof targetRestHipsHeight === "number" &&
    Number.isFinite(targetRestHipsHeight) &&
    targetRestHipsHeight > 0
  ) {
    return targetRestHipsHeight;
  }

  return 1;
}
