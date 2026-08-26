import { sha256Hex } from "@/core/sha256";
import { validateParentGraph } from "@/core/parent-graph";
import { RetargetError, type RetargetErrorCode } from "@/retarget/errors";
import { HUMANOID_BONES, type HumanoidBoneName } from "@/retarget/types";
import { REQUIRED_VRM_BONES } from "@/retarget/humanoid";
import { HUMANOID_RIG_DEFINITION } from "@/rigs/definitions";
import type {
  BindingAssetIdentity, BindingJoint, BindingWeightEdit,
  HumanoidBindingSnapshot, HumanoidBindingTask,
} from "./types";

export function bindingError(code: RetargetErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new RetargetError(code, { message, details });
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    bindingError("WORKER_PROTOCOL_INVALID", `${label} must be a plain object.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !("value" in descriptor) || !descriptor.enumerable) {
      bindingError("WORKER_PROTOCOL_INVALID", `${label} must contain only JSON data properties.`);
    }
  }
  return value as Record<string, unknown>;
}

export function exactKeys(value: unknown, allowed: readonly string[], label: string) {
  const data = record(value, label);
  if (Object.keys(data).some((key) => !allowed.includes(key))) {
    bindingError("WORKER_PROTOCOL_INVALID", `${label} contains unknown fields.`);
  }
  return data;
}

export function finiteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(
    (item) => typeof item === "number" && Number.isFinite(item),
  );
}

export function bindingHash(value: unknown) {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(value)));
}

const parents = new Map<string, string | undefined>(HUMANOID_RIG_DEFINITION.roles.map(
  (role) => [role.id, role.parent],
));
for (const side of ["left", "right"]) {
  for (const finger of ["Thumb", "Index", "Middle", "Ring", "Little"]) {
    const parts = finger === "Thumb" ? ["Metacarpal", "Proximal", "Distal"]
      : ["Proximal", "Intermediate", "Distal"];
    parts.forEach((part, index) => parents.set(`${side}${finger}${part}`,
      index === 0 ? `${side}Hand` : `${side}${finger}${parts[index - 1]}`));
  }
}

export function bindingParent(bone: HumanoidBoneName, available: ReadonlySet<string>): HumanoidBoneName | null {
  let parent = parents.get(bone);
  while (parent && !available.has(parent)) parent = parents.get(parent);
  return (parent as HumanoidBoneName | undefined) ?? null;
}

export function validateBindingJoints(value: unknown): asserts value is BindingJoint[] {
  if (!Array.isArray(value) || value.length > HUMANOID_BONES.length) {
    bindingError("BINDING_RIG_INVALID", "Expected a bounded array of humanoid joints.");
  }
  const bones = new Set<string>();
  for (const joint of value) {
    exactKeys(joint, ["bone", "parent", "position", "rotation"], "Binding joint");
    if (!HUMANOID_BONES.includes(joint.bone) || bones.has(joint.bone) ||
      !finiteTuple(joint.position, 3) || !finiteTuple(joint.rotation, 4) ||
      Math.abs(Math.hypot(...joint.rotation) - 1) > 1e-6) {
      bindingError("BINDING_RIG_INVALID", "Joint roles must be unique with finite positions and unit quaternions.");
    }
    bones.add(joint.bone);
  }
  if (REQUIRED_VRM_BONES.some((bone) => !bones.has(bone))) {
    bindingError("BINDING_RIG_INVALID", "The skeleton is missing required humanoid roles.");
  }
  for (const joint of value) {
    if (joint.parent !== bindingParent(joint.bone, bones)) {
      bindingError("BINDING_RIG_INVALID", "The skeleton must follow the humanoid hierarchy.", { bone: joint.bone });
    }
    const parent = value.find((candidate) => candidate.bone === joint.parent);
    if (parent && Math.hypot(...joint.position.map((v: number, i: number) => v - parent.position[i])) < 1e-10) {
      bindingError("BINDING_RIG_INVALID", "Zero-length bone segments are unsupported.", { bone: joint.bone });
    }
  }
  const graph = validateParentGraph({ nodeIds: bones,
    edges: value.filter((joint) => joint.parent).map((joint) => ({ childId: joint.bone, parentId: joint.parent! })) });
  if (!graph.ok) bindingError("BINDING_RIG_INVALID", "Invalid joint parent graph.");
}

export function sealBindingSnapshot(snapshot: HumanoidBindingSnapshot): HumanoidBindingSnapshot {
  snapshot.rigRevision = bindingHash(snapshot.joints);
  const { revision: _revision, ...content } = snapshot;
  snapshot.revision = bindingHash(content);
  return snapshot;
}

export function validateBindingSnapshot(
  snapshot: HumanoidBindingSnapshot, asset?: BindingAssetIdentity, expectedRevision?: string,
) {
  exactKeys(snapshot, ["schemaVersion", "profile", "asset", "revision", "rigRevision", "joints", "weights", "locks", "algorithm", "skinning", "diagnostics"], "Binding snapshot");
  if (snapshot.schemaVersion !== 1 || snapshot.profile !== "humanoid-binding-v1" ||
    !["landmark-template-v1", "existing-rig-v1"].includes(snapshot.algorithm)) {
    bindingError("BINDING_EDIT_STALE", "Unsupported binding snapshot version.");
  }
  validateBindingJoints(snapshot.joints);
  exactKeys(snapshot.asset, ["sha256", "topologySha256", "primitives"], "Binding asset identity");
  if (!/^[0-9a-f]{64}$/.test(snapshot.asset.sha256) || !/^[0-9a-f]{64}$/.test(snapshot.asset.topologySha256) ||
    !Array.isArray(snapshot.asset.primitives) || !snapshot.asset.primitives.length) {
    bindingError("BINDING_EDIT_STALE", "Invalid snapshot asset identity.");
  }
  const primitiveIds = new Set<string>();
  for (const primitive of snapshot.asset.primitives) {
    exactKeys(primitive, ["id", "node", "mesh", "primitive", "vertexCount", "triangleCount"], "Primitive identity");
    if (![primitive.node, primitive.mesh, primitive.primitive, primitive.vertexCount, primitive.triangleCount].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      primitive.vertexCount === 0 || primitive.triangleCount === 0 || primitiveIds.has(primitive.id) ||
      primitive.id !== `node:${primitive.node}/mesh:${primitive.mesh}/primitive:${primitive.primitive}`) {
      bindingError("BINDING_EDIT_STALE", "Invalid or duplicate primitive identity.");
    }
    primitiveIds.add(primitive.id);
  }
  if (snapshot.skinning !== null) {
    exactKeys(snapshot.skinning, ["algorithm", "iterations"], "Skinning provenance");
    if (snapshot.skinning.algorithm !== "surface-heat-v1" || !Number.isInteger(snapshot.skinning.iterations) ||
      snapshot.skinning.iterations < 1 || snapshot.skinning.iterations > 256) {
      bindingError("BINDING_EDIT_STALE", "Unsupported skinning provenance.");
    }
  }
  if ((snapshot.weights === null) !== (snapshot.skinning === null)) bindingError("BINDING_WEIGHTS_INVALID", "Weights and solver provenance must be present together.");
  const { revision, ...content } = snapshot;
  if (revision !== bindingHash(content) || snapshot.rigRevision !== bindingHash(snapshot.joints) ||
    (expectedRevision !== undefined && revision !== expectedRevision) ||
    (asset !== undefined && JSON.stringify(snapshot.asset) !== JSON.stringify(asset))) {
    bindingError("BINDING_EDIT_STALE", "Snapshot content, asset, topology or revision no longer matches.");
  }
  if (!Array.isArray(snapshot.locks) || !Array.isArray(snapshot.diagnostics)) {
    bindingError("BINDING_WEIGHTS_INVALID", "Invalid binding snapshot arrays.");
  }
  for (const diagnostic of snapshot.diagnostics) {
    exactKeys(diagnostic, ["code", "message"], "Binding diagnostic");
    if (!["MANUAL_REVIEW_REQUIRED", "DISCONNECTED_COMPONENTS", "EXISTING_RIG"].includes(diagnostic.code) ||
      typeof diagnostic.message !== "string") bindingError("WORKER_PROTOCOL_INVALID", "Invalid binding diagnostic.");
  }
  validateWeightEdits(snapshot.locks, snapshot);
  if (snapshot.locks.some((edit) => edit.influences !== undefined || !edit.locks?.length)) {
    bindingError("BINDING_WEIGHTS_INVALID", "Snapshot constraints must contain only nonempty lock rows.");
  }
  if (snapshot.weights !== null) {
    if (!Array.isArray(snapshot.weights) || snapshot.weights.length !== snapshot.asset.primitives.length) {
      bindingError("BINDING_WEIGHTS_INVALID", "Weight primitive count does not match the asset.");
    }
    for (const [i, weights] of snapshot.weights.entries()) {
      exactKeys(weights, ["primitive", "joints", "weights"], "Primitive weights");
      const primitive = snapshot.asset.primitives[i];
      if (weights.primitive !== primitive.id || !Array.isArray(weights.joints) || !Array.isArray(weights.weights) ||
        weights.joints.length !== primitive.vertexCount * 4 || weights.weights.length !== primitive.vertexCount * 4) {
        bindingError("BINDING_WEIGHTS_INVALID", "Weight array dimensions do not match the source topology.");
      }
      for (let vertex = 0; vertex < primitive.vertexCount; vertex++) {
        let sum = 0;
        const indices = new Set<number>();
        for (let k = 0; k < 4; k++) {
          const offset = vertex * 4 + k;
          const joint = weights.joints[offset];
          const weight = weights.weights[offset];
          if (!Number.isInteger(joint) || joint < 0 || joint >= snapshot.joints.length ||
            !Number.isFinite(weight) || weight < 0 || weight > 1 || (weight > 0 && indices.has(joint))) {
            bindingError("BINDING_WEIGHTS_INVALID", "Weights must be finite, non-negative, and address unique valid joints.");
          }
          if (weight > 0) indices.add(joint);
          sum += weight;
        }
        if (Math.abs(sum - 1) > 1e-6) bindingError("BINDING_WEIGHTS_INVALID", "Weights do not sum to one.");
      }
    }
    for (const edit of snapshot.locks) {
      const primitive = snapshot.weights.find((entry) => entry.primitive === edit.primitive)!;
      for (const lock of edit.locks!) {
        const joint = snapshot.joints.findIndex((entry) => entry.bone === lock.bone);
        let actual = 0;
        for (let k = 0; k < 4; k++) {
          const offset = edit.vertex * 4 + k;
          if (primitive.joints[offset] === joint) actual += primitive.weights[offset];
        }
        if (Math.abs(actual - lock.weight) > 1e-12) bindingError("BINDING_CONSTRAINT_CONFLICT", "Restored weights violate their locked constraints.");
      }
    }
  }
}

export function validateWeightEdits(value: unknown, snapshot: HumanoidBindingSnapshot): asserts value is BindingWeightEdit[] {
  if (!Array.isArray(value)) bindingError("BINDING_WEIGHTS_INVALID", "Expected weight edits.");
  const addressed = new Set<string>();
  const roles = new Set(snapshot.joints.map((joint) => joint.bone));
  for (const edit of value) {
    exactKeys(edit, ["primitive", "vertex", "influences", "locks"], "Weight edit");
    const primitive = snapshot.asset.primitives.find((candidate) => candidate.id === edit.primitive);
    const id = `${edit.primitive}:${edit.vertex}`;
    if (!primitive || !Number.isInteger(edit.vertex) || edit.vertex < 0 || edit.vertex >= primitive.vertexCount ||
      addressed.has(id) || (edit.influences === undefined && edit.locks === undefined)) {
      bindingError("BINDING_WEIGHTS_INVALID", "Invalid or duplicate vertex address.");
    }
    addressed.add(id);
    for (const influences of [edit.influences, edit.locks]) {
      if (influences === undefined) continue;
      if (!Array.isArray(influences) || influences.length > snapshot.joints.length) {
        bindingError("BINDING_WEIGHTS_INVALID", "Invalid influence array.");
      }
      const used = new Set<string>();
      for (const influence of influences) {
        exactKeys(influence, ["bone", "weight"], "Weight influence");
        if (!roles.has(influence.bone) || used.has(influence.bone) ||
          !Number.isFinite(influence.weight) || influence.weight < 0) {
          bindingError("BINDING_WEIGHTS_INVALID", "Invalid or duplicate bone influence.");
        }
        used.add(influence.bone);
      }
    }
    if (edit.locks && (edit.locks.some((lock: { weight: number }) => lock.weight > 1) ||
      edit.locks.reduce((sum: number, lock: { weight: number }) => sum + lock.weight, 0) > 1 + 1e-12 ||
      edit.locks.filter((lock: { weight: number }) => lock.weight > 0).length > 4)) {
      bindingError("BINDING_CONSTRAINT_CONFLICT", "Locked influences exceed the available weight or four-influence profile.");
    }
  }
}

export function assertHumanoidBindingTask(value: unknown): asserts value is HumanoidBindingTask {
  const task = exactKeys(value, ["type", "bytes", "command"], "Humanoid binding task");
  if (task.type !== "humanoid-binding" || !(task.bytes instanceof ArrayBuffer)) {
    bindingError("WORKER_PROTOCOL_INVALID", "Binding tasks require ArrayBuffer input.");
  }
  const command = record(task.command, "Binding command");
  const operations: Record<string, string[]> = {
    inspect: [], fit: ["pose", "forward", "landmarks"], "use-rig": ["joints"],
    "edit-rig": ["edits"], skin: ["iterations"], "edit-weights": ["edits"],
    export: [], validate: ["outputBytes"],
  };
  const op = command.operation;
  if (typeof op !== "string" || !Object.hasOwn(operations, op)) {
    bindingError("WORKER_PROTOCOL_INVALID", "Unknown binding operation.");
  }
  const editing = !["inspect", "fit", "use-rig"].includes(op);
  exactKeys(command, ["operation", ...operations[op], ...(editing ? ["snapshot", "expectedRevision"] : [])], "Binding command");
  if (editing && (typeof command.expectedRevision !== "string" || command.expectedRevision.length !== 64)) {
    bindingError("BINDING_EDIT_STALE", "Binding edits require an expected revision.");
  }
  if (op === "validate" && !(command.outputBytes instanceof ArrayBuffer)) {
    bindingError("WORKER_PROTOCOL_INVALID", "Validation requires output bytes.");
  }
  // Check before structuredClone/postMessage. JSON persistence cannot represent
  // sparse arrays, accessors, custom prototypes, cycles or non-finite values.
  const active = new Set<object>();
  const stack: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value: command, depth: 0 }];
  while (stack.length) {
    const { value, depth, exit } = stack.pop()!;
    if (exit) { active.delete(value as object); continue; }
    if (value === undefined || value === null || typeof value === "boolean" || typeof value === "string") continue;
    if (typeof value === "number" && Number.isFinite(value)) continue;
    if (value instanceof ArrayBuffer && op === "validate" && value === command.outputBytes) continue;
    if (!value || typeof value !== "object" || active.has(value) || depth > 64) {
      bindingError("WORKER_PROTOCOL_INVALID", "Binding commands must be finite acyclic JSON data (maximum depth 64).");
    }
    active.add(value);
    stack.push({ value, depth, exit: true });
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) bindingError("WORKER_PROTOCOL_INVALID", "Sparse or decorated arrays are not supported.");
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !("value" in descriptor)) bindingError("WORKER_PROTOCOL_INVALID", "Array accessors are not supported.");
        stack.push({ value: descriptor.value, depth: depth + 1 });
      }
    } else {
      for (const item of Object.values(record(value, "Binding JSON data"))) stack.push({ value: item, depth: depth + 1 });
    }
  }
}
