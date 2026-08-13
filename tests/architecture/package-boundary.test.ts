import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const forbiddenImports = [
  "react",
  "next",
  "next-intl",
  "@/components",
  "@/i18n",
  "@/market",
  "@/site",
];

describe("package boundary", () => {
  it("does not import the web application", () => {
    const files = walk(path.resolve("src"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of forbiddenImports) {
        expect(source, `${path.relative(process.cwd(), file)} imports ${forbidden}`)
          .not.toContain(`from "${forbidden}`);
      }
    }
  });
});

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.isFile() && entry.name.endsWith(".ts") ? [absolute] : [];
  });
}
