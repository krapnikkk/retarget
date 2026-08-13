import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const corpusRoot = path.resolve("references", "mmd", "research-corpus");
const checkOnly = process.argv.includes("--check");
const force = process.argv.includes("--force");

const sources = [
  {
    id: "mmdagent-gene",
    repository: "mmdagent-ex/gene",
    commit: "c7eace43dffaccff6ad0597433ef85fa57c91e03",
    license: "CC-BY-4.0 with separate trademark and design-right notice",
    sourceUrl: "https://github.com/mmdagent-ex/gene",
    files: [
      file("README.md", 6177, "9f908548d7b8e17797dc8cf18a8b4dd74b4dfe5cc441fd14889c8bf3d88cdd49"),
      file("README.ja.md", 7854, "f2213e21deef6893e9c71aaaf50a75343dd44d8af2e29c3bda887a7963642e07"),
      file("Gene_light.pmx", 2814276, "7ce1902e0c834a79db7070c50dcb6444d73d734f6725cad35ea25aa2dbeca4b3"),
      file("Gene_light.pmd", 2721078, "cebc55b46005ff02a6d24f4a5f1faa541153d21cc4d98ded50e5065a902d9c89"),
      file("light/arm.png", 407020, "f0e877599fc6a95c0acfbce15298a55698651306643b66540fdb5fe03b6f10f0"),
      file("light/bottoms.png", 557989, "02d6ac23a8be586b008aba314b9f8c1d32d013f467ce1038301b78f78a5a19bc"),
      file("light/extra.png", 186248, "e225077191671f9a92539f4548d90d56ebf609e7f1673879eb8f877042d61a5e"),
      file("light/eye_msk.png", 43672, "294a82febd2347e71a653252a36a54f2022f00225d14f9c05314d08ca377610f"),
      file("light/eye_red.png", 393307, "640f482c8ba1db646e818538782dd9168c311ebef00b2f3dcdc078d22c4e0230"),
      file("light/eye.png", 362902, "905d0c73fb5863559947af8166324f1371b57b2bedb07fa50f7640aada9321d8"),
      file("light/eye2.png", 474362, "e6e50b6fc355e5d8f4b4db4fb7d067957adb8923c9710095150121e7720528a0"),
      file("light/face.png", 375790, "d30fa6fef9d261bbc09564b374f0fb8f2220e02bace4cae09b74950afc623406"),
      file("light/hair2.png", 745049, "525530c116b784b43c96c2941841739bd90024f2581ad529ca59203b63993ca3"),
      file("light/iraira.png", 48406, "b286c96debf7b1e482cd5ebab9a740560be490c284f38759c0edc291d9009390"),
      file("light/pale.png", 15878, "fe28decbd5cac41f99e9789796f166a6c0e60060c07082e20721cf43718429a7"),
      file("light/top.png", 382693, "60fc47dbd91667b7e9b82bfab8ff2bdc583a2fe5ba7fa4a33351afa77324ef7f"),
      file("motion/00_normal.vmd", 10401, "6861a348a944cc57ac08353d273b52b962483b5223f91256d03f8005e2545fc7"),
      file("motion/01_happy.vmd", 33008, "8da8b93dfc2dba19535246126558f82238c915ff8a90b2d05dfba17a333f903e"),
      file("motion/16_thinking.vmd", 47546, "1f9927296862cc379004f29d8d7fa902918ad2868967c71b5fe7006e80bd118e"),
      file("motion/22_apology.vmd", 89061, "65f02aabe34e5b7ef502e47ffbaf06068f523b3522a58ad2382de29b61daf282"),
      file("motion/stand.vmd", 56611, "42080246b98aaa8a5b98d1ecd73994cf42b2587f9c04c3ed7435cf859fef83aa"),
    ],
  },
  {
    id: "babylon-mmd",
    repository: "noname0310/babylon-mmd",
    commit: "3f523d392c176d5c9c9f9264f622d0631c1d298e",
    license: "MIT",
    sourceUrl: "https://github.com/noname0310/babylon-mmd",
    files: [
      file("LICENSE", 1063, "a85a4046ee03cb97c4bf68e1853baad659c7980757cb7ba7aaa969a242d80e07"),
      file("README.md", 6124, "c784a1d7da7f9c5a210744fa47d5b6defefbaecf43a9570f777aecd8954a48f7"),
      file("res/model/bone_flag_test.pmx", 294, "35bfc7a2b03ea5190fe80dfb2920c3c6a004bc5e140472c9e5afaf24c52c0aaa"),
      file("res/model/bone_hierarchy_test.pmx", 347, "3bb328e10f2fe21d137b6f665b2f079dbc724a04014774b09e59952e72f2dce7"),
      file("res/model/constraint_test.pmx", 2596, "61417c3edbde5a8da23c08342094b0f0e003b0a58c349e90a0f8cb51bebf962f"),
      file("res/model/matcap_sample.pmx", 122929, "488647fcbaef604dda6b572def1361444140f74118ac2eafdafd0202836c1df9"),
      file("res/model/ref.jpg", 147518, "c0c06c10a5d9959ac1c28ce4684f1f468d06566ac05a92f2fa83443c397721db"),
      file("res/model/uv_morph_test.pmx", 1289, "99c5fd498b575080bfb7f928a4e19b1ee4c2a233b79b2af94cd33ee9e092307d"),
      file("res/motion/physics_toggle_test_v2_yyb10th.vmd", 407, "36cc68b869efcf4fb53778e761411c1110215a16126de5b109393f7e8b0c557c"),
      file("res/motion/physics_toggle_test_v3_yyb10th.vmd", 1961, "ad7cdfb20d65aae86988a94226d19051dee36b4a038958810900aaaceba4a9f8"),
    ],
  },
  {
    id: "nanoem",
    repository: "hkrn/nanoem",
    commit: "30acffaa29f5d2eb9e997d69418f2e4b97b5894f",
    license: "MPL-2.0 for emapp fixtures; repository also preserves MIT component text",
    sourceUrl: "https://github.com/hkrn/nanoem",
    files: [
      file("LICENSE.md", 185, "bb379cc488b532eb9acb6706d771811718ed8967dcf6a3e5e0f9783a5b1eb2e9"),
      file("LICENSE.MIT", 1053, "3dc45b6240fe47a018d4969a68e1a0cd44ed958955ce9985b8ac2d4022d58d2c"),
      file("LICENSE.MPL", 16725, "c76f740d1521b9bed9ca7a04ad526c310493c62621b1341d623b431736533b30"),
      file("README.md", 5424, "37ac6358b2e9d5744f787c5a72a25ff84db0223be88138f7d6f2f9a46d587bfd"),
      file("emapp/test/fixtures/test.pmx", 9631, "3021324f1a313391b100b2d6f24e1e1ba5796008c018c413a3ff759869f55eae"),
      file("emapp/test/fixtures/effects/main.pmx", 11577, "80ec67019af02d274aa0db5401e5c35a6445a2adb73ea39c629748dd0ebb002b"),
    ],
  },
];

