import { describe, expect, it } from "vitest";
import {
  collectParentChain,
  validateParentGraph,
} from "@/core/parent-graph";

describe("parent graph validation", () => {
  it("accepts a bounded forest", () => {
    expect(
      validateParentGraph({
        nodeIds: ["root", "spine", "head", "other"],
        edges: [
          { parentId: "root", childId: "spine" },
          { parentId: "spine", childId: "head" },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    {
      label: "missing parent",
      edges: [{ parentId: "missing", childId: "child" }],
      issue: "missing-parent",
    },
    {
      label: "self parent",
      edges: [{ parentId: "child", childId: "child" }],
      issue: "self-parent",
    },
    {
      label: "multiple parents",
      edges: [
        { parentId: "left", childId: "child" },
        { parentId: "right", childId: "child" },
      ],
      issue: "multiple-parents",
    },
    {
      label: "cycle",
      edges: [
        { parentId: "left", childId: "right" },
        { parentId: "right", childId: "left" },
      ],
      issue: "cycle",
    },
  ])("rejects $label", ({ edges, issue }) => {
    const result = validateParentGraph({
      nodeIds: ["left", "right", "child"],
      edges,
    });
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: issue })]),
    });
  });

  it("rejects excessive depth without recursive traversal", () => {
    const nodeIds = Array.from({ length: 8 }, (_, index) => index);
    const result = validateParentGraph({
      nodeIds,
      edges: nodeIds.slice(1).map((childId) => ({
        childId,
        parentId: childId - 1,
      })),
      maxDepth: 4,
    });
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "depth-exceeded" }),
      ]),
    });
  });

  it("bounds object parent-chain traversal", () => {
    const root: { parent?: typeof root } = {};
    const child: { parent?: typeof root } = { parent: root };
    root.parent = child;
    expect(() =>
      collectParentChain(child, (node) => node.parent, { label: "fixture" }),
    ).toThrow(/cycle/i);
  });
});
