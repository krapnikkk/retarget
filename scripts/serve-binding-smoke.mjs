#!/usr/bin/env node
// Real-browser verification of the built public entry. The separate package
// gate exercises the installed tarball and shipped worker layout.
import { createHash } from "node:crypto";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { build, createServer, preview } from "vite";
import { processHumanoidBinding } from "../dist/io.js";

const root = path.resolve(import.meta.dirname, "..");
const work = path.join(root, "references", "binding-browser");
const publicDir = path.join(work, "public");
await mkdir(publicDir, { recursive: true });
const fixtureServer = await createServer({ root, configFile: false, server: { middlewareMode: true },
  resolve: { alias: { "@": path.join(root, "src") } }, appType: "custom" });
try {
  const { bindingFixture } = await fixtureServer.ssrLoadModule("/tests/binding/fixtures.ts");
  const fixture = await bindingFixture({ keepSkeleton: true });
  const rig = await processHumanoidBinding(fixture.bytes, { operation: "use-rig", joints: fixture.joints });
  const skin = await processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: rig, expectedRevision: rig.revision });
  const output = await processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: skin, expectedRevision: skin.revision });
  await writeFile(path.join(publicDir, "input.glb"), new Uint8Array(fixture.bytes));
  await writeFile(path.join(publicDir, "fixture.json"), JSON.stringify({ joints: fixture.joints, snapshotRevision: skin.revision,
    sha256: createHash("sha256").update(output.bytes).digest("hex") }));
  await copyFile(path.join(root, "tests/fixtures/certification/golden-motion/motions/quaternius-walk/quaternius-walk.animation.glb"), path.join(publicDir, "walk.glb"));
} finally {
  await fixtureServer.close();
}
const config = { root: path.join(root, "tests/binding/browser"), configFile: false, publicDir,
  resolve: { alias: [
    { find: "@krapnik/retarget/browser", replacement: path.join(root, "dist/browser/index.js") },
    { find: "@krapnik/retarget", replacement: path.join(root, "dist/index.js") },
  ] },
  build: { outDir: path.join(work, "site"), emptyOutDir: true },
  preview: { host: "127.0.0.1", port: 4177, strictPort: true } };
await build(config);
const server = await preview(config);
server.printUrls();
console.log("Open the local page and press Run browser checks. This does not publish or upload assets.");
