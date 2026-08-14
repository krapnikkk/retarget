import { Accessor, Document, WebIO } from "@gltf-transform/core";
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import { importBVH } from "@/import/bvh";
import { createImportedFBXMotionClipFromAnimation } from "@/import/fbx-motion";
import { importGLTFAnimation } from "@/import/gltf-animation";
import { importVMD } from "@/import/vmd";
import { ACTORCORE_PROFILE } from "@/profiles";

describe("Phase 3 motion importers", () => {
  it("imports BVH humanoid rotation and hips translation", () => {
    const clip = importBVH(new TextEncoder().encode(createMinimalBVH()), "walk.bvh");

    expect(clip.source).toMatchObject({
      kind: "bvh",
      profile: "bvh-humanoid",
    });
    expect(clip.target.pending).toBe(true);
    expect(clip.tracks.some((track) => track.bone === "hips")).toBe(true);
    expect(clip.diagnostics?.mapping.mappedSourceBones).toBeGreaterThan(0);
  });

  it("derives BVH root-motion scale evidence from hierarchy offsets", () => {
    const clip = importBVH(
      new TextEncoder().encode(createBVHWithLegHierarchy()),
      "walk-with-legs.bvh",
    );

    expect(clip.metadata).toMatchObject({
      restHipsHeight: 90,
      rootTranslationOrigin: "root-offset",
      rootTranslationSpace: "offset-source-units",
      rootMotionEvidence: {
        status: "preserved",
        scaleSource: "bvh-hierarchy",
        sourceRestHipsHeight: 90,
      },
    });
    expect(clip.diagnostics?.assumptions.rootMotionNormalization).toContain(
      "bvh-hierarchy scale evidence",
    );
  });

  it("imports VMD body keyframes as pending VRM motion", () => {
    const clip = importVMD(createMinimalVMD(), "pose.vmd");

    expect(clip.source).toMatchObject({
      kind: "vmd",
      profile: "mmd-body",
    });
    expect(clip.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bone: "hips", path: "rotation" }),
        expect.objectContaining({ bone: "hips", path: "translation" }),
      ]),
    );
  });

  it("preserves VMD bone Bezier curves through frame-bounded resampling", () => {
    const clip = importVMD(createInterpolatedVMD(), "curved.vmd");
    const translation = clip.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    );

    expect(clip.metadata?.resampledTracks).toBe(2);
    expect(translation?.times).toHaveLength(31);
    expect(translation?.times[15]).toBe(0.5);
    expect(translation?.values[15 * 3 + 1]).toBeGreaterThan(0.9);
  });

  it("imports GLB animation channels with humanoid node names", async () => {
    const clip = await importGLTFAnimation(await createMinimalAnimatedGLB(), "idle.glb");

    expect(clip.source).toMatchObject({
      kind: "gltf-animation",
      profile: "generic-gltf-humanoid",
    });
    expect(clip.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bone: "hips", path: "translation" }),
        expect.objectContaining({ bone: "head", path: "rotation" }),
      ]),
    );
  });

  it("imports text glTF animation channels from supplied sidecars", async () => {
    const serialized = await new WebIO().writeJSON(
      createMinimalAnimatedDocument(),
    );
    const jsonBytes = new TextEncoder().encode(JSON.stringify(serialized.json));

    const clip = await importGLTFAnimation(
      jsonBytes,
      "idle.gltf",
      undefined,
      undefined,
      serialized.resources,
    );

    expect(Object.keys(serialized.resources)).toEqual(["buffer.bin"]);
    expect(clip.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bone: "hips", path: "translation" }),
        expect.objectContaining({ bone: "head", path: "rotation" }),
      ]),
    );
  });

  it("imports humanoid FBX animation tracks through a profile mapping", () => {
    const animationClip = new AnimationClip("actorcore-idle", 1, [
      new VectorKeyframeTrack("CC_Base_Hip.position", [0, 1], [0, 0, 0, 0, 1, 0]),
      new QuaternionKeyframeTrack(
        "CC_Base_Head.quaternion",
        [0, 1],
        [0, 0, 0, 1, 0, 0.1, 0, 0.995],
      ),
    ]);

    const clip = createImportedFBXMotionClipFromAnimation({
      animationClip,
      filename: "actorcore-idle.fbx",
      kind: "actorcore-fbx",
      profile: ACTORCORE_PROFILE,
    });

    expect(clip.source).toMatchObject({
      kind: "actorcore-fbx",
      profile: "actorcore",
    });
    expect(clip.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bone: "hips", path: "translation" }),
        expect.objectContaining({ bone: "head", path: "rotation" }),
      ]),
    );
  });

  it("rejects malformed BVH frame values instead of shifting later channels", () => {
    const malformed = createMinimalBVH().replace(
      "1 2 3 10 0 0 0 20 0",
      "1 2 nope 10 0 0 0 20 0",
    );

    expect(() => importBVH(new TextEncoder().encode(malformed), "bad.bvh")).toThrow(
      /frame 1 channel 2/,
    );
  });

  it("rejects truncated VMD bone frame sections", () => {
    const truncated = createMinimalVMD();
    new DataView(truncated.buffer).setUint32(50, 2, true);

    expect(() => importVMD(truncated, "truncated.vmd")).toThrow(/truncated/);
  });

  it("keeps distinct VMD source channels that map to the same canonical bone", () => {
    const clip = importVMD(createLayeredRootVMD(), "layered-root.vmd");

    expect(clip.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bone: "hips", path: "rotation" }),
        expect.objectContaining({ bone: "hips", path: "translation" }),
      ]),
    );
  });

  it("preserves CUBICSPLINE glTF channels through bounded resampling", async () => {
    const clip = await importGLTFAnimation(
      await createMinimalAnimatedGLB("CUBICSPLINE"),
      "cubic.glb",
    );
    const translation = clip.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    );
    const rotation = clip.tracks.find(
      (track) => track.bone === "head" && track.path === "rotation",
    );

    expect(clip.metadata?.resampledTracks).toBe(2);
    expect(translation!.times.length).toBeGreaterThan(2);
    expect(translation!.times.length).toBeLessThan(61);
    const midpoint = translation!.times.indexOf(0.5);
    expect(translation?.values.slice(midpoint * 3, midpoint * 3 + 3)).toEqual([
      0, 0.5, 0,
    ]);
    for (let index = 0; index <= 100; index += 1) {
      const time = index / 100;
      const expectedY = 3 * time * time - 2 * time * time * time;
      expect(sampleLinearComponent(translation!, time, 1)).toBeCloseTo(
        expectedY,
        3,
      );
    }
    for (let index = 0; index < (rotation?.values.length ?? 0); index += 4) {
      const quaternion = rotation!.values.slice(index, index + 4);
      expect(Math.hypot(...quaternion)).toBeCloseTo(1, 6);
    }
  });

  it("preserves STEP transitions without expanding the whole clip to 60 FPS", async () => {
    const clip = await importGLTFAnimation(
      await createMinimalAnimatedGLB("STEP"),
      "step.glb",
    );
    const translation = clip.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    )!;

    expect(translation.times).toHaveLength(3);
    expect(translation.times[1]).toBeCloseTo(0.999999, 6);
    expect(translation.values).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0]);
  });
});

