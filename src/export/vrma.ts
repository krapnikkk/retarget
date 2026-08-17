import { Accessor, Document, WebIO, type Node } from "@gltf-transform/core";
import {
  VRMCVRMAnimation,
  VRMC_VRM_EXTENSIONS,
  writeVRMA,
} from "gltf-transform-vrm-extensions";
import {
  getMotionTargetBinding,
  type HumanoidBoneName,
  type RetargetedMotionClip,
  validateMotionClip,
} from "@/retarget";
import {
  resolveExportBoneName,
  type BoneNamingOptions,
} from "./bone-naming";

type WritableVRMAnimationExtension = {
  data?: {
    specVersion: "1.0";
    humanoid: {
      humanBones: Partial<Record<HumanoidBoneName, Record<string, unknown>>>;
    };
  };
  humanoidBoneNodes: Map<string, Node>;
  humanoidNodeBoneNames: Map<Node, string>;
};

export async function exportVRMA(
  clip: RetargetedMotionClip,
  options: BoneNamingOptions = {},
): Promise<Uint8Array> {
  const validation = validateMotionClip(clip);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
  const document = createVRMADocument(clip, options);
  return writeVRMA(io, document);
}

export function createVRMADocument(
  clip: RetargetedMotionClip,
  { boneNamingProfile = "canonical" }: BoneNamingOptions = {},
): Document {
  const document = new Document();
  const buffer = document.createBuffer("motion-buffer");
  const scene = document.createScene("VRMA motion scene");
  document.getRoot().setDefaultScene(scene);
  const restHipsHeight = getVRMARestHipsHeight(clip);

  const extension = document
    .createExtension(VRMCVRMAnimation)
    .setRequired(false);
  const writableExtension =
    extension as unknown as WritableVRMAnimationExtension;

  const nodesByBone = new Map<HumanoidBoneName, Node>();
  for (const track of clip.tracks) {
    if (nodesByBone.has(track.bone)) {
      continue;
    }

    const node = document.createNode(
      resolveExportBoneName(track.bone, boneNamingProfile),
    );
    if (track.bone === "hips") {
      node.setTranslation([0, restHipsHeight, 0]);
    }
    scene.addChild(node);
    nodesByBone.set(track.bone, node);
    writableExtension.humanoidBoneNodes.set(track.bone, node);
    writableExtension.humanoidNodeBoneNames.set(node, track.bone);
  }

  writableExtension.data = {
    specVersion: "1.0",
    humanoid: {
      humanBones: Object.fromEntries(
        [...nodesByBone.keys()].map((bone) => [bone, {}]),
      ),
    },
  };

  const animation = document.createAnimation(clip.name);
  for (const track of clip.tracks) {
    if (track.path === "translation" && track.bone !== "hips") {
      continue;
    }

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
      .setArray(
        new Float32Array(
          track.path === "translation"
            ? addRestHipsTranslation(track.values, restHipsHeight)
            : track.values,
        ),
      )
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

  return document;
}

function addRestHipsTranslation(values: readonly number[], restHipsHeight: number) {
  return values.map((value, index) => (index % 3 === 1 ? value + restHipsHeight : value));
}

function getVRMARestHipsHeight(clip: RetargetedMotionClip) {
  const restHipsHeight =
    getMotionTargetBinding(clip)?.restHipsHeight ??
    clip.metadata?.targetHeight ??
    clip.metadata?.restHipsHeight;
  if (typeof restHipsHeight === "number" && restHipsHeight > 0) {
    return restHipsHeight;
  }

  return 1;
}
