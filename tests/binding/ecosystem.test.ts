import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { processHumanoidBinding } from "@/io";
import { runRetargetJobInline } from "@/jobs/browser-retarget-job";
import { bindMotionClipToAvatar } from "@/browser/avatar-target-pipeline";
import { exportAnimatedGLB } from "@/export/avatar-glb";
import { validateAvatarExportReload, validateAvatarExportSemantics } from "@/export/reload-validation";
import { bindingFixture } from "./fixtures";
import { measureBindingQuality } from "./quality";
import manifest from "./manifest.json";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

describe("humanoid binding ecosystem artifacts", () => {
  it.each(manifest.cases)("reproduces $id with real retargeted motion", async (entry) => {
    const fixture = await bindingFixture({ keepSkeleton: entry.path === "existing-rig" });
    const rig = await processHumanoidBinding(fixture.bytes, entry.path === "existing-rig"
      ? { operation: "use-rig", joints: fixture.joints }
      : { operation: "fit", pose: "t-pose", forward: "+z", landmarks: Object.fromEntries(fixture.joints.map((joint) => [joint.bone, joint.position])) });
    const skin = await processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: rig, expectedRevision: rig.revision, iterations: manifest.iterations });
    const bound = await processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: skin, expectedRevision: skin.revision });
    const quality = await measureBindingQuality(fixture.source, bound.bytes);
    expect(bound.validation.ok).toBe(true);
    expect(quality.ok, JSON.stringify(quality)).toBe(true);
    const motionBytes = new Uint8Array(await readFile(manifest.motion.path));
    expect(sha256(motionBytes)).toBe(manifest.motion.sha256);
    const motion = await runRetargetJobInline({ type: "import-motion", formatId: "gltf-animation", filename: "walk.glb", bytes: motionBytes.buffer });
    const avatarFile = new File([bound.bytes.slice()], "generated.glb");
    const clip = await bindMotionClipToAvatar({ avatarFile, avatarFormatId: "gltf-humanoid", clip: motion });
    const animated = await exportAnimatedGLB({ avatarFile, avatarFormatId: "gltf-humanoid", clip });
    const structural = await validateAvatarExportReload("animated-glb", animated);
    const semantic = await validateAvatarExportSemantics("animated-glb", animated, clip);
    expect(structural.ok).toBe(true);
    expect(semantic.ok, JSON.stringify(semantic)).toBe(true);
    const evidence = { schemaVersion: 1, caseId: entry.id, profile: manifest.profile, algorithm: manifest.algorithm,
      iterations: manifest.iterations, source: manifest.source, motion: manifest.motion, path: entry.path,
      inputSha256: sha256(new Uint8Array(fixture.bytes)), snapshotRevision: skin.revision, rigRevision: skin.rigRevision,
      boundArtifact: { byteLength: bound.bytes.length, sha256: sha256(bound.bytes) },
      bindingValidation: bound.validation, quality, animationValidation: { structural, semantic },
      artifact: { filename: `${entry.id}.animated.glb`, byteLength: animated.length, sha256: sha256(animated) } };
    const output = process.env.RETARGET_BINDING_ARTIFACT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, evidence.artifact.filename), animated);
      await writeFile(path.join(output, `${entry.id}.evidence.json`), JSON.stringify(evidence, null, 2) + "\n");
    } else {
      const receipt = JSON.parse(await readFile(`tests/binding/receipts/${entry.id}.json`, "utf8"));
      expect(receipt.evidence).toEqual(evidence);
      expect(receipt.status).toBe("passed");
      for (const runtime of ["blender", "godot"]) {
        expect(receipt.runtimes[runtime].status).toBe("passed");
        expect(receipt.runtimes[runtime].artifactSha256).toBe(evidence.artifact.sha256);
      }
    }
  });
});

function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
