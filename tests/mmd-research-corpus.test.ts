import { WebIO } from "@gltf-transform/core";
import { importGLTFAnimation } from "@/import/gltf-animation";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  convertMMDModelToGLBDocument,
  parsePMX,
} from "@/export/avatar-conversion";
import {
  exportAnimatedGLB,
  validateAvatarExportReload,
  validateAvatarExportSemantics,
} from "@/export";
import { bindMotionClipToAvatar } from "@/browser/avatar-target-pipeline";
import {
  readAnimatedPMXMotionSummary,
  writeAnimatedPMX,
} from "@/export/pmx";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { createGLTFHumanoidRigSignature } from "@/export/gltf-target-binding";
import { MMD_BODY_PROFILE } from "@/profiles";
import { importVMD } from "@/import/vmd";
import {
  bindSolvedMotionClipStub,
  createRetargetedMotionClipStub,
} from "./fixtures/retarget-stub";
import {
  DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
  solveHumanoidCustomRigMotion,
} from "@/solvers";
import { getRetargetPipeline } from "@/pipelines";
import { DEFAULT_RETARGET_SOLVE_OPTIONS } from "@/retarget";
import {
  validateMotionExportReload,
  validateMotionExportSemantics,
} from "@/export";
import {
  deriveShortLegs,
  deriveVRM0,
  readRestHipsHeight,
  readStudioMannequinVRM,
} from "./fixtures/vrm-variants";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

const corpusRoot = path.resolve("references/mmd/research-corpus");

