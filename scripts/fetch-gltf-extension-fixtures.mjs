import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = "https://github.com/KhronosGroup/glTF-Sample-Assets";
const commit = "2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = "tests/fixtures/gltf-extensions/khronos";
const rawBase = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${commit}/`;

const files = [
  fixture("Models/Box/glTF-Draco/Box.gltf", "box-draco/Box.gltf", "3c46acecdfa90b012ec9052d8a1dfa61358e6d56a9e333504189cc78a2de4d1b"),
  fixture("Models/Box/glTF-Draco/Box.bin", "box-draco/Box.bin", "610dc6e08aba7c2720c8e4ec0578efd91cf2d88a5e638dab7811a22f0235bf2e"),
  fixture("Models/Box/LICENSE.md", "box-draco/LICENSE.md", "634623c7bef43aa4b16a3556ac55ae71b671daf4509437d403e4f2a0273928dc"),
  fixture("Models/TextureTransformTest/glTF/TextureTransformTest.gltf", "texture-transform/TextureTransformTest.gltf", "c22c8c6c96c0ea4bcbb9b47ea245a093c5ef59acc5fd425effa4c00da4cdf164"),
  fixture("Models/TextureTransformTest/glTF/TextureTransformTest.bin", "texture-transform/TextureTransformTest.bin", "d0cdd23f2fa0996a0db99d4932fb9912a51a34e27c8bf832d072dc856ee9a7af"),
  fixture("Models/TextureTransformTest/glTF/Arrow.png", "texture-transform/Arrow.png", "5df5b251fed0ac306cf859a30b59a4953d152483a4bed2b84e5bba1c667a1e64"),
  fixture("Models/TextureTransformTest/glTF/Correct.png", "texture-transform/Correct.png", "3a14b12635ebbcee3ea427fbdb4d20da73e4740ec7a51683d700a2d6b4b7861a"),
  fixture("Models/TextureTransformTest/glTF/Error.png", "texture-transform/Error.png", "8d1032ef535a5c379bf78f9f565d3180ee3fc2d1cfef6892dee6e567728b619c"),
  fixture("Models/TextureTransformTest/glTF/NotSupported.png", "texture-transform/NotSupported.png", "1fbdeca7e5c105d677a39578e4bab82b89c8aa9f406ee681ede05635ea0f8c74"),
  fixture("Models/TextureTransformTest/glTF/UV.png", "texture-transform/UV.png", "ac37ff52fe06a4c8c35ad4e1e7e8da039dfa8afc9b629d40a44ca8b8cfe9d03d"),
  fixture("Models/TextureTransformTest/LICENSE.md", "texture-transform/LICENSE.md", "2756f452c3dd14860ace0f63abc5899755a1efbd63d63671fd6eec16e5fce2c1"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/MeshoptCubeTest.gltf", "meshopt/MeshoptCubeTest.gltf", "b5947609f3d8aba58de3d43101df3b635ffaaab5849431f8518af6a98a040433"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/MeshoptCubeTest.bin", "meshopt/MeshoptCubeTest.bin", "6578c1d82c5cc2b228e9513e37f348ca89cdb24b5985aa0567efef8d3c014360"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/col0.png", "meshopt/col0.png", "250410286de74c532ee877b51b039228742a2e4d7fd611dce29230e841ab75f7"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/col1.png", "meshopt/col1.png", "10a6db3432385dceaacb15a66f94ce79c6c2460d9b1ef1f25c3399bd2d0ee521"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/col2.png", "meshopt/col2.png", "28f15b21a88b213315e13cdcb7914007934e69f3ed8b8dc9495f469d865d57e7"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/col3.png", "meshopt/col3.png", "d518c528b85d9c2c5915c5822b152ac8c162da1bc11a9581e5486d53ebaeb11a"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/col4.png", "meshopt/col4.png", "8f5659a0451392c567217b432a6c83f65a6c22eb3a225e853daa45ec847abdb3"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/row0.png", "meshopt/row0.png", "a26715d56e91e83b19e336174494bd3e39cfc3a5f1b6f1166951a9ec38bf6baa"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/row1.png", "meshopt/row1.png", "8b005615419b1efb98d3cce2fd9529fc53bd34337a317aece8cd4a7558053ec4"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/row2.png", "meshopt/row2.png", "b4e1d53d2a5492adc2d148b19b421733fb23edf1a0aded6fea1ec11c710f11b0"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/row3.png", "meshopt/row3.png", "ae96accde34a0a35ffe63a2fa4f777eaeacf6d3157e6ef69ba5da285949d7f77"),
  fixture("Models/MeshoptCubeTest/glTF-Meshopt/row4.png", "meshopt/row4.png", "689cf0ae16c22125a4a1ad44e0431aed1a92a101def096161d133ec56906bca3"),
  fixture("Models/MeshoptCubeTest/LICENSE.md", "meshopt/LICENSE.md", "63fc4b5080289c3640c904dcf5adb3a6122a707928164d7520f46b3051da8ac3"),
  minimizedGLBFixture(
    "Models/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb",
    "materials-variants/MaterialsVariantsShoe.glb",
    "e1d7cb190382111e5a5b37b51e9a7f007f7eb2ab1b6185e0188e8d0a0d1265a7",
    "KHR_materials_variants",
  ),
  fixture("Models/MaterialsVariantsShoe/LICENSE.md", "materials-variants/LICENSE.md", "005d13a91ab71b75d4e734a7301c67fcbcab28cc7187a5ddacf94dd650d332df"),
  minimizedGLBFixture(
    "Models/LightsPunctualLamp/glTF-Binary/LightsPunctualLamp.glb",
    "lights-punctual/LightsPunctualLamp.glb",
    "b9a95cd0e17dea5284117e54807b49b746960038457a31a0011b9344acc11104",
    "KHR_lights_punctual",
  ),
  fixture("Models/LightsPunctualLamp/LICENSE.md", "lights-punctual/LICENSE.md", "44100aecf907abd0460eff3c437323643c565929f61df7c408a3d6966332e8b6"),
];

const provenance = {
  schemaVersion: 2,
  sourceRepository: repository,
  sourceCommit: commit,
  cases: [
    { id: "box-draco", extension: "KHR_draco_mesh_compression", support: "probe-only", license: "CC-BY-4.0" },
    { id: "texture-transform", extension: "KHR_texture_transform", support: "probe-only", license: "CC0-1.0" },
    { id: "meshopt", extension: "KHR_meshopt_compression", support: "probe-only", license: "CC0-1.0" },
    { id: "materials-variants", extension: "KHR_materials_variants", support: "probe-only", license: "CC-BY-4.0" },
    { id: "lights-punctual", extension: "KHR_lights_punctual", support: "probe-only", license: "CC-BY-4.0" },
  ],
  files,
};
const provenancePath = path.join(root, fixtureRoot, "provenance.json");
const serializedProvenance = `${JSON.stringify(provenance, null, 2)}\n`;

if (process.argv.includes("--check")) {
  for (const file of files) {
    const bytes = await readFile(path.join(root, file.output));
    assertHash(file.output, file.sha256, bytes);
  }
  const existing = await readFile(provenancePath, "utf8");
  if (existing !== serializedProvenance) {
    throw new Error("glTF extension fixture provenance is stale.");
  }
  console.log(`Verified ${files.length} pinned glTF extension fixture files.`);
} else {
  for (const file of files) {
    const response = await fetch(new URL(file.source, rawBase));
    if (!response.ok) {
      throw new Error(`Failed to fetch ${file.source}: HTTP ${response.status}.`);
    }
    const sourceBytes = Buffer.from(await response.arrayBuffer());
    assertHash(file.source, file.sourceSha256 ?? file.sha256, sourceBytes);
    const bytes = file.transformation
      ? createMinimizedDeclarationGLB(file, readGLBJSON(sourceBytes))
      : sourceBytes;
    assertHash(file.output, file.sha256, bytes);
    const outputPath = path.join(root, file.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
  }
  await writeFile(provenancePath, serializedProvenance, "utf8");
  console.log(`Fetched ${files.length} pinned glTF extension fixture files.`);
}

function fixture(source, relativeOutput, sha256) {
  return {
    source,
    output: `${fixtureRoot}/${relativeOutput}`,
    sha256,
  };
}

function minimizedGLBFixture(source, relativeOutput, sourceSha256, extension) {
  const file = {
    source,
    output: `${fixtureRoot}/${relativeOutput}`,
    sourceSha256,
    transformation: "minimal-glb-extension-declaration-v1",
    extension,
  };
  const bytes = createMinimizedDeclarationGLB(file, {
    extensionsUsed: [extension],
  });

  return {
    ...file,
    sha256: hash(bytes),
  };
}

function createMinimizedDeclarationGLB(file, sourceJSON) {
  if (!sourceJSON.extensionsUsed?.includes(file.extension)) {
    throw new Error(`${file.source} does not declare ${file.extension}.`);
  }

  const json = Buffer.from(JSON.stringify({
    asset: {
      version: "2.0",
      generator: "3dretarget minimal extension declaration fixture",
    },
    extensionsUsed: [file.extension],
    extras: {
      fixture: {
        purpose: "extension-declaration-probe",
        sourceRepository: repository,
        sourceCommit: commit,
        source: file.source,
        sourceSha256: file.sourceSha256,
      },
    },
  }), "utf8");
  const padding = (4 - (json.byteLength % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const output = Buffer.alloc(20 + jsonChunk.byteLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.byteLength, 8);
  output.writeUInt32LE(jsonChunk.byteLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  return output;
}

function readGLBJSON(bytes) {
  if (
    bytes.byteLength < 20 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.byteLength ||
    bytes.readUInt32LE(16) !== 0x4e4f534a
  ) {
    throw new Error("Pinned source is not a complete GLB v2 file.");
  }
  const jsonEnd = 20 + bytes.readUInt32LE(12);
  if (jsonEnd > bytes.byteLength) {
    throw new Error("Pinned source has an incomplete JSON chunk.");
  }
  return JSON.parse(bytes.subarray(20, jsonEnd).toString("utf8"));
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertHash(label, expected, bytes) {
  const actual = hash(bytes);
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${label}: expected ${expected}, received ${actual}.`);
  }
}
