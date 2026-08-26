#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptRoot = path.join(root, "scripts", "ecosystem");
const pins = readJSON(path.join(scriptRoot, "runtime-pins.json"));
const manifest = readJSON(
  path.join(root, "src", "certification", "golden-motion-v1.json"),
);
const certificationCase = manifest.cases.find((item) => item.id === pins.caseId);
if (!certificationCase) {
  throw new Error(`Missing certification case ${pins.caseId}`);
}

const mode = process.argv[2];
const binding = process.argv.includes("--binding");
const bindingManifest = binding ? readJSON(path.join(root, "tests/binding/manifest.json")) : undefined;
if (mode !== "--check" && mode !== "--update") {
  throw new Error("Use --check or --update.");
}

const blender = findBlender();
const godot = findGodot();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "3dretarget-ecosystem-"));

try {
  if (binding) runPnpm(["exec", "vitest", "run", "tests/binding/ecosystem.test.ts"], {
    ...process.env, RETARGET_BINDING_ARTIFACT_DIR: temporaryRoot,
  });
  for (const caseId of binding ? bindingManifest.cases.map((entry) => entry.id) : [pins.caseId]) {
  const artifactPath = path.join(temporaryRoot, binding ? `${caseId}.animated.glb` : pins.artifactFilename);
  if (!binding) {
  runPnpm(
    ["exec", "vitest", "run", "tests/certification/generate-ecosystem-artifact.test.ts"],
    {
      ...process.env,
      RETARGET_ECOSYSTEM_ARTIFACT_PATH: artifactPath,
    },
  );
  }
  const artifactBytes = readFileSync(artifactPath);
  const artifactSha256 = sha256(artifactBytes);

  const blenderResultPath = path.join(temporaryRoot, "blender-result.json");
  execFileSync(
    blender,
    [
      "--background",
      "--factory-startup",
      "--python",
      path.join(scriptRoot, "verify-blender.py"),
      "--",
      artifactPath,
      blenderResultPath,
      pins.blender.version,
      pins.blender.buildHash,
      ...(binding ? ["--require-deformation"] : []),
    ],
    inheritedExecutionOptions(),
  );
  const blenderResult = readJSON(blenderResultPath);

  const godotProject = path.join(temporaryRoot, "godot-project");
  mkdirSync(godotProject, { recursive: true });
  copyFileSync(
    path.join(scriptRoot, "godot", "project.godot"),
    path.join(godotProject, "project.godot"),
  );
  copyFileSync(
    path.join(scriptRoot, "godot", "verify.gd"),
    path.join(godotProject, "verify.gd"),
  );
  copyFileSync(artifactPath, path.join(godotProject, "artifact.glb"));
  execFileSync(
    godot,
    ["--headless", "--path", godotProject, "--import"],
    inheritedExecutionOptions(),
  );
  execFileSync(
    godot,
    [
      "--headless",
      "--path",
      godotProject,
      "--script",
      "res://verify.gd",
      "--",
      "res://artifact.glb",
      "res://godot-result.json",
      pins.godot.version,
      pins.godot.buildHash,
    ],
    inheritedExecutionOptions(),
  );
  const godotResult = readJSON(path.join(godotProject, "godot-result.json"));

  for (const result of [blenderResult, godotResult]) {
    if (result.status !== "passed") {
      throw new Error(`${result.runtime} ecosystem verification did not pass.`);
    }
    if (result.artifactSha256 !== artifactSha256) {
      throw new Error(`${result.runtime} verified a different artifact hash.`);
    }
  }

  const receipt = binding ? {
    schemaVersion: 1, caseId,
    evidence: readJSON(path.join(temporaryRoot, `${caseId}.evidence.json`)),
    requiredRuntimes: ["blender", "godot"],
    runtimes: { blender: blenderResult, godot: godotResult }, status: "passed",
  } : {
    schemaVersion: 1,
    caseId: certificationCase.id,
    pipeline: {
      motionFormat: certificationCase.motionFormat,
      avatarFormat: certificationCase.avatarFormat,
      exportFormat: certificationCase.exportFormat,
      executionMode: certificationCase.executionMode,
      rigDetectionMode: certificationCase.rigDetectionMode,
      solverRevision: certificationCase.solverRevision,
      targetBindingRevision: certificationCase.targetBindingRevision,
    },
    inputs: {
      sourceSha256: certificationCase.source.sha256,
      avatarSha256: certificationCase.avatar.sha256,
    },
    artifact: {
      filename: pins.artifactFilename,
      byteLength: artifactBytes.byteLength,
      sha256: artifactSha256,
    },
    requiredRuntimes: ["blender", "godot"],
    runtimes: {
      blender: blenderResult,
      godot: godotResult,
      unity: pins.unity,
    },
    status: "passed",
  };
  const serialized = stableJSON(receipt);
  const relativeReceiptPath = binding ? `tests/binding/receipts/${caseId}.json` : pins.receiptPath;
  const receiptPath = path.join(root, ...relativeReceiptPath.split("/"));

  if (mode === "--update") {
    mkdirSync(path.dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, serialized);
    console.log(
      `[updated] ${relativeReceiptPath} sha256=${sha256(Buffer.from(serialized))}`,
    );
  } else {
    if (!existsSync(receiptPath)) {
      throw new Error(`Missing pinned ecosystem receipt ${relativeReceiptPath}`);
    }
    const current = readFileSync(receiptPath, "utf8");
    if (current !== serialized) {
      throw new Error(
        `Pinned ecosystem receipt is stale; run pnpm ${binding ? "update:binding:ecosystem" : "update:ecosystem-receipt"}.`,
      );
    }
    console.log(
      `[ok] verified Blender ${blenderResult.version} and Godot ${godotResult.version}`,
    );
    console.log(`[ok] artifact sha256=${artifactSha256}`);
  }
  }
} finally {
  const resolvedTemporary = path.resolve(temporaryRoot);
  if (path.dirname(resolvedTemporary) !== path.resolve(tmpdir()) || !path.basename(resolvedTemporary).startsWith("3dretarget-ecosystem-")) {
    throw new Error("Refusing to remove an unexpected ecosystem temporary directory.");
  }
  rmSync(resolvedTemporary, { recursive: true, force: true });
}

