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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const sizeBaseline = JSON.parse(
  readFileSync(path.join(root, "scripts/package-size-baseline.json"), "utf8"),
);
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
for (const [relative, maxBytes] of Object.entries(sizeBaseline.entries)) {
  const bytes = readFileSync(path.join(root, relative)).byteLength;
  if (bytes > maxBytes) {
    throw new Error(`${relative} is ${bytes} bytes; local baseline allows ${maxBytes}`);
  }
}

const contractBoundaries = {
  "dist/index.d.ts": [/\bFile\b/, /AbortSignal/, /(?:three|gltf-transform)/],
  "dist/io.d.ts": [/\bFile\b/, /AbortSignal/, /(?:three|gltf-transform)/],
  "dist/node.d.ts": [/\bFile\b/, /(?:three|gltf-transform)/],
  "dist/browser/index.d.ts": [/(?:three|gltf-transform)/, /Object3D/],
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
const browserEntry = readFileSync(path.join(root, "dist/browser/index.js"), "utf8");
const workerReference = 'new URL("../workers/retarget.worker.js", import.meta.url)';
if (!browserEntry.includes(workerReference)) {
  throw new Error("Browser entry does not contain the packed relative Worker URL");
}

const temporaryRoot = mkdtempSync(path.join(tmpdir(), "3dretarget-package-"));
try {
  runPnpm(["pack", "--pack-destination", temporaryRoot], root);
  const tarball = path.join(temporaryRoot, `${manifest.name}-${manifest.version}.tgz`);
  if (!existsSync(tarball)) throw new Error(`Missing ${path.basename(tarball)}`);
  const tarballBytes = statSync(tarball).size;
  if (tarballBytes > sizeBaseline.packageTarballMaxBytes) {
    throw new Error(
      `${path.basename(tarball)} is ${tarballBytes} bytes; local baseline allows ${sizeBaseline.packageTarballMaxBytes}`,
    );
  }

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
    '    jobId: "package-worker-smoke",',
    '    deadlineMs: 5000,',
    '    task: { type: "import-motion", formatId: "bvh", filename: "smoke.bvh", bytes: source.buffer },',
    '  }, [source.buffer]);',
    '  const response = await resultPromise;',
    '  if (response.type !== "success" || !Array.isArray(response.result?.tracks)) {',
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
    'import { runRetargetJobInline } from "3dretarget/node";',
    'import { getRetargetPipeline, runRetargetJob, runRiggedGLTFPipeline } from "3dretarget/browser";',
    'import { validateHumanoidMotionSemantics } from "3dretarget/validation";',
    'import { HUMANOID_PIPELINE_CERTIFICATION, NON_HUMANOID_PIPELINE_CERTIFICATION, getNonHumanoidBetaPromotions } from "3dretarget/certification";',
    'void [createRetargetError, formats, importBVH, importGLTFAnimationBytes];',
    'void [runRetargetJobInline, runRetargetJob];',
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

function walkDeclarations(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkDeclarations(absolute);
    return entry.isFile() && entry.name.endsWith(".d.ts") ? [absolute] : [];
  });
}
