import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    io: "src/io.ts",
    node: "src/node.ts",
    "browser/index": "src/browser/index.ts",
    "validation/index": "src/validation/index.ts",
    "certification/index": "src/certification/index.ts",
    "workers/retarget.worker": "src/workers/retarget.worker.ts",
    "workers/node-tooling.worker": "src/workers/node-tooling.worker.ts",
  },
  format: ["esm"],
  target: "es2022",
  dts: true,
  // Keep each public entry self-contained. In particular, the browser entry's
  // import.meta.url must remain in dist/browser/index.js so its relative Worker
  // URL resolves to dist/workers/retarget.worker.js after packing.
  splitting: false,
  sourcemap: true,
  clean: true,
});
