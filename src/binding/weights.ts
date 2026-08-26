import { Vector3 } from "three";
import type { BindingGLB, BindingGeometry } from "@/import/binding-glb";
import type { ProcessingBudget } from "@/processing-budget";
import { bindingError, sealBindingSnapshot, validateBindingSnapshot, validateWeightEdits } from "./contracts";
import type { BindingInfluence, BindingJoint, BindingWeightEdit, HumanoidBindingSnapshot } from "./types";

/** A screened graph diffusion baseline; no claim of Blender bone-heat parity. */
export function skinBindingRig(asset: BindingGLB, snapshot: HumanoidBindingSnapshot, iterations: number,
  budget: ProcessingBudget, checkpoint: (phase: string) => void) {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 256) {
    bindingError("PROCESSING_OPTION_INVALID", "surface-heat-v1 requires 1..256 iterations.");
  }
  const vertices = asset.geometry.reduce((n, entry) => n + entry.identity.vertexCount, 0);
  const generated = vertices * snapshot.joints.length * (iterations + 3);
  if (!Number.isSafeInteger(generated) || generated > budget.maxGeneratedValues) {
    bindingError("PROCESSING_BUDGET_EXCEEDED", "Binding solve exceeds maxGeneratedValues.", { generated, limit: budget.maxGeneratedValues });
  }
  const next = structuredClone(snapshot);
  next.weights = [];
  const segments = boneSegments(snapshot.joints);
  let components = 0;
  for (const geometry of asset.geometry) {
    const graph = weldGraph(geometry, checkpoint);
    components += graph.components;
    const boneCount = snapshot.joints.length;
    const count = graph.positions.length;
    const source = new Float64Array(count * boneCount);
    const screen = new Float64Array(count);
    const p = new Vector3();
    for (let v = 0; v < count; v++) {
      if (v % 1024 === 0) checkpoint("binding-seed-weights");
      p.fromArray(graph.positions[v]);
      const distances = segments.map(([a, b], bone) => ({ bone, distance: pointSegmentDistance(p, a, b) }))
        .sort((a, b) => a.distance - b.distance || a.bone - b.bone);
      source[v * boneCount + distances[0].bone] = 1;
      const ratio = distances[0].distance / Math.max(distances[1].distance, 1e-12);
      screen[v] = .05 + 2 * Math.max(0, 1 - ratio);
    }
    let current = source.slice();
    let scratch = new Float64Array(current.length);
    for (let iteration = 0; iteration < iterations; iteration++) {
      checkpoint("binding-diffuse-weights");
      for (let v = 0; v < count; v++) {
        if (v % 2048 === 0) checkpoint("binding-diffuse-vertices");
        const neighbors = graph.neighbors[v];
        for (let b = 0; b < boneCount; b++) {
          let sum = 0;
          for (const neighbor of neighbors) sum += current[neighbor * boneCount + b];
          scratch[v * boneCount + b] = (screen[v] * source[v * boneCount + b] + sum / neighbors.length) / (screen[v] + 1);
        }
      }
      [current, scratch] = [scratch, current];
    }
    const joints: number[] = [], weights: number[] = [];
    const locks = new Map(snapshot.locks.filter((entry) => entry.primitive === geometry.identity.id).map((entry) => [entry.vertex, entry.locks!]));
    for (let v = 0; v < geometry.identity.vertexCount; v++) {
      if (v % 2048 === 0) checkpoint("binding-normalize-vertices");
      const row = snapshot.joints.map((joint, b) => ({ bone: joint.bone, weight: current[graph.vertexToWeld[v] * boneCount + b] }));
      const normalized = normalizeBindingWeights(row, locks.get(v) ?? [], snapshot.joints);
      joints.push(...normalized.joints);
      weights.push(...normalized.weights);
    }
    next.weights.push({ primitive: geometry.identity.id, joints, weights });
  }
  next.skinning = { algorithm: "surface-heat-v1", iterations };
  next.diagnostics = next.diagnostics.filter((entry) => entry.code !== "DISCONNECTED_COMPONENTS");
  if (components > 1) next.diagnostics.push({ code: "DISCONNECTED_COMPONENTS", message: `${components} independent surface components were solved. Clothing and accessories require deformation review.` });
  sealBindingSnapshot(next);
  validateBindingSnapshot(next);
  return next;
}

export function editBindingWeights(snapshot: HumanoidBindingSnapshot, edits: BindingWeightEdit[]) {
  if (!snapshot.weights) bindingError("BINDING_WEIGHTS_INVALID", "Generate skin weights before editing them.");
  validateWeightEdits(edits, snapshot);
  const next = structuredClone(snapshot);
  const lockRows = new Map(next.locks.map((edit) => [`${edit.primitive}:${edit.vertex}`, edit]));
  for (const edit of edits) {
    const row = next.weights!.find((entry) => entry.primitive === edit.primitive)!;
    const offset = edit.vertex * 4;
    const key = `${edit.primitive}:${edit.vertex}`;
    if (edit.locks !== undefined) {
      if (edit.locks.length) lockRows.set(key, { primitive: edit.primitive, vertex: edit.vertex, locks: structuredClone(edit.locks) });
      else lockRows.delete(key);
    }
    const influences = edit.influences ?? row.weights.slice(offset, offset + 4).flatMap((weight, i) => weight > 0
      ? [{ bone: next.joints[row.joints[offset + i]].bone, weight }] : []);
    const normalized = normalizeBindingWeights(influences, lockRows.get(key)?.locks ?? [], next.joints);
    row.joints.splice(offset, 4, ...normalized.joints);
    row.weights.splice(offset, 4, ...normalized.weights);
  }
  next.locks = [...lockRows.values()].sort((a, b) => (a.primitive < b.primitive ? -1 : a.primitive > b.primitive ? 1 : 0) || a.vertex - b.vertex);
  sealBindingSnapshot(next);
  validateBindingSnapshot(next);
  return next;
}