function createMinimalBVH() {
  return `HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
  JOINT Head
  {
    OFFSET 0 10 0
    CHANNELS 3 Zrotation Xrotation Yrotation
    End Site
    {
      OFFSET 0 2 0
    }
  }
MOTION
Frames: 2
Frame Time: 0.0333333
0 0 0 0 0 0 0 0 0
1 2 3 10 0 0 0 20 0
`;
}

function sampleLinearComponent(
  track: { times: number[]; values: number[] },
  time: number,
  component: number,
) {
  let right = track.times.findIndex((value) => value >= time);
  if (right < 0) right = track.times.length - 1;
  const left = Math.max(0, right - 1);
  const start = track.times[left] ?? time;
  const end = track.times[right] ?? time;
  const alpha = end - start <= 1e-12 ? 0 : (time - start) / (end - start);
  const from = track.values[left * 3 + component] ?? 0;
  const to = track.values[right * 3 + component] ?? from;
  return from + (to - from) * alpha;
}

function createBVHWithLegHierarchy() {
  return `HIERARCHY
ROOT Hips
{
  OFFSET 0 90 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
  JOINT LeftUpLeg
  {
    OFFSET 10 -40 0
    CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT LeftLeg
    {
      OFFSET 0 -40 0
      CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT LeftFoot
      {
        OFFSET 0 -10 5
        CHANNELS 3 Zrotation Xrotation Yrotation
      }
    }
  }
}
MOTION
Frames: 2
Frame Time: 0.0333333
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
10 0 20 0 0 0 0 0 0 0 0 0 0 0 0
`;
}

