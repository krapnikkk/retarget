import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportBVH, validateMotionExportSemantics } from "@/export";
import { importGLTFAnimation } from "@/import/gltf-animation";

const SOURCE_PATH = path.join(
  process.cwd(),
  "tests/fixtures/certification/golden-motion/motions/quaternius-walk/quaternius-walk.animation.glb",
);

describe("Golden Motion derived fixtures", () => {
  it("rebuilds BVH from the pinned canonical animation without semantic drift", async () => {
    const source = await importGLTFAnimation(
      new Uint8Array(await readFile(SOURCE_PATH)),
      "quaternius-walk.animation.glb",
    );
    const bytes = await exportBVH(source);
    const semantic = await validateMotionExportSemantics("bvh", bytes, source);

    expect(semantic).toMatchObject({ level: "semantic", ok: true, issues: [] });
    expect(semantic.metrics.maxRotationErrorDegrees).toBeLessThan(0.1);
    expect(semantic.metrics.maxRootDisplacementErrorMeters).toBeLessThan(0.001);

    const outputPath = process.env.RETARGET_GOLDEN_BVH_PATH;
    if (outputPath) {
      const absolutePath = path.resolve(outputPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, bytes);
      console.log(`[golden-bvh] ${absolutePath}`);
    }
  });
});