const failures = [];
let downloaded = 0;
let verified = 0;

for (const source of sources) {
  for (const entry of source.files) {
    const target = path.join(corpusRoot, source.id, ...entry.path.split("/"));
    const existing = await inspectFile(target, entry);
    if (existing.ok) {
      verified += 1;
      continue;
    }

    if (checkOnly) {
      failures.push(`${source.id}/${entry.path}: ${existing.reason}`);
      continue;
    }
    if (existing.exists && !force) {
      failures.push(
        `${source.id}/${entry.path}: ${existing.reason}; pass --force to replace it`,
      );
      continue;
    }

    const url = rawUrl(source, entry);
    const response = await fetch(url, {
      headers: { "user-agent": "3dretarget-mmd-research-corpus" },
    });
    if (!response.ok) {
      failures.push(`${source.id}/${entry.path}: HTTP ${response.status} from ${url}`);
      continue;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const downloadedFile = inspectBytes(bytes, entry);
    if (!downloadedFile.ok) {
      failures.push(`${source.id}/${entry.path}: upstream ${downloadedFile.reason}`);
      continue;
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    downloaded += 1;
    verified += 1;
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (checkOnly) {
  console.log(`Verified ${verified} immutable MMD research-corpus files.`);
} else {
  await mkdir(corpusRoot, { recursive: true });
  await writeFile(
    path.join(corpusRoot, "manifest.json"),
    `${JSON.stringify(createManifest(), null, 2)}\n`,
  );
  console.log(
    `Prepared ${verified} immutable MMD research-corpus files (${downloaded} downloaded).`,
  );
}

function file(filePath, size, sha256) {
  return { path: filePath, size, sha256 };
}

async function inspectFile(target, expected) {
  try {
    const metadata = await stat(target);
    if (!metadata.isFile()) return { exists: true, ok: false, reason: "not a file" };
    const bytes = new Uint8Array(await readFile(target));
    return { exists: true, ...inspectBytes(bytes, expected) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, ok: false, reason: "missing" };
    throw error;
  }
}

function inspectBytes(bytes, expected) {
  if (bytes.byteLength !== expected.size) {
    return {
      ok: false,
      reason: `size ${bytes.byteLength}, expected ${expected.size}`,
    };
  }
  const actualHash = sha256(bytes);
  if (actualHash !== expected.sha256) {
    return { ok: false, reason: `SHA-256 ${actualHash}, expected ${expected.sha256}` };
  }
  const magicError = validateMagic(expected.path, bytes);
  return magicError ? { ok: false, reason: magicError } : { ok: true };
}

function validateMagic(filePath, bytes) {
  const extension = path.extname(filePath).toLowerCase();
  const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 30));
  if (extension === ".pmx" && !prefix.startsWith("PMX ")) return "invalid PMX magic";
  if (extension === ".pmd" && !prefix.startsWith("Pmd")) return "invalid PMD magic";
  if (extension === ".vmd" && !prefix.includes("Vocaloid Motion Data")) {
    return "invalid VMD magic";
  }
  return null;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rawUrl(source, entry) {
  return `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${entry.path}`;
}

function createManifest() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    purpose: "Local research and conversion testing; not a public catalog input",
    sources: sources.map((source) => ({
      id: source.id,
      repository: source.repository,
      commit: source.commit,
      license: source.license,
      sourceUrl: source.sourceUrl,
      files: source.files.map((entry) => ({
        path: `${source.id}/${entry.path}`,
        sourceUrl: rawUrl(source, entry),
        size: entry.size,
        sha256: entry.sha256,
      })),
    })),
  };
}
