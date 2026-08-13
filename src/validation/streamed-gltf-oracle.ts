import { Document, type Accessor } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { GLBRangeInfo } from "@/import/glb-range";
import { readBlobRange } from "@/import/glb-range";
import { DEFAULT_PARSE_BUDGET } from "@/import/parse-budget";
import type { HumanoidBoneName, RetargetedMotionClip } from "@/retarget";
import { validateGLTFWorldSemantics } from "./gltf-world-semantic-oracle";
import { DEFAULT_SEMANTIC_THRESHOLDS } from "./semantic-motion";

export async function validateStreamedGLTFWorldSemantics({
  blob,
  expected,
  info,
  nodesByBone,
  worldAxisCorrection,
}: {
  blob: Blob;
  expected: RetargetedMotionClip;
  info: GLBRangeInfo;
  nodesByBone: ReadonlyMap<HumanoidBoneName, number>;
  worldAxisCorrection?: Quaternion;
}) {
  const { document, documentNodes } = await createStreamedAnimationValidationDocument(
    blob,
    info,
    expected.name,
  );
  return validateGLTFWorldSemantics({
    animationName: expected.name,
    document,
    expected,
    nodesByBone: new Map(
      [...nodesByBone].flatMap(([bone, index]) => {
        const node = documentNodes[index];
        return node ? [[bone, node] as const] : [];
      }),
    ),
    thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    worldAxisCorrection,
  });
}

