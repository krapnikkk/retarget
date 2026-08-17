import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  createZipArchive,
  createZipArchiveBlob,
  readZipArchive,
  readZipBlobArchiveAsync,
  type ReadZipArchiveOptions,
} from "@/export/zip";
import {
  createAssetResourceScope,
  getGLTFPackageResources,
  listAssetPackageEntries,
  prepareAssetDirectory,
  prepareAssetInput,
  readAssetPackageResource,
  releaseAssetPackage,
  resolveAssetPackageResource,
  type ReadableDirectoryHandle,
} from "@/import/asset-package";
import { detectVRMVersion } from "@/import/vrm-version";

describe("ZIP asset package preflight", () => {
  it("enforces ZIP32 writer names and duplicate paths", async () => {
    expect(() => createZipArchive([
      { name: "same.bin", bytes: new Uint8Array([1]) },
      { name: "SAME.bin", bytes: new Uint8Array([2]) },
    ])).toThrow("duplicate path");
    expect(() => createZipArchive([
      { name: "界".repeat(21_846), bytes: new Uint8Array() },
    ])).toThrow("name exceeds");
    await expect(createZipArchiveBlob([
      { name: "../unsafe.bin", blob: new Blob() },
    ])).rejects.toThrow("unsafe path");
  });

  it("strictly validates stored ZIP archives in the synchronous reader", () => {
    const archive = createZipArchive([
      { name: "entry.bin", bytes: new Uint8Array([1, 2, 3]) },
    ]);
    expect(readZipArchive(archive)).toMatchObject([{ name: "entry.bin" }]);

    archive[39] ^= 0xff;
    expect(() => readZipArchive(archive)).toThrow("CRC");
  });

  it("reads stored and deflated entries with CRC validation", async () => {
    const stored = createZipArchive([
      { name: "avatar/model.gltf", bytes: new TextEncoder().encode("{}") },
    ]);
    const deflated = createDeflatedZip("motion/walk.bvh", "HIERARCHY\nMOTION");

    await expect(readZipBytes(stored)).resolves.toMatchObject([
      { name: "avatar/model.gltf" },
    ]);
    await expect(readZipBytes(deflated)).resolves.toMatchObject([
      { name: "motion/walk.bvh" },
    ]);
  });

  it("rejects CRC corruption and excessive compression ratios", async () => {
    const corrupted = createZipArchive([
      { name: "a.txt", bytes: new TextEncoder().encode("hello") },
    ]);
    corrupted[35] ^= 0xff;
    await expect(readZipBytes(corrupted)).rejects.toThrow("CRC");

    const compressed = createDeflatedZip("large.txt", "a".repeat(10_000));
    await expect(
      readZipBytes(compressed, { maxCompressionRatio: 2 }),
    ).rejects.toThrow("compression ratio");
  });

  it("cancels decompression when actual output exceeds the declared size", async () => {
    const forged = createDeflatedZip("large.txt", "a".repeat(10_000));
    const view = new DataView(forged.buffer);
    const localNameLength = view.getUint16(26, true);
    const compressedSize = view.getUint32(18, true);
    const centralOffset = 30 + localNameLength + compressedSize;
    view.setUint32(22, 1, true);
    view.setUint32(centralOffset + 24, 1, true);

    await expect(readZipBytes(forged)).rejects.toThrow(
      /actual expanded size limit/,
    );
    await expect(
      readZipBlobArchiveAsync(new Blob([Uint8Array.from(forged).buffer])),
    ).rejects.toThrow(
      /actual expanded size limit/,
    );
  });

  it("rejects local ZIP metadata that disagrees with the central directory", async () => {
    const forged = createZipArchive([
      { name: "avatar/model.gltf", bytes: new TextEncoder().encode("{}") },
    ]);
    new DataView(forged.buffer).setUint16(8, 8, true);

    await expect(readZipBytes(forged)).rejects.toThrow(
      /local metadata does not match/,
    );
    await expect(
      readZipBlobArchiveAsync(new Blob([Uint8Array.from(forged).buffer])),
    ).rejects.toThrow(
      /local metadata does not match/,
    );
  });

  it("rejects traversal and multiple primary files", async () => {
    expect(() => createZipArchive([
      { name: "../avatar.vrm", bytes: new Uint8Array([1]) },
    ])).toThrow("unsafe path");

    const multiple = new File(
      [
        toArrayBuffer(createZipArchive([
          { name: "one.vrm", bytes: new Uint8Array([1]) },
          { name: "two.glb", bytes: new Uint8Array([2]) },
        ])),
      ],
      "avatars.zip",
    );
    await expect(prepareAssetInput(multiple, "avatar")).rejects.toThrow(
      "exactly one",
    );
  });

  it("extracts one primary file and resolves relative glTF sidecars", async () => {
    const gltf = JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "../shared/model.bin", byteLength: 3 }],
      images: [{ uri: "textures/base.png" }],
    });
    const archive = new File(
      [
        toArrayBuffer(createZipArchive([
          { name: "character/model.gltf", bytes: new TextEncoder().encode(gltf) },
          { name: "shared/model.bin", bytes: new Uint8Array([1, 2, 3]) },
          { name: "character/textures/base.png", bytes: new Uint8Array([4, 5]) },
          { name: "LICENSE.txt", bytes: new TextEncoder().encode("CC0") },
        ])),
      ],
      "character.zip",
      { type: "application/zip" },
    );

    const prepared = await prepareAssetInput(archive, "avatar");
    const json = JSON.parse(await prepared.file.text()) as Record<string, unknown>;
    const resources = await getGLTFPackageResources(prepared.file, json);

    expect(prepared.file.name).toBe("model.gltf");
    expect(prepared.report).toMatchObject({
      sourceKind: "zip",
      sourceName: "character.zip",
      primaryPath: "character/model.gltf",
      resourceCount: 3,
      missingResources: [],
    });
    expect([...resources["../shared/model.bin"]!]).toEqual([1, 2, 3]);
    expect(await readAssetPackageResource(prepared.file, "textures/base.png")).toEqual(
      new Uint8Array([4, 5]),
    );
    expect(resolveAssetPackageResource(prepared.file, "textures/base.png")).toBeInstanceOf(Blob);
    expect(listAssetPackageEntries(prepared.file)?.map((entry) => entry.name)).toEqual([
      "character/model.gltf",
      "shared/model.bin",
      "character/textures/base.png",
      "LICENSE.txt",
    ]);
    expect(
      await listAssetPackageEntries(prepared.file)?.at(-1)?.blob.text(),
    ).toBe("CC0");
  });

  it("range-reads ZIP input without materializing the whole archive", async () => {
    const archiveBytes = createZipArchive([
      { name: "avatar/model.gltf", bytes: new TextEncoder().encode("{}") },
      { name: "avatar/mesh.bin", bytes: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const archive = new RangeOnlyFile(
      [toArrayBuffer(archiveBytes)],
      "avatar.zip",
    );

    const prepared = await prepareAssetInput(archive, "avatar");

    expect(archive.fullReads).toBe(0);
    expect(await readAssetPackageResource(prepared.file, "mesh.bin")).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    releaseAssetPackage(prepared.file);
  });

  it("streams Blob-backed ZIP output without a whole-file source read", async () => {
    const avatar = new RangeOnlyFile(
      [new Uint8Array([1, 2, 3, 4]).buffer],
      "avatar.vrm",
    );
    const output = await createZipArchiveBlob([
      { name: "avatar.vrm", blob: avatar },
      { name: "walk.vrma", blob: new Blob([new Uint8Array([5, 6]).buffer]) },
    ]);
    const entries = await readZipBlobArchiveAsync(output);

    expect(avatar.fullReads).toBe(0);
    expect(entries.map((entry) => entry.name)).toEqual(["avatar.vrm", "walk.vrma"]);
    expect(new Uint8Array(await entries[0]!.blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("maps a synthetic loader URL to the primary file for native MMD loaders", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "avatar.pmx");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const resources = createAssetResourceScope(file);
    const resolved = resources.manager.resolveURL("avatar.pmx");

    expect(resolved).toMatch(/^blob:/);
    resources.dispose();
    resources.dispose();
    expect(resources.disposed).toBe(true);
    expect(revoke).toHaveBeenCalledOnce();
    expect(() => resources.manager.resolveURL("avatar.pmx")).toThrow(
      /already been disposed/,
    );
    revoke.mockRestore();
  });

  it("fails closed for unresolved single-file loader resources", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "avatar.gltf");
    const resources = createAssetResourceScope(file);

    expect(() => resources.manager.resolveURL("texture.png")).toThrow(
      /unresolved asset resource is not allowed/,
    );
    expect(() =>
      resources.manager.resolveURL("https://attacker.example/texture.png"),
    ).toThrow(/External or unresolved asset resource is not allowed/);
    expect(resources.manager.resolveURL("data:image/png;base64,AA==")).toBe(
      "data:image/png;base64,AA==",
    );
    resources.dispose();
  });

  it("reports missing and remote glTF resources before parsing", async () => {
    const gltf = JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "missing.bin" }],
      images: [{ uri: "https://example.com/remote.png" }],
    });
    const archive = new File(
      [
        toArrayBuffer(createZipArchive([
          { name: "model.gltf", bytes: new TextEncoder().encode(gltf) },
        ])),
      ],
      "broken.zip",
    );

    const prepared = await prepareAssetInput(archive, "avatar");
    expect(prepared.report?.missingResources).toEqual([
      "missing.bin",
      "https://example.com/remote.png",
    ]);
  });

  it("blocks protocol-relative, absolute, file, and custom package resources", async () => {
    const uris = [
      "//attacker.example/remote.bin",
      "/absolute.bin",
      "file:///tmp/private.bin",
      "custom:opaque.bin",
      "\\\\server\\share\\remote.bin",
    ];
    const gltf = JSON.stringify({
      asset: { version: "2.0" },
      buffers: uris.map((uri) => ({ uri })),
    });
    const archive = new File(
      [
        toArrayBuffer(
          createZipArchive([
            { name: "model.gltf", bytes: new TextEncoder().encode(gltf) },
          ]),
        ),
      ],
      "external-resources.zip",
    );
    const prepared = await prepareAssetInput(archive, "avatar");
    const { manager, dispose } = createAssetResourceScope(prepared.file);

    expect(prepared.report?.missingResources).toEqual(uris);
    for (const uri of uris) {
      expect(resolveAssetPackageResource(prepared.file, uri)).toBeNull();
      expect(() => manager.resolveURL(uri)).toThrow(/External package resource/);
    }
    dispose();
  });

  it("reports a missing PMD texture sidecar", async () => {
    const archive = new File(
      [
        toArrayBuffer(
          createZipArchive([
            { name: "mmd/model.pmd", bytes: createMinimalTexturedPMD() },
          ]),
        ),
      ],
      "mmd.zip",
    );

    const prepared = await prepareAssetInput(archive, "avatar");
    expect(prepared.report?.missingResources).toEqual(["textures/body.png"]);
  });

  it("recursively scans a selected folder and resolves relative glTF sidecars", async () => {
    const gltf = JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "../shared/model.bin", byteLength: 3 }],
      images: [{ uri: "textures/base.png" }],
    });
    const directory = createDirectoryHandle("character-project", [
      createDirectoryHandle("character", [
        createFileHandle("model.gltf", new TextEncoder().encode(gltf)),
        createDirectoryHandle("textures", [
          createFileHandle("base.png", new Uint8Array([4, 5])),
        ]),
      ]),
      createDirectoryHandle("shared", [
        createFileHandle("model.bin", new Uint8Array([1, 2, 3])),
      ]),
      createFileHandle(".DS_Store", new Uint8Array([0])),
    ]);

    const prepared = await prepareAssetDirectory(directory, "avatar");
    const json = JSON.parse(await prepared.file.text()) as Record<string, unknown>;
    const resources = await getGLTFPackageResources(prepared.file, json);

    expect(prepared.report).toMatchObject({
      sourceKind: "directory",
      sourceName: "character-project",
      primaryPath: "character/model.gltf",
      entryCount: 3,
      resourceCount: 2,
      missingResources: [],
    });
    expect([...resources["../shared/model.bin"]!]).toEqual([1, 2, 3]);
    expect(await readAssetPackageResource(prepared.file, "textures/base.png")).toEqual(
      new Uint8Array([4, 5]),
    );
  });

  it("releases expanded package resources explicitly", async () => {
    const archive = new File(
      [
        toArrayBuffer(createZipArchive([
          { name: "model.gltf", bytes: new TextEncoder().encode("{}") },
          { name: "large.bin", bytes: new Uint8Array([1, 2, 3]) },
        ])),
      ],
      "character.zip",
    );
    const prepared = await prepareAssetInput(archive, "avatar");

    expect(resolveAssetPackageResource(prepared.file, "large.bin")).toBeInstanceOf(Blob);
    expect(releaseAssetPackage(prepared.file)).toBe(true);
    expect(resolveAssetPackageResource(prepared.file, "large.bin")).toBeNull();
    expect(listAssetPackageEntries(prepared.file)).toBeNull();
    expect(releaseAssetPackage(prepared.file)).toBe(false);
  });

  it("bounds selected-folder file counts and total bytes before import", async () => {
    const directory = createDirectoryHandle("large-project", [
      createFileHandle("walk.bvh", new TextEncoder().encode("HIERARCHY")),
      createFileHandle("LICENSE.txt", new TextEncoder().encode("CC0")),
    ]);

    await expect(
      prepareAssetDirectory(directory, "motion", { maxEntries: 1 }),
    ).rejects.toThrow("more than 1 entries");
    await expect(
      prepareAssetDirectory(directory, "motion", { maxExpandedBytes: 4 }),
    ).rejects.toThrow("local processing limit");
  });

  it("does not impose a default selected-folder entry policy", async () => {
    const directory = createDirectoryHandle("large-project", [
      createFileHandle("walk.bvh", new TextEncoder().encode("HIERARCHY")),
      ...Array.from({ length: 512 }, (_, index) =>
        createFileHandle(`notes/${index}.txt`, new Uint8Array([index % 256]))),
    ]);

    const prepared = await prepareAssetDirectory(directory, "motion");

    expect(prepared.report.entryCount).toBe(513);
  });
});

