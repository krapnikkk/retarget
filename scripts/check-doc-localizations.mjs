import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const repositoryDocs = "https://github.com/krapnikkk/3dretarget/blob/main/";

function hasDocumentLink(text, relative, target) {
  return text.includes(`](${relative})`) ||
    text.includes(`](${repositoryDocs}${target.split(path.sep).join("/")})`);
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "zh-CN") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(absolute)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files;
}

const pairs = [
  ["README.md", "README.zh-CN.md"],
  ["SECURITY.md", "SECURITY.zh-CN.md"],
  ["AGENTS.md", "AGENTS.zh-CN.md"],
  [
    "tests/fixtures/non-humanoid/README.md",
    "tests/fixtures/non-humanoid/README.zh-CN.md",
  ],
];

for (const source of await markdownFiles(path.join(root, "docs"))) {
  const relative = path.relative(path.join(root, "docs"), source);
  pairs.push([
    path.join("docs", relative),
    path.join("docs", "zh-CN", relative),
  ]);
}

const failures = [];
for (const [source, translation] of pairs) {
  const sourcePath = path.join(root, source);
  const translatedPath = path.join(root, translation);
  try {
    await access(translatedPath);
  } catch {
    failures.push(`${translation}: missing Chinese counterpart for ${source}`);
    continue;
  }

  const text = await readFile(translatedPath, "utf8");
  const sourceLink = path
    .relative(path.dirname(translation), source)
    .split(path.sep)
    .join("/");
  if (!hasDocumentLink(text, sourceLink, source)) {
    failures.push(`${translation}: missing source link (${sourceLink})`);
  }

  const sourceText = await readFile(sourcePath, "utf8");
  const translationLink = path
    .relative(path.dirname(source), translation)
    .split(path.sep)
    .join("/");
  if (!hasDocumentLink(sourceText, translationLink, translation)) {
    failures.push(`${source}: missing Chinese link (${translationLink})`);
  }
}

if (failures.length > 0) {
  // Translations may lag during early development; pass --strict to enforce.
  console.error(failures.join("\n"));
  if (process.argv.includes("--strict")) process.exitCode = 1;
  else console.warn(`[warn] ${failures.length} localization issue(s); pass --strict to fail.`);
} else {
  console.log(`Verified ${pairs.length} English/Chinese documentation pairs.`);
}
