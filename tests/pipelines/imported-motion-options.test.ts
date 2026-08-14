import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findAvatarImportAdapter,
  vrmAvatarAdapter,
} from "@/adapters/avatar";
import {
  findMotionImportAdapter,
  mixamoFbxMotionAdapter,
} from "@/adapters/motion";
import { bindMotionClipToAvatar } from "@/browser/avatar-target-pipeline";
import { importedMotionToAvatarPipelines } from "@/pipelines/imported-motion-to-avatar";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";
import {
  DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
  solveHumanoidCustomRigMotion,
} from "@/solvers";
import { runRetargetJob } from "@/jobs/browser-retarget-job";
import { restoreAssetPackageContext } from "@/import/asset-package";

vi.mock("@/adapters/avatar", () => ({
  findAvatarImportAdapter: vi.fn(),
  vrmAvatarAdapter: { probe: vi.fn() },
}));
vi.mock("@/adapters/motion", () => ({
  findMotionImportAdapter: vi.fn(),
  mixamoFbxMotionAdapter: { probe: vi.fn(), importMotion: vi.fn() },
}));
vi.mock("@/browser/avatar-target-pipeline", () => ({
  bindMotionClipToAvatar: vi.fn(),
}));
vi.mock("@/jobs/browser-retarget-job", () => ({
  runRetargetJob: vi.fn(),
}));

