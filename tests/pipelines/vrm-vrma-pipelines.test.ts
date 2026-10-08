import { WebIO } from "@gltf-transform/core";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  validateAvatarExportReload,
  validateAvatarExportSemantics,
  validateMotionExportReload,
  validateMotionExportSemantics,
} from "@/export";
import type { MotionFormatId } from "@/formats";
import { runRetargetJobInline } from "@/jobs/browser-retarget-job";
import { getRetargetPipeline } from "@/pipelines";
import { DEFAULT_RETARGET_SOLVE_OPTIONS } from "@/retarget";
import { DEFAULT_CUSTOM_RIG_MAPPING_CONFIG } from "@/solvers";
import {
  deriveShortLegs,
  deriveVRM0,
  readAvatarForward,
  readHipsWorldTravel,
  readRestHipsHeight,
  readStudioMannequinVRM,
} from "../fixtures/vrm-variants";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

const GOLDEN = "tests/fixtures/certification/golden-motion";
const MOTIONS = `${GOLDEN}/motions/quaternius-walk`;
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
  { motionFormat: "mixamo-fbx", assurance: "experimental", motionFile: async () => mixamoFBX },
];

// The committed VRM 1.0 plus variants derived from it (tests/fixtures/vrm-variants.ts).
const TARGETS: ReadonlyArray<{
  target: string;
  bytes: () => Promise<Uint8Array<ArrayBuffer>>;
}> = [
  { target: "VRM 1.0", bytes: readStudioMannequinVRM },
  { target: "VRM 0.x", bytes: async () => deriveVRM0(await readStudioMannequinVRM()) },
  { target: "short legs", bytes: async () => deriveShortLegs(await readStudioMannequinVRM()) },
];

const CASES = SOURCES.flatMap((source) => TARGETS.map((target) => ({ ...source, ...target })));

let mixamoFBX: File;

describe("<source> -> vrm -> vrma pipelines", () => {
  it.each(CASES)(
    "$motionFormat on $target exports a VRMA that reloads and matches the solved motion",
    async ({ motionFormat, assurance, motionFile, bytes }) => {
      mixamoFBX ??= await createMixamoNamedFBX();
      const pipeline = getRetargetPipeline(motionFormat, "vrm", "vrma");
      expect(pipeline).toMatchObject({ assurance, outputFormat: "vrma" });

      const result = await pipeline!.run({
        motionFile: await motionFile(),
        avatarFile: new File([await bytes()], "avatar.vrm"),
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
      // VRMA uses the VRM 1.0 frame: the walk must travel toward +Z whatever
      // the target version or proportions.
      const { travel } = await readVRMARoot(result.output.bytes);
      expect(travel.z / Math.hypot(travel.x, travel.z)).toBeGreaterThan(0.9);
    },
  );

  it("scales VRMA root stride by the target rest hips height", async () => {
    const standard = await readStudioMannequinVRM();
    const short = deriveShortLegs(standard);
    const ratio = readRestHipsHeight(short) / readRestHipsHeight(standard);
    expect(ratio).toBeLessThan(0.7);

    const [standardRoot, shortRoot] = await Promise.all(
      [standard, short].map(async (avatar) => {
        const result = await getRetargetPipeline("gltf-animation", "vrm", "vrma")!.run({
          motionFile: await fixture(`${MOTIONS}/quaternius-walk.animation.glb`),
          avatarFile: new File([avatar], "avatar.vrm"),
          mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
          solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
        });
        return readVRMARoot(result.output.bytes);
      }),
    );

    expect(shortRoot!.restHeight).toBeCloseTo(readRestHipsHeight(short), 4);
    expect(shortRoot!.stride / standardRoot!.stride).toBeCloseTo(ratio, 3);
  });

  // Foot contact and facing on each target: the avatar-space oracle checks
  // end-effector (hands/feet) and left/right symmetry error, and the hips must
  // travel the way the avatar geometry faces (foot -> toes), which semantic
  // comparison against the solved motion alone cannot detect.
  it.each(
    SOURCES.filter(({ assurance }) => assurance === "beta").flatMap((source) =>
      TARGETS.map((target) => ({ ...source, ...target })),
    ),
  )(
    "$motionFormat on $target bakes a VRM that walks forward with matching end effectors",
    async ({ motionFormat, motionFile, bytes }) => {
      const avatar = await bytes();
      const result = await getRetargetPipeline(motionFormat, "vrm", "baked-vrm")!.run({
        motionFile: await motionFile(),
        avatarFile: new File([avatar], "avatar.vrm"),
        mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
        solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
      });
      await expect(
        validateAvatarExportReload("baked-vrm", result.output.bytes),
      ).resolves.toMatchObject({ level: "structural", ok: true });
      const semantic = await validateAvatarExportSemantics(
        "baked-vrm",
        result.output.bytes,
        result.solvedClip,
      );
      expect(semantic.issues ?? []).toEqual([]);
      expect(semantic).toMatchObject({ level: "semantic", ok: true });
      expect(semantic.metrics?.maxEndEffectorErrorMeters).toBeLessThanOrEqual(0.01);
      const travel = readHipsWorldTravel(result.output.bytes);
      expect(travel.length()).toBeGreaterThan(0.3);
      expect(travel.normalize().dot(readAvatarForward(avatar))).toBeGreaterThan(0.9);
    },
  );
});

async function fixture(relativePath: string) {
  const bytes = await readFile(path.join(process.cwd(), ...relativePath.split("/")));
  return new File([bytes], path.basename(relativePath));
}

async function readVRMARoot(bytes: Uint8Array) {
  const document = await new WebIO().readBinary(bytes);
  const channel = document
    .getRoot()
    .listAnimations()[0]!
    .listChannels()
    .find((candidate) => candidate.getTargetPath() === "translation")!;
  const values = Array.from(channel.getSampler()!.getOutput()!.getArray()!);
  const horizontal = (index: number) => Math.hypot(values[index]!, values[index + 2]!);
  const last = values.length - 3;
  return {
    travel: { x: values[last]! - values[0]!, z: values[last + 2]! - values[2]! },
    restHeight: channel.getTargetNode()!.getTranslation()[1],
    stride: Math.max(
      ...Array.from({ length: values.length / 3 }, (_, item) => horizontal(item * 3)),
    ),
  };
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
