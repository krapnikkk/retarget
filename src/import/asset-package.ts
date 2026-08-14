import { LoadingManager } from "three";
import {
  readZipBlobArchiveAsync,
} from "@/export/zip";
import {
  PMXBinaryReader,
  readPMXHeader,
  readPMXWeight,
} from "@/parsers/pmx-binary";
import {
  getAssetPackageContext,
  hasAssetPackageContext,
  storeAssetPackageContext,
  type StoredAssetPackageEntry,
} from "./asset-package-memory";
import {
  MAX_MOTION_FILE_BYTES,
  MAX_RANGE_LOADABLE_AVATAR_BYTES,
  assertInputByteLength,
} from "@/jobs/asset-memory-policy";
import { readBlobArrayBufferWithSignal } from "@/browser/read-file";
import { DEFAULT_PARSE_BUDGET } from "./parse-budget";

export { releaseAssetPackage } from "./asset-package-memory";

export type AssetPackageRole = "avatar" | "motion";

export type AssetPackageSourceKind = "zip" | "directory";

export type ReadableDirectoryHandle = Pick<
  FileSystemDirectoryHandle,
  "kind" | "name"
> & {
  values(): AsyncIterable<FileSystemHandle>;
};

type AssetDirectoryLimits = {
  maxEntries?: number;
  maxTotalBytes?: number;
};

export type AssetPackageReport = {
  sourceKind: AssetPackageSourceKind;
  sourceName: string;
  primaryPath: string;
  entryCount: number;
  resourceCount: number;
  expandedBytes: number;
  missingResources: string[];
};

export type TransferableAssetPackage = {
  primaryPath: string;
  resources: Record<string, ArrayBuffer>;
};

type AssetPackageEntry = {
  name: string;
  blob: Blob;
  byteLength: number;
};

const AVATAR_EXTENSIONS = [".vrm", ".glb", ".gltf", ".fbx", ".pmx", ".pmd"];
const MOTION_EXTENSIONS = [".vrma", ".glb", ".gltf", ".fbx", ".bvh", ".vmd"];
const MAX_DIRECTORY_ENTRIES = 512;

export async function prepareAssetInput(file: File, role: AssetPackageRole) {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return { file, report: null } as const;
  }

  const entries = (await readZipBlobArchiveAsync(
    file,
    {
      maxEntryUncompressedBytes: getMaxPackageBytes(role),
      maxTotalUncompressedBytes: getMaxPackageBytes(role),
    },
  )).filter(isUsefulBlobEntry);
  return prepareAssetEntries(entries, role, "zip", file.name);
}

export async function prepareAssetDirectory(
  directory: ReadableDirectoryHandle,
  role: AssetPackageRole,
  limits: AssetDirectoryLimits = {},
) {
  const entries: AssetPackageEntry[] = [];
  const state = {
    discoveredEntries: 0,
    expandedBytes: 0,
    maxEntries: resolveDirectoryLimit(
      limits.maxEntries,
      MAX_DIRECTORY_ENTRIES,
    ),
    maxTotalBytes: resolveDirectoryLimit(
      limits.maxTotalBytes,
      getMaxPackageBytes(role),
    ),
  };
  await collectDirectoryEntries(directory, "", entries, state);
  return prepareAssetEntries(entries, role, "directory", directory.name);
}

