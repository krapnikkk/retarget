#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const domainDirectories = [
  "core",
  "profiles",
  "retarget",
  "rig-motion",
  "rigs",
  "solvers",
  "validation",
];
const forbiddenLayers = /^(?:@\/)?(?:browser|pipelines|adapters|jobs|node-tooling|workers|export)(?:\/|$)/;
const importPattern = /\b(?:from\s+|import\s*(?:\(\s*)?)["']([^"']+)["']/g;
const violations = [];

for (const directory of domainDirectories) {
  for (const filename of walkTypeScript(path.join(root, "src", directory))) {
    const source = readFileSync(filename, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier && forbiddenLayers.test(specifier)) {
        violations.push(
          `${path.relative(root, filename)} imports forbidden outer layer ${specifier}`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Architecture boundary violations:\n${violations.join("\n")}`);
}
console.log(`Verified domain-layer imports across ${domainDirectories.length} directories.`);

function* walkTypeScript(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkTypeScript(absolute);
    else if (entry.isFile() && entry.name.endsWith(".ts")) yield absolute;
  }
}
