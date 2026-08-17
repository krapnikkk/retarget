#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const publicSpecifiers = Object.keys(manifest.exports).map((subpath) =>
  subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`,
);
const pnpmCli = process.env.npm_execpath;

function runPnpm(args, cwd) {
  if (pnpmCli && existsSync(pnpmCli)) {
    return execFileSync(process.execPath, [pnpmCli, ...args], { cwd, stdio: "inherit" });
  }
  if (process.platform === "win32") {
    return execFileSync(process.env.ComSpec || "cmd.exe", [
      "/d", "/s", "/c", ["pnpm", ...args].join(" "),
    ], { cwd, stdio: "inherit" });
  }
  return execFileSync("pnpm", args, { cwd, stdio: "inherit" });
}

for (const target of Object.values(manifest.exports)) {
  for (const relative of [target.import, target.types]) {
    if (!existsSync(path.join(root, relative))) {
      throw new Error(`Missing packed entry ${relative}`);
    }
  }
}
for (const relative of new Set(
  Object.values(manifest.exports).map((target) => target.import),
)) {
  reportArtifactSize(relative);
}

const contractBoundaries = {
  "dist/index.d.ts": [/\bFile\b/, /AbortSignal/, /(?:three|gltf-transform)/],
  "dist/io.d.ts": [/\bFile\b/, /AbortSignal/, /(?:three|gltf-transform)/],
  "dist/node.d.ts": [/\bFile\b/, /(?:three|gltf-transform)/],
  "dist/browser/index.d.ts": [/(?:three|gltf-transform)/, /Object3D/],
  "dist/browser/input.d.ts": [/(?:three|gltf-transform)/, /Object3D/],
  "dist/validation/index.d.ts": [/\bFile\b/, /(?:three|gltf-transform)/, /Object3D/],
  "dist/certification/index.d.ts": [/\bFile\b/, /(?:three|gltf-transform)/, /Object3D/],
};
for (const [relative, forbidden] of Object.entries(contractBoundaries)) {
  const declaration = readFileSync(path.join(root, relative), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(declaration)) {
      throw new Error(`${relative} leaks forbidden public contract ${pattern}`);
    }
  }
}
for (const declarationPath of walkDeclarations(path.join(root, "dist"))) {
  const declaration = readFileSync(declarationPath, "utf8");
  if (/(?:from ['"]three['"]|gltf-transform|Object3D)/.test(declaration)) {
    throw new Error(
      `${path.relative(root, declarationPath)} exposes a scene/document dependency`,
    );
  }
}
if (!existsSync(path.join(root, "dist/workers/retarget.worker.js"))) {
  throw new Error("Missing bundled browser worker");
}
if (!existsSync(path.join(root, "dist/workers/input-preparation.worker.js"))) {
  throw new Error("Missing bundled input-preparation worker");
}
if (!existsSync(path.join(root, "dist/workers/node-tooling.worker.js"))) {
  throw new Error("Missing bundled Node tooling worker");
}
for (const relative of [
  "dist/workers/input-preparation.worker.js",
  "dist/workers/retarget.worker.js",
  "dist/workers/node-tooling.worker.js",
]) {
  reportArtifactSize(relative);
}
const browserEntry = readFileSync(path.join(root, "dist/browser/index.js"), "utf8");
const workerReference = 'new URL("../workers/retarget.worker.js", import.meta.url)';
if (!browserEntry.includes(workerReference)) {
  throw new Error("Browser entry does not contain the packed relative Worker URL");
}
const browserInputEntryPath = path.join(root, "dist/browser/input.js");
const browserInputEntry = readFileSync(browserInputEntryPath, "utf8");
const inputWorkerReference =
  'new URL("../workers/input-preparation.worker.js", import.meta.url)';
if (!browserEntry.includes(inputWorkerReference)) {
  throw new Error("Browser compatibility entry does not contain the input Worker URL");
}
if (!browserInputEntry.includes(inputWorkerReference)) {
  throw new Error("Browser input entry does not contain the packed relative Worker URL");
}
verifyInputIsolation(
  "dist/browser/input.js",
  browserInputEntry,
  JSON.parse(readFileSync(`${browserInputEntryPath}.map`, "utf8")).sources,
);
const inputWorkerPath = path.join(root, "dist/workers/input-preparation.worker.js");
verifyInputIsolation(
  "dist/workers/input-preparation.worker.js",
  readFileSync(inputWorkerPath, "utf8"),
  JSON.parse(readFileSync(`${inputWorkerPath}.map`, "utf8")).sources,
);

const temporaryRoot = mkdtempSync(path.join(tmpdir(), "3dretarget-package-"));
try {
  runPnpm(["pack", "--pack-destination", temporaryRoot], root);
  const tarball = path.join(temporaryRoot, `${manifest.name}-${manifest.version}.tgz`);
  if (!existsSync(tarball)) throw new Error(`Missing ${path.basename(tarball)}`);
  const tarballBytes = statSync(tarball).size;
  console.log(`[info] packed tarball ${path.basename(tarball)}: ${tarballBytes} bytes`);

  writeFileSync(path.join(temporaryRoot, "package.json"), `${JSON.stringify({
    name: "3dretarget-package-smoke",
    private: true,
    type: "module",
    dependencies: { [manifest.name]: `file:${tarball.replace(/\\/g, "/")}` },
  }, null, 2)}\n`);
  runPnpm(["install", "--ignore-scripts", "--prefer-offline"], temporaryRoot);
  writeFileSync(path.join(temporaryRoot, "smoke.mjs"), [
    `const specifiers = ${JSON.stringify(publicSpecifiers)};`,
    "for (const specifier of specifiers) await import(specifier);",
    "console.log(`[ok] imported ${specifiers.length} packed entries`);",
    "",
  ].join("\n"));
  execFileSync(process.execPath, [path.join(temporaryRoot, "smoke.mjs")], {
    cwd: temporaryRoot,
    stdio: "inherit",
  });
  writeFileSync(path.join(temporaryRoot, "browser-input-bundle.ts"), [
    'import { prepareBrowserAssetInput } from "3dretarget/browser/input";',
    'export const prepare = prepareBrowserAssetInput;',
    '',
  ].join("\n"));
  const packedInputBundle = await viteBuild({
    root: temporaryRoot,
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      target: "es2022",
      rollupOptions: {
        input: path.join(temporaryRoot, "browser-input-bundle.ts"),
      },
    },
  });
  const packedInputOutputs = (Array.isArray(packedInputBundle)
    ? packedInputBundle.flatMap((result) => result.output)
    : packedInputBundle.output);
  const packedInputCode = packedInputOutputs.map((output) =>
    output.type === "chunk"
      ? output.code
      : typeof output.source === "string"
        ? output.source
        : Buffer.from(output.source).toString("utf8")
  ).join("\n");
  const packedInputModules = packedInputOutputs.flatMap((output) =>
    output.type === "chunk" ? Object.keys(output.modules) : []
  );
  const packedInputBytes = packedInputOutputs.reduce(
    (total, output) => total + (output.type === "chunk"
      ? Buffer.byteLength(output.code)
      : typeof output.source === "string"
        ? Buffer.byteLength(output.source)
        : output.source.byteLength),
    0,
  );
  verifyInputIsolation(
    "packed browser-input production bundle",
    packedInputCode,
    packedInputModules,
  );
  if (!packedInputCode.includes("input-preparation.worker")) {
    throw new Error("Packed browser-input production bundle lost its Worker URL");
  }
  console.log(
    `[ok] production-bundled packed browser input (${packedInputBytes} bytes) without unrelated format runtimes`,
  );
  writeFileSync(path.join(temporaryRoot, "node-tooling-smoke.mjs"), [
    'import { runNodeToolJob } from "3dretarget/node";',
    'const motion = {',
    '  schemaVersion: 2, rigDefinitionId: "humanoid-v1", family: "humanoid",',
    '  name: "packed-node-tool", duration: 1, fps: 30, createdAt: "2026-08-14T00:00:00.000Z",',
    '  source: { kind: "gltf-animation", filename: "packed.glb", profileId: "canonical-humanoid-v1", rigSignature: "packed", animation: { index: 0, name: "Packed", interpolationModes: ["LINEAR"], resampledTracks: 0 } },',
    '  restPose: [{ role: "hips", nodeName: "hips", translation: [0, 0, 0], rotation: [0, 0, 0, 1], worldTranslation: [0, 0, 0], worldRotation: [0, 0, 0, 1] }],',
    '  tracks: [{ role: "hips", path: "translation", times: [0, 1], values: [0, 0, 0, 0, 0, 0] }],',
    '};',
    'const task = { type: "export-rig-motion-gltf", artifactName: "packed.glb", motion };',
    'const first = await runNodeToolJob(task);',
    'const second = await runNodeToolJob(task);',
    'if (!first.ok || !second.ok || first.result.validation.structural.status !== "passed" || first.result.validation.semantic.status !== "passed") throw new Error(`packed Node tooling failed: ${JSON.stringify(first)}`);',
    'if (first.result.artifact.sha256 !== second.result.artifact.sha256) throw new Error("packed Node tooling output is not deterministic");',
    'const controller = new AbortController();',
    'let sawActiveProgress = false;',
    'const cancelled = await runNodeToolJob(task, { signal: controller.signal, onProgress(progress) { if (progress.phase === "author") { sawActiveProgress = true; controller.abort(); } } });',
    'if (!sawActiveProgress || cancelled.ok || cancelled.error.code !== "OPERATION_CANCELLED") throw new Error("packed Node tooling in-flight cancellation failed");',
    'console.log("[ok] executed packed Node tooling author/validate/determinism/cancellation flow");',
    '',
  ].join("\n"));
  execFileSync(process.execPath, [path.join(temporaryRoot, "node-tooling-smoke.mjs")], {
    cwd: temporaryRoot,
    stdio: "inherit",
  });
  writeFileSync(path.join(temporaryRoot, "worker-wrapper.mjs"), [
    'import { parentPort, workerData } from "node:worker_threads";',
    'globalThis.self = {',
    '  addEventListener(type, listener) {',
    '    if (type === "message") parentPort.on("message", (data) => listener({ data }));',
    '  },',
    '  postMessage(message, transfer = []) { parentPort.postMessage(message, transfer); },',
    '};',
    'await import(workerData.workerUrl);',
    'parentPort.postMessage({ type: "wrapper-ready" });',
    '',
  ].join("\n"));
  writeFileSync(path.join(temporaryRoot, "worker-smoke.mjs"), [
    'import { Worker } from "node:worker_threads";',
    'import path from "node:path";',
    'import { fileURLToPath, pathToFileURL } from "node:url";',
    'const browserEntry = fileURLToPath(import.meta.resolve("3dretarget/browser"));',
    'const workerUrl = pathToFileURL(path.resolve(path.dirname(browserEntry), "../workers/retarget.worker.js")).href;',
    'const worker = new Worker(new URL("./worker-wrapper.mjs", import.meta.url), { workerData: { workerUrl } });',
    'const receive = (predicate, timeoutMs = 10000) => new Promise((resolve, reject) => {',
    '  const timeout = setTimeout(() => reject(new Error("packed Worker smoke timed out")), timeoutMs);',
    '  const onMessage = (message) => {',
    '    if (!predicate(message)) return;',
    '    clearTimeout(timeout);',
    '    worker.off("message", onMessage);',
    '    resolve(message);',
    '  };',
    '  worker.on("message", onMessage);',
    '});',
    'try {',
    '  await receive((message) => message?.type === "wrapper-ready");',
    '  const source = new TextEncoder().encode([',
    '    "HIERARCHY",',
    '    "ROOT Hips",',
    '    "{",',
    '    "  OFFSET 0 1 0",',
    '    "  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation",',
    '    "  End Site",',
    '    "  {",',
    '    "    OFFSET 0 1 0",',
    '    "  }",',
    '    "}",',
    '    "MOTION",',
    '    "Frames: 1",',
    '    "Frame Time: 0.0333333",',
    '    "0 0 0 0 0 0",',
    '  ].join("\\n"));',
    '  const resultPromise = receive((message) => message?.jobId === "package-worker-smoke" && message.type !== "progress");',
    '  worker.postMessage({',
    '    schemaVersion: 2,',
    '    jobId: "package-worker-smoke",',
    '    deadlineMs: 5000,',
    '    task: { type: "import-motion", formatId: "bvh", filename: "smoke.bvh", bytes: source.buffer },',
    '  }, [source.buffer]);',
    '  const response = await resultPromise;',
    '  if (response.schemaVersion !== 2 || response.type !== "success" || !Array.isArray(response.result?.tracks)) {',
    '    throw new Error(`packed Worker failed: ${JSON.stringify(response)}`);',
    '  }',
    '  console.log("[ok] executed packed Worker request/result flow");',
    '} finally {',
    '  await worker.terminate();',
    '}',
    '',
  ].join("\n"));
  execFileSync(process.execPath, [path.join(temporaryRoot, "worker-smoke.mjs")], {
    cwd: temporaryRoot,
    stdio: "inherit",
  });
  writeFileSync(path.join(temporaryRoot, "smoke.ts"), [
    'import { createRetargetError, formats, type CanonicalHumanoidMotionClip } from "3dretarget";',
    'import { importBVH, importGLTFAnimationBytes } from "3dretarget/io";',
    'import { runNodeToolJob, runRetargetJobInline, type NodeToolTask } from "3dretarget/node";',
    'import { getRetargetPipeline, prepareBrowserAssetInput as prepareBrowserAssetInputCompat, runRetargetJob, runRiggedGLTFPipeline } from "3dretarget/browser";',
    'import { prepareBrowserAssetInput, type BrowserInputSelection } from "3dretarget/browser/input";',
    'import { validateHumanoidMotionSemantics } from "3dretarget/validation";',
    'import { HUMANOID_PIPELINE_CERTIFICATION, NON_HUMANOID_PIPELINE_CERTIFICATION, getNonHumanoidBetaPromotions } from "3dretarget/certification";',
    'void [createRetargetError, formats, importBVH, importGLTFAnimationBytes];',
    'void [runNodeToolJob, runRetargetJobInline, runRetargetJob, prepareBrowserAssetInputCompat];',
    'const nodeToolTask: NodeToolTask = { type: "validate-artifact", artifactName: "typing.vrm", bytes: new ArrayBuffer(0), format: "vrm" };',
    'runNodeToolJob(nodeToolTask).then((result) => { if (!result.ok) { const code: import("3dretarget").RetargetError["code"] = result.error.code; void code; } });',
    'type RiggedPipelineOutput = Awaited<ReturnType<typeof runRiggedGLTFPipeline>>["output"];',
    'const riggedOutputFormat: RiggedPipelineOutput["format"] = "animated-glb";',
    'void [runRiggedGLTFPipeline, riggedOutputFormat];',
    'const betaPipeline = getRetargetPipeline("gltf-animation", "gltf-humanoid", "animated-glb");',
    'const betaAssurance: "beta" | "experimental" | "certified" | undefined = betaPipeline?.assurance;',
    'void [betaAssurance, betaPipeline?.run];',
    'void [validateHumanoidMotionSemantics, HUMANOID_PIPELINE_CERTIFICATION, NON_HUMANOID_PIPELINE_CERTIFICATION, getNonHumanoidBetaPromotions];',
    'const clip: CanonicalHumanoidMotionClip | undefined = undefined;',
    'void clip;',
    'const inferredJob = runRetargetJob({ type: "import-motion", formatId: "bvh", filename: "typing.bvh", bytes: new ArrayBuffer(0) });',
    'inferredJob.then((result) => { const duration: number = result.duration; void duration; });',
    'const preparedInput = prepareBrowserAssetInput(new File([], "renamed.input"), { role: "motion", budget: { maxProbeBytes: 4096 }, onProgress: ({ phase }) => { const stablePhase: "discover" | "read" | "probe" | "unpack" | "resolve" | "complete" = phase; void stablePhase; } });',
    'preparedInput.then((prepared) => { const selection: BrowserInputSelection = prepared.selection; prepared.dispose(); void selection; });',
    '',
  ].join("\n"));
  const tsc = path.join(root, "node_modules/typescript/bin/tsc");
  execFileSync(process.execPath, [
    tsc,
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "smoke.ts",
  ], { cwd: temporaryRoot, stdio: "inherit" });
  console.log("[ok] type-checked packed consumer contract");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function reportArtifactSize(relative) {
  console.log(`[info] package artifact ${relative}: ${statSync(path.join(root, relative)).size} bytes`);
}

function walkDeclarations(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkDeclarations(absolute);
    return entry.isFile() && entry.name.endsWith(".d.ts") ? [absolute] : [];
  });
}

function verifyInputIsolation(label, code, sources = []) {
  const forbiddenCode = [
    /@moeru\/three-mmd/,
    /\bVmdObject\b/,
    /\bFBXLoader\b/,
    /AmmoFactory|ammo\.wasm/i,
    /executeRetargetJob/,
  ];
  for (const pattern of forbiddenCode) {
    if (pattern.test(code)) {
      throw new Error(`${label} contains unrelated runtime marker ${pattern}`);
    }
  }
  const forbiddenSource = [
    /@moeru\/three-mmd/,
    /src[\\/]import[\\/]vmd/,
    /src[\\/]import[\\/]fbx-motion/,
    /FBXLoader/,
    /execute-retarget-job/,
    /dist[\\/]browser[\\/]index\.js/,
    /retarget\.worker/,
  ];
  for (const source of sources) {
    for (const pattern of forbiddenSource) {
      if (pattern.test(source)) {
        throw new Error(`${label} includes unrelated module ${source}`);
      }
    }
  }
}