async function prepareAssetEntries(
  entries: AssetPackageEntry[],
  role: AssetPackageRole,
  sourceKind: AssetPackageSourceKind,
  sourceName: string,
) {
  const extensions = role === "avatar" ? AVATAR_EXTENSIONS : MOTION_EXTENSIONS;
  const primaryEntries = entries.filter((entry) =>
    extensions.some((extension) => entry.name.toLowerCase().endsWith(extension)),
  );

  if (primaryEntries.length !== 1) {
    const sourceLabel = sourceKind === "zip" ? "ZIP package" : "Selected folder";
    throw new Error(
      primaryEntries.length === 0
        ? `${sourceLabel} does not contain a supported ${role} file.`
        : `${sourceLabel} must contain exactly one supported ${role} file; found ${primaryEntries.length}.`,
    );
  }

  const primary = primaryEntries[0]!;
  const expandedBytes = entries.reduce(
    (sum, entry) => sum + entry.byteLength,
    0,
  );
  if (
    role === "avatar" &&
    !/\.(?:glb|vrm)$/i.test(primary.name) &&
    expandedBytes > 200 * 1024 * 1024
  ) {
    throw new Error(
      "Only GLB and VRM avatar packages can use the segmented large-asset path.",
    );
  }
  const resources = new Map<string, Blob>();
  const packageEntries = new Map<string, StoredAssetPackageEntry>();
  const uniqueBasenames = new Map<string, Blob | null>();
  for (const entry of entries) {
    const normalized = normalizeResourcePath(entry.name);
    const resourceKey = normalized.toLowerCase();
    if (resources.has(resourceKey)) {
      throw new Error(`Resource collection contains a duplicate path: ${entry.name}`);
    }
    resources.set(resourceKey, entry.blob);
    packageEntries.set(resourceKey, {
      name: normalized,
      blob: entry.blob,
    });
    const basename = normalized.split("/").at(-1)!.toLowerCase();
    uniqueBasenames.set(
      basename,
      uniqueBasenames.has(basename) ? null : entry.blob,
    );
  }

  const primaryFile = new File([primary.blob], primary.name.split("/").at(-1)!, {
    type: inferMimeType(primary.name),
  });
  const report: AssetPackageReport = {
    sourceKind,
    sourceName,
    primaryPath: primary.name,
    entryCount: entries.length,
    resourceCount: Math.max(0, entries.length - 1),
    expandedBytes,
    missingResources: await collectMissingPrimaryResources(primary, resources),
  };
  storeAssetPackageContext(primaryFile, {
    report,
    entries: packageEntries,
    resources,
    uniqueBasenames,
  });
  return { file: primaryFile, report } as const;
}

