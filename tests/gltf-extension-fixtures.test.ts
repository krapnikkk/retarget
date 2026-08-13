import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fixtureRoot = path.resolve(
  process.cwd(),
  "tests/fixtures/gltf-extensions/khronos",
);
const fixturesAvailable = existsSync(path.join(fixtureRoot, "provenance.json"));
const provenance = fixturesAvailable
  ? JSON.parse(
      readFileSync(path.join(fixtureRoot, "provenance.json"), "utf8"),
    ) as {
      sourceCommit: string;
      schemaVersion: number;
      files: Array<{
        output: string;
        sha256: string;
        sourceSha256?: string;
        transformation?: string;
      }>;
      cases: Array<{ id: string; extension: string; support: string }>;
    }
  : { schemaVersion: 0, sourceCommit: "", files: [], cases: [] };

describe.skipIf(!fixturesAvailable)("pinned Khronos glTF extension fixtures", () => {
  it("matches every committed artifact hash", () => {
    expect(provenance.schemaVersion).toBe(2);
    expect(provenance.sourceCommit).toBe(
      "2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf",
    );
    for (const file of provenance.files) {
      const bytes = readFileSync(path.resolve(process.cwd(), file.output));
      expect(createHash("sha256").update(bytes).digest("hex"), file.output)
        .toBe(file.sha256);
    }
  });

  it.each([
    ["box-draco/Box.gltf", "KHR_draco_mesh_compression"],
    ["texture-transform/TextureTransformTest.gltf", "KHR_texture_transform"],
    ["meshopt/MeshoptCubeTest.gltf", "KHR_meshopt_compression"],
  ])("keeps %s as real declared-extension evidence", (relativePath, extension) => {
    const json = JSON.parse(
      readFileSync(path.join(fixtureRoot, relativePath), "utf8"),
    ) as { extensionsUsed?: string[]; extensionsRequired?: string[] };
    expect(json.extensionsUsed).toContain(extension);
    expect(
      provenance.cases.find((item) => item.extension === extension),
    ).toMatchObject({ support: expect.stringMatching(/probe-only/) });
  });

  it.each([
    ["materials-variants/MaterialsVariantsShoe.glb", "KHR_materials_variants"],
    ["lights-punctual/LightsPunctualLamp.glb", "KHR_lights_punctual"],
  ])("keeps %s as minimal complete binary declaration evidence", (relativePath, extension) => {
    const bytes = readFileSync(path.join(fixtureRoot, relativePath));
    const json = readGLBJSON(bytes);
    const file = provenance.files.find((item) => item.output.endsWith(relativePath));

    expect(bytes.byteLength).toBeLessThan(2_048);
    expect(json.extensionsUsed).toContain(extension);
    expect(json.extras?.fixture).toMatchObject({
      purpose: "extension-declaration-probe",
      sourceCommit: provenance.sourceCommit,
      sourceSha256: file?.sourceSha256,
    });
    expect(file).toMatchObject({
      transformation: "minimal-glb-extension-declaration-v1",
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      provenance.cases.find((item) => item.extension === extension),
    ).toMatchObject({ support: "probe-only" });
  });
});

function readGLBJSON(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a
  ) {
    throw new Error("Extension fixture is not a complete GLB v2 file.");
  }
  const jsonLength = view.getUint32(12, true);
  const jsonEnd = 20 + jsonLength;
  if (jsonEnd > bytes.byteLength) {
    throw new Error("Extension fixture has an incomplete JSON chunk.");
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, jsonEnd))) as {
    extensionsUsed?: string[];
    extensionsRequired?: string[];
    extras?: {
      fixture?: {
        purpose?: string;
        sourceCommit?: string;
        sourceSha256?: string;
      };
    };
  };
}
