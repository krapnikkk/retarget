import type { HumanoidBindingSnapshot } from "@/binding/types";
import type { ProcessingBudget } from "@/processing-budget";
import type { RetargetJobTask } from "./types";

const TRANSPORT = "humanoid-binding-snapshot-v1";

type PackedWeight = {
  primitive: string;
  joints: ArrayBuffer;
  weights: ArrayBuffer;
};

type PackedSnapshot = Omit<HumanoidBindingSnapshot, "weights"> & {
  weights: PackedWeight[] | null;
};

type SnapshotTransport = {
  transport: typeof TRANSPORT;
  snapshot: PackedSnapshot;
};

export function usesHumanoidBindingSnapshotTransport(task: RetargetJobTask) {
  return task.type === "humanoid-binding" &&
    !["inspect", "export", "validate"].includes(task.command.operation);
}

export function packHumanoidBindingSnapshotResult(
  task: RetargetJobTask,
  result: unknown,
): unknown {
  if (!usesHumanoidBindingSnapshotTransport(task)) return result;
  const snapshot = result as HumanoidBindingSnapshot;
  return {
    transport: TRANSPORT,
    snapshot: {
      ...snapshot,
      weights: snapshot.weights?.map((entry) => ({
        primitive: entry.primitive,
        joints: Uint16Array.from(entry.joints).buffer,
        weights: Float64Array.from(entry.weights).buffer,
      })) ?? null,
    },
  } satisfies SnapshotTransport;
}

export function collectHumanoidBindingSnapshotTransportTransfers(value: unknown) {
  if (!isRecord(value) || value.transport !== TRANSPORT || !isRecord(value.snapshot) ||
    !Array.isArray(value.snapshot.weights)) return [];
  return value.snapshot.weights.flatMap((entry) => isRecord(entry) &&
    entry.joints instanceof ArrayBuffer && entry.weights instanceof ArrayBuffer
    ? [entry.joints, entry.weights]
    : []);
}

export async function unpackHumanoidBindingSnapshotResult(
  value: unknown,
  budget: ProcessingBudget,
  yieldControl: () => Promise<void>,
): Promise<HumanoidBindingSnapshot> {
  const transport = exactRecord(value, ["transport", "snapshot"], "Binding snapshot transport");
  if (transport.transport !== TRANSPORT) throw new Error("Unsupported binding snapshot transport.");
  const snapshot = exactRecord(transport.snapshot,
    ["schemaVersion", "profile", "asset", "revision", "rigRevision", "joints", "weights", "locks", "algorithm", "skinning", "diagnostics"],
    "Packed binding snapshot");
  if (snapshot.weights === null) return snapshot as unknown as HumanoidBindingSnapshot;
  if (!Array.isArray(snapshot.weights)) throw new Error("Packed binding weights must be an array or null.");
  const decoded: HumanoidBindingSnapshot["weights"] = [];
  let generatedValues = 0;
  for (const packedValue of snapshot.weights) {
    const packed = exactRecord(packedValue, ["primitive", "joints", "weights"], "Packed primitive weights");
    if (typeof packed.primitive !== "string" || !(packed.joints instanceof ArrayBuffer) ||
      !(packed.weights instanceof ArrayBuffer) || packed.joints.byteLength % 2 !== 0 || packed.weights.byteLength % 8 !== 0) {
      throw new Error("Packed primitive weight buffers are invalid.");
    }
    const jointView = new Uint16Array(packed.joints);
    const weightView = new Float64Array(packed.weights);
    if (jointView.length !== weightView.length || jointView.length % 4 !== 0) {
      throw new Error("Packed primitive weight dimensions differ.");
    }
    generatedValues += jointView.length + weightView.length;
    if (!Number.isSafeInteger(generatedValues) || generatedValues > budget.maxGeneratedValues) {
      throw new Error("Packed binding snapshot exceeds maxGeneratedValues.");
    }
    const joints = new Array<number>(jointView.length);
    const weights = new Array<number>(weightView.length);
    for (let offset = 0; offset < jointView.length; offset += 4096) {
      const end = Math.min(offset + 4096, jointView.length);
      for (let index = offset; index < end; index++) {
        joints[index] = jointView[index];
        weights[index] = weightView[index];
      }
      await yieldControl();
    }
    decoded.push({ primitive: packed.primitive, joints, weights });
  }
  return { ...snapshot, weights: decoded } as unknown as HumanoidBindingSnapshot;
}

function exactRecord(value: unknown, keys: readonly string[], label: string) {
  if (!isRecord(value)) throw new Error(`${label} must be a plain object.`);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))) throw new Error(`${label} fields are invalid.`);
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(`${label} contains an unsupported property.`);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
