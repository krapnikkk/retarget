import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(
  root,
  "src/certification/non-humanoid-v1.json",
);
const provenance = JSON.parse(
  await readFile(
    path.join(
      root,
      "tests/fixtures/non-humanoid/mesh2motion/provenance.json",
    ),
    "utf8",
  ),
);
const sourceHash = (output) =>
  provenance.files.find((item) => item.output === output)?.sha256 ?? null;

const commonEvidence = {
  structural: {
    status: "passed",
    result:
      "Animated GLB reload has the expected channel count for every active family.",
    test:
      "tests/rigs/mesh2motion-acceptance.test.ts#reloads-and-actually-plays-every-family",
  },
  semantic: {
    status: "passed",
    result:
      "Identity/rest, required-chain coverage, family isolation, and family solver assertions pass.",
    test:
      "tests/rigs/mesh2motion-acceptance.test.ts#non-humanoid-semantic-acceptance",
  },
  ecosystem: {
    status: "pending",
    result:
      "Local Three.js playback passes, but no pinned external Blender, Unity, or Godot receipt is recorded.",
    test:
      "tests/rigs/mesh2motion-acceptance.test.ts#reloads-and-actually-plays-every-family",
  },
};

const cases = [
  certificationCase("quadruped-v1", "quadruped", "mesh2motion-fox", {
    sourceFixtures: ["fox-animations.glb"],
    targetFixtures: ["fox-base.glb", "fox-dog.glb", "fox-horse.glb"],
    actions: ["Idle", "Walk", "Run", "Jump"],
    promotion: {
      assurance: "beta",
      sourceFormat: "gltf-rigged",
      targetFormat: "gltf-rigged",
      outputFormat: "animated-glb",
      publicEntry: "3dretarget/browser#runRiggedGLTFPipeline",
      scope:
        "Pinned Mesh2Motion Fox Idle/Walk/Run/Jump source actions to the pinned Fox, Dog, and Horse target fixtures.",
      evidence: {
        structural: {
          status: "passed",
          result:
            "All 12 exported Animated GLBs reload with the expected animation channel set.",
          test:
            "tests/rigs/mesh2motion-acceptance.test.ts#fox-dog-horse-animated-glb-beta",
        },
        semantic: {
          status: "passed",
          result:
            "An independent glTF sampler and world-transform oracle passes all 12 source-action/target pairs with no missing tracks.",
          test:
            "tests/rigs/mesh2motion-acceptance.test.ts#fox-dog-horse-animated-glb-beta",
        },
        ecosystem: {
          status: "pending",
          result:
            "External Blender and Godot receipts remain specific to the humanoid certified artifact.",
          test: null,
        },
      },
    },
  }),
  certificationCase("avian-v1", "avian", "mesh2motion-bird", {
    sourceFixtures: ["bird-animations.glb"],
    targetFixtures: ["bird-eagle.glb"],
  }),
  certificationCase("serpentine-v1", "serpentine", "mesh2motion-snake", {
    sourceFixtures: ["snake-animations.glb"],
    targetDerivation: "Pinned rig with scaled rest translations and an 8-joint axial-chain acceptance target.",
  }),
  certificationCase("arachnid-v1", "arachnid", "mesh2motion-spider", {
    sourceFixtures: ["spider-animations.glb"],
    targetDerivation: "Pinned rig with scaled rest translations.",
  }),
  certificationCase("creature-v1", "creature", "mesh2motion-dragon", {
    sourceFixtures: ["dragon-animations.glb"],
    targetDerivation: "Pinned rig with scaled rest translations.",
  }),
];

const manifestBody = {
  schemaVersion: 3,
  validatorVersion: 3,
  sourceRepository: provenance.sourceRepository,
  sourceCommit: provenance.sourceCommit,
  license: provenance.license,
  outputCapabilities: [
    "rig-motion-json-v2",
    "gltf-animation",
    "animated-glb",
  ],
  bindingContract: {
    rigSignature: "rest-node-skin-v2",
    contactMetric: "world-space-including-root-translation",
  },
  cases,
};
const manifest = {
  ...manifestBody,
  acceptanceHash: sha256(
    Buffer.from(JSON.stringify(manifestBody), "utf8"),
  ),
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const existing = await readFile(outputPath, "utf8");
  if (existing !== serialized) {
    throw new Error(
      "Non-humanoid certification is stale; run pnpm generate:non-humanoid-certification.",
    );
  }
  console.log(`Verified ${cases.length} non-humanoid acceptance cases.`);
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  console.log(`Generated ${path.relative(root, outputPath)}.`);
}

function certificationCase(rigDefinitionId, family, profileId, evidence) {
  const sourceFixtures = evidence.sourceFixtures.map(fixtureReference);
  const targetFixtures = (evidence.targetFixtures ?? []).map(fixtureReference);
  return {
    rigDefinitionId,
    family,
    profileId,
    status: "semantic-passed",
    solver: family === "serpentine"
      ? {
          id: "serpentine-chain-resample-v1",
          specialization: "axial-chain-resample",
        }
      : {
          id: "definition-mapped-swing-twist-v1",
          specialization: "shared-definition-mapped",
        },
    sourceFixtures,
    targetFixtures,
    ...(evidence.targetDerivation
      ? { targetDerivation: evidence.targetDerivation }
      : {}),
    ...(evidence.actions ? { actions: evidence.actions } : {}),
    ...(evidence.promotion ? { promotion: evidence.promotion } : {}),
    evidence: commonEvidence,
  };
}

function fixtureReference(filename) {
  const hash = sourceHash(filename);
  if (!hash) throw new Error(`Missing provenance for ${filename}.`);
  return { filename, sha256: hash };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
