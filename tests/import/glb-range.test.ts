import { describe, expect, it } from "vitest";
import { loadCanonicalAvatarRig } from "@/browser/avatar-rig";
import { disposeObject } from "@/resources/dispose-three";
import { readGLBRangeInfo } from "@/import/glb-range";
import { detectVRMVersionFromFile } from "@/import/vrm-version";
import { readGLTFStructuralDocument } from "@/import/gltf-structural-document";
import { inspectGLTFRig } from "@/rigs";

describe("range-loaded large GLB and VRM assets", () => {
  it("reads only GLB metadata ranges from a 478 MB source", async () => {
    const source = createRangeOnlyVRM(478.4 * 1024 * 1024);
    const info = await readGLBRangeInfo(source.file);

    expect(info.declaredByteLength).toBe(source.file.size);
    expect(info.binaryChunk?.byteLength).toBeGreaterThan(470 * 1024 * 1024);
    expect(source.reads.every(({ byteLength }) => byteLength < 1024 * 1024)).toBe(true);
    expect(source.fullReads).toBe(0);
  });

  it("detects VRM and creates a structural preview rig without materializing the BIN chunk", async () => {
    const source = createRangeOnlyVRM(478.4 * 1024 * 1024);

    await expect(detectVRMVersionFromFile(source.file)).resolves.toBe("1.0");
    const rig = await loadCanonicalAvatarRig(source.file, "vrm");

    expect(rig.structuralOnly).toBe(true);
    expect(rig.bones.has("hips")).toBe(true);
    expect(rig.bones.has("head")).toBe(true);
    expect(rig.restHipsHeight).toBe(1);
    expect(source.fullReads).toBe(0);
    expect(
      source.reads.reduce((sum, read) => sum + read.byteLength, 0),
    ).toBeLessThan(1024 * 1024);
    disposeObject(rig.root);
  });

  it("builds a glTF-Transform structural document for solver inspection", async () => {
    const source = createRangeOnlyVRM(478.4 * 1024 * 1024);
    const { document } = await readGLTFStructuralDocument(source.file);
    const inspection = inspectGLTFRig(document, {
      familyOverride: "humanoid",
      profileId: "canonical-humanoid-v1",
    });

    expect(inspection.nodesByRole.has("hips")).toBe(true);
    expect(inspection.nodesByRole.has("head")).toBe(true);
    expect(source.fullReads).toBe(0);
  });

  it("does not fall back to a whole-file read for oversized textual input", async () => {
    let fullReads = 0;
    const file = {
      size: 100 * 1024 * 1024,
      slice() {
        return new Blob(['{"asset":{"version":"2.0"}}']);
      },
      async arrayBuffer() {
        fullReads += 1;
        throw new Error("Whole-file reads are forbidden.");
      },
    } as unknown as Blob;

    await expect(detectVRMVersionFromFile(file)).resolves.toBe("unknown");
    expect(fullReads).toBe(0);
  });
});

function createRangeOnlyVRM(requestedSize: number) {
  const json = {
    asset: { version: "2.0" },
    extensions: {
      VRMC_vrm: {
        humanoid: {
          humanBones: {
            hips: { node: 0 },
            spine: { node: 1 },
            head: { node: 2 },
            leftUpperArm: { node: 3 },
            rightUpperArm: { node: 4 },
          },
        },
      },
    },
    nodes: [
      { name: "hips", translation: [0, 1, 0], children: [1] },
      { name: "spine", translation: [0, 0.3, 0], children: [2, 3, 4] },
      { name: "head", translation: [0, 0.5, 0] },
      { name: "leftUpperArm", translation: [-0.3, 0.25, 0] },
      { name: "rightUpperArm", translation: [0.3, 0.25, 0] },
    ],
    buffers: [{ byteLength: 0 }],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonByteLength = Math.ceil(encoded.byteLength / 4) * 4;
  const metadataByteLength = 12 + 8 + jsonByteLength + 8;
  const size = Math.floor(requestedSize / 4) * 4;
  const binaryByteLength = size - metadataByteLength;
  json.buffers[0]!.byteLength = binaryByteLength;
  const finalEncoded = new TextEncoder().encode(JSON.stringify(json));
  const finalJSONByteLength = Math.ceil(finalEncoded.byteLength / 4) * 4;
  const finalMetadataByteLength = 12 + 8 + finalJSONByteLength + 8;
  const finalBinaryByteLength = size - finalMetadataByteLength;
  json.buffers[0]!.byteLength = finalBinaryByteLength;
  const stableEncoded = new TextEncoder().encode(JSON.stringify(json));
  const stableJSONByteLength = Math.ceil(stableEncoded.byteLength / 4) * 4;
  if (stableJSONByteLength !== finalJSONByteLength) {
    throw new Error("Fixture JSON length did not stabilize.");
  }
  const prefix = new Uint8Array(12 + 8 + stableJSONByteLength + 8);
  prefix.fill(0x20, 20, 20 + stableJSONByteLength);
  prefix.set(stableEncoded, 20);
  const view = new DataView(prefix.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, size, true);
  view.setUint32(12, stableJSONByteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  view.setUint32(20 + stableJSONByteLength, size - prefix.byteLength, true);
  view.setUint32(24 + stableJSONByteLength, 0x004e4942, true);

  const reads: Array<{ offset: number; byteLength: number }> = [];
  let fullReads = 0;
  const file = {
    name: "Hydra_-_Animated.vrm",
    size,
    type: "model/gltf-binary",
    slice(start = 0, end = size) {
      reads.push({ offset: start, byteLength: end - start });
      if (start < 0 || end > prefix.byteLength) {
        throw new Error(`Unexpected large byte read: ${start}-${end}`);
      }
      return new Blob([prefix.slice(start, end)]);
    },
    async arrayBuffer() {
      fullReads += 1;
      throw new Error("Full source reads are forbidden for this fixture.");
    },
  } as unknown as File;
  return {
    file,
    reads,
    get fullReads() {
      return fullReads;
    },
  };
}