function createMinimalVMD() {
  const bytes = new Uint8Array(30 + 20 + 4 + 111 + 20);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 30, "Vocaloid Motion Data 0002");
  view.setUint32(50, 1, true);
  const offset = 54;
  writeAscii(bytes, offset, 15, "center");
  view.setUint32(offset + 15, 3, true);
  view.setFloat32(offset + 19, 1, true);
  view.setFloat32(offset + 23, 2, true);
  view.setFloat32(offset + 27, 3, true);
  view.setFloat32(offset + 31, 0, true);
  view.setFloat32(offset + 35, 0, true);
  view.setFloat32(offset + 39, 0, true);
  view.setFloat32(offset + 43, 1, true);
  return bytes;
}

function createInterpolatedVMD() {
  const bytes = new Uint8Array(30 + 20 + 4 + 111 * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 30, "Vocaloid Motion Data 0002");
  view.setUint32(50, 2, true);
  writeVMDFrame(bytes, 54, 0, 0);
  const secondOffset = 54 + 111;
  writeVMDFrame(bytes, secondOffset, 30, 1);
  const interpolationOffset = secondOffset + 47;
  bytes[interpolationOffset + 1] = 0;
  bytes[interpolationOffset + 9] = 0;
  bytes[interpolationOffset + 5] = 127;
  bytes[interpolationOffset + 13] = 127;
  return bytes;
}

function createLayeredRootVMD() {
  const bytes = new Uint8Array(30 + 20 + 4 + 111 * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 30, "Vocaloid Motion Data 0002");
  view.setUint32(50, 2, true);
  writeVMDFrame(bytes, 54, 0, 1, "center");
  writeVMDFrame(bytes, 54 + 111, 0, 2, "groove");
  return bytes;
}

function writeVMDFrame(
  bytes: Uint8Array,
  offset: number,
  frame: number,
  translationY: number,
  boneName = "center",
) {
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, offset, 15, boneName);
  view.setUint32(offset + 15, frame, true);
  view.setFloat32(offset + 23, translationY, true);
  view.setFloat32(offset + 43, 1, true);
}

async function createMinimalAnimatedGLB(
  interpolation: "LINEAR" | "STEP" | "CUBICSPLINE" = "LINEAR",
) {
  return new WebIO().writeBinary(
    createMinimalAnimatedDocument(interpolation),
  );
}

function createMinimalAnimatedDocument(
  interpolation: "LINEAR" | "STEP" | "CUBICSPLINE" = "LINEAR",
) {
  const document = new Document();
  const buffer = document.createBuffer("buffer");
  const scene = document.createScene("scene");
  document.getRoot().setDefaultScene(scene);
  const hips = document.createNode("hips");
  const head = document.createNode("head");
  scene.addChild(hips).addChild(head);

  const times = document
    .createAccessor("times")
    .setType(Accessor.Type.SCALAR)
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  const translations = document
    .createAccessor("hips.translation")
    .setType(Accessor.Type.VEC3)
    .setArray(
      new Float32Array(
        interpolation === "CUBICSPLINE"
          ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]
          : [0, 0, 0, 0, 1, 0],
      ),
    )
    .setBuffer(buffer);
  const rotations = document
    .createAccessor("head.rotation")
    .setType(Accessor.Type.VEC4)
    .setArray(
      new Float32Array(
        interpolation === "CUBICSPLINE"
          ? [
              0, 0, 0, 0,
              0, 0, 0, 1,
              0, 0, 0, 0,
              0, 0, 0, 0,
              0, 0, 0.1, 0.995,
              0, 0, 0, 0,
            ]
          : [0, 0, 0, 1, 0, 0, 0.1, 0.995],
      ),
    )
    .setBuffer(buffer);
  const animation = document.createAnimation("idle");
  const translationSampler = document
    .createAnimationSampler("hips.translation.sampler")
    .setInput(times)
    .setOutput(translations)
    .setInterpolation(interpolation);
  const rotationSampler = document
    .createAnimationSampler("head.rotation.sampler")
    .setInput(times)
    .setOutput(rotations)
    .setInterpolation(interpolation);

  animation
    .addSampler(translationSampler)
    .addSampler(rotationSampler)
    .addChannel(
      document
        .createAnimationChannel("hips.translation")
        .setSampler(translationSampler)
        .setTargetNode(hips)
        .setTargetPath("translation"),
    )
    .addChannel(
      document
        .createAnimationChannel("head.rotation")
        .setSampler(rotationSampler)
        .setTargetNode(head)
        .setTargetPath("rotation"),
    );

  return document;
}

function writeAscii(
  bytes: Uint8Array,
  offset: number,
  length: number,
  value: string,
) {
  const encoded = new TextEncoder().encode(value);
  bytes.set(encoded.slice(0, length), offset);
}
