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
      (candidate) => candidate.id === "bvh-to-gltf-humanoid",
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

  it("keeps the Mixamo-to-VRM probe experimental and preserves public errors", async () => {
    const pipeline = importedMotionToAvatarPipelines.find(
      (candidate) => candidate.id === "mixamo-fbx-to-vrm",
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
      confidence: 0.34,
      evidence: [],
      profile: "mixamo",
      warnings: [],
    });
    await expect(pipeline.retarget(input)).rejects.toMatchObject({
      code: "FBX_PARSE_FAILED",
    });

    vi.mocked(mixamoFbxMotionAdapter.probe).mockResolvedValue({
      confidence: 0.8,
      evidence: [],
      profile: "mixamo",
      warnings: [],
    });
    vi.mocked(vrmAvatarAdapter.probe).mockResolvedValue({
      confidence: 0.34,
      evidence: [],
      profile: "vrm-humanoid",
      warnings: [],
    });
    await expect(pipeline.retarget(input)).rejects.toMatchObject({
      code: "VRM_PARSE_FAILED",
    });
  });
});
