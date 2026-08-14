#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(path.join(root, ".git"))) {
  throw new Error("Local Git hooks can only be installed from a repository checkout.");
}

execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  cwd: root,
  stdio: "inherit",
});
console.log("Configured core.hooksPath=.githooks for this checkout.");
