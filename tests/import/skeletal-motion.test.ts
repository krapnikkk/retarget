import { describe, it, expect } from "vitest";
import { Quaternion, Vector3 } from "three";
import {
  importHumanoidSkeletalMotion,
  type HumanoidSkeletalMotion,
} from "@/import/skeletal-motion";
import { exportVMD } from "@/export/vmd";
import { exportVRMA } from "@/export/vrma";
import { importVRMA } from "@/import/vrma";
import { importVMD } from "@/import/vmd";
import { parseVMDDocument } from "@/mmd/vmd-document";
import { sampleMotionClipPose, validateMotionClip } from "@/retarget";

const options = { humanBoneLayout: "unity-human-body-bones" as const };
function fixture(): HumanoidSkeletalMotion {
  const trs = (x = 0, y = 0, z = 0) => [x, y, z, 0, 0, 0, 1, 1, 1, 1];
  const joints = [
    { name: "root", parent: -1, humanBone: null as number | null, rest: trs() },
  ];
  // Required body bones plus thumb; a semantic tree with a helper before Hips.
  for (let bone = 0; bone <= 20; bone++)
    joints.push({
      name: `joint-${bone}`,
      parent: bone === 0 ? 0 : 1,
      humanBone: bone,
      rest: bone === 0 ? trs(0, 1, 0) : trs(0.1, 0.1, 0),
    });
  for (let bone = 24; bone <= 26; bone++)
    joints.push({
      name: `finger-${bone}`,
      parent: 18,
      humanBone: bone,
      rest: trs(0.03),
    });
  const first = joints.flatMap((j) => j.rest),
    last = [...first];
  const yaw = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2,
  );
  last.splice(0, 7, 2, 0, 3, ...yaw.toArray());
  return {
    name: "evaluated",
    fps: 30,
    joints,
    times: [0, 1],
    frames: [first, last],
  };
}
describe("evaluated skeletal motion", () => {
  it("folds root movement into hips without scaling, trimming or mutating inputs", () => {
    const m = fixture(),
      original = JSON.stringify(m);
    const clip = importHumanoidSkeletalMotion(m, options);
    expect(validateMotionClip(clip).ok).toBe(true);
    expect(clip.metadata?.restHipsHeight).toBe(1);
    expect(sampleMotionClipPose(clip, 1, false).hips?.position).toEqual([
      -2, 0, -3,
    ]);
    const q = sampleMotionClipPose(clip, 1, false).hips!.rotation!;
    expect(
      new Quaternion(...q).angleTo(
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
      ),
    ).toBeLessThan(1e-7);
    expect(sampleMotionClipPose(clip, 1, false).leftUpperArm?.rotation).toEqual(
      [0, 0, 0, 1],
    );
    expect(
      clip.tracks.find((t) => t.bone === "leftThumbMetacarpal"),
    ).toBeDefined();
    expect(JSON.stringify(m)).toBe(original);
  });
  it("removes non-identity rest rotations and folds an animated helper", () => {
    const m = fixture();
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.6);
    m.joints[1]!.rest.splice(3, 4, ...q.toArray());
    for (const f of m.frames) f.splice(13, 4, ...q.toArray());
    const clip = importHumanoidSkeletalMotion(m, options);
    expect(
      new Quaternion(
        ...sampleMotionClipPose(clip, 0, false).hips!.rotation!,
      ).angleTo(new Quaternion()),
    ).toBeLessThan(1e-7);
    expect(sampleMotionClipPose(clip, 1, false).hips!.position![0]).toBeCloseTo(
      -2,
    );
  });
  it("distinguishes native HumanTrait from public HumanBodyBones numbering", () => {
    const m = fixture();
    m.joints.forEach((j) => {
      if (j.humanBone !== null && j.humanBone >= 9) j.humanBone++;
    });
    const clip = importHumanoidSkeletalMotion(m, {
      humanBoneLayout: "unity-human-trait",
    });
    expect(clip.tracks.some((t) => t.bone === "head")).toBe(true);
    expect(clip.tracks.some((t) => t.bone === "leftThumbMetacarpal")).toBe(
      true,
    );
    expect(clip.tracks.some((t) => t.bone === "upperChest")).toBe(false);
  });
  it("rejects loss of animated translations and non-unit scales", () => {
    const m = fixture();
    m.frames[1]![20] = 0.7;
    expect(() => importHumanoidSkeletalMotion(m, options)).toThrow("non-root");
    m.frames[1]![20] = m.joints[2]!.rest[0]!;
    m.frames[1]![27] = 2;
    expect(() => importHumanoidSkeletalMotion(m, options)).toThrow("Scaled");
  });
  it("rejects duplicate mappings, invalid timelines, malformed frames and exhausted budgets", () => {
    const m = fixture();
    m.joints[2]!.humanBone = 0;
    expect(() => importHumanoidSkeletalMotion(m, options)).toThrow("duplicate");
    const t = fixture();
    t.times[1] = 0;
    expect(() => importHumanoidSkeletalMotion(t, options)).toThrow("timeline");
    const f = fixture();
    f.frames[1]!.pop();
    expect(() => importHumanoidSkeletalMotion(f, options)).toThrow("stride");
    expect(() =>
      importHumanoidSkeletalMotion(fixture(), {
        ...options,
        budget: { maxBones: 2 },
      }),
    ).toThrow();

  });
  it("roundtrips VRMA and VMD root travel and disables standard MMD IK only when requested", async () => {
    const c = importHumanoidSkeletalMotion(fixture(), options);
    const vrma = await importVRMA(await exportVRMA(c));
    const bytes = await exportVMD(c, { disableLegIK: true });
    const vmd = importVMD(bytes);
    expect(
      sampleMotionClipPose(vrma, 1, false).hips?.position?.[2],
    ).toBeCloseTo(-3, 5);
    const sourceHeight = c.metadata!.restHipsHeight!;
    const targetHeight = vmd.metadata!.restHipsHeight!;
    expect(
      sampleMotionClipPose(vmd, 1, false).hips?.position?.[2]! / targetHeight,
    ).toBeCloseTo(-3 / sourceHeight, 5);
    const document = parseVMDDocument(bytes);
    expect(
      document.propertyFrames[0]?.ikStates.map((s) => [s.name, s.enabled]),
    ).toEqual([
      ["左足ＩＫ", false],
      ["右足ＩＫ", false],
      ["左つま先ＩＫ", false],
      ["右つま先ＩＫ", false],
    ]);
    expect(parseVMDDocument(await exportVMD(c)).propertyFrames).toEqual([]);
  });
});
