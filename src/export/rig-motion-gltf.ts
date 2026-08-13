import { Accessor, Document, WebIO, type Node } from "@gltf-transform/core";
import { inspectGLTFRig, type RigInspectionOptions } from "@/rigs";
import {
  validateRigMotion,
  type RetargetedRigMotionV2,
  type RigMotionV2,
} from "@/rig-motion";
import { readGLTFDocument } from "@/import/gltf-document";
import { validateRigMotionDocumentSemantics } from "@/validation";

export async function exportRigMotionGLTF(motion: RigMotionV2) {
  const validation = validateRigMotion(motion);
  if (!validation.ok) throw new Error(validation.issues.join(" "));
  const document = new Document();
  const scene = document.createScene(`${motion.family} motion scene`);
  document.getRoot().setDefaultScene(scene);
  const buffer = document.createBuffer("rig-motion-buffer");
  const nodesByRole = createRestPoseNodes(document, scene, motion);
  addRigMotionAnimation(document, buffer, nodesByRole, motion);
  return new WebIO().writeBinary(document);
}

export async function exportAnimatedRigGLB({
  avatarFile,
  motion,
  inspectionOptions = {},
}: {
  avatarFile: File;
  motion: RetargetedRigMotionV2;
  inspectionOptions?: RigInspectionOptions;
}) {
  const bytes = new Uint8Array(await avatarFile.arrayBuffer());
  const document = await readGLTFDocument(bytes, avatarFile);
  const inspection = inspectGLTFRig(document, inspectionOptions);
  if (inspection.signature !== motion.target.rigSignature) {
    throw new Error(
      "Animated GLB target signature differs from the motion target; retarget again before export.",
    );
  }
  const buffer =
    document.getRoot().listBuffers()[0] ?? document.createBuffer("rig-motion-buffer");
  addRigMotionAnimation(document, buffer, inspection.nodesByRole, motion);
  return new WebIO().writeBinary(document);
}

export async function validateRigMotionGLTFReload(
  bytes: Uint8Array,
  expected: RigMotionV2,
) {
  try {
    const document = await new WebIO().readBinary(bytes);
    const animation = document.getRoot().listAnimations().at(-1);
    if (!animation) {
      return { ok: false as const, issue: "Reloaded GLB has no animation." };
    }
    const channelCount = animation.listChannels().length;
    if (channelCount !== expected.tracks.length) {
      return {
        ok: false as const,
        issue: `Reloaded animation has ${channelCount}/${expected.tracks.length} channels.`,
      };
    }
    return {
      ok: true as const,
      semantic: validateRigMotionDocumentSemantics({ document, expected }),
    };
  } catch (error) {
    return {
      ok: false as const,
      issue: error instanceof Error ? error.message : String(error),
    };
  }
}

export function addRigMotionAnimation(
  document: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  nodesByRole: ReadonlyMap<string, Node>,
  motion: RigMotionV2,
) {
  const animation = document.createAnimation(motion.name || "rig-motion");
  for (const track of motion.tracks) {
    const node = nodesByRole.get(track.role);
    if (!node) continue;
    const input = document
      .createAccessor(`${track.role}.${track.path}.time`)
      .setArray(new Float32Array(track.times))
      .setType(Accessor.Type.SCALAR!)
      .setBuffer(buffer);
    const output = document
      .createAccessor(`${track.role}.${track.path}.value`)
      .setArray(new Float32Array(track.values))
      .setType(track.path === "rotation" ? Accessor.Type.VEC4! : Accessor.Type.VEC3!)
      .setBuffer(buffer);
    const sampler = document
      .createAnimationSampler(`${track.role}.${track.path}.sampler`)
      .setInput(input)
      .setOutput(output)
      .setInterpolation("LINEAR");
    const channel = document
      .createAnimationChannel(`${track.role}.${track.path}.channel`)
      .setTargetNode(node)
      .setTargetPath(track.path)
      .setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
  return animation;
}

function createRestPoseNodes(
  document: Document,
  scene: ReturnType<Document["createScene"]>,
  motion: RigMotionV2,
) {
  const nodes = new Map<string, Node>();
  for (const transform of motion.restPose) {
    nodes.set(
      transform.role,
      document
        .createNode(transform.nodeName || transform.role)
        .setTranslation(transform.translation)
        .setRotation(transform.rotation),
    );
  }
  for (const transform of motion.restPose) {
    const node = nodes.get(transform.role)!;
    const parent = transform.parentRole
      ? nodes.get(transform.parentRole)
      : undefined;
    if (parent) parent.addChild(node);
    else scene.addChild(node);
  }
  return nodes;
}
