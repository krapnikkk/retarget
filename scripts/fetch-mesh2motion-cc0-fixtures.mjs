import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_REPOSITORY = "https://github.com/Mesh2Motion/mesh2motion-app";
const SOURCE_COMMIT = "a9bf18a6007d7e12d197657f023f77a5e33473fe";
const RAW_ROOT = `https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/${SOURCE_COMMIT}`;
const OUTPUT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/non-humanoid/mesh2motion",
);
const CHECK_ONLY = process.argv.includes("--check");

const FIXTURES = [
  fixture("LICENSE-CC0.MD", "LICENSE-CC0.md", "52fec1c484df708c16b4c27b2bf0d7f0d3994105c57adc4b9e6f95bcfd9de65f"),
  fixture("static/animations/fox-animations.glb", "fox-animations.glb", "1e01b7c224fa135ead67978a0840d115e99a959f9f745384e7b308f173dfebf2"),
  fixture("static/models-variation/fox-base.glb", "fox-base.glb", "df056636ba771c1ab76f4dd1cfed6931a9d430352709e62e7a3691351041f056"),
  fixture("static/models-variation/fox-dog.glb", "fox-dog.glb", "b7eed87d95d91eb05605cefd591e5931c52f1152305db5337335ce792138678b"),
  fixture("static/models-variation/fox-horse.glb", "fox-horse.glb", "435b20d31234ab11da3242d30df1464d70a39221f801d13e0ddb87deff118fde"),
  fixture("static/animations/bird-animations.glb", "bird-animations.glb", "9624b0bf70abe400ed0445c2423c69d5e046bd7d60074e399e2be161763c4f99"),
  fixture("static/models-variation/bird-eagle.glb", "bird-eagle.glb", "8321c6df6ddba0a17e204e7ba704f65d3737e7677cb9682d62a6ea2befca9e56"),
  fixture("static/animations/snake-animations.glb", "snake-animations.glb", "795e4c62ba1e02f3f33e900832cdc6a1ca5a4aa4f6fe426fccd3aaa0f7f6ac25"),
  fixture("static/models/model-snake.glb", "snake-target.glb", "07fd75c7b6645247f4d0545e2355aadf1ddf5357387041a1aa4d5eaa12668cdc"),
  fixture("static/animations/spider-animations.glb", "spider-animations.glb", "a321c1617c7f74cf86c050694bc254e74409c6c69db26fe542338f2f7c43d07a"),
  fixture("static/models/model-spider.glb", "spider-target.glb", "7c2e298c101f74956153b5932e3667b537c824f28e472f6c8e3df0c45f1950c7"),
  fixture("static/animations/dragon-animations.glb", "dragon-animations.glb", "73262041b09aa0499778818162b34955e76e17548212825548799643d5c925b3"),
  fixture("static/models/model-dragon.glb", "dragon-target.glb", "4ea7600bdad99d234bfb21396e597b41ba36732ee22592a7894b96664fd01c39"),
];

await mkdir(OUTPUT_ROOT, { recursive: true });

if (CHECK_ONLY) {
  for (const item of FIXTURES) {
    const bytes = await readFile(path.join(OUTPUT_ROOT, item.output));
    assertHash(item, bytes);
  }
  const manifest = JSON.parse(
    await readFile(path.join(OUTPUT_ROOT, "provenance.json"), "utf8"),
  );
  if (
    manifest.sourceRepository !== SOURCE_REPOSITORY ||
    manifest.sourceCommit !== SOURCE_COMMIT
  ) {
    throw new Error("Mesh2Motion fixture provenance does not match the pin.");
  }
  console.log(`Verified ${FIXTURES.length} pinned Mesh2Motion CC0 fixtures.`);
  process.exit(0);
}

for (const item of FIXTURES) {
  const response = await fetch(`${RAW_ROOT}/${encodeURI(item.source)}`);
  if (!response.ok) {
    throw new Error(`Failed to download ${item.source}: HTTP ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  assertHash(item, bytes);
  await writeFile(path.join(OUTPUT_ROOT, item.output), bytes);
  console.log(`Fetched ${item.output}.`);
}

await writeFile(
  path.join(OUTPUT_ROOT, "provenance.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      sourceRepository: SOURCE_REPOSITORY,
      sourceCommit: SOURCE_COMMIT,
      license: "CC0-1.0",
      files: FIXTURES.map(({ source, output, sha256 }) => ({
        source,
        output,
        sha256,
      })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Wrote provenance for ${FIXTURES.length} pinned fixtures.`);

function fixture(source, output, sha256) {
  return { source, output, sha256 };
}

function assertHash(item, bytes) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== item.sha256) {
    throw new Error(
      `${item.output} SHA-256 mismatch: expected ${item.sha256}, got ${actual}.`,
    );
  }
}
