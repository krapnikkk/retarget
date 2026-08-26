import type { GLTF } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { sha256Hex } from "@/core/sha256";
import { validateParentGraph } from "@/core/parent-graph";
import { bindingError, bindingHash, finiteTuple } from "@/binding/contracts";
import type { BindingPrimitiveIdentity, BindingVector3, HumanoidBindingInspection } from "@/binding/types";
import { assertCountWithinBudget, assertInputWithinBudget, type ParseBudget } from "./parse-budget";

export type BindingGeometry = {
  identity: BindingPrimitiveIdentity;
  positions: Float64Array;
  indices: Uint32Array;
  worldMatrix: number[];
};

export type BindingGLB = {
  json: GLTF.IGLTF;
  binary: Uint8Array;
  geometry: BindingGeometry[];
  inspection: HumanoidBindingInspection;
};

const componentSize: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const elementSize: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Strict self-contained static GLB profile. No URI is fetched or decoded. */
export function readBindingGLB(
  bytes: Uint8Array, budget: ParseBudget, checkpoint: (phase: string) => void,
  allowSkin = false, maxAccessorValues = Number.MAX_SAFE_INTEGER,
): BindingGLB {
  assertInputWithinBudget(bytes.byteLength, budget, { section: "humanoid binding GLB" });
  const { json, binary } = readBindingContainer(bytes);
  if (json.asset?.version !== "2.0" || (json.asset.minVersion && json.asset.minVersion !== "2.0")) {
    unsupported("Only glTF 2.0 is supported.");
  }
  if (json.extras !== undefined && (json.extras === null || typeof json.extras !== "object" || Array.isArray(json.extras))) {
    unsupported("Top-level extras must be an object so binding metadata can be added without rewriting source content.");
  }
  // Reject extensions even when optional: silently losing their rendering or
  // geometry semantics would make the apparent preservation contract dishonest.
  const queue: unknown[] = [json];
  while (queue.length) {
    const value = queue.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, item] of Object.entries(value)) {
      if (key === "extensions" && item && Object.keys(item).length) unsupported("glTF extensions are not supported by humanoid-binding-v1.");
      if (key !== "extras") queue.push(item);
    }
  }
  if (json.extensionsUsed?.length || json.extensionsRequired?.length || json.animations?.length ||
    (!allowSkin && json.skins?.length)) unsupported("Extensions, animations and existing skins require a different input profile.");
  if (!Array.isArray(json.buffers) || json.buffers.length !== 1 || json.buffers[0].uri !== undefined ||
    !integer(json.buffers[0].byteLength) || json.buffers[0].byteLength > binary.length ||
    binary.length - json.buffers[0].byteLength > 3) unsupported("A single embedded GLB buffer is required.");
  for (const view of json.bufferViews ?? []) {
    if (view.buffer !== 0 || !integer(view.byteOffset ?? 0) || !integer(view.byteLength) ||
      (view.byteOffset ?? 0) + view.byteLength > json.buffers[0].byteLength ||
      (view.byteStride !== undefined && (!integer(view.byteStride) || view.byteStride < 4 || view.byteStride > 252 || view.byteStride % 4 !== 0))) {
      unsupported("Invalid bufferView range or stride.");
    }
  }
  let accessorValues = 0;
  for (const [i, accessor] of (json.accessors ?? []).entries()) {
    checkpoint("binding-parse-accessors");
    const view = json.bufferViews?.[accessor.bufferView ?? -1];
    const size = componentSize[accessor.componentType];
    const components = elementSize[accessor.type];
    if (!view || !size || !components || accessor.sparse || !integer(accessor.count) || accessor.count === 0 ||
      !integer(accessor.byteOffset ?? 0) || (accessor.byteOffset ?? 0) % size !== 0 ||
      ((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)) % size !== 0) unsupported("Invalid or unsupported accessor.", { accessor: i });
    const stride = view.byteStride ?? components * size;
    const needed = (accessor.count - 1) * stride + components * size;
    if (stride < components * size || !Number.isSafeInteger(needed) ||
      (accessor.byteOffset ?? 0) + needed > view.byteLength) unsupported("Accessor exceeds its bufferView.", { accessor: i });
    accessorValues += accessor.count * components;
    if (!Number.isSafeInteger(accessorValues) || accessorValues > maxAccessorValues) {
      bindingError("PROCESSING_BUDGET_EXCEEDED", "Decoded accessor values exceed maxGeneratedValues.", { declared: accessorValues, limit: maxAccessorValues });
    }
    if (accessor.normalized !== undefined && (typeof accessor.normalized !== "boolean" ||
      (accessor.normalized && ![5120, 5121, 5122, 5123].includes(accessor.componentType)))) unsupported("Invalid accessor normalization.");
    if (accessor.componentType === 5126) for (let element = 0; element < accessor.count; element++) {
      if (element % 4096 === 0) checkpoint("binding-parse-floats");
      if (readBindingAccessor(json, binary, i, element).some((v) => !Number.isFinite(v))) unsupported("Non-finite accessor values.", { accessor: i });
    }
  }
  assertCountWithinBudget(json.materials?.length ?? 0, budget.maxMaterials, "materials");
  for (const image of json.images ?? []) {
    if (image.uri !== undefined || !json.bufferViews?.[image.bufferView ?? -1] ||
      !["image/png", "image/jpeg"].includes(image.mimeType ?? "")) unsupported("Textures must be embedded PNG or JPEG images.");
  }
  for (const texture of json.textures ?? []) {
    if (!integer(texture.source!) || !json.images?.[texture.source!] ||
      (texture.sampler !== undefined && (!integer(texture.sampler) || !json.samplers?.[texture.sampler]))) unsupported("Invalid texture resource reference.");
  }
  for (const mesh of json.meshes ?? []) {
    if (mesh.weights?.length || !Array.isArray(mesh.primitives) || !mesh.primitives.length) unsupported("Invalid static mesh.");
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4 || primitive.targets?.length || !primitive.attributes ||
        typeof primitive.attributes !== "object" || Array.isArray(primitive.attributes)) unsupported("Only static triangle primitives are supported.");
      if (primitive.material !== undefined && (!integer(primitive.material) || !json.materials?.[primitive.material])) unsupported("Invalid primitive material reference.");
      for (const [semantic, index] of Object.entries(primitive.attributes)) {
        const accessor = json.accessors?.[index];
        if (!integer(index) || !accessor || !validAttribute(semantic, accessor, allowSkin)) unsupported("Unsupported primitive attribute.", { semantic });
      }
    }
  }
  const nodes = json.nodes;
  if (!Array.isArray(nodes) || !nodes.length || !Array.isArray(json.scenes) || json.scenes.length !== 1 ||
    (json.scene !== undefined && json.scene !== 0)) unsupported("Exactly one nonempty scene is required.");
  const parents = new Map<number, number>();
  const edges: { childId: number; parentId: number }[] = [];
  for (const [i, node] of nodes.entries()) {
    if ((!allowSkin && node.skin !== undefined) || node.weights?.length || node.camera !== undefined) {
      unsupported("Skinned, morphing or camera nodes are unsupported in binding input.");
    }
    for (const child of node.children ?? []) {
      if (!integer(child) || child >= nodes.length || parents.has(child)) unsupported("Invalid or multiply-parented node.");
      parents.set(child, i);
      edges.push({ childId: child, parentId: i });
    }
  }
  const graph = validateParentGraph({ nodeIds: nodes.map((_, i) => i), edges, maxDepth: 256 });
  if (!graph.ok) unsupported("Invalid scene hierarchy.", { issues: graph.issues });
  const roots = json.scenes[0].nodes ?? [];
  if (!roots.length || new Set(roots).size !== roots.length || roots.some((i) => !integer(i) || !nodes[i] || parents.has(i))) {
    unsupported("Invalid scene roots.");
  }
  const worlds = new Map<number, Matrix4>();
  const stack = roots.map((index) => ({ index, parent: new Matrix4() }));
  while (stack.length) {
    const { index, parent } = stack.pop()!;
    const node = nodes[index];
    const world = parent.clone().multiply(localMatrix(node));
    if (!world.elements.every(Number.isFinite) || Math.abs(world.determinant()) < 1e-20) unsupported("Singular or non-finite scene transform.");
    worlds.set(index, world);
    for (const child of node.children ?? []) stack.push({ index: child, parent: world });
  }
  const geometry: BindingGeometry[] = [];
  const min = [Infinity, Infinity, Infinity] as BindingVector3;
  const max = [-Infinity, -Infinity, -Infinity] as BindingVector3;
  let totalVertices = 0;
  let totalIndices = 0;
  const point = new Vector3();
  for (const [nodeIndex, node] of nodes.entries()) {
    checkpoint("binding-parse-mesh");
    if (node.mesh === undefined) continue;
    if (!integer(node.mesh)) unsupported("Invalid mesh reference.");
    const world = worlds.get(nodeIndex);
    const mesh = json.meshes?.[node.mesh];
    if (!world || !mesh || mesh.weights?.length || !Array.isArray(mesh.primitives) || !mesh.primitives.length) unsupported("Unreachable or invalid mesh node.");
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      if ((primitive.mode ?? 4) !== 4 || primitive.targets?.length || (!allowSkin &&
        Object.keys(primitive.attributes).some((key) => /^(JOINTS|WEIGHTS)_/.test(key)))) unsupported("Only unskinned static triangle primitives are supported.");
      const position = json.accessors?.[primitive.attributes.POSITION];
      if (!position || position.type !== "VEC3" || position.componentType !== 5126 || position.normalized) unsupported("POSITION must be a FLOAT VEC3 accessor.");
      for (const index of Object.values(primitive.attributes)) {
        if (!integer(index) || json.accessors?.[index]?.count !== position.count) unsupported("Primitive attribute counts differ.");
      }
      const indexAccessor = primitive.indices === undefined ? undefined : json.accessors?.[primitive.indices];
      if (primitive.indices !== undefined && (!indexAccessor || indexAccessor.type !== "SCALAR" ||
        ![5121, 5123, 5125].includes(indexAccessor.componentType) || indexAccessor.normalized)) unsupported("Invalid triangle index accessor.");
      const indexCount = indexAccessor?.count ?? position.count;
      if (indexCount % 3) unsupported("Triangle index count must be divisible by three.");
      totalVertices += position.count;
      totalIndices += indexCount;
      assertCountWithinBudget(totalVertices, budget.maxVertices, "binding vertices including instances");
      assertCountWithinBudget(totalIndices, budget.maxIndices, "binding indices including instances");
      const positions = new Float64Array(position.count * 3);
      for (let v = 0; v < position.count; v++) {
        if (v % 4096 === 0) checkpoint("binding-parse-vertices");
        point.fromArray(readBindingAccessor(json, binary, primitive.attributes.POSITION, v)).applyMatrix4(world);
        for (let axis = 0; axis < 3; axis++) {
          const value = point.getComponent(axis);
          if (!Number.isFinite(value)) unsupported("Non-finite vertex position.");
          positions[v * 3 + axis] = value;
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      const indices = new Uint32Array(indexCount);
      const referenced = new Uint8Array(position.count);
      const a = new Vector3(), b = new Vector3(), c = new Vector3();
      for (let i = 0; i < indexCount; i++) {
        if (i % 4096 === 0) checkpoint("binding-parse-triangles");
        const index = indexAccessor ? readBindingAccessor(json, binary, primitive.indices!, i)[0] : i;
        if (!integer(index) || index >= position.count) unsupported("Triangle index is outside POSITION.");
        indices[i] = index;
        referenced[index] = 1;
        if (i % 3 === 2) {
          a.fromArray(positions, indices[i - 2] * 3);
          b.fromArray(positions, indices[i - 1] * 3);
          c.fromArray(positions, indices[i] * 3);
          if (b.sub(a).cross(c.sub(a)).lengthSq() === 0) unsupported("Degenerate triangles are unsupported.");
        }
      }
      if (referenced.some((value) => value === 0)) unsupported("Unreferenced vertices are unsupported.");
      geometry.push({ identity: { id: `node:${nodeIndex}/mesh:${node.mesh}/primitive:${primitiveIndex}`,
        node: nodeIndex, mesh: node.mesh, primitive: primitiveIndex, vertexCount: position.count, triangleCount: indexCount / 3 },
        positions, indices, worldMatrix: [...world.elements] });
    }
  }
  if (!geometry.length || max[1] <= min[1]) unsupported("The scene has no usable three-dimensional character geometry.");
  const primitives = geometry.map((entry) => entry.identity);
  return { json, binary, geometry, inspection: {
    schemaVersion: 1,
    asset: { sha256: sha256Hex(bytes), topologySha256: bindingHash(geometry.map((entry) => ({
      ...entry.identity, indices: Array.from(entry.indices), worldMatrix: entry.worldMatrix,
    }))), primitives },
    bounds: { min, max }, diagnostics: [],
  } };
}

