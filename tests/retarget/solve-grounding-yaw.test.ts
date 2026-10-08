import { WebIO } from "@gltf-transform/core";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { exportVRMA } from "@/export";
import { runRetargetJobInline } from "@/jobs/browser-retarget-job";
import { assertRetargetJobRequest } from "@/jobs/runtime-protocol";
import { RETARGET_JOB_PROTOCOL_VERSION } from "@/jobs/types";
import {
  DEFAULT_RETARGET_SOLVE_OPTIONS,
  type CanonicalHumanoidMotionClip,
  type HumanoidBoneName,
  type RetargetSkeletonNode,
  type RetargetSolveOptions,
} from "@/retarget";
import { CANONICAL_AXIS_FRAME, createAxisCorrection } from "@/retarget/coordinate-space";
import { DEFAULT_CUSTOM_RIG_MAPPING_CONFIG } from "@/solvers";
import { solveSemanticWorldPose } from "@/validation/semantic-fk-oracle";
import type { SemanticRestBone } from "@/validation/semantic-motion";
import { readStudioMannequinVRM } from "../fixtures/vrm-variants";

const WALK = "tests/fixtures/certification/golden-motion/motions/quaternius-walk/quaternius-walk.animation.glb";
const FEET = ["leftFoot", "rightFoot", "leftToes", "rightToes"] as const;

// #12: grounding and yaw solve options.
describe("solve options: grounding and yaw", () => {
  it("leaves the solve unchanged when the new options are absent", async () => {
    const { motion, targetRig } = await fixtures();
    const base = await solve(motion, targetRig, DEFAULT_RETARGET_SOLVE_OPTIONS);
    const explicit = await solve(motion, targetRig, {
      ...DEFAULT_RETARGET_SOLVE_OPTIONS,
      grounding: "none",
      yawOffsetDegrees: 0,
    });
    expect(explicit.tracks).toEqual(base.tracks);
  });

  it("turns root travel and facing together with a 180 degree yaw", async () => {
    const { motion, targetRig } = await fixtures();
    const [base, turned] = await Promise.all(
      [0, 180].map(async (yawOffsetDegrees) =>
        vrmaRoot(await exportVRMA(await solve(motion, targetRig, {
          ...DEFAULT_RETARGET_SOLVE_OPTIONS,
          yawOffsetDegrees,
        }))),
      ),
    );
    expect(base!.travel.length()).toBeGreaterThan(1);
    expect(turned!.travel.clone().normalize().dot(base!.travel.clone().normalize()))
      .toBeLessThan(-0.99);
    // The body turns with its travel, so it still walks the way it faces.
    for (const root of [base!, turned!]) {
      expect(root.travel.clone().normalize().dot(root.facing)).toBeGreaterThan(0.9);
    }
  });

  // rootMotion: false discards root offsets, so the lifted source is no longer
  // floating there; grounding must still land the lowest foot on the rest foot.
  it.each([
    { label: "default", options: {}, floats: true },
    { label: "in place", options: { rootMotion: false }, floats: false },
    { label: "height scale 1.5", options: { heightScale: 1.5 }, floats: true },
  ])("grounds a lifted source so the lowest foot meets the rest foot ($label)", async ({ options, floats }) => {
    const { motion, targetRig } = await fixtures();
    const lifted = liftRoot(motion, 0.2);
    const solveOptions = { ...DEFAULT_RETARGET_SOLVE_OPTIONS, ...options };
    const before = await solve(lifted, targetRig, solveOptions);
    const grounded = await solve(lifted, targetRig, { ...solveOptions, grounding: "constant" });

    const restFoot = Math.min(...FEET.map((bone) => targetRig.restJoints[bone]!.position[1]));
    if (floats) expect(lowestFoot(before, targetRig)).toBeGreaterThan(restFoot + 0.05);
    expect(lowestFoot(grounded, targetRig)).toBeCloseTo(restFoot, 4);

    // The offset is a constant shift of the root channel in the exported VRMA.
    const [beforeRoot, groundedRoot] = await Promise.all(
      [before, grounded].map(async (clip) => vrmaRoot(await exportVRMA(clip))),
    );
    const shifts = groundedRoot!.heights.map((height, index) => height - beforeRoot!.heights[index]!);
    expect(Math.max(...shifts) - Math.min(...shifts)).toBeLessThan(1e-5);
    if (floats) expect(shifts[0]!).toBeLessThan(-0.05);
  });

  it("rejects constant grounding without target rest joints", async () => {
    const { motion, targetRig } = await fixtures();
    await expect(
      solve(motion, { ...targetRig, restJoints: undefined }, {
        ...DEFAULT_RETARGET_SOLVE_OPTIONS,
        grounding: "constant",
      }),
    ).rejects.toMatchObject({ code: "PROCESSING_OPTION_INVALID" });
  });

  it("rejects unknown option values at the Worker boundary", async () => {
    const { motion } = await fixtures();
    for (const options of [
      { ...DEFAULT_RETARGET_SOLVE_OPTIONS, grounding: "per-frame" },
      { ...DEFAULT_RETARGET_SOLVE_OPTIONS, yawOffsetDegrees: Number.NaN },
    ]) {
      expect(() =>
        assertRetargetJobRequest({
          schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
          jobId: "solve-options",
          task: {
            type: "solve-humanoid",
            motion,
            mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
            options,
          },
        }),
      ).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
    }
  });
});