describe.skipIf(!existsSync(corpusRoot))("MMD research corpus", () => {
  for (const filename of ["Gene_light.pmx", "Gene_light.pmd"]) {
    it(`loads ${filename} through production conversion`, async () => {
      const geneRoot = path.join(corpusRoot, "mmdagent-gene");
      const bytes = new Uint8Array(await readFile(path.join(geneRoot, filename)));
      const document = convertMMDModelToGLBDocument(bytes, filename, (uri) => {
        const resourcePath = path.join(geneRoot, ...uri.split(/[\\/]+/));
        return new Uint8Array(readFileSync(resourcePath));
      });
      const root = document.getRoot();
      const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());

      expect(root.listMeshes()).toHaveLength(1);
      expect(root.listNodes()).toHaveLength(226);
      expect(primitives).toHaveLength(13);
      expect(root.listSkins()).toHaveLength(1);
      expect(root.listTextures()).toHaveLength(13);
    });
  }

  it("preserves Gene PMX morph, display, rigid-body, and joint sections", async () => {
    const bytes = new Uint8Array(
      await readFile(path.join(corpusRoot, "mmdagent-gene", "Gene_light.pmx")),
    );
    const before = readAnimatedPMXMotionSummary(bytes);
    const canonical = createRetargetedMotionClipStub({
      fbxFile: { name: "idle.fbx" },
      vrmFile: { name: "Gene_light.pmx" },
    });
    const document = convertMMDModelToGLBDocument(bytes, "Gene_light.pmx");
    const clip = bindSolvedMotionClipStub(
      solveHumanoidCustomRigMotion(canonical),
      {
        kind: "mmd-model",
        filename: "Gene_light.pmx",
        profile: MMD_BODY_PROFILE.id,
        rigSignature: createGLTFHumanoidRigSignature(
          collectHumanoidNodes(document),
          MMD_BODY_PROFILE.id,
        ),
      },
    );
    const after = readAnimatedPMXMotionSummary(
      writeAnimatedPMX(
        bytes,
        clip,
      ),
    );

    expect(after.morphCount).toBeGreaterThan(before.morphCount);
    expect(after.displayFrames).toBe(before.displayFrames);
    expect(after.rigidBodies).toBe(before.rigidBodies);
    expect(after.joints).toBe(before.joints);
    expect(after.softBodies).toBe(before.softBodies);
  });

  const geneMotions = [
    ["01_happy.vmd", 10],
    ["16_thinking.vmd", 10],
    ["22_apology.vmd", 10],
    ["stand.vmd", 4],
  ] as const;

  for (const [filename, expectedDuration] of geneMotions) {
    it(`imports ${filename}`, async () => {
      const bytes = new Uint8Array(
        await readFile(path.join(corpusRoot, "mmdagent-gene", "motion", filename)),
      );
      const clip = importVMD(bytes, filename);

      expect(clip.tracks).toHaveLength(50);
      expect(clip.duration).toBeCloseTo(expectedDuration, 6);
      expect(clip.metadata?.mmd?.sectionCounts).toMatchObject({
        bone: expect.any(Number),
        morph: expect.any(Number),
        property: expect.any(Number),
      });
      expect(clip.diagnostics?.assumptions.fingerTracks).toBe(true);
    });
  }

  it("runs a real Gene VMD/PMX pair through target binding and Animated GLB semantics", async () => {
    const geneRoot = path.join(corpusRoot, "mmdagent-gene");
    const [avatarBytes, motionBytes] = await Promise.all([
      readFile(path.join(geneRoot, "Gene_light.pmx")),
      readFile(path.join(geneRoot, "motion", "stand.vmd")),
    ]);
    const avatarFile = new File([avatarBytes], "Gene_light.pmx");
    const bound = await bindMotionClipToAvatar({
      avatarFile,
      avatarFormatId: "mmd-model",
      clip: importVMD(new Uint8Array(motionBytes), "stand.vmd"),
    });
    const output = await exportAnimatedGLB({
      avatarFile,
      avatarFormatId: "mmd-model",
      clip: bound,
    });

    await expect(
      validateAvatarExportReload("animated-glb", output),
    ).resolves.toMatchObject({ level: "structural", ok: true });
    await expect(
      validateAvatarExportSemantics("animated-glb", output, bound),
    ).resolves.toMatchObject({ level: "semantic", ok: true });
  });

  // #15: MMD avatars report rest hips at leg-root height, like every other
  // format, while root motion is still driven on センター.
  it("reports Gene's rest hips at its leg-root height, not センター", async () => {
    const heights = await readGeneHeights();
    const bound = await bindMotionClipToAvatar({
      avatarFile: new File([await readFile(path.join(corpusRoot, "mmdagent-gene", "Gene_light.pmx"))], "Gene_light.pmx"),
      avatarFormatId: "mmd-model",
      clip: importVMD(
        new Uint8Array(await readFile(path.join(corpusRoot, "mmdagent-gene", "motion", "stand.vmd"))),
        "stand.vmd",
      ),
    });
    expect(bound.target.restHipsHeight).toBeCloseTo(heights.legRoot, 3);
    expect(bound.target.restHipsHeight!).toBeGreaterThan(heights.center + 1);
  });

  it("scales a glTF walk to Gene in proportion to its leg-root height", async () => {
    const heights = await readGeneHeights();
    const avatarFile = new File([await readFile(path.join(corpusRoot, "mmdagent-gene", "Gene_light.pmx"))], "Gene_light.pmx");
    const source = await importGLTFAnimation(
      Uint8Array.from(await readFile("tests/fixtures/certification/golden-motion/motions/quaternius-walk/quaternius-walk.animation.glb")),
      "walk.glb",
    );
    const bound = await bindMotionClipToAvatar({ avatarFile, avatarFormatId: "mmd-model", clip: source });
    const output = await exportAnimatedGLB({ avatarFile, avatarFormatId: "mmd-model", clip: bound });

    const sourceStride = span(component(trackValues(source, "hips"), 2));
    const expected = sourceStride * heights.legRoot / source.metadata!.restHipsHeight!;
    expect(await centerTravel(output)).toBeCloseTo(expected, 1);
    // MMD faces -Z in its own space; Gene must walk the way its eyes face.
    expect(await travelTowardFace(output)).toBeGreaterThan(0.9);
    await expect(
      validateAvatarExportSemantics("animated-glb", output, bound),
    ).resolves.toMatchObject({ level: "semantic", ok: true });
  });

  it("plays a Gene VMD on Gene with unscaled root motion, as MMD does", async () => {
    const geneRoot = path.join(corpusRoot, "mmdagent-gene");
    const avatarFile = new File([await readFile(path.join(geneRoot, "Gene_light.pmx"))], "Gene_light.pmx");
    const motion = importVMD(new Uint8Array(await readFile(path.join(geneRoot, "motion", "stand.vmd"))), "stand.vmd");
    const bound = await bindMotionClipToAvatar({ avatarFile, avatarFormatId: "mmd-model", clip: motion });
    const output = await exportAnimatedGLB({ avatarFile, avatarFormatId: "mmd-model", clip: bound });

    const sway = Math.max(...[0, 1, 2].map((axis) => span(component(trackValues(motion, "hips"), axis))));
    expect(sway).toBeGreaterThan(0.05);
    expect(await centerTravel(output, "max-axis")).toBeCloseTo(sway, 3);
  });

  it("keeps the expression-only Gene VMD as a negative fixture", async () => {
    const filename = "00_normal.vmd";
    const bytes = new Uint8Array(
      await readFile(path.join(corpusRoot, "mmdagent-gene", "motion", filename)),
    );
    expect(() => importVMD(bytes, filename)).toThrow(
      "VMD file does not contain supported body tracks.",
    );
  });

  const pmxFixtures = [
    ["babylon-mmd/res/model/bone_flag_test.pmx", 0, 3, 0, 0],
    ["babylon-mmd/res/model/bone_hierarchy_test.pmx", 0, 5, 0, 0],
    ["babylon-mmd/res/model/constraint_test.pmx", 48, 2, 2, 0],
    ["babylon-mmd/res/model/matcap_sample.pmx", 2452, 2, 1, 1],
    ["babylon-mmd/res/model/uv_morph_test.pmx", 24, 2, 1, 1],
    ["nanoem/emapp/test/fixtures/test.pmx", 0, 140, 1, 4],
    ["nanoem/emapp/test/fixtures/effects/main.pmx", 0, 140, 17, 4],
  ] as const;

  for (const [filename, vertices, bones, materials, textures] of pmxFixtures) {
    it(`parses ${filename}`, async () => {
      const bytes = new Uint8Array(await readFile(path.join(corpusRoot, filename)));
      const model = parsePMX(bytes);

      expect(model.positions).toHaveLength(vertices * 3);
      expect(model.bones).toHaveLength(bones);
      expect(model.materials).toHaveLength(materials);
      expect(model.textures).toHaveLength(textures);
    });
  }

  it("classifies the Babylon MMD physics-toggle VMD fixtures", async () => {
    const motionRoot = path.join(corpusRoot, "babylon-mmd", "res", "motion");
    const v2Filename = "physics_toggle_test_v2_yyb10th.vmd";
    const v2 = new Uint8Array(await readFile(path.join(motionRoot, v2Filename)));
    expect(() => importVMD(v2, v2Filename)).toThrow(
      "VMD file does not contain supported body tracks.",
    );

    const v3Filename = "physics_toggle_test_v3_yyb10th.vmd";
    const v3 = new Uint8Array(await readFile(path.join(motionRoot, v3Filename)));
    const clip = importVMD(v3, v3Filename);
    expect(clip.tracks).toHaveLength(8);
    expect(clip.duration).toBeCloseTo(2 / 3, 6);
  });

  // Independent VMD in real MMD units (rest hips 10). Gene motions carry
  // little root motion, so they pin the unit scaling numerically rather than
  // a walk: VRMA root span = source span * targetRestHips / sourceRestHips.
  it.each([
    ["stand.vmd", "VRM 1.0"],
    ["stand.vmd", "VRM 0.x"],
    ["stand.vmd", "short legs"],
    ["01_happy.vmd", "VRM 1.0"],
  ] as const)("exports Gene %s on %s as a semantically matching VRMA", async (filename, target) => {
    const standard = await readStudioMannequinVRM();
    const avatar = target === "VRM 0.x"
      ? deriveVRM0(standard)
      : target === "short legs"
        ? deriveShortLegs(standard)
        : standard;
    const motionBytes = await readFile(
      path.join(corpusRoot, "mmdagent-gene", "motion", filename),
    );
    const result = await getRetargetPipeline("vmd", "vrm", "vrma")!.run({
      motionFile: new File([motionBytes], filename),
      avatarFile: new File([avatar], "avatar.vrm"),
      mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
      solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
    });

    expect(result.sourceClip.metadata).toMatchObject({
      rootTranslationSpace: "offset-source-units",
      restHipsHeight: 10,
    });
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

    const sourceSpan = horizontalSpan(
      result.solvedClip.tracks.find(
        (track) => track.bone === "hips" && track.path === "translation",
      )?.values ?? [],
    );
    const document = await new WebIO().readBinary(result.output.bytes);
    const rootChannel = document.getRoot().listAnimations()[0]!.listChannels()
      .find((channel) => channel.getTargetPath() === "translation");
    const vrmaSpan = horizontalSpan(
      Array.from(rootChannel?.getSampler()?.getOutput()?.getArray() ?? []),
    );
    const scale = (target === "VRM 0.x" ? readRestHipsHeight(standard) : readRestHipsHeight(avatar)) / 10;
    expect(vrmaSpan).toBeCloseTo(sourceSpan * scale, 4);
  });
});

