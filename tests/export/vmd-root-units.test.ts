import { WebIO } from "@gltf-transform/core";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { exportVMD, validateMotionExportSemantics } from "@/export";
import { importGLTFAnimation } from "@/import/gltf-animation";
import { importVMD } from "@/import/vmd";
import { MMD_STANDARD_REST_HIPS_HEIGHT, parseVMDDocument } from "@/mmd/vmd-document";
import { getRetargetPipeline } from "@/pipelines";
import { DEFAULT_RETARGET_SOLVE_OPTIONS } from "@/retarget";
import { DEFAULT_CUSTOM_RIG_MAPPING_CONFIG } from "@/solvers";
import { readStudioMannequinVRM } from "../fixtures/vrm-variants";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

const WALK = "tests/fixtures/certification/golden-motion/motions/quaternius-walk/quaternius-walk.animation.glb";

// #13: exportVMD must write root motion in MMD units, the inverse of importVMD.
describe("VMD export root units", () => {
  it("writes センター offsets in MMD units against the standard rest hips height", async () => {
    const clip = await importGLTFAnimation(await readBytes(WALK), "walk.glb");
    const sourceRest = clip.metadata!.restHipsHeight!;
    expect(clip.metadata?.rootTranslationSpace).toBe("offset-meters");

    const bytes = await exportVMD(clip);
    const center = parseVMDDocument(bytes).boneFrames.filter(
      (frame) => frame.boneName === "センター",
    );
    const sourceHips = clip.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    )!;
    const scale = MMD_STANDARD_REST_HIPS_HEIGHT / sourceRest;
    expect(span(center.map((frame) => frame.position[1]))).toBeCloseTo(
      span(component(sourceHips.values, 1)) * scale,
      3,
    );
    expect(span(center.map((frame) => frame.position[2]))).toBeCloseTo(
      span(component(sourceHips.values, 2)) * scale,
      2,
    );

    const semantic = await validateMotionExportSemantics("vmd", bytes, clip);
    expect(semantic.issues ?? []).toEqual([]);
    expect(semantic).toMatchObject({ level: "semantic", ok: true });
  });

  it("round-trips through VMD to the same VRMA root motion as the direct path", async () => {
    const walk = await readBytes(WALK);
    const vmd = await exportVMD(await importGLTFAnimation(walk, "walk.glb"));
    expect(importVMD(vmd, "walk.vmd").metadata?.restHipsHeight).toBe(
      MMD_STANDARD_REST_HIPS_HEIGHT,
    );

    const [direct, viaVMD] = await Promise.all([
      vrmaRoot("gltf-animation", new File([walk], "walk.glb")),
      vrmaRoot("vmd", new File([Uint8Array.from(vmd)], "walk.vmd")),
    ]);

    expect(direct.stride).toBeGreaterThan(1);
    expect(viaVMD.stride).toBeCloseTo(direct.stride, 2);
    expect(viaVMD.bounce).toBeCloseTo(direct.bounce, 3);
  });
});

async function vrmaRoot(motionFormat: "gltf-animation" | "vmd", motionFile: File) {
  const result = await getRetargetPipeline(motionFormat, "vrm", "vrma")!.run({
    motionFile,
    avatarFile: new File([await readStudioMannequinVRM()], "avatar.vrm"),
    mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
    solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
  });
  const document = await new WebIO().readBinary(result.output.bytes);
  const values = Array.from(
    document
      .getRoot()
      .listAnimations()[0]!
      .listChannels()
      .find((channel) => channel.getTargetPath() === "translation")!
      .getSampler()!
      .getOutput()!
      .getArray()!,
  );
  return {
    stride: span(component(values, 2)),
    bounce: span(component(values, 1)),
  };
}

async function readBytes(relativePath: string) {
  return Uint8Array.from(await readFile(path.join(process.cwd(), relativePath)));
}

function component(values: ArrayLike<number>, axis: number) {
  return Array.from({ length: Math.floor(values.length / 3) }, (_, index) => values[index * 3 + axis]!);
}

function span(values: readonly number[]) {
  return Math.max(...values) - Math.min(...values);
}