describe("VRM version detection", () => {
  it("distinguishes VRM 0.x, VRM 1.0, and unknown glTF", () => {
    expect(detectVRMVersion(createGLB({ extensions: { VRM: {} } }))).toBe("0.x");
    expect(detectVRMVersion(createGLB({ extensions: { VRMC_vrm: {} } }))).toBe(
      "1.0",
    );
    expect(detectVRMVersion(createGLB({ asset: { version: "2.0" } }))).toBe(
      "unknown",
    );
  });
});

function createDeflatedZip(name: string, content: string) {
  const nameBytes = new TextEncoder().encode(name);
  const raw = new TextEncoder().encode(content);
  const compressed = new Uint8Array(deflateRawSync(raw));
  const crc = crc32(raw);
  const local = new Uint8Array(30 + nameBytes.length + compressed.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(8, 8, true);
  localView.setUint32(14, crc, true);
  localView.setUint32(18, compressed.length, true);
  localView.setUint32(22, raw.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(compressed, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(10, 8, true);
  centralView.setUint32(16, crc, true);
  centralView.setUint32(20, compressed.length, true);
  centralView.setUint32(24, raw.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);
  return concat([local, central, end]);
}

class RangeOnlyFile extends File {
  fullReads = 0;

  override async arrayBuffer(): Promise<ArrayBuffer> {
    this.fullReads += 1;
    throw new Error("Whole-file ZIP reads are forbidden in this fixture.");
  }
}

function createGLB(json: Record<string, unknown>) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(20 + paddedLength);
  bytes.fill(0x20, 20);
  bytes.set(encoded, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  return bytes;
}

function createMinimalTexturedPMD() {
  const bytes = new Uint8Array(367);
  bytes.set(new TextEncoder().encode("Pmd"), 0);
  const view = new DataView(bytes.buffer);
  view.setFloat32(3, 1, true);
  view.setInt32(283, 0, true);
  view.setInt32(287, 0, true);
  view.setInt32(291, 1, true);
  bytes.set(new TextEncoder().encode("textures/body.png"), 345);
  view.setUint16(365, 0, true);
  return bytes;
}

function createFileHandle(name: string, bytes: Uint8Array) {
  return {
    kind: "file",
    name,
    async getFile() {
      return new File([toArrayBuffer(bytes)], name);
    },
  } as unknown as FileSystemHandle;
}

function createDirectoryHandle(
  name: string,
  children: Array<FileSystemHandle | ReadableDirectoryHandle>,
): ReadableDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *values() {
      for (const child of children) {
        yield child as FileSystemHandle;
      }
    },
  };
}

function concat(parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.slice().buffer as ArrayBuffer;
}

async function readZipBytes(
  bytes: Uint8Array,
  options: ReadZipArchiveOptions = {},
) {
  const entries = await readZipBlobArchiveAsync(
    new Blob([toArrayBuffer(bytes)]),
    options,
  );
  return Promise.all(entries.map(async (entry) => ({
    name: entry.name,
    bytes: new Uint8Array(await entry.blob.arrayBuffer()),
  })));
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