export function normalizeBindingWeights(influences: BindingInfluence[], locks: BindingInfluence[], rig: BindingJoint[]) {
  const locked = new Map(locks.map((entry) => [entry.bone, entry.weight]));
  const mass = locks.reduce((sum, entry) => sum + entry.weight, 0);
  const fixed = locks.filter((entry) => entry.weight > 0);
  if (mass > 1 + 1e-12 || fixed.length > 4) bindingError("BINDING_CONSTRAINT_CONFLICT", "Locked influences exceed the output profile.");
  const remaining = Math.max(0, 1 - mass);
  const candidates = influences.filter((entry) => !locked.has(entry.bone) && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || rig.findIndex((j) => j.bone === a.bone) - rig.findIndex((j) => j.bone === b.bone))
    .slice(0, 4 - fixed.length);
  const sum = candidates.reduce((total, entry) => total + entry.weight, 0);
  if (remaining > 1e-12 && (sum <= 0 || !Number.isFinite(sum))) {
    bindingError(locks.length ? "BINDING_CONSTRAINT_CONFLICT" : "BINDING_WEIGHTS_INVALID", "No unlocked positive influence can receive the remaining weight.");
  }
  const row = [...fixed, ...(remaining > 1e-12 ? candidates.map((entry) => ({ bone: entry.bone, weight: entry.weight / sum * remaining })) : [])]
    .sort((a, b) => b.weight - a.weight || rig.findIndex((j) => j.bone === a.bone) - rig.findIndex((j) => j.bone === b.bone));
  const joints = row.map((entry) => rig.findIndex((joint) => joint.bone === entry.bone));
  const weights = row.map((entry) => entry.weight);
  while (joints.length < 4) { joints.push(0); weights.push(0); }
  return { joints, weights };
}

function boneSegments(joints: BindingJoint[]): [Vector3, Vector3][] {
  return joints.map((joint) => {
    const a = new Vector3(...joint.position);
    const child = joints.find((candidate) => candidate.parent === joint.bone);
    if (child) return [a, new Vector3(...child.position)];
    const parent = joints.find((candidate) => candidate.bone === joint.parent);
    const b = parent ? a.clone().add(a.clone().sub(new Vector3(...parent.position)).multiplyScalar(.4)) : a.clone();
    return [a, b];
  });
}

function pointSegmentDistance(p: Vector3, a: Vector3, b: Vector3) {
  const direction = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(direction) / Math.max(direction.lengthSq(), 1e-30)));
  return p.distanceTo(a.clone().addScaledVector(direction, t));
}

function weldGraph(geometry: BindingGeometry, checkpoint: (phase: string) => void) {
  const byPosition = new Map<string, number>();
  const positions: number[][] = [];
  const vertexToWeld: number[] = [];
  for (let vertex = 0; vertex < geometry.identity.vertexCount; vertex++) {
    if (vertex % 4096 === 0) checkpoint("binding-weld-vertices");
    const position = Array.from(geometry.positions.subarray(vertex * 3, vertex * 3 + 3));
    // Exact welding joins UV/normal seams without fusing nearby separate limbs.
    const key = position.join(",");
    let index = byPosition.get(key);
    if (index === undefined) { index = positions.length; positions.push(position); byPosition.set(key, index); }
    vertexToWeld.push(index);
  }
  const adjacent = positions.map(() => new Set<number>());
  for (let i = 0; i < geometry.indices.length; i += 3) {
    if (i % 12288 === 0) checkpoint("binding-weld-triangles");
    for (let j = 0; j < 3; j++) {
      const a = vertexToWeld[geometry.indices[i + j]];
      const b = vertexToWeld[geometry.indices[i + (j + 1) % 3]];
      if (a !== b) { adjacent[a].add(b); adjacent[b].add(a); }
    }
  }
  const neighbors = adjacent.map((set) => [...set].sort((a, b) => a - b));
  if (neighbors.some((row) => !row.length)) bindingError("BINDING_INPUT_UNSUPPORTED", "Unreferenced or isolated vertices are unsupported.");
  let components = 0;
  const seen = new Set<number>();
  for (let v = 0; v < positions.length; v++) {
    if (seen.has(v)) continue;
    components++;
    const stack = [v]; seen.add(v);
    while (stack.length) for (const neighbor of neighbors[stack.pop()!]) {
      if (!seen.has(neighbor)) { seen.add(neighbor); stack.push(neighbor); }
    }
  }
  return { positions, vertexToWeld, neighbors, components };
}