describe("generic humanoid pipeline options", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards solve options, mapping, and cancellation to target binding", async () => {
    const sourceClip = createRetargetedMotionClipStub({
      fbxFile: { name: "walk.bvh" },
      vrmFile: { name: "pending.vrm" },
    });
    const solved = solveHumanoidCustomRigMotion(sourceClip);
    const solvedClip = {
      ...solved,
      target: { ...solved.target, rigSignature: "humanoid-rest-v1:test" },
    };
    vi.mocked(findMotionImportAdapter).mockResolvedValue({
      id: "bvh",
      label: "BVH",
      maturity: "active",
      profileId: "bvh-humanoid",
      probe: vi.fn(),
      importMotion: vi.fn().mockResolvedValue(sourceClip),
    });
    vi.mocked(findAvatarImportAdapter).mockResolvedValue({
      id: "gltf-humanoid",
      label: "glTF humanoid",
      maturity: "active",
      profileId: "generic-gltf-humanoid",
      probe: vi.fn(),
    });
    vi.mocked(bindMotionClipToAvatar).mockResolvedValue(solvedClip);
    vi.mocked(runRetargetJob).mockResolvedValue(sourceClip);
    const pipeline = importedMotionToAvatarPipelines.find(
      (candidate) =>
        candidate.id === "bvh-to-gltf-humanoid-to-gltf-animation",
    )!;
    const solveOptions = {
      armOffsetDegrees: 12,
      heightScale: 1.25,
      rootMotion: false,
    };
    const mapping = {
      ...DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
      chainPreset: "upper-body" as const,
    };
    const controller = new AbortController();

    await expect(
      pipeline.retarget({
        motionFile: new File([], "walk.bvh"),
        avatarFile: new File([], "avatar.glb"),
        solveOptions,
        mapping,
        signal: controller.signal,
      }),
    ).resolves.toEqual({ sourceClip, solvedClip });
    expect(bindMotionClipToAvatar).toHaveBeenCalledWith(
      expect.objectContaining({
        clip: sourceClip,
        mappingConfig: mapping,
        signal: controller.signal,
        solveOptions,
      }),
    );
    expect(runRetargetJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "import-motion",
        formatId: "bvh",
        filename: "walk.bvh",
      }),
      { signal: controller.signal },
    );
  });

  it("transfers text glTF motion sidecars to the import Worker", async () => {
    const sourceClip = createRetargetedMotionClipStub({
      fbxFile: { name: "motion.gltf" },
      vrmFile: { name: "pending.vrm" },
    });
    const solved = solveHumanoidCustomRigMotion(sourceClip);
    const motionJSON = JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "motion.bin", byteLength: 4 }],
    });
    const motionFile = new File([motionJSON], "motion.gltf");
    const sidecar = new Uint8Array([1, 2, 3, 4]);
    restoreAssetPackageContext(
      motionFile,
      {
        sourceKind: "directory",
        sourceName: "motion-package",
        primaryPath: "motion.gltf",
        entryCount: 2,
        resourceCount: 1,
        expandedBytes: motionFile.size + sidecar.byteLength,
        missingResources: [],
      },
      [
        { name: "motion.gltf", blob: motionFile, byteLength: motionFile.size },
        {
          name: "motion.bin",
          blob: new Blob([sidecar]),
          byteLength: sidecar.byteLength,
        },
      ],
    );
    vi.mocked(findMotionImportAdapter).mockResolvedValue({
      id: "gltf-animation",
      label: "glTF animation",
      maturity: "active",
      profileId: "generic-gltf-humanoid",
      probe: vi.fn(),
      importMotion: vi.fn().mockResolvedValue(sourceClip),
    });
    vi.mocked(findAvatarImportAdapter).mockResolvedValue({
      id: "gltf-humanoid",
      label: "glTF humanoid",
      maturity: "active",
      profileId: "generic-gltf-humanoid",
      probe: vi.fn(),
    });
    vi.mocked(bindMotionClipToAvatar).mockResolvedValue({
      ...solved,
      target: { ...solved.target, rigSignature: "humanoid-rest-v1:test" },
    });
    vi.mocked(runRetargetJob).mockResolvedValue(sourceClip);
    const pipeline = importedMotionToAvatarPipelines.find(
      (candidate) =>
        candidate.id === "gltf-animation-to-gltf-humanoid-to-animated-glb",
    )!;

    await pipeline.retarget({
      motionFile,
      avatarFile: new File([], "avatar.glb"),
      solveOptions: { armOffsetDegrees: 0, heightScale: 1, rootMotion: true },
      mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
    });

    const importTask = vi.mocked(runRetargetJob).mock.calls[0]?.[0];
    expect(importTask).toMatchObject({
      type: "import-motion",
      formatId: "gltf-animation",
      filename: "motion.gltf",
    });
    if (importTask?.type !== "import-motion") {
      throw new Error("Expected the import-motion Worker task.");
    }
    const transferredSidecar = importTask.resources?.["motion.bin"];
    expect(transferredSidecar).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(transferredSidecar!)]).toEqual([...sidecar]);
  });

  it("keeps the Mixamo-to-VRM probe experimental and preserves public errors", async () => {
    const pipeline = importedMotionToAvatarPipelines.find(
      (candidate) => candidate.id === "mixamo-fbx-to-vrm-to-vrma",
    )!;
    const input = {
      motionFile: new File([], "walk.fbx"),
      avatarFile: new File([], "avatar.vrm"),
      solveOptions: {
        armOffsetDegrees: 0,
        heightScale: 1,
        rootMotion: true,
      },
      mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
    };

    expect(pipeline).toMatchObject({ assurance: "experimental", availability: "hidden" });
    vi.mocked(mixamoFbxMotionAdapter.probe).mockResolvedValue({
      bytesInspected: 0,
      confidence: 0.34,
      contentSignature: false,
      evidence: [],
      evidenceDetails: [],
      profile: "mixamo",
      warnings: [],
    });
    await expect(pipeline.retarget(input)).rejects.toMatchObject({
      code: "FBX_PARSE_FAILED",
    });

    vi.mocked(mixamoFbxMotionAdapter.probe).mockResolvedValue({
      bytesInspected: 0,
      confidence: 0.8,
      contentSignature: true,
      evidence: [],
      evidenceDetails: [],
      profile: "mixamo",
      warnings: [],
    });
    vi.mocked(vrmAvatarAdapter.probe).mockResolvedValue({
      bytesInspected: 0,
      confidence: 0.34,
      contentSignature: false,
      evidence: [],
      evidenceDetails: [],
      profile: "vrm-humanoid",
      warnings: [],
    });
    await expect(pipeline.retarget(input)).rejects.toMatchObject({
      code: "VRM_PARSE_FAILED",
    });
  });
});