export async function createStreamedAnimationValidationDocument(
  blob: Blob,
  info: GLBRangeInfo,
  animationName: string,
) {
  if (!info.binaryChunk) {
    throw new Error("Streamed semantic validation requires an embedded BIN chunk.");
  }
  const rawNodes = readArray<Record<string, unknown>>(info.json.nodes, "nodes");
  if (rawNodes.length > DEFAULT_PARSE_BUDGET.maxBones) {
    throw new Error("Streamed GLB node count exceeds the semantic validation limit.");
  }
  const document = new Document();
  const scene = document.createScene("streamed-semantic-validation");
  document.getRoot().setDefaultScene(scene);
  const documentNodes = rawNodes.map((rawNode, index) =>
    createNode(document, rawNode, index),
  );
  const parents = new Map<number, number>();
  rawNodes.forEach((rawNode, parentIndex) => {
    if (rawNode.children === undefined) return;
    const children = readArray<unknown>(
      rawNode.children,
      `nodes[${parentIndex}].children`,
    );
    for (const value of children) {
      const childIndex = readIndex(value, documentNodes.length, "node child");
      if (parents.has(childIndex)) {
        throw new Error(`Streamed GLB node ${childIndex} has multiple parents.`);
      }
      parents.set(childIndex, parentIndex);
      documentNodes[parentIndex]!.addChild(documentNodes[childIndex]!);
    }
  });
  documentNodes.forEach((node, index) => {
    if (!parents.has(index)) scene.addChild(node);
  });

  const animations = readArray<Record<string, unknown>>(
    info.json.animations,
    "animations",
  );
  const rawAnimation = [...animations]
    .reverse()
    .find((animation) => animation.name === animationName);
  if (!rawAnimation) {
    throw new Error(`Streamed GLB has no animation named ${animationName}.`);
  }
  const rawSamplers = readArray<Record<string, unknown>>(
    rawAnimation.samplers,
    "animation samplers",
  );
  const rawChannels = readArray<Record<string, unknown>>(
    rawAnimation.channels,
    "animation channels",
  );
  if (rawChannels.length > DEFAULT_PARSE_BUDGET.maxTracks) {
    throw new Error("Streamed GLB animation channel count exceeds the validation limit.");
  }
  const buffer = document.createBuffer("streamed-animation-validation");
  const accessors = new Map<number, Accessor>();
  let totalSamples = 0;
  const animation = document.createAnimation(
    typeof rawAnimation.name === "string" ? rawAnimation.name : "Animation",
  );
  for (const [channelIndex, rawChannel] of rawChannels.entries()) {
    const target = readObject(rawChannel.target, `animation channel ${channelIndex} target`);
    const nodeIndex = readIndex(
      target.node,
      documentNodes.length,
      `animation channel ${channelIndex} target node`,
    );
    const path = target.path;
    if (path !== "rotation" && path !== "translation" && path !== "scale") {
      throw new Error(`Streamed GLB animation channel ${channelIndex} has an invalid path.`);
    }
    const samplerIndex = readIndex(
      rawChannel.sampler,
      rawSamplers.length,
      `animation channel ${channelIndex} sampler`,
    );
    const rawSampler = rawSamplers[samplerIndex]!;
    const inputIndex = readIndex(
      rawSampler.input,
      readArray<unknown>(info.json.accessors, "accessors").length,
      `animation sampler ${samplerIndex} input`,
    );
    const outputIndex = readIndex(
      rawSampler.output,
      readArray<unknown>(info.json.accessors, "accessors").length,
      `animation sampler ${samplerIndex} output`,
    );
    const input =
      accessors.get(inputIndex) ??
      (await readFloatAccessor({
        accessorIndex: inputIndex,
        blob,
        buffer,
        document,
        expectedType: "SCALAR",
        info,
      }));
    accessors.set(inputIndex, input);
    const outputType = path === "rotation" ? "VEC4" : "VEC3";
    const output =
      accessors.get(outputIndex) ??
      (await readFloatAccessor({
        accessorIndex: outputIndex,
        blob,
        buffer,
        document,
        expectedType: outputType,
        info,
      }));
    accessors.set(outputIndex, output);
    totalSamples += input.getCount();
    if (totalSamples > DEFAULT_PARSE_BUDGET.maxTotalSamples) {
      throw new Error("Streamed GLB animation samples exceed the validation limit.");
    }
    const sampler = document
      .createAnimationSampler(`sampler-${samplerIndex}`)
      .setInput(input)
      .setOutput(output)
      .setInterpolation(
        rawSampler.interpolation === undefined
          ? "LINEAR"
          : readInterpolation(rawSampler.interpolation),
      );
    const channel = document
      .createAnimationChannel(`channel-${channelIndex}`)
      .setTargetNode(documentNodes[nodeIndex]!)
      .setTargetPath(path)
      .setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
  return { document, documentNodes };
}

function createNode(
  document: Document,
  rawNode: Record<string, unknown>,
  index: number,
) {
  const node = document.createNode(
    typeof rawNode.name === "string" ? rawNode.name : `Node ${index}`,
  );
  if (rawNode.matrix !== undefined) {
    const matrix = new Matrix4().fromArray(
      readTuple(rawNode.matrix, 16, `nodes[${index}].matrix`),
    );
    const translation = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    matrix.decompose(translation, rotation, scale);
    return node
      .setTranslation(translation.toArray())
      .setRotation(rotation.toArray())
      .setScale(scale.toArray());
  }
  return node
    .setTranslation(
      readTuple(rawNode.translation ?? [0, 0, 0], 3, `nodes[${index}].translation`),
    )
    .setRotation(
      readTuple(rawNode.rotation ?? [0, 0, 0, 1], 4, `nodes[${index}].rotation`),
    )
    .setScale(readTuple(rawNode.scale ?? [1, 1, 1], 3, `nodes[${index}].scale`));
}

async function readFloatAccessor({
  accessorIndex,
  blob,
  buffer,
  document,
  expectedType,
  info,
}: {
  accessorIndex: number;
  blob: Blob;
  buffer: ReturnType<Document["createBuffer"]>;
  document: Document;
  expectedType: "SCALAR" | "VEC3" | "VEC4";
  info: GLBRangeInfo;
}) {
  const rawAccessors = readArray<Record<string, unknown>>(info.json.accessors, "accessors");
  const rawAccessor = rawAccessors[accessorIndex]!;
  if (
    rawAccessor.componentType !== 5126 ||
    rawAccessor.type !== expectedType ||
    rawAccessor.sparse !== undefined ||
    rawAccessor.normalized === true
  ) {
    throw new Error(`Streamed GLB accessor ${accessorIndex} is not a dense Float32 ${expectedType}.`);
  }
  const count = readCount(rawAccessor.count, `accessor ${accessorIndex} count`);
  if (count > DEFAULT_PARSE_BUDGET.maxSamplesPerTrack) {
    throw new Error(`Streamed GLB accessor ${accessorIndex} exceeds the sample limit.`);
  }
  const rawBufferViews = readArray<Record<string, unknown>>(
    info.json.bufferViews,
    "bufferViews",
  );
  const bufferViewIndex = readIndex(
    rawAccessor.bufferView,
    rawBufferViews.length,
    `accessor ${accessorIndex} bufferView`,
  );
  const rawBufferView = rawBufferViews[bufferViewIndex]!;
  if (rawBufferView.buffer !== 0) {
    throw new Error("Streamed semantic validation requires the embedded buffer.");
  }
  const components = expectedType === "SCALAR" ? 1 : expectedType === "VEC3" ? 3 : 4;
  const packedStride = components * 4;
  if (
    rawBufferView.byteStride !== undefined &&
    rawBufferView.byteStride !== packedStride
  ) {
    throw new Error("Streamed semantic validation requires tightly packed animation accessors.");
  }
  const viewOffset = readCount(rawBufferView.byteOffset ?? 0, "bufferView byteOffset");
  const viewLength = readCount(rawBufferView.byteLength, "bufferView byteLength");
  const accessorOffset = readCount(rawAccessor.byteOffset ?? 0, "accessor byteOffset");
  const byteLength = count * packedStride;
  if (accessorOffset + byteLength > viewLength) {
    throw new Error(`Streamed GLB accessor ${accessorIndex} exceeds its bufferView.`);
  }
  const binary = info.binaryChunk!;
  if (viewOffset + accessorOffset + byteLength > binary.byteLength) {
    throw new Error(`Streamed GLB accessor ${accessorIndex} exceeds the BIN chunk.`);
  }
  const bytes = await readBlobRange(
    blob,
    binary.offset + viewOffset + accessorOffset,
    byteLength,
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(count * components);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getFloat32(index * 4, true);
  }
  return document
    .createAccessor(`streamed-accessor-${accessorIndex}`)
    .setType(expectedType)
    .setArray(values)
    .setBuffer(buffer);
}

function readInterpolation(value: unknown) {
  if (value === "LINEAR" || value === "STEP" || value === "CUBICSPLINE") {
    return value;
  }
  throw new Error("Streamed GLB animation interpolation is invalid.");
}

function readObject(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readArray<T>(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`Streamed GLB ${label} must be an array.`);
  return value as T[];
}

function readIndex(value: unknown, length: number, label: string) {
  const index = readCount(value, label);
  if (index >= length) throw new Error(`${label} is out of range.`);
  return index;
}

function readCount(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function readTuple(value: unknown, size: 3, label: string): [number, number, number];
function readTuple(value: unknown, size: 4, label: string): [number, number, number, number];
function readTuple(value: unknown, size: 16, label: string): number[];
function readTuple(value: unknown, size: number, label: string) {
  if (
    !Array.isArray(value) ||
    value.length !== size ||
    value.some((component) => typeof component !== "number" || !Number.isFinite(component))
  ) {
    throw new Error(`${label} must contain ${size} finite numbers.`);
  }
  return value as number[];
}
