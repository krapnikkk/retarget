import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createLinearVMDBoneInterpolation,
  parseVMDDocument,
  serializeVMDDocument,
  type VMDDocument,
} from "@/mmd/vmd-document";
import { importVMD } from "@/import/vmd";
import { importVRMA } from "@/import/vrma";
import { validateHumanoidMotionSemantics } from "@/validation";

describe("VMD document codec", () => {
  it("round-trips every standard VMD section", () => {
    const source = createFullDocument();
    const bytes = serializeVMDDocument(source);
    const parsed = parseVMDDocument(bytes);

    expect(parsed).toMatchObject({
      signature: "Vocaloid Motion Data 0002",
      modelName: "test-model",
      maxFrame: 15,
      duration: 0.5,
    });
    expect(parsed.boneFrames).toHaveLength(2);
    expect(parsed.morphFrames).toEqual([
      expect.objectContaining({ morphName: "smile", frameNumber: 5, weight: 0.75 }),
    ]);
    expect(parsed.cameraFrames).toEqual([
      expect.objectContaining({ frameNumber: 10, fov: 45, perspective: true }),
    ]);
    expect(parsed.lightFrames[0]?.frameNumber).toBe(11);
    expect(parsed.lightFrames[0]?.color[0]).toBeCloseTo(1, 6);
    expect(parsed.lightFrames[0]?.color[1]).toBeCloseTo(0.8, 6);
    expect(parsed.lightFrames[0]?.color[2]).toBeCloseTo(0.6, 6);
    expect(parsed.selfShadowFrames).toEqual([
      expect.objectContaining({ frameNumber: 12, mode: 1, distance: 42 }),
    ]);
    expect(parsed.propertyFrames).toEqual([
      expect.objectContaining({
        frameNumber: 15,
        visible: false,
        ikStates: [{ name: "legIK", enabled: true, nameBytes: expect.any(Uint8Array) }],
      }),
    ]);

    const rewritten = parseVMDDocument(serializeVMDDocument(parsed));
    expect(withoutRawNameBytes(rewritten)).toEqual(withoutRawNameBytes(parsed));
  });

  it("bakes VMD interpolation, root layers, and handedness into canonical tracks", () => {
    const document = createFullDocument();
    document.boneFrames = [
      createBoneFrame("center", 0, [0, 0, 0]),
      createBoneFrame("center", 2, [2, 4, 6]),
      createBoneFrame("groove", 0, [0, 1, 0]),
      createBoneFrame("groove", 2, [0, 3, 0]),
    ];
    document.morphFrames = [];
    document.cameraFrames = [];
    document.lightFrames = [];
    document.selfShadowFrames = [];
    document.propertyFrames = [];

    const clip = importVMD(serializeVMDDocument(document), "root.vmd");
    const translation = clip.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    );

    expect(translation?.times).toEqual([0, 0.033333, 0.066667]);
    expect(translation?.values.slice(3, 5)).toEqual([1, 4]);
    expect(translation?.values[5]).toBeLessThan(-3);
    expect(translation?.values.slice(-3)).toEqual([2, 7, -6]);
    expect(clip.metadata?.mmd?.sectionCounts.bone).toBe(4);
    expect(clip.metadata?.rootMotionEvidence).toMatchObject({
      status: "preserved",
      scaleSource: "mmd-standard-model-preset",
      sourceRestHipsHeight: 10,
    });
  });

  it("locks asymmetric VMD handedness and forward-axis conversion evidence", () => {
    const document = createFullDocument();
    document.boneFrames = [
      createBoneFrame("center", 0, [0, 0, 0]),
      createBoneFrame("center", 30, [1, 0, 0]),
      createBoneFrame("center", 60, [1, 0, 1]),
    ];
    document.morphFrames = [];
    document.cameraFrames = [];
    document.lightFrames = [];
    document.selfShadowFrames = [];
    document.propertyFrames = [];

    const clip = importVMD(serializeVMDDocument(document), "directions.vmd");
    const translation = clip.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    )!;

    expect(translation.values.slice(30 * 3, 30 * 3 + 3)).toEqual([1, 0, 0]);
    expect(translation.values.slice(60 * 3, 60 * 3 + 3)).toEqual([1, 0, -1]);
    expect(clip.metadata?.rootMotionEvidence?.coordinateTransform).toContain(
      "left-handed",
    );
    expect(clip.diagnostics?.assumptions.forwardAxisCorrection).toContain(
      "already matches",
    );
  });

  it("matches the pinned Quaternius walk sibling across real VMD and VRMA exports", async () => {
    const fixtureRoot = new URL(
      "../fixtures/certification/golden-motion/motions/quaternius-walk/",
      import.meta.url,
    );
    const [vmdBytes, vrmaBytes] = await Promise.all([
      readFile(new URL("quaternius-walk.vmd", fixtureRoot)),
      readFile(new URL("quaternius-walk.vrma", fixtureRoot)),
    ]);
    const [vmd, vrma] = await Promise.all([
      importVMD(vmdBytes, "quaternius-walk.vmd"),
      importVRMA(vrmaBytes, "quaternius-walk.vrma"),
    ]);
    const comparison = validateHumanoidMotionSemantics({
      actual: vmd,
      expected: vrma,
      thresholds: {
        durationSeconds: 1 / 30,
        rotationDegrees: 0.1,
        rootDisplacementMeters: 0.001,
        rootDirectionDegrees: 0.1,
        endEffectorMeters: 0.001,
        symmetryMeters: 0.001,
      },
    });

    expect(comparison.missingRotationTracks).toEqual([]);
    expect(comparison.issues).toEqual([
      "root displacement cannot be certified without meter-normalized tracks",
    ]);
    expect(comparison.metrics.maxRotationErrorDegrees).toBeLessThan(0.1);
    expect(comparison.metrics.maxRootDisplacementErrorMeters).toBeLessThan(0.001);
    expect(comparison.metrics.maxRootDirectionErrorDegrees).toBeLessThan(0.1);
  });

  it("rejects truncated documents instead of silently dropping frames", () => {
    const bytes = serializeVMDDocument(createFullDocument());
    expect(() => parseVMDDocument(bytes.slice(0, -1))).toThrow(/VMD document is truncated/);
  });
});

