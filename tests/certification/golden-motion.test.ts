import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HUMANOID_PIPELINE_CERTIFICATION,
  getPipelineExportAssurance,
  isFullyCertified,
} from "@/certification";
import { bindMotionClipToAvatar } from "@/browser/avatar-target-pipeline";
import { exportAnimatedGLB, validateAvatarExportReload, validateAvatarExportSemantics } from "@/export";
import { importGLTFAnimation } from "@/import/gltf-animation";
import { importVRMA } from "@/import/vrma";
import { sampleSemanticMotionPose } from "@/validation";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

describe("Golden Motion certification", () => {
  it("locks every candidate asset to the SDK-owned fixture corpus", async () => {
    const assets = new Map(
      HUMANOID_PIPELINE_CERTIFICATION.cases.flatMap((item) => [
        [item.source.path, item.source] as const,
        [item.avatar.path, item.avatar] as const,
      ]),
    );

    for (const [assetPath, asset] of assets) {
      expect(asset.license).not.toHaveLength(0);
      expect(asset.sourceUrl).toMatch(/^https:\/\//);
      expect(sha256(new Uint8Array(await readFile(projectPath(assetPath))))).toBe(
        asset.sha256,
      );
    }
  });

  it("keeps status, evidence, ids, and pipeline triples internally consistent", () => {
    expect(HUMANOID_PIPELINE_CERTIFICATION.validatorVersion).toBe(2);
    const ids = HUMANOID_PIPELINE_CERTIFICATION.cases.map((item) => item.id);
    const triples = HUMANOID_PIPELINE_CERTIFICATION.cases.map(
      (item) =>
        `${item.motionFormat}:${item.avatarFormat}:${item.exportFormat}:${item.executionMode}:${item.rigDetectionMode}:${item.solverRevision}:${item.targetBindingRevision}`,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(triples).size).toBe(triples.length);

    for (const item of HUMANOID_PIPELINE_CERTIFICATION.cases) {
      expect(["in-memory", "streamed"]).toContain(item.executionMode);
      expect(["vrm-extension", "name-heuristic"]).toContain(
        item.rigDetectionMode,
      );
      expect(item.solverRevision).toBe(4);
      expect(item.targetBindingRevision).toBe(1);
      if (item.status === "semantic-passed") {
        expect(item.evidence).toMatchObject({
          structural: "passed",
          semantic: "passed",
        });
        expect(item.expectedCanonical ?? item.expectedCanonicalFrom).toBeDefined();
      }
      if (item.status === "certified") {
        expect(item.evidence).toEqual({
          structural: "passed",
          semantic: "passed",
          ecosystem: "passed",
        });
      }
      if (item.evidence.ecosystem !== "passed") {
        expect(isFullyCertified(item)).toBe(false);
      }
    }
  });

  it.each(
    HUMANOID_PIPELINE_CERTIFICATION.cases.filter(
      (item) => item.status === "semantic-passed",
    ),
  )("locks $id provenance and validates its avatar roundtrip", async (golden) => {
    const sourceBytes = new Uint8Array(await readFile(projectPath(golden.source.path)));
    const avatarBytes = new Uint8Array(await readFile(projectPath(golden.avatar.path)));
    expect(sha256(sourceBytes)).toBe(golden.source.sha256);
    expect(sha256(avatarBytes)).toBe(golden.avatar.sha256);

    const sourceClip =
      golden.motionFormat === "vrma"
        ? await importVRMA(sourceBytes, "quaternius-walk.vrma")
        : await importGLTFAnimation(
            sourceBytes,
            "quaternius-walk.animation.glb",
          );
    const expectedCanonical = golden.expectedCanonicalFrom
      ? HUMANOID_PIPELINE_CERTIFICATION.cases.find(
          (item) => item.id === golden.expectedCanonicalFrom,
        )?.expectedCanonical
      : golden.expectedCanonical;
    expect(expectedCanonical).toBeDefined();
    expect({
      duration: sourceClip.duration,
      fps: sourceClip.fps,
      trackCount: sourceClip.tracks.length,
      samples: golden.sampleFractions.map((fraction) => {
        const pose = sampleSemanticMotionPose(
          sourceClip,
          sourceClip.duration * fraction,
        );
        return Object.fromEntries(
          ["hips", "leftHand", "rightHand", "leftFoot", "rightFoot"].map((bone) => [
            bone,
            roundPose(pose[bone as keyof typeof pose]),
          ]),
        );
      }),
    }).toEqual(expectedCanonical);
    const avatarFile = new File([avatarBytes], "studio-mannequin-male.glb", {
      type: "model/gltf-binary",
    });
    const boundClip = await bindMotionClipToAvatar({
      avatarFile,
      avatarFormatId: golden.avatarFormat,
      clip: sourceClip,
    });
    const exported = await exportAnimatedGLB({
      avatarFile,
      avatarFormatId: golden.avatarFormat,
      clip: boundClip,
    });

    await expect(
      validateAvatarExportReload(golden.exportFormat as "animated-glb", exported),
    ).resolves.toMatchObject({ level: "structural", ok: true });
    const semantic = await validateAvatarExportSemantics(
      golden.exportFormat as "animated-glb",
      exported,
      boundClip,
    );
    expect(semantic).toMatchObject({ level: "semantic", ok: true });
    expect(semantic.metrics).toEqual(
      expect.objectContaining({
        maxRotationErrorDegrees: expect.any(Number),
        maxRootDisplacementErrorMeters: expect.any(Number),
        maxEndEffectorErrorMeters: expect.any(Number),
      }),
    );
  });

  it("does not claim certification while ecosystem evidence is pending", () => {
    expect(HUMANOID_PIPELINE_CERTIFICATION.cases.some(isFullyCertified)).toBe(false);
    const golden = HUMANOID_PIPELINE_CERTIFICATION.cases.find(
      (item) => item.status === "semantic-passed",
    )!;
    expect(
      getPipelineExportAssurance({
        motionFormat: golden.motionFormat,
        avatarFormat: golden.avatarFormat,
        exportFormat: golden.exportFormat,
        executionMode: golden.executionMode,
        rigDetectionMode: golden.rigDetectionMode,
        solverRevision: golden.solverRevision,
        targetBindingRevision: golden.targetBindingRevision,
      }),
    ).toBe("beta");
    expect(
      getPipelineExportAssurance({
        motionFormat: "vmd",
        avatarFormat: "vrm",
        exportFormat: "baked-vrm",
        executionMode: "in-memory",
        rigDetectionMode: "vrm-extension",
        solverRevision: 4,
        targetBindingRevision: 1,
        fallback: "beta",
      }),
    ).toBe("experimental");
  });
});

function projectPath(relativePath: string) {
  return path.join(process.cwd(), ...relativePath.split("/"));
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function roundPose(
  pose:
    | { rotation?: [number, number, number, number]; position?: [number, number, number] }
    | undefined,
) {
  return pose
    ? Object.fromEntries(
        Object.entries(pose).map(([key, values]) => [
          key,
          values?.map((value) => Number(value.toFixed(6))),
        ]),
      )
    : undefined;
}