async function collectDirectoryEntries(
  directory: ReadableDirectoryHandle,
  prefix: string,
  entries: AssetPackageEntry[],
  state: {
    discoveredEntries: number;
    expandedBytes: number;
    maxEntries: number;
    maxTotalBytes: number;
  },
) {
  for await (const handle of directory.values()) {
    const path = prefix ? `${prefix}/${handle.name}` : handle.name;
    state.discoveredEntries += 1;
    if (state.discoveredEntries > state.maxEntries) {
      throw new Error(
        `Selected folder contains more than ${state.maxEntries} entries.`,
      );
    }
    if (handle.kind === "directory") {
      await collectDirectoryEntries(
        handle as unknown as ReadableDirectoryHandle,
        path,
        entries,
        state,
      );
      continue;
    }

    if (!isUsefulPath(path)) {
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    state.expandedBytes += file.size;
    if (state.expandedBytes > state.maxTotalBytes) {
      throw new Error(
        `Selected folder exceeds the ${state.maxTotalBytes}-byte local processing limit.`,
      );
    }
    entries.push({
      name: normalizeResourcePath(path),
      blob: file,
      byteLength: file.size,
    });
  }
}

export function resolveAssetPackageResource(file: File, uri: string) {
  const context = getAssetPackageContext<AssetPackageReport>(file);
  if (!context) {
    return null;
  }

  const cleanUri = decodeResourceUri(uri);
  if (!cleanUri || !isPackageRelativeUri(cleanUri)) {
    return null;
  }
  const primaryDirectory = dirname(context.report.primaryPath);
  const relative = normalizeResourcePath(
    primaryDirectory ? `${primaryDirectory}/${cleanUri}` : cleanUri,
  ).toLowerCase();
  const direct = context.resources.get(relative);
  if (direct) {
    return direct;
  }
  const rootRelative = context.resources.get(
    normalizeResourcePath(cleanUri).toLowerCase(),
  );
  if (rootRelative) {
    return rootRelative;
  }
  return context.uniqueBasenames.get(cleanUri.split("/").at(-1)!.toLowerCase()) ?? null;
}

export async function readAssetPackageResource(file: File, uri: string) {
  const resource = resolveAssetPackageResource(file, uri);
  return resource
    ? new Uint8Array(
        await readBlobArrayBufferWithSignal(
          resource,
          getMaxPackageBytes("avatar"),
          `resource:${uri}`,
        ),
      )
    : null;
}

export function listAssetPackageEntries(file: File) {
  const context = getAssetPackageContext<AssetPackageReport>(file);
  if (!context) {
    return null;
  }
  return [...context.entries.values()].map((entry) => ({ ...entry }));
}

export async function collectTransferableAssetPackage(
  file: File,
  signal?: AbortSignal,
): Promise<TransferableAssetPackage | undefined> {
  const context = getAssetPackageContext<AssetPackageReport>(file);
  if (!context) return undefined;
  const resources: Record<string, ArrayBuffer> = {};
  let transferredBytes = 0;
  const maxTransferredBytes = MAX_MOTION_FILE_BYTES;
  for (const entry of context.entries.values()) {
    if (
      normalizeResourcePath(entry.name).toLowerCase() ===
      normalizeResourcePath(context.report.primaryPath).toLowerCase()
    ) {
      continue;
    }
    signal?.throwIfAborted();
    transferredBytes += entry.blob.size;
    assertInputByteLength(
      transferredBytes,
      maxTransferredBytes,
      `resources:${context.report.sourceName}`,
    );
    resources[entry.name] = await readBlobArrayBufferWithSignal(
      entry.blob,
      maxTransferredBytes,
      `resource:${entry.name}`,
      signal,
    );
  }
  return {
    primaryPath: context.report.primaryPath,
    resources,
  };
}

export function createTransferableAssetPackageResolver(
  assetPackage: TransferableAssetPackage | undefined,
) {
  if (!assetPackage) return () => null;
  const entries = new Map(
    Object.entries(assetPackage.resources).map(([name, bytes]) => [
      normalizeResourcePath(name).toLowerCase(),
      bytes,
    ]),
  );
  const primaryDirectory = dirname(assetPackage.primaryPath);
  const basenames = new Map<string, ArrayBuffer | null>();
  for (const [name, bytes] of entries) {
    const basename = name.split("/").at(-1)!;
    basenames.set(basename, basenames.has(basename) ? null : bytes);
  }
  return (uri: string) => {
    const cleanUri = decodeResourceUri(uri);
    if (!cleanUri || !isPackageRelativeUri(cleanUri)) return null;
    const relative = normalizeResourcePath(
      primaryDirectory ? `${primaryDirectory}/${cleanUri}` : cleanUri,
    ).toLowerCase();
    const bytes =
      entries.get(relative) ??
      entries.get(normalizeResourcePath(cleanUri).toLowerCase()) ??
      basenames.get(cleanUri.split("/").at(-1)!.toLowerCase());
    return bytes ? new Uint8Array(bytes) : null;
  };
}

export function collectMMDPackageResourceUris(
  bytes: Uint8Array,
  filename: string,
) {
  return filename.toLowerCase().endsWith(".pmd")
    ? collectPMDTextureUris(bytes)
    : collectPMXTextureUris(bytes);
}

export async function getGLTFPackageResources(
  file: File,
  json: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
  let transferredBytes = 0;
  const maxTransferredBytes = MAX_MOTION_FILE_BYTES;
  for (const uri of collectGLTFExternalUris(json)) {
    const resource = resolveAssetPackageResource(file, uri);
    if (resource) {
      signal?.throwIfAborted();
      transferredBytes += resource.size;
      assertInputByteLength(
        transferredBytes,
        maxTransferredBytes,
        `resources:${file.name}`,
      );
      resources[uri] = new Uint8Array(
        await readBlobArrayBufferWithSignal(
          resource,
          maxTransferredBytes,
          `resource:${uri}`,
          signal,
        ),
      );
    }
  }
  return resources;
}

export type AssetResourceScope = {
  manager: LoadingManager;
  dispose: () => void;
  readonly disposed: boolean;
};

export function createAssetResourceScope(file: File): AssetResourceScope {
  const objectUrls: string[] = [];
  const manager = new LoadingManager();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const url of objectUrls.splice(0)) {
      URL.revokeObjectURL(url);
    }
  };
  manager.setURLModifier((url) => {
    if (disposed) {
      throw new Error("Asset resource scope has already been disposed.");
    }
    if (/^(?:data:|blob:)/i.test(url)) {
      return url;
    }
    const hasContext = hasAssetPackageContext(file);
    if (hasContext && !isPackageRelativeUri(decodeResourceUri(url))) {
      throw new Error(`External package resource is not allowed: ${url}`);
    }
    const resource =
      decodeResourceUri(url) === file.name
        ? file
        : resolveAssetPackageResource(file, url);
    if (!resource) {
      if (hasContext) {
        throw new Error(`Package resource was not found: ${url}`);
      }
      throw new Error(
        `External or unresolved asset resource is not allowed: ${url}`,
      );
    }
    const objectUrl = URL.createObjectURL(resource);
    objectUrls.push(objectUrl);
    return objectUrl;
  });
  manager.onLoad = () => dispose();
  manager.onError = () => dispose();
  return {
    manager,
    dispose,
    get disposed() {
      return disposed;
    },
  };
}

