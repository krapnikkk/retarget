#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