export function readBindingContainer(bytes: Uint8Array): { json: GLTF.IGLTF; binary: Uint8Array } {
  if (bytes.byteLength < 28) unsupported("GLB is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) unsupported("Invalid GLB header.");
  const jsonLength = view.getUint32(12, true);
  const binHeader = 20 + jsonLength;
  if (!jsonLength || jsonLength % 4 || binHeader + 8 > bytes.length ||
    view.getUint32(binHeader + 4, true) !== 0x004e4942) unsupported("Invalid GLB JSON or BIN chunk.");
  const binLength = view.getUint32(binHeader, true);
  if (binLength % 4 || binHeader + 8 + binLength !== bytes.length) unsupported("Invalid GLB binary chunk length.");
  let json: GLTF.IGLTF;
  try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, binHeader))); }
  catch { unsupported("GLB JSON is invalid."); }
  if (!json! || typeof json !== "object" || Array.isArray(json)) unsupported("GLB root must be an object.");
  return { json: json!, binary: bytes.subarray(binHeader + 8) };
}

export function readBindingAccessor(json: GLTF.IGLTF, binary: Uint8Array, index: number, element: number): number[] {
  const accessor = json.accessors![index];
  const view = json.bufferViews![accessor.bufferView!];
  const size = componentSize[accessor.componentType];
  const count = elementSize[accessor.type];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + element * (view.byteStride ?? size * count);
  const data = new DataView(binary.buffer, binary.byteOffset + start, size * count);
  const result: number[] = [];
  for (let component = 0; component < count; component++) {
    const offset = component * size;
    let value: number;
    switch (accessor.componentType) {
      case 5120: value = data.getInt8(offset); break;
      case 5121: value = data.getUint8(offset); break;
      case 5122: value = data.getInt16(offset, true); break;
      case 5123: value = data.getUint16(offset, true); break;
      case 5125: value = data.getUint32(offset, true); break;
      default: value = data.getFloat32(offset, true);
    }
    if (accessor.normalized) {
      if (accessor.componentType === 5120) value = Math.max(-1, value / 127);
      if (accessor.componentType === 5121) value /= 255;
      if (accessor.componentType === 5122) value = Math.max(-1, value / 32767);
      if (accessor.componentType === 5123) value /= 65535;
    }
    result.push(value);
  }
  return result;
}