async function collectMissingPrimaryResources(
  primary: AssetPackageEntry,
  resources: ReadonlyMap<string, Blob>,
) {
  const lowerName = primary.name.toLowerCase();
  let referencedUris: string[] = [];
  if (lowerName.endsWith(".gltf")) {
    const primaryBytes = new Uint8Array(await primary.blob.arrayBuffer());
    const json = JSON.parse(new TextDecoder().decode(primaryBytes)) as Record<
      string,
      unknown
    >;
    referencedUris = collectGLTFExternalUris(json);
  } else if (lowerName.endsWith(".pmx")) {
    const primaryBytes = new Uint8Array(await primary.blob.arrayBuffer());
    referencedUris = collectPMXTextureUris(primaryBytes);
  } else if (lowerName.endsWith(".pmd")) {
    const primaryBytes = new Uint8Array(await primary.blob.arrayBuffer());
    referencedUris = collectPMDTextureUris(primaryBytes);
  }
  const primaryDirectory = dirname(primary.name);
  return referencedUris.filter((uri) => {
    if (!isPackageRelativeUri(decodeResourceUri(uri))) {
      return true;
    }
    const relative = normalizeResourcePath(
      primaryDirectory ? `${primaryDirectory}/${decodeResourceUri(uri)}` : uri,
    ).toLowerCase();
    return !resources.has(relative);
  });
}

function collectPMXTextureUris(bytes: Uint8Array) {
  const reader = new PMXBinaryReader(bytes, "package PMX", {
    maxInputBytes: getMaxPackageBytes("avatar"),
  });
  const { config } = readPMXHeader(reader);
  const {
    additionalUvCount,
    boneIndexSize,
    encoding,
    textureIndexSize,
    vertexIndexSize,
  } = config;
  for (let index = 0; index < 4; index += 1) {
    reader.readText(encoding);
  }
  const vertexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxVertices,
    label: "PMX vertex count",
  });
  for (let index = 0; index < vertexCount; index += 1) {
    reader.skip(3 * 4 + 3 * 4 + 2 * 4 + additionalUvCount * 16);
    readPMXWeight(reader, boneIndexSize);
    reader.readFloat32();
  }
  const indexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxIndices,
    label: "PMX index count",
  });
  reader.skip(indexCount * vertexIndexSize);
  const textureCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMaterials,
    label: "PMX texture count",
  });
  const textures = Array.from({ length: textureCount }, () =>
    reader.readText(encoding),
  );
  const referenced = new Set<string>();
  const materialCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMaterials,
    label: "PMX material count",
  });
  for (let index = 0; index < materialCount; index += 1) {
    reader.readText(encoding);
    reader.readText(encoding);
    reader.skip(4 * 4 + 3 * 4 + 4 + 3 * 4 + 1 + 4 * 4 + 4);
    const textureIndex = reader.readIndex(textureIndexSize);
    if (textureIndex >= 0 && textures[textureIndex]) {
      referenced.add(textures[textureIndex]!);
    }
    reader.readIndex(textureIndexSize);
    reader.readUint8();
    if (reader.readUint8() === 0) {
      reader.readIndex(textureIndexSize);
    } else {
      reader.readUint8();
    }
    reader.readText(encoding);
    reader.readCount({
      max: DEFAULT_PARSE_BUDGET.maxIndices,
      label: "PMX material indices",
    });
  }
  return [...referenced];
}