function horizontalSpan(values: ArrayLike<number>) {
  const xs: number[] = [];
  const zs: number[] = [];
  for (let index = 0; index + 2 < values.length; index += 3) {
    xs.push(values[index]!);
    zs.push(values[index + 2]!);
  }
  return xs.length
    ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
    : 0;
}

async function readGeneHeights() {
  const file = path.join(corpusRoot, "mmdagent-gene", "Gene_light.pmx");
  const document = convertMMDModelToGLBDocument(new Uint8Array(readFileSync(file)), "Gene_light.pmx", (uri) => {
    try {
      return new Uint8Array(readFileSync(path.join(path.dirname(file), ...uri.split(/[\/]+/))));
    } catch {
      return new Uint8Array();
    }
  });
  const y = (name: string) =>
    document.getRoot().listNodes().find((node) => node.getName() === name)!.getWorldTranslation()[1];
  return { center: y("センター"), legRoot: (y("左足") + y("右足")) / 2 };
}

function trackValues(clip: { tracks: ReadonlyArray<{ bone: string; path: string; values: readonly number[] }> }, bone: string) {
  return clip.tracks.find((track) => track.bone === bone && track.path === "translation")!.values;
}

async function centerTravel(bytes: Uint8Array, mode: "z" | "max-axis" = "z") {
  const document = await new WebIO().readBinary(bytes);
  const center = document.getRoot().listNodes().find((node) => node.getName() === "センター")!;
  const channel = document.getRoot().listAnimations().at(-1)!.listChannels()
    .find((candidate) => candidate.getTargetNode() === center && candidate.getTargetPath() === "translation")!;
  const values = Array.from(channel.getSampler()!.getOutput()!.getArray()!);
  return mode === "z"
    ? span(component(values, 2))
    : Math.max(...[0, 1, 2].map((axis) => span(component(values, axis))));
}

function component(values: ArrayLike<number>, axis: number) {
  return Array.from({ length: Math.floor(values.length / 3) }, (_, index) => values[index * 3 + axis]!);
}

function span(values: readonly number[]) {
  return Math.max(...values) - Math.min(...values);
}

async function travelTowardFace(bytes: Uint8Array) {
  const document = await new WebIO().readBinary(bytes);
  const nodes = document.getRoot().listNodes();
  const world = (name: string) => nodes.find((node) => node.getName() === name)!.getWorldTranslation();
  const faceZ = Math.sign(world("左目")[2] - world("頭")[2]);
  const center = nodes.find((node) => node.getName() === "センター")!;
  const values = Array.from(
    document.getRoot().listAnimations().at(-1)!.listChannels()
      .find((channel) => channel.getTargetNode() === center && channel.getTargetPath() === "translation")!
      .getSampler()!.getOutput()!.getArray()!,
  );
  const travelX = values.at(-3)! - values[0]!;
  const travelZ = values.at(-1)! - values[2]!;
  return (travelZ * faceZ) / Math.hypot(travelX, travelZ);
}