async function fixtures() {
  const motion = await runRetargetJobInline({
    type: "import-motion",
    formatId: "gltf-animation",
    filename: "walk.glb",
    bytes: Uint8Array.from(await readFile(path.join(process.cwd(), WALK))).buffer,
  });
  const rig = await runRetargetJobInline({
    type: "inspect-humanoid-avatar",
    formatId: "vrm",
    filename: "avatar.vrm",
    bytes: (await readStudioMannequinVRM()).buffer,
  });
  const targetRig = {
    rigSignature: rig.rigSignature,
    profile: rig.profile,
    bones: rig.bones,
    skeleton: rig.skeleton,
    restHipsHeight: rig.restHipsHeight,
    restJoints: rig.restJoints!,
  };
  return { motion, targetRig };
}

type TargetRig = Awaited<ReturnType<typeof fixtures>>["targetRig"];

function solve(
  motion: CanonicalHumanoidMotionClip,
  targetRig: Omit<TargetRig, "restJoints"> & { restJoints?: TargetRig["restJoints"] },
  options: RetargetSolveOptions,
) {
  return runRetargetJobInline({
    type: "solve-humanoid",
    motion,
    mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
    options,
    targetRig,
  });
}

function liftRoot(motion: CanonicalHumanoidMotionClip, meters: number): CanonicalHumanoidMotionClip {
  return {
    ...motion,
    tracks: motion.tracks.map((track) =>
      track.bone === "hips" && track.path === "translation"
        ? { ...track, values: track.values.map((value, index) => (index % 3 === 1 ? value + meters : value)) }
        : track,
    ),
  };
}

function lowestFoot(
  clip: Awaited<ReturnType<typeof solve>>,
  targetRig: TargetRig,
) {
  const parents = new Map<HumanoidBoneName, HumanoidBoneName | undefined>();
  const visit = (node: RetargetSkeletonNode, parent?: HumanoidBoneName) => {
    if (node.bone) parents.set(node.bone, parent);
    for (const child of node.children) visit(child, node.bone ?? parent);
  };
  visit(targetRig.skeleton);
  const restPose = new Map<HumanoidBoneName, SemanticRestBone>(
    Object.entries(targetRig.restJoints).map(([bone, joint]) => [
      bone as HumanoidBoneName,
      { parent: parents.get(bone as HumanoidBoneName), worldPosition: joint!.position, worldQuaternion: joint!.rotation },
    ]),
  );
  const rootScale = targetRig.restHipsHeight! / clip.metadata!.restHipsHeight!;
  const worldAxisCorrection = createAxisCorrection(CANONICAL_AXIS_FRAME, targetRig.profile);
  let lowest = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame <= Math.ceil(clip.duration * clip.fps); frame += 1) {
    const pose = solveSemanticWorldPose({
      clip,
      restPose,
      rootScale,
      time: Math.min(clip.duration, frame / clip.fps),
      worldAxisCorrection,
    });
    for (const bone of FEET) lowest = Math.min(lowest, pose.get(bone)?.position.y ?? Infinity);
  }
  return lowest;
}

async function vrmaRoot(bytes: Uint8Array) {
  const animation = (await new WebIO().readBinary(bytes)).getRoot().listAnimations()[0]!;
  const read = (pathName: string) =>
    Array.from(
      animation.listChannels()
        .find((channel) => channel.getTargetNode()?.getName() === "hips" && channel.getTargetPath() === pathName)!
        .getSampler()!
        .getOutput()!
        .getArray()!,
    );
  const translation = read("translation");
  const rotation = read("rotation");
  const last = translation.length - 3;
  return {
    travel: new Vector3(translation[last]! - translation[0]!, 0, translation[last + 2]! - translation[2]!),
    // VRMA uses the VRM 1.0 frame, rest facing +Z.
    facing: new Vector3(0, 0, 1)
      .applyQuaternion(new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]))
      .setY(0)
      .normalize(),
    heights: translation.filter((_, index) => index % 3 === 1),
  };
}