function runPnpm(args, env) {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli && existsSync(pnpmCli)) {
    return execFileSync(process.execPath, [pnpmCli, ...args], {
      cwd: root,
      env,
      stdio: "inherit",
    });
  }
  if (process.platform === "win32") {
    return execFileSync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", ["pnpm", ...args].join(" ")],
      { cwd: root, env, stdio: "inherit" },
    );
  }
  return execFileSync("pnpm", args, { cwd: root, env, stdio: "inherit" });
}

function findBlender() {
  const candidates = [
    process.env[pins.blender.executableEnvironmentVariable],
    process.platform === "win32"
      ? "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe"
      : undefined,
    findOnPath("blender"),
  ];
  return requireExecutable("Blender", candidates);
}

function findGodot() {
  const candidates = [
    process.env[pins.godot.executableEnvironmentVariable],
    findOnPath("godot"),
    findOnPath("godot4"),
    ...findWindowsGodotPackages(),
  ];
  return requireExecutable("Godot", candidates);
}

function findWindowsGodotPackages() {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return [];
  const packagesRoot = path.join(
    process.env.LOCALAPPDATA,
    "Microsoft",
    "WinGet",
    "Packages",
  );
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("GodotEngine."))
    .flatMap((entry) => {
      const packagePath = path.join(packagesRoot, entry.name);
      return readdirSync(packagePath)
        .filter((name) => /godot.*console\.exe$/i.test(name))
        .map((name) => path.join(packagePath, name));
    });
}

function findOnPath(command) {
  try {
    const locator = process.platform === "win32" ? "where.exe" : "which";
    return execFileSync(locator, [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .find(Boolean);
  } catch {
    return undefined;
  }
}

function requireExecutable(label, candidates) {
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) {
    throw new Error(`${label} executable was not found. Use the configured environment override.`);
  }
  return executable;
}

function inheritedExecutionOptions() {
  return {
    cwd: root,
    stdio: "inherit",
    maxBuffer: 32 * 1024 * 1024,
  };
}

function readJSON(filename) {
  return JSON.parse(readFileSync(filename, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJSON(value) {
  return JSON.stringify(sortValue(value), null, 2) + "\n";
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}