function createFullDocument(): VMDDocument {
  return {
    signature: "Vocaloid Motion Data 0002",
    modelName: "test-model",
    boneFrames: [
      createBoneFrame("center", 0, [0, 0, 0]),
      createBoneFrame("center", 15, [1, 2, 3]),
    ],
    morphFrames: [{ morphName: "smile", frameNumber: 5, weight: 0.75 }],
    cameraFrames: [{
      frameNumber: 10,
      distance: -30,
      position: [0, 10, 0],
      rotation: [0.1, 0.2, 0.3],
      interpolation: new Uint8Array([
        20, 107, 20, 107, 20, 107, 20, 107, 20, 107, 20, 107,
        20, 107, 20, 107, 20, 107, 20, 107, 20, 107, 20, 107,
      ]),
      fov: 45,
      perspective: true,
    }],
    lightFrames: [{
      frameNumber: 11,
      color: [1, 0.8, 0.6],
      direction: [0, -1, 0],
    }],
    selfShadowFrames: [{ frameNumber: 12, mode: 1, distance: 42 }],
    propertyFrames: [{
      frameNumber: 15,
      visible: false,
      ikStates: [{ name: "legIK", enabled: true }],
    }],
    maxFrame: 15,
    duration: 0.5,
  };
}

function createBoneFrame(
  boneName: string,
  frameNumber: number,
  position: [number, number, number],
) {
  return {
    boneName,
    frameNumber,
    position,
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    interpolation: createLinearVMDBoneInterpolation(),
  };
}

function withoutRawNameBytes(document: VMDDocument) {
  return {
    ...document,
    signatureBytes: undefined,
    modelNameBytes: undefined,
    boneFrames: document.boneFrames.map((frame) => ({
      ...frame,
      boneNameBytes: undefined,
    })),
    morphFrames: document.morphFrames.map((frame) => ({
      ...frame,
      morphNameBytes: undefined,
    })),
    propertyFrames: document.propertyFrames.map((frame) => ({
      ...frame,
      ikStates: frame.ikStates.map((state) => ({
        ...state,
        nameBytes: undefined,
      })),
    })),
  };
}
