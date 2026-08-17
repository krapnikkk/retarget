import { Accessor, Document, WebIO, type Node as GltfNode } from "@gltf-transform/core";
import {
  VRMCVRM,
  VRMC_VRM_EXTENSIONS,
  VRM_REQUIRED_HUMAN_BONE_NAMES,
  isVRMDocument,
  writeVRM,
} from "gltf-transform-vrm-extensions";
import { describe, expect, it, vi } from "vitest";
import {
  getAvatarExportAdapter,
  getMotionExportAdapter,
} from "@/adapters/export";
import {
  validateAvatarExportReload,
  validateMotionExportReload,
  validateMotionExportSemantics,
} from "@/export";
import {
  createBVHText,
  createGLTFAnimationDocument,
  createZipArchive,
  createVRMADocument,
  exportAnimatedGLB,
  exportBVH,
  exportFBXAnimation,
  exportPairedAvatarMotionZip,
  exportVMD,
  type PairedMotionExportFormatId,
  resolveExportBoneName,
  validateFBXAnimationBytes,
} from "@/export";
import {
  convertMMDModelToGLBDocument,
  readAvatarAsGLBDocument,
} from "@/export/avatar-conversion";
import { readAnimatedPMXMotionSummary } from "@/export/pmx";
import { writeAnimatedPMX } from "@/export/pmx";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { createGLTFHumanoidRigSignature } from "@/export/gltf-target-binding";
import { parseVMDDocument } from "@/mmd/vmd-document";
import { importBVH } from "@/import/bvh";
import { importGLTFAnimation } from "@/import/gltf-animation";
import { importVMD } from "@/import/vmd";
import {
  prepareAssetInput,
  releaseAssetPackage,
} from "@/import/asset-package";
import {
  bindSolvedMotionClipStub,
  createRetargetedMotionClipStub,
} from "../fixtures/retarget-stub";
import { solveHumanoidCustomRigMotion } from "@/solvers";
import {
  GENERIC_GLTF_HUMANOID_PROFILE,
  MMD_BODY_PROFILE,
  MIXAMO_RIG_PROFILE,
  VRM_HUMANOID_PROFILE,
} from "@/profiles";
import type { AvatarFormatId } from "@/formats";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

type WritableVRMExtension = {
  data?: {
    specVersion: "1.0";
    meta: {
      name: string;
      version: string;
      authors: string[];
      licenseUrl: string;
    };
    humanoid: {
      humanBones: Record<string, Record<string, unknown>>;
    };
  };
  humanoidBoneNodes: Map<string, GltfNode>;
};

