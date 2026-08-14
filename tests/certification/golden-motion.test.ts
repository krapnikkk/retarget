import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HUMANOID_ECOSYSTEM_RECEIPTS,
  HUMANOID_PIPELINE_CERTIFICATION,
  getPipelineExportAssurance,
  isFullyCertified,
} from "@/certification";
import {
  validateAvatarExportReload,
  validateAvatarExportSemantics,
  validateMotionExportReload,
  validateMotionExportSemantics,
} from "@/export";
import type { AvatarExportFormatId } from "@/formats";
import { getRetargetPipeline } from "@/pipelines";
import { DEFAULT_RETARGET_SOLVE_OPTIONS } from "@/retarget";
import { DEFAULT_CUSTOM_RIG_MAPPING_CONFIG } from "@/solvers";
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
    expect(HUMANOID_PIPELINE_CERTIFICATION.validatorVersion).toBe(4);
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
      if (item.status === "semantic-passed" || item.status === "certified") {
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
        expect(item.ecosystemReceipt).toBeDefined();
      }
      if (item.evidence.ecosystem !== "passed") {
        expect(isFullyCertified(item)).toBe(false);
      }
    }
  });

  it("locks certified ecosystem receipts to the generated evidence", async () => {
    const certified = HUMANOID_PIPELINE_CERTIFICATION.cases.filter(
      (item) => item.status === "certified",
    );
    expect(certified).toHaveLength(1);

    for (const item of certified) {
      const reference = item.ecosystemReceipt!;
      const receiptBytes = new Uint8Array(
        await readFile(projectPath(reference.path)),
      );
      expect(sha256(receiptBytes)).toBe(reference.sha256);
      const receipt = HUMANOID_ECOSYSTEM_RECEIPTS.find(
        (candidate) => candidate.caseId === item.id,
      );
      expect(receipt).toMatchObject({
        status: "passed",
        requiredRuntimes: reference.requiredRuntimes,
        runtimes: {
          blender: { status: "passed" },
          godot: { status: "passed" },
          unity: { required: false, status: "deferred" },
        },
      });
      for (const runtime of reference.requiredRuntimes) {
        expect(runtime).not.toBe("unity");
        if (runtime === "blender" || runtime === "godot") {
          expect(receipt!.runtimes[runtime].artifactSha256).toBe(
            receipt!.artifact.sha256,
          );
        }
      }
    }
  });

  it.each(
    HUMANOID_PIPELINE_CERTIFICATION.cases.filter(
      (item) => item.status === "semantic-passed" || item.status === "certified",
    ),
  )("locks $id provenance and validates its public pipeline roundtrip", async (golden) => {
    const sourceBytes = new Uint8Array(await readFile(projectPath(golden.source.path)));
    const avatarBytes = new Uint8Array(await readFile(projectPath(golden.avatar.path)));
    expect(sha256(sourceBytes)).toBe(golden.source.sha256);
    expect(sha256(avatarBytes)).toBe(golden.avatar.sha256);

    const pipeline = getRetargetPipeline(
      golden.motionFormat,
      golden.avatarFormat,
      golden.exportFormat,
    );
    expect(pipeline).toMatchObject({
      assurance: "beta",
      outputFormat: golden.exportFormat,
    });
    const avatarFile = new File(
      [avatarBytes],
      path.basename(golden.avatar.path),
      { type: "model/gltf-binary" },
    );
    const result = await pipeline!.run({
      motionFile: new File(
        [sourceBytes],
        path.basename(golden.source.path),
        { type: "model/gltf-binary" },
      ),
      avatarFile,
      mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
      solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
    });
    const sourceClip = result.sourceClip;
    const expectedCanonical = golden.expectedCanonicalFrom
      ? HUMANOID_PIPELINE_CERTIFICATION.cases.find(
          (item) => item.id === golden.expectedCanonicalFrom,
        )?.expectedCanonical
      : golden.expectedCanonical;
    expect(expectedCanonical).toBeDefined();
    expect({
      duration: Number(sourceClip.duration.toFixed(6)),
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
    const semantic = isAvatarExportFormatId(result.output.format)
      ? await validateAvatarOutput(
          result.output.format,
          result.output.bytes,
          result.solvedClip,
        )
      : await validateMotionOutput(
          result.output.format,
          result.output.bytes,
          result.solvedClip,
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

  it("certifies only the exact pipeline with pinned ecosystem evidence", () => {
    expect(HUMANOID_PIPELINE_CERTIFICATION.cases.filter(isFullyCertified)).toHaveLength(1);
    const golden = HUMANOID_PIPELINE_CERTIFICATION.cases.find(
      (item) => item.status === "certified",
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
    ).toBe("certified");
    expect(
      getRetargetPipeline(
        golden.motionFormat,
        golden.avatarFormat,
        golden.exportFormat,
      ),
    ).toMatchObject({
      assurance: "beta",
      outputFormat: golden.exportFormat,
    });
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

function isAvatarExportFormatId(
  format: string,
): format is AvatarExportFormatId {
  return [
    "animated-glb",
    "vrm-external-vrma",
    "baked-vrm",
    "fbx-avatar-animation",
    "animated-pmx",
  ].includes(format);
}

async function validateAvatarOutput(
  format: AvatarExportFormatId,
  bytes: Uint8Array,
  expected: Parameters<typeof validateAvatarExportSemantics>[2],
) {
  await expect(validateAvatarExportReload(format, bytes)).resolves.toMatchObject({
    level: "structural",
    ok: true,
  });
  return validateAvatarExportSemantics(format, bytes, expected);
}

async function validateMotionOutput(
  format: Parameters<typeof validateMotionExportReload>[0],
  bytes: Uint8Array,
  expected: Parameters<typeof validateMotionExportSemantics>[2],
) {
  await expect(validateMotionExportReload(format, bytes)).resolves.toMatchObject({
    level: "structural",
    ok: true,
  });
  return validateMotionExportSemantics(format, bytes, expected);
}
