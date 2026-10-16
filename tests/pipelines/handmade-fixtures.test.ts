import { WebIO } from "@gltf-transform/core";
import { VRMC_VRM_EXTENSIONS } from "gltf-transform-vrm-extensions";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findMotionImportAdapter } from "@/adapters/motion";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { validateMotionExportReload, validateMotionExportSemantics } from "@/export";
import type { MotionFormatId } from "@/formats";
import { runRetargetJobInline } from "@/jobs/browser-retarget-job";
import { parseVMDDocument } from "@/mmd/vmd-document";
import { getRetargetPipeline } from "@/pipelines";
import { getRigProfile } from "@/profiles";
import { DEFAULT_RETARGET_SOLVE_OPTIONS, type HumanoidBoneName } from "@/retarget";
import { CANONICAL_AXIS_FRAME, createAxisCorrection } from "@/retarget/coordinate-space";
import { DEFAULT_CUSTOM_RIG_MAPPING_CONFIG } from "@/solvers";
import { createGLTFHumanoidSemanticRestPose } from "@/validation/gltf-rest-pose";
import { solveSemanticWorldPose } from "@/validation/semantic-fk-oracle";
import {
  deriveShortLegs,
  deriveVRM0,
  readStudioMannequinVRM,
} from "../fixtures/vrm-variants";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

// #10: fixtures written by MMD Tools and Blender, not by this library. See
// tests/fixtures/handmade/README.md.
const VMD = "tests/fixtures/handmade/mmd-walk/mmd-walk.vmd";
const FBX = "tests/fixtures/handmade/mixamo-walk/mixamo-walk.fbx";
const WALK = "tests/fixtures/certification/golden-motion/motions/quaternius-walk/quaternius-walk.animation.glb";

const TARGETS = [
  { target: "VRM 1.0", bytes: readStudioMannequinVRM },
  { target: "VRM 0.x", bytes: async () => deriveVRM0(await readStudioMannequinVRM()) },
  { target: "short legs", bytes: async () => deriveShortLegs(await readStudioMannequinVRM()) },
] as const;

const SOURCES = [
  { motionFormat: "vmd" as MotionFormatId, file: VMD },
  { motionFormat: "mixamo-fbx" as MotionFormatId, file: FBX },
];

describe("hand-made independent fixtures", () => {
  it("MMD Tools VMD: standard bones, FK legs, MMD units, MMD forward", async () => {
    const document = parseVMDDocument(await bytesOf(VMD));
    const bones = new Set(document.boneFrames.map((frame) => frame.boneName));
    for (const name of [
      "センター", "下半身", "上半身", "上半身2", "首", "頭",
      "左肩", "左腕", "左ひじ", "左手首", "左足", "左ひざ", "左足首",
      "右肩", "右腕", "右ひじ", "右手首", "右足", "右ひざ", "右足首",
    ]) expect(bones.has(name), name).toBe(true);
    expect([...bones].some((name) => /ＩＫ|IK/.test(name))).toBe(false);
    const center = document.boneFrames
      .filter((frame) => frame.boneName === "センター")
      .sort((left, right) => left.frameNumber - right.frameNumber);
    expect(center.at(-1)!.frameNumber).toBe(40);
    // MMD forward is raw -Z; 1.332 m stride on 0.955 m leg roots = 13.95 units.
    expect(center.at(-1)!.position[2] - center[0]!.position[2]).toBeCloseTo(-13.95, 1);
  });

  it("Blender FBX: detected as Mixamo, centimetres, one walk cycle", async () => {
    const bytes = await bytesOf(FBX);
    expect((await findMotionImportAdapter(new File([bytes], "mixamo-walk.fbx")))?.id).toBe("mixamo-fbx");
    const clip = await runRetargetJobInline({
      type: "import-motion",
      formatId: "mixamo-fbx",
      filename: "mixamo-walk.fbx",
      bytes: bytes.buffer,
    });
    expect(clip.metadata?.rootTranslationSpace).toBe("offset-meters");
    expect(clip.duration).toBeCloseTo(4 / 3, 3);
  });

  it.each(SOURCES.flatMap((source) => TARGETS.map((target) => ({ ...source, ...target }))))(
    "$motionFormat on $target exports a VRMA that matches and walks forward",
    async ({ motionFormat, file, bytes }) => {
      const result = await getRetargetPipeline(motionFormat, "vrm", "vrma")!.run({
        motionFile: new File([await bytesOf(file)], path.basename(file)),
        avatarFile: new File([await bytes()], "avatar.vrm"),
        mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
        solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
      });
      await expect(validateMotionExportReload("vrma", result.output.bytes))
        .resolves.toMatchObject({ level: "structural", ok: true });
      const semantic = await validateMotionExportSemantics("vrma", result.output.bytes, result.solvedClip);
      expect(semantic.issues ?? []).toEqual([]);
      expect(semantic.ok).toBe(true);
      // VRMA uses the VRM 1.0 frame: forward is +Z.
      const root = await vrmaRootTravel(result.output.bytes);
      expect(root.z / Math.hypot(root.x, root.z)).toBeGreaterThan(0.9);
    },
  );

  // The decisive check: the same walk through an independent file and through
  // the direct glTF path must move every joint to the same place on the same
  // VRM. Rest-hips definitions differ slightly between importers (about 1.6%
  // for VMD and 3% for FBX over a 1.33 m walk), hence the 6 cm bound.
  it.each(SOURCES)("$motionFormat matches the direct glTF path joint by joint on a VRM", async ({ motionFormat, file }) => {
    const vrm = await readStudioMannequinVRM();
    const solve = async (format: MotionFormatId, motionPath: string) =>
      (await getRetargetPipeline(format, "vrm", "vrma")!.retarget({
        motionFile: new File([await bytesOf(motionPath)], path.basename(motionPath)),
        avatarFile: new File([vrm], "avatar.vrm"),
        mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
        solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
      })).solvedClip;
    const [independent, direct] = await Promise.all([solve(motionFormat, file), solve("gltf-animation", WALK)]);
    const document = await new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS).readBinary(vrm);
    const restPose = createGLTFHumanoidSemanticRestPose(collectHumanoidNodes(document));
    const worldAxisCorrection = createAxisCorrection(CANONICAL_AXIS_FRAME, getRigProfile("vrm1-humanoid")!);
    const pose = (clip: typeof direct, time: number) =>
      solveSemanticWorldPose({
        clip,
        restPose,
        rootScale: clip.target.restHipsHeight! / clip.metadata!.restHipsHeight!,
        time,
        worldAxisCorrection,
      });
    const bones: HumanoidBoneName[] = ["hips", "head", "leftLowerArm", "leftHand", "rightHand", "leftFoot", "rightFoot"];
    for (let frame = 0; frame <= 40; frame += 1) {
      const time = Math.min(frame / 30, direct.duration);
      const a = pose(independent, time);
      const b = pose(direct, time);
      for (const bone of bones) {
        expect(a.get(bone)!.position.distanceTo(b.get(bone)!.position), `${bone} @ ${frame}`)
          .toBeLessThan(0.06);
      }
    }
  });
});

async function bytesOf(relativePath: string) {
  return Uint8Array.from(await readFile(path.join(process.cwd(), relativePath)));
}

async function vrmaRootTravel(bytes: Uint8Array) {
  const values = Array.from(
    (await new WebIO().readBinary(bytes)).getRoot().listAnimations()[0]!.listChannels()
      .find((channel) => channel.getTargetPath() === "translation")!
      .getSampler()!.getOutput()!.getArray()!,
  );
  return { x: values.at(-3)! - values[0]!, z: values.at(-1)! - values[2]! };
}
