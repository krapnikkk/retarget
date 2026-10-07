import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  validateMotionExportReload,
  validateMotionExportSemantics,
} from "@/export";
import type { MotionFormatId } from "@/formats";
import { runRetargetJobInline } from "@/jobs/browser-retarget-job";
import { getRetargetPipeline } from "@/pipelines";
import { DEFAULT_RETARGET_SOLVE_OPTIONS } from "@/retarget";
import { DEFAULT_CUSTOM_RIG_MAPPING_CONFIG } from "@/solvers";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

const GOLDEN = "tests/fixtures/certification/golden-motion";
const MOTIONS = `${GOLDEN}/motions/quaternius-walk`;
const VRM_AVATAR = `${GOLDEN}/characters/studio-mannequin-male/studio-mannequin-male.vrm`;
const GLB_AVATAR = `${GOLDEN}/characters/studio-mannequin-male/studio-mannequin-male.glb`;

const SOURCES: ReadonlyArray<{
  motionFormat: MotionFormatId;
  assurance: "beta" | "experimental";
  motionFile: () => Promise<File>;
}> = [
  { motionFormat: "bvh", assurance: "beta", motionFile: () => fixture(`${MOTIONS}/quaternius-walk.bvh`) },
  { motionFormat: "vmd", assurance: "beta", motionFile: () => fixture(`${MOTIONS}/quaternius-walk.vmd`) },
  {
    motionFormat: "gltf-animation",
    assurance: "beta",
    motionFile: () => fixture(`${MOTIONS}/quaternius-walk.animation.glb`),
  },
  { motionFormat: "mixamo-fbx", assurance: "experimental", motionFile: createMixamoNamedFBX },
];

describe("<source> -> vrm -> vrma pipelines", () => {
  it.each(SOURCES)(
    "$motionFormat exports a VRMA that reloads and matches the solved motion",
    async ({ motionFormat, assurance, motionFile }) => {
      const pipeline = getRetargetPipeline(motionFormat, "vrm", "vrma");
      expect(pipeline).toMatchObject({ assurance, outputFormat: "vrma" });

      const result = await pipeline!.run({
        motionFile: await motionFile(),
        avatarFile: await fixture(VRM_AVATAR),
        mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
        solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
      });

      expect(result.output.format).toBe("vrma");
      expect(result.solvedClip.tracks.length).toBeGreaterThan(0);
      await expect(
        validateMotionExportReload("vrma", result.output.bytes),
      ).resolves.toMatchObject({ level: "structural", ok: true });
      const semantic = await validateMotionExportSemantics(
        "vrma",
        result.output.bytes,
        result.solvedClip,
      );
      expect(semantic.issues ?? []).toEqual([]);
      expect(semantic).toMatchObject({ level: "semantic", ok: true });
    },
  );
});

async function fixture(relativePath: string) {
  const bytes = await readFile(path.join(process.cwd(), ...relativePath.split("/")));
  return new File([bytes], path.basename(relativePath));
}

// Mixamo downloads cannot be committed. Retarget the CC0 walk onto the GLB
// mannequin and write it as FBX with Mixamo bone names via the library's own
// exporter; embedded-texture ("With Skin") parsing is covered separately in
// tests/import/fbx-embedded-texture.test.ts.
async function createMixamoNamedFBX() {
  const pipeline = getRetargetPipeline("gltf-animation", "gltf-humanoid", "fbx-animation");
  const { solvedClip } = await pipeline!.retarget({
    motionFile: await fixture(`${MOTIONS}/quaternius-walk.animation.glb`),
    avatarFile: await fixture(GLB_AVATAR),
    mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
    solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
  });
  const bytes = await runRetargetJobInline({
    type: "export-motion",
    formatId: "fbx-animation",
    clip: solvedClip,
    options: { boneNamingProfile: "mixamo" },
  });
  return new File([Uint8Array.from(bytes)], "mixamo-walk.fbx");
}
