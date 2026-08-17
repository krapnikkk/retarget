#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const configPath = path.join(root, "tsconfig.json");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
}
const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  root,
  undefined,
  configPath,
);
const rules = [
  {
    sourceLayers: [
      "core",
      "profiles",
      "retarget",
      "rig-motion",
      "rigs",
      "solvers",
      "validation",
    ],
    forbiddenLayers: new Set([
      "adapters",
      "browser",
      "export",
      "jobs",
      "node-tooling",
      "pipelines",
      "workers",
    ]),
  },
  {
    sourceLayers: ["import"],
    forbiddenLayers: new Set(["export"]),
  },
];
const violations = [];
let checkedFiles = 0;

for (const rule of rules) {
  for (const sourceLayer of rule.sourceLayers) {
    for (const filename of walkTypeScript(path.join(sourceRoot, sourceLayer))) {
      checkedFiles += 1;
      const source = readFileSync(filename, "utf8");
      const imports = ts.preProcessFile(source, true, true).importedFiles;
      for (const imported of imports) {
        const resolved = ts.resolveModuleName(
          imported.fileName,
          filename,
          parsedConfig.options,
          ts.sys,
        ).resolvedModule?.resolvedFileName;
        if (!resolved) continue;
        const targetLayer = getSourceLayer(resolved);
        if (targetLayer && rule.forbiddenLayers.has(targetLayer)) {
          violations.push(
            `${path.relative(root, filename)} imports forbidden ${targetLayer} layer via ${imported.fileName}`,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Architecture boundary violations:\n${violations.join("\n")}`);
}
console.log(
  `Verified ${checkedFiles} TypeScript files using resolved architecture dependencies.`,
);

function getSourceLayer(filename) {
  const relative = path.relative(sourceRoot, filename);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep)[0] ?? null;
}

function* walkTypeScript(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkTypeScript(absolute);
    else if (entry.isFile() && entry.name.endsWith(".ts")) yield absolute;
  }
}
