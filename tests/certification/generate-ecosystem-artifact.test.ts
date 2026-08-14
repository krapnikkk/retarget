import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HUMANOID_ECOSYSTEM_RECEIPTS,
  HUMANOID_PIPELINE_CERTIFICATION,
} from "@/certification";
import {
  validateAvatarExportReload,
  validateAvatarExportSemantics,
} from "@/export";
import { getRetargetPipeline } from "@/pipelines";
import { DEFAULT_RETARGET_SOLVE_OPTIONS } from "@/retarget";
import { DEFAULT_CUSTOM_RIG_MAPPING_CONFIG } from "@/solvers";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

const CASE_ID = "quaternius-walk-gltf-to-studio-mannequin-glb";

describe("Golden Motion external ecosystem artifact", () => {
  it("generates the structurally and semantically validated Animated GLB", async () => {
    const golden = HUMANOID_PIPELINE_CERTIFICATION.cases.find(
      (item) => item.id === CASE_ID,
    );
    expect(golden).toBeDefined();
    expect(golden).toMatchObject({
      motionFormat: "gltf-animation",
      avatarFormat: "gltf-humanoid",
      exportFormat: "animated-glb",
    });

    const sourceBytes = new Uint8Array(
      await readFile(projectPath(golden!.source.path)),
    );
    const avatarBytes = new Uint8Array(
      await readFile(projectPath(golden!.avatar.path)),
    );
    const motionFile = new File(
      [sourceBytes],
      "quaternius-walk.animation.glb",
      { type: "model/gltf-binary" },
    );
    const avatarFile = new File(
      [avatarBytes],
      "studio-mannequin-male.glb",
      { type: "model/gltf-binary" },
    );
    const pipeline = getRetargetPipeline(
      golden!.motionFormat,
      golden!.avatarFormat,
      golden!.exportFormat,
    );
    expect(pipeline).toMatchObject({ assurance: "beta" });
    const result = await pipeline!.run({
      motionFile,
      avatarFile,
      mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
      solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
    });
    const exported = result.output.bytes;

    await expect(
      validateAvatarExportReload("animated-glb", exported),
    ).resolves.toMatchObject({ level: "structural", ok: true });
    await expect(
      validateAvatarExportSemantics(
        "animated-glb",
        exported,
        result.solvedClip,
      ),
    ).resolves.toMatchObject({ level: "semantic", ok: true });

    const outputPath = process.env.RETARGET_ECOSYSTEM_ARTIFACT_PATH;
    if (outputPath) {
      const absolutePath = path.resolve(outputPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, exported);
      console.log(
        `[ecosystem-artifact] ${absolutePath} sha256=${sha256(exported)}`,
      );
    }

    expect(exported.byteLength).toBeGreaterThan(0);
    const receipt = HUMANOID_ECOSYSTEM_RECEIPTS.find(
      (item) => item.caseId === CASE_ID,
    );
    expect(receipt).toBeDefined();
    expect({
      byteLength: exported.byteLength,
      sha256: sha256(exported),
    }).toEqual({
      byteLength: receipt!.artifact.byteLength,
      sha256: receipt!.artifact.sha256,
    });
  });
});

function projectPath(relativePath: string) {
  return path.join(process.cwd(), ...relativePath.split("/"));
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
