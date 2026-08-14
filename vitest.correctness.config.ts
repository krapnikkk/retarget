import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "tests/export/gltf-target-binding.test.ts",
      "tests/import/phase3-motion.test.ts",
      "tests/retarget/**/*.test.ts",
      "tests/rigs/mesh2motion-acceptance.test.ts",
      "tests/rigs/non-humanoid.test.ts",
      "tests/rigs/rig-motion-validation.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/correctness",
      include: [
        "src/import/rig-motion-gltf.ts",
        "src/retarget/pose-sampler.ts",
        "src/retarget/source-normalization.ts",
        "src/retarget/target-binding.ts",
        "src/solvers/rig-chain-swing-twist.ts",
      ],
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 78,
        lines: 77,
        "src/import/rig-motion-gltf.ts": { branches: 71 },
        "src/retarget/pose-sampler.ts": { branches: 66 },
        "src/retarget/source-normalization.ts": { branches: 82 },
        "src/retarget/target-binding.ts": { branches: 85 },
        "src/solvers/rig-chain-swing-twist.ts": { branches: 70 }
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src")
    }
  }
});