function localMatrix(node: GLTF.INode): Matrix4 {
  if (node.matrix !== undefined && (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined)) unsupported("A node cannot contain both matrix and TRS.");
  if (node.matrix !== undefined && !finiteTuple(node.matrix, 16)) unsupported("Invalid node matrix.");
  const position = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const scale = node.scale ?? [1, 1, 1];
  if (!finiteTuple(position, 3) || !finiteTuple(rotation, 4) || !finiteTuple(scale, 3) ||
    Math.abs(Math.hypot(...rotation) - 1) > 1e-6 || scale.some((v) => v <= 0)) unsupported("Invalid or reflected node TRS.");
  const matrix = node.matrix ? new Matrix4().fromArray(node.matrix)
    : new Matrix4().compose(new Vector3(...position), new Quaternion(...rotation), new Vector3(...scale));
  if (matrix.determinant() <= 0 || matrix.elements.some((v) => !Number.isFinite(v)) ||
    matrix.elements[3] !== 0 || matrix.elements[7] !== 0 || matrix.elements[11] !== 0 || matrix.elements[15] !== 1) unsupported("Transform must be nonsingular, affine and non-reflected.");
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  matrix.decompose(p, q, s);
  const rebuilt = new Matrix4().compose(p, q, s);
  if (node.matrix && matrix.elements.some((v, i) => Math.abs(v - rebuilt.elements[i]) > 1e-6 * Math.max(1, Math.abs(v)))) unsupported("Sheared node matrices are unsupported.", { node: node.name });
  return matrix;
}