function collectPMDTextureUris(bytes: Uint8Array) {
  const reader = new PMXBinaryReader(bytes, "package PMD", {
    maxInputBytes: getMaxPackageBytes("avatar"),
  });
  if (reader.readAscii(3) !== "Pmd") {
    throw new Error("PMD header is invalid.");
  }
  reader.readFloat32();
  reader.skip(20 + 256);
  const vertexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxVertices,
    label: "PMD vertex count",
  });
  reader.skip(vertexCount * 38);
  const indexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxIndices,
    label: "PMD index count",
  });
  reader.skip(indexCount * 2);
  const referenced = new Set<string>();
  const materialCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMaterials,
    label: "PMD material count",
  });
  for (let index = 0; index < materialCount; index += 1) {
    reader.skip(4 * 4 + 4 + 3 * 4 + 3 * 4 + 1 + 1 + 4);
    const texture = reader.readShiftJISString(20).split("*")[0]?.trim();
    if (texture) {
      referenced.add(texture);
    }
  }
  return [...referenced];
}

function collectGLTFExternalUris(json: Record<string, unknown>) {
  const uris = new Set<string>();
  for (const collectionName of ["buffers", "images"] as const) {
    const collection = json[collectionName];
    if (!Array.isArray(collection)) {
      continue;
    }
    for (const item of collection) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { uri?: unknown }).uri === "string" &&
        !(item as { uri: string }).uri.startsWith("data:")
      ) {
        uris.add((item as { uri: string }).uri);
      }
    }
  }
  return [...uris];
}

function isUsefulBlobEntry(entry: AssetPackageEntry) {
  return isUsefulPath(entry.name);
}

function isUsefulPath(value: string) {
  const path = value.replace(/\\/g, "/");
  return !path.startsWith("__MACOSX/") && !/(?:^|\/)\.DS_Store$/i.test(path);
}

function getMaxPackageBytes(role: AssetPackageRole) {
  return role === "avatar"
    ? MAX_RANGE_LOADABLE_AVATAR_BYTES
    : 100 * 1024 * 1024;
}

function resolveDirectoryLimit(value: number | undefined, maximum: number) {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return maximum;
  }
  return Math.min(Math.floor(value), maximum);
}

function normalizeResourcePath(value: string) {
  const normalized: string[] = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized.join("/");
}

function decodeResourceUri(uri: string) {
  const withoutQuery = uri.split(/[?#]/, 1)[0] ?? uri;
  try {
    return decodeURIComponent(withoutQuery).replace(/\\/g, "/");
  } catch {
    return withoutQuery.replace(/\\/g, "/");
  }
}

function isPackageRelativeUri(uri: string) {
  if (!uri || uri.includes("\0")) {
    return false;
  }
  const normalized = uri.trim().replace(/\\/g, "/");
  return !(
    normalized.startsWith("//") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized) ||
    /^[a-zA-Z]:\//.test(normalized)
  );
}

function dirname(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function inferMimeType(filename: string) {
  const extension = filename.toLowerCase().split(".").at(-1);
  if (extension === "gltf") return "model/gltf+json";
  if (["glb", "vrm", "vrma"].includes(extension ?? "")) {
    return "model/gltf-binary";
  }
  return "application/octet-stream";
}
