import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Viewers load @krapnik/retarget/profiles to recognize a rig without
// downloading the engine. Everything its runtime code can reach must be a
// profile module or one of these bone-table leaves.
const ALLOWED_MODULES = new Set([
  "src/profiles-entry.ts",
  "src/retarget/humanoid-bones.ts",
  "src/retarget/humanoid.ts",
]);
const ALLOWED_DIRECTORY = "src/profiles/";

const root = process.cwd();
const compilerOptions = ts.parseJsonConfigFileContent(
  ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile).config,
  ts.sys,
  root,
).options;

describe("@krapnik/retarget/profiles entry", () => {
  it("reaches only profile modules and bone tables at runtime", () => {
    const { modules, packages } = collectRuntimeGraph("src/profiles-entry.ts");

    expect(packages, "package imports").toEqual([]);
    const outside = modules.filter(
      (file) => !ALLOWED_MODULES.has(file) && !file.startsWith(ALLOWED_DIRECTORY),
    );
    expect(outside, "modules outside the profiles boundary").toEqual([]);
    expect(modules).toContain("src/profiles/humanoid.ts");
  });

  it("matches the root namespaces it duplicates", async () => {
    const entry = await import("@/profiles-entry");
    const { profiles, retarget } = await import("@/index");

    for (const [name, value] of Object.entries(profiles)) {
      expect(entry, name).toHaveProperty(name, value);
    }
    expect(entry.HUMANOID_BONES).toBe(retarget.HUMANOID_BONES);
    expect(entry.REQUIRED_VRM_BONES).toBe(retarget.REQUIRED_VRM_BONES);
    expect(entry.MIXAMO_BONE_MAP).toBe(retarget.MIXAMO_BONE_MAP);
    expect(entry.getRigProfile("vrm-humanoid")).toBe(entry.VRM_HUMANOID_PROFILE);
  });
});

// Follows imports that survive compilation: `import type`, `export type` and
// imports whose bindings are all type-only are erased, so they cannot pull
// runtime code into the bundle.
function collectRuntimeGraph(entry: string) {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const pending = [path.join(root, entry)];
  while (pending.length > 0) {
    const file = pending.pop()!;
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (modules.has(relative)) continue;
    modules.add(relative);
    for (const specifier of runtimeSpecifiers(file)) {
      const resolved = ts.resolveModuleName(specifier, file, compilerOptions, ts.sys)
        .resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) {
        packages.add(specifier);
      } else {
        pending.push(path.resolve(resolved.resolvedFileName));
      }
    }
  }
  return { modules: [...modules].sort(), packages: [...packages].sort() };
}

function runtimeSpecifiers(file: string) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !isTypeOnly(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function isTypeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration) {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true;
    const clause = node.exportClause;
    return (
      clause !== undefined &&
      ts.isNamedExports(clause) &&
      clause.elements.length > 0 &&
      clause.elements.every((element) => element.isTypeOnly)
    );
  }
  const clause = node.importClause;
  if (!clause) return false; // side-effect import
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}
