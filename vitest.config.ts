import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Test tiers:
// - unit: fast default suite, run by `pnpm test` and the pre-commit hook.
// - slow: CPU-heavy end-to-end fixtures (real meshes, CLI subprocesses).
// - certification: byte-exact receipts and golden locks tied to pinned
//   ecosystem evidence; run before release, not on every change.
const certificationTests = [
  "tests/certification/**/*.test.ts",
  "tests/binding/ecosystem.test.ts",
];
const slowTests = [
  "tests/binding/humanoid-binding.test.ts",
  "tests/rigs/mesh2motion-acceptance.test.ts",
  "tests/node/node-tooling.test.ts",
  "tests/asset-validation.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...slowTests, ...certificationTests],
        },
      },
      {
        extends: true,
        test: { name: "slow", include: slowTests, testTimeout: 60_000 },
      },
      {
        extends: true,
        test: { name: "certification", include: certificationTests, testTimeout: 60_000 },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/correctness",
      // Modules whose mutations can change exported motion.
      include: [
        "src/binding/contracts.ts",
        "src/binding/rig.ts",
        "src/binding/weights.ts",
        "src/import/binding-glb.ts",
        "src/export/humanoid-binding-glb.ts",
        "src/validation/binding-deformation.ts",
        "src/import/rig-motion-gltf.ts",
        "src/retarget/pose-sampler.ts",
        "src/retarget/source-normalization.ts",
        "src/retarget/target-binding.ts",
        "src/solvers/rig-chain-swing-twist.ts",
      ],
      // A loose floor that catches large untested additions, not a ratchet.
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 75,
        lines: 75,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
