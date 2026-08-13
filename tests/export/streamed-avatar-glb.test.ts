import { WebIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  exportAnimatedGLBStream,
  validateAnimatedGLBStream,
} from "@/export/streamed-avatar-glb";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";

describe("streamed animated GLB export", () => {
  it("appends animation through Blob parts without reading the whole avatar", async () => {
    const avatarFile = createRangeOnlyAvatarFile();
    const clip = createRetargetedMotionClipStub({
      vrmFile: avatarFile,
      fbxFile: { name: "walk.fbx" },
    });
    clip.metadata = {
      ...clip.metadata,
      rootTranslationSpace: "offset-meters",
      restHipsHeight: 1,
    };

    const output = await exportAnimatedGLBStream({ avatarFile, clip });
    const validation = await validateAnimatedGLBStream(
      output,
      clip.tracks.length,
      clip,
    );

    expect(validation.semantic?.issues).toEqual([]);
    expect(validation).toMatchObject({
      ok: true,
      executionMode: "streamed",
      rigDetectionMode: "vrm-extension",
      semantic: { ok: true, level: "semantic" },
    });
    expect(avatarFile.fullReads).toBe(0);
    expect(output.size).toBeGreaterThan(avatarFile.size);
    const document = await new WebIO().readBinary(
      new Uint8Array(await output.arrayBuffer()),
    );
    const animation = document.getRoot().listAnimations().at(-1);
    expect(animation?.listChannels()).toHaveLength(clip.tracks.length);
    expect(animation?.listChannels()[0]?.getTargetNode()?.getName()).toBe("hips");

    const drifted = structuredClone(clip);
    const driftedRotation = drifted.tracks.find(
      (track) => track.path === "rotation",
    )!;
    driftedRotation.values.splice(
      driftedRotation.values.length - 4,
      4,
      0,
      0.25,
      0,
      0.9682458,
    );
    const mismatch = await validateAnimatedGLBStream(
      output,
      clip.tracks.length,
      drifted,
    );
    expect(mismatch).toMatchObject({
      ok: true,
      semantic: { ok: false },
    });
  });
});

class RangeOnlyFile extends File {
  fullReads = 0;

  override async arrayBuffer(): Promise<ArrayBuffer> {
    this.fullReads += 1;
    throw new Error("Full avatar reads are forbidden in streamed export.");
  }
}

function createRangeOnlyAvatarFile() {
  const json = {
    asset: { version: "2.0" },
    extensions: {
      VRMC_vrm: {
        humanoid: {
          humanBones: {
            hips: { node: 0 },
            leftUpperArm: { node: 1 },
            rightUpperArm: { node: 2 },
          },
        },
      },
    },
    nodes: [
      { name: "hips", translation: [0, 1, 0], children: [1, 2] },
      { name: "leftUpperArm" },
      { name: "rightUpperArm" },
    ],
    buffers: [{ byteLength: 16 }],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonByteLength = Math.ceil(encoded.byteLength / 4) * 4;
  const totalByteLength = 12 + 8 + jsonByteLength + 8 + 16;
  const header = new Uint8Array(20);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, 0x46546c67, true);
  headerView.setUint32(4, 2, true);
  headerView.setUint32(8, totalByteLength, true);
  headerView.setUint32(12, jsonByteLength, true);
  headerView.setUint32(16, 0x4e4f534a, true);
  const jsonBytes = new Uint8Array(jsonByteLength);
  jsonBytes.fill(0x20);
  jsonBytes.set(encoded);
  const binaryHeader = new Uint8Array(8);
  const binaryView = new DataView(binaryHeader.buffer);
  binaryView.setUint32(0, 16, true);
  binaryView.setUint32(4, 0x004e4942, true);
  return new RangeOnlyFile(
    [header.buffer, jsonBytes.buffer, binaryHeader.buffer, new ArrayBuffer(16)],
    "avatar.vrm",
    { type: "model/gltf-binary" },
  );
}
