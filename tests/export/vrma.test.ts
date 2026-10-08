import { WebIO, type Node } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  VRMCVRMAnimation,
  VRMC_VRM_EXTENSIONS,
  isVRMADocument,
} from "gltf-transform-vrm-extensions";
import { createVRMADocument, exportVRMA } from "@/export";
import { importVRMA } from "@/import/vrma";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";

describe("VRMA export", () => {
  it("writes a binary glTF document marked as VRM Animation", async () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.vrm" },
      fbxFile: { name: "idle.fbx" },
    });
    const bytes = await exportVRMA(clip);
    const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
    const document = await io.readBinary(bytes);

    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(isVRMADocument(document)).toBe(true);
    expect(document.getRoot().listAnimations()).toHaveLength(1);
  });

  it("writes a non-zero hips rest height for official VRMA playback scaling", async () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.vrm" },
      fbxFile: { name: "idle.fbx" },
    });
    clip.metadata = { ...clip.metadata, restHipsHeight: 0.92 };
    const bytes = await exportVRMA(clip);
    const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
    const document = await io.readBinary(bytes);
    const extension = document
      .getRoot()
      .listExtensionsUsed()
      .find((item) => item.extensionName === VRMCVRMAnimation.EXTENSION_NAME);
    const hipsNode = (
      extension as VRMCVRMAnimation & {
        getHumanoidBoneNodes: () => ReadonlyMap<string, Node>;
      }
    )
      .getHumanoidBoneNodes()
      .get("hips");

    expect(hipsNode?.getTranslation()[1]).toBeCloseTo(0.92, 6);
    const hipsTranslation = document
      .getRoot()
      .listAnimations()[0]
      ?.listChannels()
      .find(
        (channel) =>
          channel.getTargetNode() === hipsNode &&
          channel.getTargetPath() === "translation",
      )
      ?.getSampler()
      ?.getOutput()
      ?.getArray();
    expect(hipsTranslation?.[1]).toBeCloseTo(0.92, 6);
    expect(hipsTranslation?.[4]).toBeCloseTo(0.95, 6);
  });

  it("scales source-unit root motion into the declared target rest units", async () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.vrm" },
      fbxFile: { name: "dance.vmd" },
    });
    // MMD-style source: rest hips 10 units, a 2-unit step; target hips 0.9 m.
    clip.metadata = {
      ...clip.metadata,
      rootTranslationSpace: "offset-source-units",
      restHipsHeight: 10,
      targetHeight: 0.9,
    };
    clip.tracks[0]!.values = [0, 0, 0, 0, 0, 2, 0, 0, 0];

    const document = createVRMADocument(clip);
    const hips = document
      .getRoot()
      .listAnimations()[0]!
      .listChannels()
      .find((channel) => channel.getTargetPath() === "translation")!;
    const values = Array.from(hips.getSampler()!.getOutput()!.getArray()!);

    expect(hips.getTargetNode()?.getTranslation()).toEqual([0, 0.9, 0]);
    // 2 units * (0.9 / 10) = 0.18 m step, on top of the 0.9 m rest height.
    expect(values[4]).toBeCloseTo(0.9, 6);
    expect(Math.hypot(values[3]!, values[5]!)).toBeCloseTo(0.18, 6);
  });

  it("holds tracks that end early so the VRMA keeps the clip duration", async () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.vrm" },
      fbxFile: { name: "expression.vmd" },
    });
    const lastKey = Math.max(...clip.tracks.map((track) => track.times.at(-1)!));
    clip.duration = lastKey + 5;

    const imported = await importVRMA(await exportVRMA(clip), "expression.vrma");

    expect(imported.duration).toBeCloseTo(clip.duration, 5);
  });

  it("rejects source-unit root motion without a source rest height", () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.vrm" },
      fbxFile: { name: "dance.vmd" },
    });
    clip.metadata = {
      ...clip.metadata,
      rootTranslationSpace: "offset-source-units",
      restHipsHeight: undefined,
    };

    expect(() => createVRMADocument(clip)).toThrow(
      expect.objectContaining({ code: "ROOT_MOTION_SCALE_UNRESOLVED" }),
    );
  });

  it("omits non-hips translations from the document and roundtrip", async () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.vrm" },
      fbxFile: { name: "idle.fbx" },
    });
    clip.tracks.push({
      bone: "leftUpperArm",
      path: "translation",
      times: [0, 1, clip.duration],
      values: [0, 0, 0, 0.1, 0, 0, 0, 0, 0],
    });
    const expectedTracks = clip.tracks.filter(
      (track) => track.path === "rotation" || track.bone === "hips",
    );
    const document = createVRMADocument(clip);

    expect(
      document
        .getRoot()
        .listAnimations()[0]
        ?.listChannels()
        .map((channel) => ({
          bone: channel.getTargetNode()?.getName(),
          path: channel.getTargetPath(),
        })),
    ).toEqual(
      expectedTracks.map(({ bone, path }) => ({ bone, path })),
    );

    const bytes = await exportVRMA(clip);
    const importedClip = await importVRMA(bytes, "idle.vrma");

    expect(importedClip.source).toEqual({
      kind: "vrma",
      filename: "idle.vrma",
      profile: "vrm-humanoid",
    });
    expect(importedClip.duration).toBeCloseTo(clip.duration, 6);
    expect(importedClip.fps).toBeGreaterThan(0);
    expect("target" in importedClip).toBe(false);
    expect(importedClip.diagnostics).toMatchObject({
      solver: {
        id: "canonical-normalization-v1",
      },
      profiles: {
        source: {
          id: "vrm-humanoid",
        },
      },
    });
    expect(importedClip.diagnostics?.mapping.mappedSourceBones).toBeGreaterThan(0);
    expect(importedClip.metadata).toMatchObject({
      rootTranslationSpace: "offset-meters",
      restHipsHeight: 1,
      sourceRestBinding: 1,
    });
    expect(importedClip.tracks).toHaveLength(expectedTracks.length);
    importedClip.tracks.forEach((track, trackIndex) => {
      const expected = expectedTracks[trackIndex]!;
      expect(track).toMatchObject({
        bone: expected.bone,
        path: expected.path,
        times: expected.times,
      });
      track.values.forEach((value, valueIndex) => {
        const size = track.path === "rotation" ? 4 : 3;
        const sampleStart = valueIndex - (valueIndex % size);
        const expectedSample = expected.values.slice(sampleStart, sampleStart + size);
        const expectedValue =
          track.path === "rotation"
            ? expected.values[valueIndex]! / Math.hypot(...expectedSample)
            : expected.values[valueIndex]!;
        expect(value).toBeCloseTo(expectedValue, 6);
      });
      if (track.path === "rotation") {
        for (let index = 0; index < track.values.length; index += 4) {
          expect(Math.hypot(...track.values.slice(index, index + 4))).toBeCloseTo(1, 6);
        }
      }
    });
  });
});