function integer(value: number) { return Number.isSafeInteger(value) && value >= 0; }
function validAttribute(semantic: string, accessor: GLTF.IAccessor, allowSkin: boolean) {
  const float = accessor.componentType === 5126 && !accessor.normalized;
  const unit = float || ([5121, 5123].includes(accessor.componentType) && accessor.normalized === true);
  if (semantic === "POSITION" || semantic === "NORMAL") return accessor.type === "VEC3" && float;
  if (semantic === "TANGENT") return accessor.type === "VEC4" && float;
  if (/^TEXCOORD_\d+$/.test(semantic)) return accessor.type === "VEC2" && unit;
  if (/^COLOR_\d+$/.test(semantic)) return ["VEC3", "VEC4"].includes(accessor.type) && unit;
  if (/^JOINTS_\d+$/.test(semantic)) return allowSkin && accessor.type === "VEC4" && [5121, 5123].includes(accessor.componentType) && !accessor.normalized;
  if (/^WEIGHTS_\d+$/.test(semantic)) return allowSkin && accessor.type === "VEC4" && unit;
  return semantic.startsWith("_") && ["SCALAR", "VEC2", "VEC3", "VEC4"].includes(accessor.type);
}
function unsupported(message: string, details?: Record<string, unknown>): never {
  return bindingError("BINDING_INPUT_UNSUPPORTED", message, details);
}
