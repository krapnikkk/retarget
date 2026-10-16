import { describe, expect, it } from "vitest";
import { findAvatarImportAdapter } from "@/adapters/avatar";
import {
  getAvatarExportAdapter,
  getMotionExportAdapter,
} from "@/adapters/export";
import { findMotionImportAdapter } from "@/adapters/motion";
import { getRetargetPipeline, RETARGET_PIPELINES } from "@/pipelines";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";

describe("adapter registries", () => {
  const file = (name: string, content: BlobPart = "") =>
    new File([content], name, { type: "application/octet-stream" });
  const fbx = (name: string, bones: string) =>
    file(
      name,
      `FBXHeaderExtension: {\nUpAxis: 1\nFrontAxis: 2\nUnitScaleFactor: 1\n${bones}\n}`,
    );
  const gltf = (
    name: string,
    { extensions = [], nodes = ["hips"], skin = true } = {} as {
      extensions?: string[];
      nodes?: string[];
      skin?: boolean;
    },
  ) =>
    file(
      name,
      createGLB(JSON.stringify({
        animations: [{}],
        extensionsUsed: extensions,
        nodes: nodes.map((node) => ({ name: node })),
        skins: skin ? [{}] : [],
      })),
    );

  function createGLB(json: string) {
    const encoded = new TextEncoder().encode(json);
    const jsonLength = Math.ceil(encoded.byteLength / 4) * 4;
    const bytes = new Uint8Array(20 + jsonLength);
    bytes.fill(0x20, 20);
    bytes.set(encoded, 20);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, bytes.byteLength, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    return bytes;
  }

  it("registers only evidence-backed complete combinations", () => {
    expect(RETARGET_PIPELINES.map((pipeline) => pipeline.id)).toEqual([
      "bvh-to-vrm-to-baked-vrm",
      "bvh-to-vrm-to-vrma",
      "gltf-animation-to-gltf-humanoid-to-animated-glb",
      "gltf-animation-to-gltf-humanoid-to-fbx-animation",
      "gltf-animation-to-gltf-humanoid-to-gltf-animation",
      "gltf-animation-to-gltf-humanoid-to-motion-json",
      "gltf-animation-to-gltf-humanoid-to-vrma",
      "gltf-animation-to-vrm-to-baked-vrm",
      "gltf-animation-to-vrm-to-vrma",
      "mixamo-fbx-to-vrm-to-vrma",
      "vmd-to-vrm-to-baked-vrm",
      "vmd-to-vrm-to-vrma",
      "vrma-to-gltf-humanoid-to-animated-glb",
    ]);
    expect(
      RETARGET_PIPELINES.filter((pipeline) => pipeline.assurance !== "beta")
        .map((pipeline) => [pipeline.id, pipeline.assurance]),
    ).toEqual([["mixamo-fbx-to-vrm-to-vrma", "experimental"]]);
    for (const motionFormat of ["bvh", "gltf-animation", "vmd"] as const) {
      expect(getRetargetPipeline(motionFormat, "vrm", "vrma")).toMatchObject({
        assurance: "beta",
        outputFormat: "vrma",
        run: expect.any(Function),
      });
    }
    expect(Object.isFrozen(RETARGET_PIPELINES)).toBe(true);
    expect(RETARGET_PIPELINES.every(Object.isFrozen)).toBe(true);
    expect(
      getRetargetPipeline(
        "gltf-animation",
        "gltf-humanoid",
        "animated-glb",
      ),
    ).toMatchObject({
      assurance: "beta",
      outputFormat: "animated-glb",
      run: expect.any(Function),
    });
    for (const outputFormat of [
      "fbx-animation",
      "gltf-animation",
      "motion-json",
      "vrma",
    ] as const) {
      expect(
        getRetargetPipeline(
          "gltf-animation",
          "gltf-humanoid",
          outputFormat,
        ),
      ).toMatchObject({
        assurance: "beta",
        outputFormat,
        run: expect.any(Function),
      });
    }
    expect(
      getRetargetPipeline("vrma", "gltf-humanoid", "animated-glb"),
    ).toMatchObject({
      assurance: "beta",
      outputFormat: "animated-glb",
      run: expect.any(Function),
    });
    expect(
      getRetargetPipeline("gltf-animation", "vrm", "baked-vrm"),
    ).toMatchObject({
      assurance: "beta",
      outputFormat: "baked-vrm",
      run: expect.any(Function),
    });
    expect(
      getRetargetPipeline("vmd", "vrm", "baked-vrm"),
    ).toMatchObject({
      assurance: "beta",
      outputFormat: "baked-vrm",
      run: expect.any(Function),
    });
    expect(getRetargetPipeline("bvh", "vrm", "baked-vrm")).toMatchObject({
      assurance: "beta",
      outputFormat: "baked-vrm",
      run: expect.any(Function),
    });
    expect(getRetargetPipeline("bvh", "gltf-humanoid", "animated-glb")).toBeNull();
    expect(getRetargetPipeline("actorcore-fbx", "reallusion", "animated-glb")).toBeNull();
    expect(getRetargetPipeline("vmd", "mmd-model", "animated-pmx")).toBeNull();
  });

  it("resolves motion import adapters by bounded file evidence", async () => {
    await expect(
      findMotionImportAdapter(fbx("walk.fbx", "mixamorigHips mixamorig:LeftArm")),
    ).resolves.toMatchObject({
      id: "mixamo-fbx",
      profileId: "mixamo",
    });
    await expect(
      findMotionImportAdapter(
        gltf("idle.vrma", { extensions: ["VRMC_vrm_animation"] }),
      ),
    ).resolves.toMatchObject({
      id: "vrma",
      profileId: "vrm-humanoid",
    });
    await expect(
      findMotionImportAdapter(file("walk.bvh", "HIERARCHY\nROOT Hips\nMOTION")),
    ).resolves.toMatchObject({
      id: "bvh",
      profileId: "bvh-humanoid",
    });
    await expect(
      findMotionImportAdapter(file("dance.vmd", "Vocaloid Motion Data 0002")),
    ).resolves.toMatchObject({
      id: "vmd",
      profileId: "mmd-body",
    });
    await expect(findMotionImportAdapter(gltf("clip.glb"))).resolves.toMatchObject({
      id: "gltf-animation",
      profileId: "generic-gltf-humanoid",
    });
    await expect(
      findMotionImportAdapter(fbx("walk.fbx", "CC_Base_Hip CC_Base_L_Upperarm")),
    ).resolves.toMatchObject({
      id: "actorcore-fbx",
      profileId: "actorcore",
    });
    await expect(
      findMotionImportAdapter(fbx("generic.fbx", "Hips LeftArm"), "generic-fbx"),
    ).resolves.toMatchObject({
      id: "generic-fbx",
      profileId: "generic-fbx-humanoid",
    });
  });

  it("resolves avatar import adapters by bounded file evidence", async () => {
    await expect(
      findAvatarImportAdapter(
        gltf("avatar.vrm", { extensions: ["VRMC_vrm"] }),
      ),
    ).resolves.toMatchObject({
      id: "vrm",
      profileId: "vrm-humanoid",
    });
    await expect(findAvatarImportAdapter(gltf("avatar.glb"))).resolves.toMatchObject({
      id: "gltf-humanoid",
      profileId: "generic-gltf-humanoid",
    });
    await expect(
      findAvatarImportAdapter(
        gltf("avatar.glb", { nodes: ["Wolf3D_Head", "Wolf3D_Body"] }),
      ),
    ).resolves.toMatchObject({
      id: "ready-player-me",
      profileId: "ready-player-me",
    });
    await expect(
      findAvatarImportAdapter(fbx("avatar.fbx", "CC_Base_Hip CC_Base_L_Upperarm")),
    ).resolves.toMatchObject({
      id: "reallusion",
      profileId: "actorcore",
    });
    await expect(
      findAvatarImportAdapter(fbx("avatar.fbx", "mixamorigHips mixamorig:LeftArm")),
    ).resolves.toMatchObject({
      id: "mixamo-rigged",
      profileId: "mixamo",
    });
    await expect(
      findAvatarImportAdapter(file("avatar.pmx", "PMX 2.0")),
    ).resolves.toMatchObject({
      id: "mmd-model",
      profileId: "mmd-body",
    });
    await expect(
      findAvatarImportAdapter(file("avatar.pmd", "Pmd")),
    ).resolves.toMatchObject({
      id: "mmd-model",
      profileId: "mmd-body",
    });
    await expect(
      findAvatarImportAdapter(
        fbx("humanoid.fbx", "Hips LeftArm"),
        "generic-fbx-avatar",
      ),
    ).resolves.toMatchObject({
      id: "generic-fbx-avatar",
      profileId: "generic-fbx-humanoid",
    });
  });

  it("exports motion JSON through a format adapter", async () => {
    const adapter = getMotionExportAdapter("motion-json");
    expect(adapter).toBeTruthy();

    const bytes = await adapter!.exportMotion(
      createRetargetedMotionClipStub({
        vrmFile: { name: "avatar.vrm" },
        fbxFile: { name: "idle.fbx" },
      }),
    );
    const json = new TextDecoder().decode(bytes);

    expect(JSON.parse(json)).toMatchObject({
      schemaVersion: 2,
      source: {
        kind: "mixamo-fbx",
      },
    });
  });

  it("registers Phase 4 export adapters", () => {
    expect(getMotionExportAdapter("gltf-animation")).toMatchObject({
      id: "gltf-animation",
      maturity: "active",
    });
    expect(getMotionExportAdapter("bvh")).toMatchObject({
      id: "bvh",
      maturity: "active",
    });
    expect(getMotionExportAdapter("vmd")).toMatchObject({
      id: "vmd",
      maturity: "active",
    });
    expect(getAvatarExportAdapter("animated-glb")).toMatchObject({
      id: "animated-glb",
      maturity: "active",
    });
    expect(getAvatarExportAdapter("baked-vrm")).toMatchObject({
      id: "baked-vrm",
      maturity: "active",
    });
    expect(getMotionExportAdapter("fbx-animation")).toMatchObject({
      maturity: "active",
    });
    expect(getAvatarExportAdapter("vrm-external-vrma")).toMatchObject({
      label: "VRM + external VRMA",
      maturity: "active",
      extension: ".zip",
    });
    expect(getAvatarExportAdapter("fbx-avatar-animation")).toMatchObject({
      label: "Animated FBX",
      maturity: "active",
    });
    expect(getAvatarExportAdapter("animated-pmx")).toMatchObject({
      label: "PMX Motion Morphs",
      maturity: "experimental",
    });
  });
});