describe("Phase 4 export adapters", () => {
  it("exports a glTF/GLB animation document", async () => {
    const adapter = getMotionExportAdapter("gltf-animation");
    const bytes = await adapter!.exportMotion(createClip());
    const document = await new WebIO().readBinary(bytes);

    expect(adapter).toMatchObject({ maturity: "active" });
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(document.getRoot().listAnimations()).toHaveLength(1);
    await expect(validateMotionExportReload("gltf-animation", bytes)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("exports BVH motion that can be imported again", async () => {
    const adapter = getMotionExportAdapter("bvh");
    const bytes = await adapter!.exportMotion(createClip());
    const text = new TextDecoder().decode(bytes);
    const imported = importBVH(bytes, "roundtrip.bvh");

    expect(text).toContain("HIERARCHY");
    expect(text).toContain("MOTION");
    expect(text).toMatch(/JOINT spine[\s\S]+JOINT leftUpperArm/);
    expect(text).not.toContain("OFFSET 0 0 0\n    CHANNELS 3 Zrotation Xrotation Yrotation\n    End Site");
    expect(imported.source.kind).toBe("bvh");
    await expect(validateMotionExportReload("bvh", bytes)).resolves.toMatchObject({
      ok: true,
    });
    const semantic = await validateMotionExportSemantics("bvh", bytes, createClip());
    expect(semantic.metrics.maxRotationErrorDegrees).toBeLessThan(0.01);
    expect(semantic.metrics.maxRootDisplacementErrorMeters).toBeLessThan(0.001);
  });

  it("semantically validates BVH root motion against the bound target scale", async () => {
    const clip = createClip();
    clip.metadata = {
      rootTranslationSpace: "offset-meters",
      targetHeight: 1,
    };
    for (const bone of ["leftToes", "rightToes"] as const) {
      clip.tracks.push({
        bone,
        path: "rotation",
        times: [0, 1, 2],
        values: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      });
    }

    const semantic = await validateMotionExportSemantics(
      "bvh",
      await exportBVH(clip),
      clip,
    );

    expect(semantic).toMatchObject({ level: "semantic", ok: true, issues: [] });
    expect(semantic.metrics.maxRotationErrorDegrees).toBeLessThan(0.01);
    expect(semantic.metrics.maxRootDisplacementErrorMeters).toBeLessThan(0.001);
  });

  it("exports VMD motion with MMD bone names that can be imported again", async () => {
    const bytes = await exportVMD(createClip());
    const imported = importVMD(bytes, "roundtrip.vmd");

    expect(bytes.byteLength).toBeGreaterThan(30 + 20 + 4);
    expect(new TextDecoder("shift-jis").decode(bytes.slice(54, 69))).toContain(
      "センター",
    );
    expect(imported.source).toMatchObject({
      kind: "vmd",
      profile: "mmd-body",
    });
    expect(imported.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bone: "hips", path: "translation" }),
        expect.objectContaining({ bone: "leftUpperArm", path: "rotation" }),
      ]),
    );
    const vmd = parseVMDDocument(bytes);
    expect(vmd.boneFrames[0]?.interpolation.some((value) => value !== 0)).toBe(true);
    expect(vmd.morphFrames).toHaveLength(0);
    expect(vmd.cameraFrames).toHaveLength(0);
    expect(vmd.lightFrames).toHaveLength(0);
    expect(vmd.selfShadowFrames).toHaveLength(0);
    expect(vmd.propertyFrames).toHaveLength(0);
    await expect(validateMotionExportReload("vmd", bytes)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("exports BVH with selectable ecosystem bone names", () => {
    const clip = createClip();

    expect(createBVHText(clip, { boneNamingProfile: "mixamo" })).toContain(
      "JOINT mixamorig:LeftArm",
    );
    expect(createBVHText(clip, { boneNamingProfile: "actorcore" })).toContain(
      "JOINT CC_Base_L_Upperarm",
    );
    expect(createBVHText(clip, { boneNamingProfile: "bvh-standard" })).toContain(
      "JOINT LeftArm",
    );
    expect(createBVHText(clip, { boneNamingProfile: "mmd" })).toContain(
      "JOINT 左腕",
    );
  });

  it("unwraps BVH Euler channels across the +/-180 degree boundary", () => {
    const clip = createClip();
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const quaternionZ = (degrees: number) => [
      0,
      0,
      Math.sin(radians(degrees) / 2),
      Math.cos(radians(degrees) / 2),
    ];
    clip.duration = 1;
    clip.fps = 1;
    clip.tracks = [
      clip.tracks.find(
        (track) => track.bone === "hips" && track.path === "translation",
      )!,
      {
        bone: "rightUpperArm",
        path: "rotation",
        times: [0, 1],
        values: [...quaternionZ(170), ...quaternionZ(190)],
      },
    ];
    clip.tracks[0] = {
      ...clip.tracks[0]!,
      times: [0, 1],
      values: [0, 0, 0, 0, 0, 0],
    };

    const motionLines = createBVHText(clip)
      .split("\n")
      .slice(-3, -1)
      .map((line) => line.split(" ").map(Number));

    expect(motionLines).toHaveLength(2);
    for (let index = 0; index < motionLines[0]!.length; index += 1) {
      expect(Math.abs(motionLines[1]![index]! - motionLines[0]![index]!))
        .toBeLessThanOrEqual(180);
    }
  });

  it("exports GLB animation nodes with selectable ecosystem bone names", () => {
    const document = createGLTFAnimationDocument(createClip(), {
      boneNamingProfile: "mixamo",
    });
    const nodeNames = document.getRoot().listNodes().map((node) => node.getName());

    expect(nodeNames).toContain(resolveExportBoneName("hips", "mixamo"));
    expect(nodeNames).toContain(resolveExportBoneName("leftUpperArm", "mixamo"));
  });

  it("builds standalone GLB hierarchy independently of track order", () => {
    const source = createClip();
    for (let seed = 0; seed < 100; seed += 1) {
      const document = createGLTFAnimationDocument({
        ...source,
        tracks: shuffled(source.tracks, seed),
      });
      expectDirectNodeParent(document, "rightUpperArm", "rightShoulder");
      expectDirectNodeParent(document, "rightShoulder", "upperChest");
      expectDirectNodeParent(document, "upperChest", "chest");
      expectDirectNodeParent(document, "chest", "spine");
      expectDirectNodeParent(document, "spine", "hips");
    }
  });

  it.each([
    ["head", "neck"],
    ["leftIndexDistal", "leftIndexIntermediate"],
  ] as const)("creates the ancestor closure for a terminal-only %s track", (bone, parent) => {
    const source = createClip();
    const document = createGLTFAnimationDocument({
      ...source,
      tracks: [{
        bone,
        path: "rotation",
        times: [0, 1],
        values: [0, 0, 0, 1, 0, 0, 0, 1],
      }],
    });
    expectDirectNodeParent(document, bone, parent);
  });

  it("preserves the source hips rest height through a GLB round trip", async () => {
    const clip = createClip();
    clip.metadata = {
      ...clip.metadata,
      canonicalProfile: "vrm-humanoid",
      normalizationVersion: 1,
      restHipsHeight: 0.9,
      rootTranslationSpace: "offset-meters",
    };
    const bytes = await getMotionExportAdapter("gltf-animation")!.exportMotion(clip);
    const document = await new WebIO().readBinary(bytes);
    const hips = document
      .getRoot()
      .listNodes()
      .find((node) => node.getName() === "hips");
    const imported = await importGLTFAnimation(bytes, "roundtrip.animation.glb");

    expect(hips?.getWorldTranslation()[1]).toBeCloseTo(0.9, 6);
    expect(imported.metadata?.restHipsHeight).toBeCloseTo(0.9, 6);
    expect(await validateMotionExportSemantics("gltf-animation", bytes, clip))
      .toMatchObject({ level: "semantic", ok: true });
  });

  it("exports VRMA scene nodes with selectable ecosystem bone names", () => {
    const document = createVRMADocument(createClip(), {
      boneNamingProfile: "mixamo",
    });
    const nodeNames = document.getRoot().listNodes().map((node) => node.getName());

    expect(nodeNames).toContain(resolveExportBoneName("hips", "mixamo"));
    expect(nodeNames).toContain(resolveExportBoneName("leftUpperArm", "mixamo"));
  });

  it("reload-validates BVH exports with non-canonical profile names", async () => {
    await expect(
      validateMotionExportReload(
        "bvh",
        await exportBVH(createClip(), { boneNamingProfile: "actorcore" }),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      validateMotionExportReload(
        "bvh",
        await exportBVH(createClip(), { boneNamingProfile: "mmd" }),
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("exports paired avatar and named motion files in a zip archive", async () => {
    const avatarBytes = await createMinimalAvatarGLB();
    const avatarFile = new File([avatarBytes], "avatar.glb");
    const bytes = await exportPairedAvatarMotionZip({
      avatarFile,
      boneNamingProfile: "mixamo",
      clip: await createClipForAvatar(avatarFile),
      motionFormat: "bvh",
    });
    const entries = parseStoredZip(bytes);

    expect(entries.get("avatar.glb")).toEqual(avatarBytes);
    expect(new TextDecoder().decode(entries.get("idle.bvh"))).toContain(
      "mixamorig:LeftArm",
    );
  });

  it("preserves every MMD package sidecar and license in paired output", async () => {
    const avatarBytes = createMinimalPMXAvatar("textures/base.png");
    const textureBytes = new Uint8Array([137, 80, 78, 71]);
    const licenseBytes = new TextEncoder().encode("CC-BY-4.0 attribution");
    const sourceArchive = createZipArchive([
      { name: "model/Gene.pmx", bytes: avatarBytes },
      { name: "model/textures/base.png", bytes: textureBytes },
      { name: "ATTRIBUTION.txt", bytes: licenseBytes },
    ]);
    const prepared = await prepareAssetInput(
      new File([sourceArchive.slice().buffer as ArrayBuffer], "gene.zip"),
      "avatar",
    );

    const bytes = await exportPairedAvatarMotionZip({
      avatarFile: prepared.file,
      clip: await createClipForAvatar(prepared.file, "mmd-model"),
      motionFormat: "vmd",
    });
    const entries = parseStoredZip(bytes);

    expect(entries.get("model/Gene.pmx")).toEqual(avatarBytes);
    expect(entries.get("model/textures/base.png")).toEqual(textureBytes);
    expect(entries.get("ATTRIBUTION.txt")).toEqual(licenseBytes);
    expect(entries.get("motion/idle.vmd")).toBeDefined();
    expect(entries.has("avatar.pmx")).toBe(false);
    releaseAssetPackage(prepared.file);
  });

  it("exports paired zip motion entries that pass reload validation", async () => {
    const cases = [
      { format: "vrma", entry: "idle.vrma" },
      { format: "bvh", entry: "idle.bvh" },
      { format: "vmd", entry: "idle.vmd" },
      { format: "gltf-animation", entry: "idle.animation.glb" },
      { format: "fbx-animation", entry: "idle.fbx" },
    ] as const satisfies readonly {
      format: PairedMotionExportFormatId;
      entry: string;
    }[];

    const avatarFile = new File([await createMinimalVRMBlobPart()], "avatar.vrm");
    const clip = await createClipForAvatar(avatarFile, "vrm");
    for (const item of cases) {
      const bytes = await exportPairedAvatarMotionZip({
        avatarFile,
        clip,
        motionFormat: item.format,
      });
      const entries = parseStoredZip(bytes);
      const motionBytes = entries.get(item.entry);

      expect(motionBytes).toBeDefined();
      await expect(
        validateMotionExportReload(item.format, motionBytes!),
      ).resolves.toMatchObject({ ok: true });
    }
  });

  it("exports an animated GLB by injecting clip animation into an avatar file", async () => {
    const adapter = getAvatarExportAdapter("animated-glb");
    const avatarFile = new File([await createMinimalAvatarGLB()], "avatar.glb");
    const bytes = await adapter!.exportAvatar({
      avatarFile,
      clip: await createClipForAvatar(avatarFile),
    });
    const document = await new WebIO().readBinary(bytes);

    expect(adapter).toMatchObject({ maturity: "active" });
    expect(document.getRoot().listAnimations()).toHaveLength(1);
    expect(document.getRoot().listNodes().some((node) => node.getName() === "hips")).toBe(
      true,
    );
    await expect(validateAvatarExportReload("animated-glb", bytes)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("exports an animated GLB from a JSON glTF avatar", async () => {
    const avatarFile = new File([createMinimalAvatarGLTF()], "avatar.gltf");
    const bytes = await exportAnimatedGLB({
      avatarFile,
      clip: await createClipForAvatar(avatarFile),
    });
    const document = await new WebIO().readBinary(bytes);

    expect(document.getRoot().listAnimations()).toHaveLength(1);
    expect(document.getRoot().listNodes().some((node) => node.getName() === "hips")).toBe(
      true,
    );
    await expect(validateAvatarExportReload("animated-glb", bytes)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("preserves VRM extensions when exporting an animated GLB from a VRM", async () => {
    const avatarFile = new File([await createMinimalVRMBlobPart()], "avatar.vrm");
    const bytes = await exportAnimatedGLB({
      avatarFile,
      clip: await createClipForAvatar(avatarFile, "vrm"),
    });
    const document = await new WebIO()
      .registerExtensions(VRMC_VRM_EXTENSIONS)
      .readBinary(bytes);

    expect(isVRMDocument(document)).toBe(true);
    expect(document.getRoot().listAnimations()).toHaveLength(1);
  });

  it("injects animated GLB channels into known profile alias nodes", async () => {
    const avatarFile = new File([await createMinimalMixamoAvatarGLB()], "avatar.glb");
    const bytes = await exportAnimatedGLB({
      avatarFile,
      clip: await createClipForAvatar(
        avatarFile,
        "mixamo-rigged",
        MIXAMO_RIG_PROFILE.id,
      ),
    });
    const document = await new WebIO().readBinary(bytes);
    const targetNodeNames = document
      .getRoot()
      .listAnimations()[0]
      .listChannels()
      .map((channel) => channel.getTargetNode()?.getName());

    expect(targetNodeNames).toContain("mixamorig:Hips");
    expect(targetNodeNames).toContain("mixamorig:LeftArm");
  });

  it("exports an animated VRM while preserving VRM extensions", async () => {
    const adapter = getAvatarExportAdapter("baked-vrm");
    const avatarFile = new File([await createMinimalVRMBlobPart()], "avatar.vrm");
    const bytes = await adapter!.exportAvatar({
      avatarFile,
      clip: await createClipForAvatar(avatarFile, "vrm"),
    });
    const document = await new WebIO()
      .registerExtensions(VRMC_VRM_EXTENSIONS)
      .readBinary(bytes);

    expect(adapter).toMatchObject({ maturity: "active" });
    expect(isVRMDocument(document)).toBe(true);
    expect(document.getRoot().listAnimations()).toHaveLength(1);
    await expect(validateAvatarExportReload("baked-vrm", bytes)).resolves.toMatchObject({
      ok: true,
    });
  });


  it("bundles the original VRM and a reloadable VRMA through vrm-external-vrma", async () => {
    const adapter = getAvatarExportAdapter("vrm-external-vrma");
    const avatarFile = new File([await createMinimalVRMBlobPart()], "avatar.vrm");
    const bytes = await adapter!.exportAvatar({
      avatarFile,
      avatarFormatId: "vrm",
      clip: await createClipForAvatar(avatarFile, "vrm"),
    });
    const entries = parseStoredZip(bytes);

    expect(adapter).toMatchObject({ maturity: "active", extension: ".zip" });
    expect(new TextDecoder().decode(entries.get("avatar.vrm")!.slice(0, 4))).toBe(
      "glTF",
    );
    expect(entries.has("idle.vrma")).toBe(true);
    await expect(
      validateAvatarExportReload("vrm-external-vrma", bytes),
    ).resolves.toMatchObject({ ok: true });
  });

  it("rejects vrm-external-vrma export without a VRM avatar file", async () => {
    const adapter = getAvatarExportAdapter("vrm-external-vrma");

    await expect(
      adapter!.exportAvatar({ avatarFile: null, clip: createClip() }),
    ).rejects.toThrow(/VRM avatar/);
    await expect(
      adapter!.exportAvatar({
        avatarFile: new File(["not-a-vrm"], "avatar.glb"),
        clip: createClip(),
      }),
    ).rejects.toThrow(/VRM avatar/);
  });

  it("converts PMX and PMD avatars into GLB documents with skeleton and mesh data", async () => {
    const pmxDocument = convertMMDModelToGLBDocument(createMinimalPMXAvatar(), "avatar.pmx");
    const pmdDocument = convertMMDModelToGLBDocument(createMinimalPMDAvatar(), "avatar.pmd");

    for (const document of [pmxDocument, pmdDocument]) {
      expect(document.getRoot().listMeshes()).toHaveLength(1);
      expect(document.getRoot().listMaterials()).toHaveLength(1);

      const skin = document.getRoot().listSkins()[0];
      expect(skin).toBeTruthy();
      expect(skin.listJoints()).toHaveLength(2);
      expect(skin.getInverseBindMatrices()?.getCount()).toBe(2);

      const primitive = document.getRoot().listMeshes()[0].listPrimitives()[0];
      const joints = primitive.getAttribute("JOINTS_0");
      const weights = primitive.getAttribute("WEIGHTS_0");
      expect(joints?.getCount()).toBe(3);
      expect(weights?.getCount()).toBe(3);
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const vertexWeights = weights!.getElement(vertex, []);
        const sum = vertexWeights.reduce((total, value) => total + value, 0);
        expect(sum).toBeCloseTo(1, 5);
      }

      await expect(new WebIO().writeBinary(document)).resolves.toBeInstanceOf(Uint8Array);
    }

    expect(pmxDocument.getRoot().listNodes().map((node) => node.getName())).toEqual(
      expect.arrayContaining(["センター", "左腕"]),
    );
    expect(pmdDocument.getRoot().listNodes().map((node) => node.getName())).toEqual(
      expect.arrayContaining(["hips", "leftUpperArm"]),
    );

    const pmxJoints = pmxDocument
      .getRoot()
      .listMeshes()[0]
      .listPrimitives()[0]
      .getAttribute("JOINTS_0")!;
    expect(pmxJoints.getElement(1, [])).toEqual([1, 0, 0, 0]);
  });

  it("publishes a machine-readable MMD conversion capability report", async () => {
    const document = convertMMDModelToGLBDocument(
      createMinimalPMXAvatar(),
      "avatar.pmx",
    );
    const report = document.getRoot().getExtras()
      .mmdConversionCapabilityReport as {
        schemaVersion: number;
        sourceFormat: string;
        targetFormat: string;
        features: Array<{ id: string; status: string }>;
      };

    expect(report).toMatchObject({
      schemaVersion: 1,
      sourceFormat: "pmx",
      targetFormat: "glb",
    });
    expect(new Set(report.features.map((feature) => feature.status))).toEqual(
      new Set(["preserved", "approximated", "stored-in-extras", "dropped"]),
    );
    expect(report.features).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "bdef-skinning", status: "preserved" }),
      expect.objectContaining({ id: "sdef-skinning", status: "approximated" }),
      expect.objectContaining({ id: "qdef-skinning", status: "approximated" }),
    ]));

    const reloaded = await new WebIO().readBinary(
      await new WebIO().writeBinary(document),
    );
    expect(reloaded.getRoot().getExtras()).toEqual(document.getRoot().getExtras());
  });

  it("round-trips a PMX avatar GLB into a three.js SkinnedMesh", async () => {
    const document = convertMMDModelToGLBDocument(createMinimalPMXAvatar(), "avatar.pmx");
    const bytes = await new WebIO().writeBinary(document);
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const gltf = await new Promise<{ scene: import("three").Group }>(
      (resolve, reject) => new GLTFLoader().parse(arrayBuffer, "", resolve, reject),
    );

    let skinnedMesh: import("three").SkinnedMesh | null = null;
    gltf.scene.traverse((object) => {
      if ((object as import("three").SkinnedMesh).isSkinnedMesh) {
        skinnedMesh = object as import("three").SkinnedMesh;
      }
    });

    expect(skinnedMesh).toBeTruthy();
    expect(skinnedMesh!.skeleton.bones).toHaveLength(2);
    expect(skinnedMesh!.skeleton.bones.map((bone) => bone.name)).toEqual(
      expect.arrayContaining(["センター", "左腕"]),
    );
    expect(skinnedMesh!.geometry.getAttribute("skinIndex")).toBeTruthy();
    expect(skinnedMesh!.geometry.getAttribute("skinWeight")).toBeTruthy();
  });

  it("exports an animated GLB from a PMX avatar by matching MMD bone names", async () => {
    const avatarFile = new File([createMinimalPMXAvatar()], "avatar.pmx");
    const bytes = await exportAnimatedGLB({
      avatarFile,
      avatarFormatId: "mmd-model",
      clip: await createClipForAvatar(avatarFile, "mmd-model"),
    });
    const document = await new WebIO().readBinary(bytes);
    const targetNodeNames = document
      .getRoot()
      .listAnimations()[0]
      .listChannels()
      .map((channel) => channel.getTargetNode()?.getName());

    expect(targetNodeNames).toContain("センター");
    expect(targetNodeNames).toContain("左腕");
    await expect(validateAvatarExportReload("animated-glb", bytes)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("loads a PMX texture sidecar from an uploaded ZIP package", async () => {
    const textureBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const archive = createZipArchive([
      {
        name: "model/avatar.pmx",
        bytes: createMinimalPMXAvatar("textures/base.png"),
      },
      { name: "model/textures/base.png", bytes: textureBytes },
    ]);
    const prepared = await prepareAssetInput(
      new File([archive.slice().buffer as ArrayBuffer], "avatar.zip"),
      "avatar",
    );
    const document = await readAvatarAsGLBDocument({
      avatarFile: prepared.file,
      avatarFormatId: "mmd-model",
      io: new WebIO(),
    });
    const image = document
      .getRoot()
      .listMaterials()[0]
      .getBaseColorTexture()
      ?.getImage();

    expect(image).toEqual(textureBytes);
    releaseAssetPackage(prepared.file);
  });

  it("exports FBX animation that can be loaded again", async () => {
    const bytes = await exportFBXAnimation(createClip(), {
      boneNamingProfile: "mixamo",
    });
    const text = new TextDecoder().decode(bytes);

    expect(text).toContain("Kaydara FBX Binary");
    expect(text).toContain("Model::mixamorig:Hips");
    await expect(validateMotionExportReload("fbx-animation", bytes)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("round-trips FBX animation semantics through Three.js", async () => {
    const clip = createClip();
    clip.metadata = { rootTranslationSpace: "offset-meters" };
    const bytes = await exportFBXAnimation(clip);
    const semantic = await validateMotionExportSemantics(
      "fbx-animation",
      bytes,
      clip,
    );
    expect(semantic).toMatchObject({ level: "semantic", ok: true, issues: [] });
    expect(semantic.metrics.maxRotationErrorDegrees).toBeLessThan(0.001);
    expect(semantic.metrics.maxRootDisplacementErrorMeters).toBeLessThan(0.001);
  });

  it("requires an avatar for the active FBX avatar animation adapter", async () => {
    const adapter = getAvatarExportAdapter("fbx-avatar-animation");
    expect(adapter).toMatchObject({
      label: "Animated FBX",
      maturity: "active",
    });
    await expect(adapter!.exportAvatar({
      avatarFormatId: "mixamo-rigged",
      clip: createClip(),
    })).rejects.toThrow(/requires an avatar file/);
  });

  it("embeds avatar mesh and skin in the FBX avatar export", async () => {
    const adapter = getAvatarExportAdapter("fbx-avatar-animation");
    const avatarFile = new File([createMinimalPMXAvatar()], "avatar.pmx");
    const bytes = await adapter!.exportAvatar({
      avatarFile,
      avatarFormatId: "mmd-model",
      clip: await createClipForAvatar(avatarFile, "mmd-model"),
    });
    const group = await validateFBXAnimationBytes(bytes);

    let skinnedMesh: import("three").SkinnedMesh | null = null;
    group.traverse((object) => {
      if ((object as import("three").SkinnedMesh).isSkinnedMesh) {
        skinnedMesh = object as import("three").SkinnedMesh;
      }
    });

    expect(skinnedMesh).toBeTruthy();
    expect(skinnedMesh!.geometry.getAttribute("position").count).toBe(3);
    expect(skinnedMesh!.geometry.getAttribute("skinIndex")).toBeTruthy();
    expect(skinnedMesh!.geometry.getAttribute("skinWeight")).toBeTruthy();
    expect(skinnedMesh!.skeleton.bones.length).toBe(2);
    await expect(
      validateAvatarExportReload("fbx-avatar-animation", bytes),
    ).resolves.toMatchObject({ ok: true });
  });

  it("embeds baseColor textures in the FBX avatar export", async () => {
    const adapter = getAvatarExportAdapter("fbx-avatar-animation");
    const avatarFile = new File([await createMinimalTexturedAvatarGLB()], "avatar.glb");
    const bytes = await adapter!.exportAvatar({
      avatarFile,
      clip: await createClipForAvatar(avatarFile),
    });
    const group = await withTextureLoaderDomStubs(() => validateFBXAnimationBytes(bytes));
    let hasTextureMap = false;

    group.traverse((object) => {
      if (!(object as import("three").Mesh).isMesh) {
        return;
      }

      const material = (object as import("three").Mesh).material;
      const materials = Array.isArray(material) ? material : [material];
      hasTextureMap ||= materials.some((item) =>
        Boolean((item as import("three").MeshLambertMaterial).map),
      );
    });

    expect(hasTextureMap).toBe(true);
  });

  it("exports a reloadable FBX scene from a VRM avatar", async () => {
    const adapter = getAvatarExportAdapter("fbx-avatar-animation");
    const avatarFile = new File([await createMinimalVRMBlobPart()], "avatar.vrm");
    const bytes = await adapter!.exportAvatar({
      avatarFile,
      avatarFormatId: "vrm",
      clip: await createClipForAvatar(avatarFile, "vrm"),
    });
    const text = new TextDecoder().decode(bytes);

    expect(text).toContain("Model::hips");
    await expect(
      validateAvatarExportReload("fbx-avatar-animation", bytes),
    ).resolves.toMatchObject({ ok: true });
  });

  it("exports an animated PMX with binary bone morph frames", async () => {
    const adapter = getAvatarExportAdapter("animated-pmx");
    const avatarBytes = createMinimalPMXAvatar();
    const avatarFile = new File([avatarBytes], "avatar.pmx");
    const bytes = await adapter!.exportAvatar({
      avatarFile,
      avatarFormatId: "mmd-model",
      clip: createClipForPMX(avatarBytes),
    });
    const summary = readAnimatedPMXMotionSummary(bytes);

    expect(adapter).toMatchObject({
      label: "PMX Motion Morphs",
      maturity: "experimental",
    });
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("PMX ");
    expect(summary.morphCount).toBeGreaterThan(0);
    expect(summary.morphNames[0]).toBe("3DR Frame 0000");
    await expect(validateAvatarExportReload("animated-pmx", bytes)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("appends PMX pose morphs without deleting existing morph and display sections", () => {
    const source = createMinimalPMXAvatarWithOriginalMorph();
    const bytes = writeAnimatedPMX(source, createClipForPMX(source));
    const summary = readAnimatedPMXMotionSummary(bytes);

    expect(summary.morphNames[0]).toBe("Original Morph");
    expect(summary.morphNames).toContain("3DR Frame 0000");
    expect(summary.displayFrames).toBe(1);
    expect(summary.rigidBodies).toBe(0);
    expect(summary.joints).toBe(0);
    expect(new TextDecoder().decode(bytes)).toContain("Original Display");
  });

  it("rejects truncated PMX data at the binary-reader boundary", () => {
    const source = createMinimalPMXAvatar();
    const clip = createClipForPMX(source);
    expect(() => writeAnimatedPMX(source.slice(0, -1), clip)).toThrow(
      /truncated|unexpected trailing bytes/,
    );
  });
});

function createClip() {
  const canonical = createRetargetedMotionClipStub({
    fbxFile: { name: "idle.fbx" },
    vrmFile: { name: "avatar.vrm" },
  });
  return bindSolvedMotionClipStub(
    solveHumanoidCustomRigMotion(canonical),
    { rigSignature: "unbound-test-rig" },
  );
}

function expectDirectNodeParent(
  document: Document,
  nodeName: string,
  parentName: string,
) {
  const node = document.getRoot().listNodes().find(
    (candidate) => candidate.getName() === nodeName,
  );
  expect(node?.getParentNode()?.getName()).toBe(parentName);
}

function shuffled<T>(values: readonly T[], seed: number) {
  const output = [...values];
  let state = seed + 1;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const swapIndex = state % (index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex]!, output[index]!];
  }
  return output;
}

async function createClipForAvatar(
  avatarFile: File,
  avatarFormatId?: AvatarFormatId,
  profileId = inferProfileId(avatarFile, avatarFormatId),
) {
  const document = await readAvatarAsGLBDocument({
    avatarFile,
    avatarFormatId,
    io: new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS),
  });
  return createClipForDocument(document, avatarFile.name, avatarFormatId, profileId);
}

function createClipForPMX(bytes: Uint8Array, filename = "avatar.pmx") {
  return createClipForDocument(
    convertMMDModelToGLBDocument(bytes, filename),
    filename,
    "mmd-model",
    MMD_BODY_PROFILE.id,
  );
}

function createClipForDocument(
  document: Document,
  filename: string,
  avatarFormatId: AvatarFormatId | undefined,
  profileId: string,
) {
  const clip = createClip();
  return {
    ...clip,
    target: {
      ...clip.target,
      kind: avatarFormatId ?? (filename.endsWith(".vrm") ? "vrm" : "gltf-humanoid"),
      filename,
      profile: profileId,
      rigSignature: createGLTFHumanoidRigSignature(
        collectHumanoidNodes(document),
        profileId,
      ),
    },
  };
}

function inferProfileId(file: File, avatarFormatId?: AvatarFormatId) {
  if (avatarFormatId === "mmd-model" || /\.(?:pmx|pmd)$/i.test(file.name)) {
    return MMD_BODY_PROFILE.id;
  }
  if (avatarFormatId === "vrm" || /\.vrm$/i.test(file.name)) {
    return VRM_HUMANOID_PROFILE.id;
  }
  if (avatarFormatId === "mixamo-rigged") return MIXAMO_RIG_PROFILE.id;
  return GENERIC_GLTF_HUMANOID_PROFILE.id;
}

async function createMinimalAvatarGLB() {
  const document = new Document();
  const scene = document.createScene("avatar scene");
  document.getRoot().setDefaultScene(scene);
  const hips = document.createNode("hips").setTranslation([0, 1, 0]);
  const head = document.createNode("head").setTranslation([0, 1.6, 0]);
  scene.addChild(hips);
  hips.addChild(head);

  return new WebIO().writeBinary(document);
}

function createMinimalAvatarGLTF() {
  return JSON.stringify({
    asset: {
      version: "2.0",
    },
    scene: 0,
    scenes: [
      {
        nodes: [0],
      },
    ],
    nodes: [
      {
        children: [1],
        name: "hips",
        translation: [0, 1, 0],
      },
      {
        name: "head",
        translation: [0, 1.6, 0],
      },
    ],
  });
}

async function createMinimalVRMBytes() {
  const document = new Document();
  const scene = document.createScene("test VRM scene");
  document.getRoot().setDefaultScene(scene);

  const extension = document.createExtension(VRMCVRM).setRequired(false);
  const writableExtension = extension as unknown as WritableVRMExtension;
  const nodesByBone = new Map<string, GltfNode>();

  for (const bone of VRM_REQUIRED_HUMAN_BONE_NAMES) {
    const node = document.createNode(bone);
    node.setTranslation(defaultBoneTranslation(bone));
    scene.addChild(node);
    nodesByBone.set(bone, node);
    writableExtension.humanoidBoneNodes.set(bone, node);
  }

  writableExtension.data = {
    specVersion: "1.0",
    meta: {
      name: "Test Minimal VRM",
      version: "1.0",
      authors: ["3dretarget"],
      licenseUrl: "https://vrm.dev/licenses/1.0/",
    },
    humanoid: {
      humanBones: Object.fromEntries(
        [...nodesByBone.keys()].map((bone) => [bone, {}]),
      ),
    },
  };

  const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
  return writeVRM(io, document);
}

async function createMinimalVRMBlobPart() {
  const bytes = await createMinimalVRMBytes();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function createMinimalMixamoAvatarGLB() {
  const document = new Document();
  const scene = document.createScene("mixamo avatar scene");
  document.getRoot().setDefaultScene(scene);
  const hips = document.createNode("mixamorig:Hips").setTranslation([0, 1, 0]);
  const leftArm = document
    .createNode("mixamorig:LeftArm")
    .setTranslation([-0.2, 1.4, 0]);
  scene.addChild(hips);
  hips.addChild(leftArm);

  return new WebIO().writeBinary(document);
}

async function createMinimalTexturedAvatarGLB() {
  const document = new Document();
  const buffer = document.createBuffer("textured-avatar-buffer");
  const scene = document.createScene("textured avatar scene");
  document.getRoot().setDefaultScene(scene);

  const hips = document.createNode("hips");
  const leftUpperArm = document.createNode("leftUpperArm").setTranslation([-0.2, 1.4, 0]);
  scene.addChild(hips);
  hips.addChild(leftUpperArm);

  const texture = document
    .createTexture("baseColor")
    .setMimeType("image/png")
    .setImage(PNG_1X1);
  const material = document
    .createMaterial("Textured material")
    .setBaseColorTexture(texture);
  const mesh = document.createMesh("textured mesh").addPrimitive(
    document
      .createPrimitive()
      .setAttribute(
        "POSITION",
        document
          .createAccessor("POSITION")
          .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
          .setType(Accessor.Type.VEC3)
          .setBuffer(buffer),
      )
      .setAttribute(
        "NORMAL",
        document
          .createAccessor("NORMAL")
          .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
          .setType(Accessor.Type.VEC3)
          .setBuffer(buffer),
      )
      .setAttribute(
        "TEXCOORD_0",
        document
          .createAccessor("TEXCOORD_0")
          .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
          .setType(Accessor.Type.VEC2)
          .setBuffer(buffer),
      )
      .setIndices(
        document
          .createAccessor("indices")
          .setArray(new Uint16Array([0, 1, 2]))
          .setType(Accessor.Type.SCALAR)
          .setBuffer(buffer),
      )
      .setMaterial(material),
  );
  hips.addChild(document.createNode("textured-mesh-node").setMesh(mesh));

  return new WebIO().writeBinary(document);
}

async function withTextureLoaderDomStubs<T>(read: () => Promise<T>) {
  const globals = globalThis as Record<string, unknown>;
  const previousDocument = globals.document;
  const previousWindow = globals.window;
  globals.window = {
    URL: {
      createObjectURL: () => "blob:texture",
      revokeObjectURL: () => undefined,
    },
  };
  globals.document = {
    createElementNS: () => createImageStub(),
  };

  try {
    return await read();
  } finally {
    if (previousWindow === undefined) {
      delete globals.window;
    } else {
      globals.window = previousWindow;
    }
    if (previousDocument === undefined) {
      delete globals.document;
    } else {
      globals.document = previousDocument;
    }
  }
}

function createImageStub() {
  const listeners = new Map<string, EventListener[]>();
  return {
    complete: false,
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener));
    },
    set src(_value: string) {
      this.complete = true;
      for (const listener of listeners.get("load") ?? []) {
        listener.call(this, new Event("load"));
      }
    },
  };
}

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function parseStoredZip(bytes: Uint8Array) {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    entries.set(name, bytes.slice(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }

  return entries;
}

function defaultBoneTranslation(bone: string): [number, number, number] {
  const x = bone.startsWith("left") ? -0.22 : bone.startsWith("right") ? 0.22 : 0;
  if (bone === "hips") {
    return [0, 0.9, 0];
  }
  if (bone.includes("UpperLeg")) {
    return [x, 0.55, 0];
  }
  if (bone.includes("LowerLeg")) {
    return [x, 0.25, 0];
  }
  if (bone.includes("Foot")) {
    return [x, 0.02, 0.08];
  }
  if (bone === "spine") {
    return [0, 1.1, 0];
  }
  if (bone === "chest") {
    return [0, 1.3, 0];
  }
  if (bone === "neck") {
    return [0, 1.5, 0];
  }
  if (bone === "head") {
    return [0, 1.68, 0];
  }
  if (bone.includes("UpperArm")) {
    return [x * 1.8, 1.32, 0];
  }
  if (bone.includes("LowerArm")) {
    return [x * 2.6, 1.12, 0];
  }
  if (bone.includes("Hand")) {
    return [x * 3.2, 0.96, 0];
  }
  return [x, 1.2, 0];
}

function createMinimalPMXAvatar(texturePath?: string) {
  const writer = new BinaryWriter();
  writer.writeAscii("PMX ");
  writer.writeFloat32(2);
  writer.writeUint8(8);
  [1, 0, 4, 4, 4, 4, 4, 4].forEach((value) => writer.writeUint8(value));
  writer.writeText("PMX Test");
  writer.writeText("PMX Test");
  writer.writeText("");
  writer.writeText("");

  writer.writeInt32(3);
  writePMXVertex(writer, [0, 0, 0], [0, 1, 0], [0, 0], 0);
  writePMXVertex(writer, [1, 0, 0], [0, 1, 0], [1, 0], 1);
  writePMXVertex(writer, [0, 1, 0], [0, 1, 0], [0, 1], 1);

  writer.writeInt32(3);
  [0, 1, 2].forEach((index) => writer.writeUint32(index));

  writer.writeInt32(texturePath ? 1 : 0);
  if (texturePath) {
    writer.writeText(texturePath);
  }
  writer.writeInt32(1);
  writer.writeText("PMX Material");
  writer.writeText("PMX Material");
  [1, 0.8, 0.8, 1].forEach((value) => writer.writeFloat32(value));
  [0, 0, 0].forEach((value) => writer.writeFloat32(value));
  writer.writeFloat32(0);
  [0.5, 0.5, 0.5].forEach((value) => writer.writeFloat32(value));
  writer.writeUint8(0);
  [0, 0, 0, 1].forEach((value) => writer.writeFloat32(value));
  writer.writeFloat32(1);
  writer.writeInt32(texturePath ? 0 : -1);
  writer.writeInt32(-1);
  writer.writeUint8(0);
  writer.writeUint8(1);
  writer.writeUint8(0);
  writer.writeText("");
  writer.writeInt32(3);

  writer.writeInt32(2);
  writePMXBone(writer, "センター", [0, 0, 0], -1, [0, 1, 0]);
  writePMXBone(writer, "左腕", [-1, 1, 0], 0, [-0.5, 0, 0]);

  writer.writeInt32(0); // morphs
  writer.writeInt32(0); // display frames
  writer.writeInt32(0); // rigid bodies
  writer.writeInt32(0); // joints

  return writer.toUint8Array();
}

function createMinimalPMXAvatarWithOriginalMorph() {
  const base = createMinimalPMXAvatar();
  const writer = new BinaryWriter();
  writer.writeBytes(base.slice(0, -16));
  writer.writeInt32(1);
  writer.writeText("Original Morph");
  writer.writeText("Original Morph");
  writer.writeUint8(4);
  writer.writeUint8(2);
  writer.writeInt32(1);
  writer.writeInt32(0);
  [0, 0, 0].forEach((value) => writer.writeFloat32(value));
  [0, 0, 0, 1].forEach((value) => writer.writeFloat32(value));
  writer.writeInt32(1);
  writer.writeText("Original Display");
  writer.writeText("Original Display");
  writer.writeUint8(0);
  writer.writeInt32(1);
  writer.writeUint8(1);
  writer.writeInt32(0);
  writer.writeInt32(0);
  writer.writeInt32(0);
  return writer.toUint8Array();
}

function writePMXVertex(
  writer: BinaryWriter,
  position: [number, number, number],
  normal: [number, number, number],
  uv: [number, number],
  boneIndex: number,
) {
  position.forEach((value) => writer.writeFloat32(value));
  normal.forEach((value) => writer.writeFloat32(value));
  uv.forEach((value) => writer.writeFloat32(value));
  writer.writeUint8(0);
  writer.writeInt32(boneIndex);
  writer.writeFloat32(1);
}

function writePMXBone(
  writer: BinaryWriter,
  name: string,
  position: [number, number, number],
  parentIndex: number,
  tailOffset: [number, number, number],
) {
  writer.writeText(name);
  writer.writeText(name);
  position.forEach((value) => writer.writeFloat32(value));
  writer.writeInt32(parentIndex);
  writer.writeInt32(0);
  writer.writeUint16(0);
  tailOffset.forEach((value) => writer.writeFloat32(value));
}

function createMinimalPMDAvatar() {
  const writer = new BinaryWriter();
  writer.writeAscii("Pmd");
  writer.writeFloat32(1);
  writer.writeFixedAscii("PMD Test", 20);
  writer.writeFixedAscii("minimal PMD avatar", 256);

  writer.writeInt32(3);
  writePMDVertex(writer, [0, 0, 0], [0, 1, 0], [0, 0], 0, 1);
  writePMDVertex(writer, [1, 0, 0], [0, 1, 0], [1, 0], 1, 0);
  writePMDVertex(writer, [0, 1, 0], [0, 1, 0], [0, 1], 1, 0);

  writer.writeInt32(3);
  [0, 1, 2].forEach((index) => writer.writeUint16(index));

  writer.writeInt32(1);
  [0.7, 0.7, 1, 1].forEach((value) => writer.writeFloat32(value));
  writer.writeFloat32(0);
  [0, 0, 0].forEach((value) => writer.writeFloat32(value));
  [0.5, 0.5, 0.5].forEach((value) => writer.writeFloat32(value));
  writer.writeUint8(0);
  writer.writeUint8(0);
  writer.writeUint32(3);
  writer.writeFixedAscii("", 20);

  writer.writeUint16(2);
  writePMDBone(writer, "hips", 0xffff, 1, [0, 0, 0]);
  writePMDBone(writer, "leftUpperArm", 0, 0, [-1, 1, 0]);

  return writer.toUint8Array();
}

function writePMDVertex(
  writer: BinaryWriter,
  position: [number, number, number],
  normal: [number, number, number],
  uv: [number, number],
  bone0: number,
  bone1: number,
) {
  position.forEach((value) => writer.writeFloat32(value));
  normal.forEach((value) => writer.writeFloat32(value));
  uv.forEach((value) => writer.writeFloat32(value));
  writer.writeUint16(bone0);
  writer.writeUint16(bone1);
  writer.writeUint8(100);
  writer.writeUint8(0);
}

function writePMDBone(
  writer: BinaryWriter,
  name: string,
  parentIndex: number,
  tailIndex: number,
  position: [number, number, number],
) {
  writer.writeFixedAscii(name, 20);
  writer.writeUint16(parentIndex);
  writer.writeUint16(tailIndex);
  writer.writeUint8(0);
  writer.writeUint16(0);
  position.forEach((value) => writer.writeFloat32(value));
}

class BinaryWriter {
  private bytes: number[] = [];
  private textEncoder = new TextEncoder();

  writeAscii(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      this.writeUint8(value.charCodeAt(index));
    }
  }

  writeFixedAscii(value: string, length: number) {
    const encoded = this.textEncoder.encode(value).slice(0, length);
    this.writeBytes(encoded);
    for (let index = encoded.length; index < length; index += 1) {
      this.writeUint8(0);
    }
  }

  writeText(value: string) {
    const encoded = this.textEncoder.encode(value);
    this.writeInt32(encoded.length);
    this.writeBytes(encoded);
  }

  writeBytes(value: Uint8Array) {
    this.bytes.push(...value);
  }

  writeUint8(value: number) {
    this.bytes.push(value & 0xff);
  }

  writeUint16(value: number) {
    this.writeDataView(2, (view) => view.setUint16(0, value, true));
  }

  writeInt32(value: number) {
    this.writeDataView(4, (view) => view.setInt32(0, value, true));
  }

  writeUint32(value: number) {
    this.writeDataView(4, (view) => view.setUint32(0, value, true));
  }

  writeFloat32(value: number) {
    this.writeDataView(4, (view) => view.setFloat32(0, value, true));
  }

  toUint8Array() {
    return new Uint8Array(this.bytes);
  }

  private writeDataView(length: number, write: (view: DataView) => void) {
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    write(view);
    this.writeBytes(new Uint8Array(buffer));
  }
}
