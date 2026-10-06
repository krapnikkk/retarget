import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NODE_TOOL_BUDGET,
  resolveNodeToolBudget,
} from "@/node-tooling/budget";
import { executeNodeToolTask } from "@/node-tooling/execute";
import type { NodeToolTask } from "@/node-tooling/types";

const CHARACTER_FIXTURE = path.resolve(
  "tests/fixtures/certification/golden-motion/characters/studio-mannequin-male/studio-mannequin-male.glb",
);
const RIG_MOTION_FIXTURE = path.resolve(
  "tests/fixtures/non-humanoid/mesh2motion/fox-animations.glb",
);

describe("Node tooling contract", () => {
  it("keeps resource policy opt-in and does not clamp caller values", () => {
    expect(DEFAULT_NODE_TOOL_BUDGET.softDeadlineMs).toBeUndefined();
    expect(resolveNodeToolBudget({
      maxArchiveEntries: 1024,
      softDeadlineMs: 600_000,
    })).toMatchObject({
      maxArchiveEntries: 1024,
      softDeadlineMs: 600_000,
    });
  });

  it("authors byte-stable VRM artifacts from explicit deterministic inputs", async () => {
    const canonicalGLBBytes = fixtureBytes(CHARACTER_FIXTURE);
    const task = {
      type: "author-vrm",
      artifactName: "avatar.vrm",
      canonicalGLBBytes,
      metadata: {
        name: "Studio Mannequin",
        author: "3dretarget fixtures",
        license: "CC0-1.0",
        sourceUrl: "https://quaternius.com/",
      },
    } as const satisfies NodeToolTask;

    const first = await execute(task);
    const second = await execute({ ...task, canonicalGLBBytes: canonicalGLBBytes.slice(0) });

    expect(first.result.artifact.assurance).toBe("experimental");
    expect(first.result.validation).toMatchObject({
      ok: true,
      structural: { status: "passed" },
      semantic: { status: "not-applicable" },
      ecosystem: { status: "not-run" },
    });
    expect(first.result.artifact.sha256).toBe(second.result.artifact.sha256);
    expect(new Uint8Array(first.result.artifact.bytes)).toEqual(
      new Uint8Array(second.result.artifact.bytes),
    );
  }, 30_000);

  it("authors byte-stable experimental PMX bundles without exposing ZIP helpers", async () => {
    const canonicalGLBBytes = fixtureBytes(CHARACTER_FIXTURE);
    const task = {
      type: "author-pmx",
      artifactName: "avatar-pmx.zip",
      canonicalGLBBytes,
      metadata: {
        name: "Studio Mannequin",
        author: "3dretarget fixtures",
        license: "CC0-1.0",
      },
      output: "bundle",
    } as const satisfies NodeToolTask;

    const first = await execute(task);
    const second = await execute({ ...task, canonicalGLBBytes: canonicalGLBBytes.slice(0) });

    expect(first.result.artifact.assurance).toBe("experimental");
    expect(first.result.validation.structural.status).toBe("passed");
    expect(first.result.artifact.sha256).toBe(second.result.artifact.sha256);
    expect(new Uint8Array(first.result.artifact.bytes)).toEqual(
      new Uint8Array(second.result.artifact.bytes),
    );
  }, 30_000);

  it("imports, serializes, exports, reloads, and semantically validates rig motion", async () => {
    const source = fixtureBytes(RIG_MOTION_FIXTURE);
    const imported = await execute({
      type: "import-rig-motion-gltf",
      bytes: source,
      filename: "fox-animations.glb",
      createdAt: "2026-08-14T00:00:00.000Z",
      options: { animationIndex: 0 },
    });

    expect(imported.result.motion.createdAt).toBe("2026-08-14T00:00:00.000Z");
    expect(imported.result.actions.length).toBeGreaterThan(0);
    expect(imported.result.inspection.signature).toMatch(/rest-node-skin-v3:sha256/);

    const exported = await execute({
      type: "export-rig-motion-gltf",
      artifactName: "fox-motion.glb",
      motion: imported.result.motion,
    });
    const repeated = await execute({
      type: "export-rig-motion-gltf",
      artifactName: "fox-motion.glb",
      motion: imported.result.motion,
    });

    expect(exported.result.validation).toMatchObject({
      ok: true,
      structural: { status: "passed" },
      semantic: { status: "passed" },
      ecosystem: { status: "not-run" },
    });
    expect(exported.result.artifact.sha256).toBe(repeated.result.artifact.sha256);
  });

  it("returns layered validation evidence for malformed artifacts", async () => {
    const execution = await execute({
      type: "validate-artifact",
      artifactName: "broken.vrm",
      bytes: new Uint8Array([1, 2, 3, 4]).buffer,
      format: "vrm",
    });

    expect(execution.result).toMatchObject({
      ok: false,
      structural: { status: "failed" },
      semantic: { status: "not-run" },
      ecosystem: { status: "not-run" },
    });
    expect(execution.result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ARTIFACT_INVALID" }),
    );
  });

  it("fails with stable codes for budgets, unsafe names, and implicit timestamps", async () => {
    const canonicalGLBBytes = fixtureBytes(CHARACTER_FIXTURE);
    await expect(
      executeNodeToolTask({
        jobId: "budget",
        budget: { ...DEFAULT_NODE_TOOL_BUDGET, maxInputBytes: 8 },
        task: {
          type: "author-vrm",
          artifactName: "avatar.vrm",
          canonicalGLBBytes,
          metadata: { name: "Avatar", author: "Fixture", license: "CC0-1.0" },
        },
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });

    await expect(
      execute({
        type: "validate-artifact",
        artifactName: "../avatar.vrm",
        bytes: new Uint8Array([1]).buffer,
        format: "vrm",
      }),
    ).rejects.toMatchObject({ code: "PROCESSING_OPTION_INVALID" });

    await expect(
      execute({
        type: "import-rig-motion-gltf",
        bytes: fixtureBytes(RIG_MOTION_FIXTURE),
        filename: "fox-animations.glb",
        createdAt: "now",
        options: { animationIndex: 0 },
      }),
    ).rejects.toMatchObject({ code: "PROCESSING_OPTION_INVALID" });
  });
});

function execute<TTask extends NodeToolTask>(task: TTask) {
  return executeNodeToolTask({
    jobId: `test-${task.type}`,
    budget: { ...DEFAULT_NODE_TOOL_BUDGET },
    task,
  });
}

function fixtureBytes(filename: string) {
  const bytes = readFileSync(filename);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
