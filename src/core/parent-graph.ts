export const DEFAULT_MAX_PARENT_DEPTH = 512;

export type ParentGraphEdge<TId> = {
  childId: TId;
  parentId: TId;
};

export type ParentGraphIssue<TId> =
  | { code: "duplicate-node"; nodeId: TId }
  | { code: "missing-child"; childId: TId; parentId: TId }
  | { code: "missing-parent"; childId: TId; parentId: TId }
  | { code: "multiple-parents"; childId: TId; parentIds: [TId, TId] }
  | { code: "self-parent"; nodeId: TId }
  | { code: "cycle"; nodeIds: TId[] }
  | { code: "depth-exceeded"; nodeId: TId; depth: number; limit: number };

export type ParentGraphValidationResult<TId> =
  | { ok: true }
  | { ok: false; issues: ParentGraphIssue<TId>[] };

export function validateParentGraph<TId>({
  nodeIds,
  edges,
  maxDepth = DEFAULT_MAX_PARENT_DEPTH,
}: {
  nodeIds: Iterable<TId>;
  edges: Iterable<ParentGraphEdge<TId>>;
  maxDepth?: number;
}): ParentGraphValidationResult<TId> {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error("Parent graph maxDepth must be a non-negative integer.");
  }

  const issues: ParentGraphIssue<TId>[] = [];
  const nodes = new Set<TId>();
  for (const nodeId of nodeIds) {
    if (nodes.has(nodeId)) {
      issues.push({ code: "duplicate-node", nodeId });
    }
    nodes.add(nodeId);
  }

  const parentByChild = new Map<TId, TId>();
  for (const { childId, parentId } of edges) {
    if (!nodes.has(childId)) {
      issues.push({ code: "missing-child", childId, parentId });
      continue;
    }
    if (!nodes.has(parentId)) {
      issues.push({ code: "missing-parent", childId, parentId });
      continue;
    }
    if (Object.is(childId, parentId)) {
      issues.push({ code: "self-parent", nodeId: childId });
      continue;
    }
    const existingParent = parentByChild.get(childId);
    if (existingParent !== undefined && !Object.is(existingParent, parentId)) {
      issues.push({
        code: "multiple-parents",
        childId,
        parentIds: [existingParent, parentId],
      });
      continue;
    }
    parentByChild.set(childId, parentId);
  }

  const settledDepth = new Map<TId, number>();
  let reportedDepthExceeded = false;
  for (const start of nodes) {
    if (settledDepth.has(start)) continue;

    const path: TId[] = [];
    const position = new Map<TId, number>();
    let current: TId | undefined = start;
    let baseDepth = -1;
    let cyclic = false;

    while (current !== undefined) {
      const knownDepth = settledDepth.get(current);
      if (knownDepth !== undefined) {
        baseDepth = knownDepth;
        break;
      }
      const cycleStart = position.get(current);
      if (cycleStart !== undefined) {
        issues.push({
          code: "cycle",
          nodeIds: [...path.slice(cycleStart), current],
        });
        cyclic = true;
        break;
      }
      position.set(current, path.length);
      path.push(current);
      current = parentByChild.get(current);
    }

    if (cyclic) {
      for (const nodeId of path) settledDepth.set(nodeId, Number.POSITIVE_INFINITY);
      continue;
    }

    for (let index = path.length - 1; index >= 0; index -= 1) {
      const nodeId = path[index]!;
      baseDepth += 1;
      settledDepth.set(nodeId, baseDepth);
      if (baseDepth > maxDepth && !reportedDepthExceeded) {
        issues.push({
          code: "depth-exceeded",
          nodeId,
          depth: baseDepth,
          limit: maxDepth,
        });
        reportedDepthExceeded = true;
      }
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

export function assertValidParentGraph<TId>(input: {
  nodeIds: Iterable<TId>;
  edges: Iterable<ParentGraphEdge<TId>>;
  maxDepth?: number;
  label?: string;
}): void {
  const result = validateParentGraph(input);
  if (result.ok) return;
  const label = input.label ?? "Parent graph";
  throw new Error(
    `${label} is invalid: ${result.issues.map(formatParentGraphIssue).join(" ")}`,
  );
}

export function assertParentChains<T extends object>(
  nodes: readonly T[],
  getParent: (value: T) => T | null | undefined,
  options: { label?: string; maxDepth?: number } = {},
) {
  const indexByNode = new Map(nodes.map((node, index) => [node, index]));
  assertValidParentGraph({
    nodeIds: nodes.keys(),
    edges: nodes.flatMap((node, childId) => {
      const parent = getParent(node);
      return parent
        ? [{ childId, parentId: indexByNode.get(parent) ?? -1 }]
        : [];
    }),
    maxDepth: options.maxDepth,
    label: options.label,
  });
}

export function collectParentChain<T>(
  start: T | null | undefined,
  getParent: (value: T) => T | null | undefined,
  options: { label?: string; maxDepth?: number } = {},
): T[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_PARENT_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error("Parent chain maxDepth must be a non-negative integer.");
  }
  const chain: T[] = [];
  const visited = new Set<T>();
  for (let current = start; current != null; current = getParent(current)) {
    if (visited.has(current)) {
      throw new Error(`${options.label ?? "Parent chain"} contains a cycle.`);
    }
    if (chain.length >= maxDepth) {
      throw new Error(
        `${options.label ?? "Parent chain"} exceeds depth limit ${maxDepth}.`,
      );
    }
    visited.add(current);
    chain.push(current);
  }
  return chain;
}

export function formatParentGraphIssue<TId>(issue: ParentGraphIssue<TId>) {
  const id = (value: TId) => String(value);
  switch (issue.code) {
    case "duplicate-node":
      return `node ${id(issue.nodeId)} is duplicated.`;
    case "missing-child":
      return `edge ${id(issue.parentId)} -> ${id(issue.childId)} references a missing child.`;
    case "missing-parent":
      return `node ${id(issue.childId)} references missing parent ${id(issue.parentId)}.`;
    case "multiple-parents":
      return `node ${id(issue.childId)} has multiple parents ${issue.parentIds.map(id).join(", ")}.`;
    case "self-parent":
      return `node ${id(issue.nodeId)} references itself as parent.`;
    case "cycle":
      return `cycle detected: ${issue.nodeIds.map(id).join(" -> ")}.`;
    case "depth-exceeded":
      return `node ${id(issue.nodeId)} has depth ${issue.depth}; limit is ${issue.limit}.`;
  }
}
