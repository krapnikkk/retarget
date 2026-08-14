export type ZipFileEntry = {
  name: string;
  bytes: Uint8Array;
};

export type ZipBlobFileEntry = {
  name: string;
  blob: Blob;
  byteLength: number;
};

export type ZipBlobOutputEntry = {
  name: string;
  blob: Blob;
};

export type ReadZipArchiveOptions = {
  maxCompressionRatio?: number;
  maxEntries?: number;
  maxEntryUncompressedBytes?: number;
  maxTotalUncompressedBytes?: number;
};

const DEFAULT_READ_OPTIONS = {
  maxCompressionRatio: 200,
  maxEntries: 512,
  maxEntryUncompressedBytes: 256 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
} as const;

const encoder = new TextEncoder();
const CRC32_TABLE = createCRC32Table();
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;

export function createZipArchive(entries: readonly ZipFileEntry[]): Uint8Array {
  assertZipEntryCount(entries.length);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const seenNames = new Set<string>();
  let offset = 0;

  for (const entry of entries) {
    assertZip32Value(entry.bytes.byteLength, `ZIP entry "${entry.name}" size`);
    const nameBytes = encodeZipOutputName(entry.name, seenNames);
    const crc = crc32(entry.bytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.bytes.byteLength, true);
    local.setUint32(22, entry.bytes.byteLength, true);
    local.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, entry.bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, entry.bytes.byteLength, true);
    central.setUint32(24, entry.bytes.byteLength, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.byteLength + entry.bytes.byteLength;
    assertZip32Value(offset, "ZIP local-data offset");
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  assertCentralDirectoryLimits(centralOffset, centralSize);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return concatBytes([...localParts, ...centralParts, end]);
}

export async function createZipArchiveBlob(
  entries: readonly ZipBlobOutputEntry[],
) {
  assertZipEntryCount(entries.length);
  const localParts: BlobPart[] = [];
  const centralParts: ArrayBuffer[] = [];
  const seenNames = new Set<string>();
  let offset = 0;
  for (const entry of entries) {
    assertZip32Value(entry.blob.size, `ZIP entry "${entry.name}" size`);
    const nameBytes = encodeZipOutputName(entry.name, seenNames);
    const crc = await crc32Blob(entry.blob);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.blob.size, true);
    local.setUint32(22, entry.blob.size, true);
    local.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader.buffer, entry.blob);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, entry.blob.size, true);
    central.setUint32(24, entry.blob.size, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader.buffer);
    offset += localHeader.byteLength + entry.blob.size;
    assertZip32Value(offset, "ZIP local-data offset");
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  assertCentralDirectoryLimits(centralOffset, centralSize);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return new Blob(
    [...localParts, ...centralParts, end.buffer],
    { type: "application/zip" },
  );
}

export function readZipArchive(bytes: Uint8Array): ZipFileEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntryCount = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount) {
    throw new Error("ZIP disk or entry counts are inconsistent.");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported.");
  }
  if (entryCount > DEFAULT_READ_OPTIONS.maxEntries) {
    throw new Error(`ZIP archive contains more than ${DEFAULT_READ_OPTIONS.maxEntries} entries.`);
  }
  if (
    centralSize > MAX_CENTRAL_DIRECTORY_BYTES ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new Error("ZIP central directory is outside the archive bounds.");
  }
  const entries: ZipFileEntry[] = [];
  const seenPaths = new Set<string>();
  let totalUncompressedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("ZIP central directory entry is invalid.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > endOffset) {
      throw new Error("ZIP entry metadata is outside the central directory.");
    }
    const name = validateArchivePath(decodeZipName(
      bytes.subarray(nameStart, nameEnd),
      Boolean(flags & 0x0800),
    ));
    offset = nameEnd + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    validateZipEntryLimits({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      limits: DEFAULT_READ_OPTIONS,
    });
    if (method !== 0) {
      throw new Error(`ZIP entry "${name}" uses an unsupported compression method.`);
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > DEFAULT_READ_OPTIONS.maxTotalUncompressedBytes) {
      throw new Error("ZIP archive exceeds the total expanded size limit.");
    }
    const key = name.toLocaleLowerCase("en-US");
    if (seenPaths.has(key)) {
      throw new Error(`ZIP archive contains a duplicate path: "${name}".`);
    }
    seenPaths.add(key);
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`ZIP entry "${name}" has an invalid local header.`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) {
      throw new Error(`ZIP entry "${name}" is outside the archive bounds.`);
    }
    const localName = validateArchivePath(decodeZipName(
      bytes.subarray(localNameStart, localNameEnd),
      Boolean(view.getUint16(localOffset + 6, true) & 0x0800),
    ));
    validateLocalHeaderMetadata({
      central: { compressedSize, expectedCrc, flags, method, name, uncompressedSize },
      local: {
        compressedSize: view.getUint32(localOffset + 18, true),
        expectedCrc: view.getUint32(localOffset + 14, true),
        flags: view.getUint16(localOffset + 6, true),
        method: view.getUint16(localOffset + 8, true),
        name: localName,
        uncompressedSize: view.getUint32(localOffset + 22, true),
      },
    });
    const entryBytes = bytes.slice(dataStart, dataEnd);
    if (crc32(entryBytes) !== expectedCrc) {
      throw new Error(`ZIP entry "${name}" failed its CRC check.`);
    }
    entries.push({ name, bytes: entryBytes });
  }
  if (offset !== endOffset) {
    throw new Error("ZIP central directory size does not match its entries.");
  }

  return entries;
}

export async function readZipBlobArchiveAsync(
  blob: Blob,
  options: ReadZipArchiveOptions = {},
): Promise<ZipBlobFileEntry[]> {
  const limits = { ...DEFAULT_READ_OPTIONS, ...options };
  const tailOffset = Math.max(0, blob.size - 65_557);
  const tail = new Uint8Array(await blob.slice(tailOffset).arrayBuffer());
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const relativeEndOffset = findEndOfCentralDirectory(tailView);
  const diskNumber = tailView.getUint16(relativeEndOffset + 4, true);
  const centralDisk = tailView.getUint16(relativeEndOffset + 6, true);
  const diskEntryCount = tailView.getUint16(relativeEndOffset + 8, true);
  const entryCount = tailView.getUint16(relativeEndOffset + 10, true);
  const centralSize = tailView.getUint32(relativeEndOffset + 12, true);
  const centralOffset = tailView.getUint32(relativeEndOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount) {
    throw new Error("ZIP disk or entry counts are inconsistent.");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported.");
  }
  if (entryCount > limits.maxEntries) {
    throw new Error(`ZIP archive contains more than ${limits.maxEntries} entries.`);
  }
  if (centralSize > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new Error("ZIP central directory exceeds the metadata size limit.");
  }
  if (centralOffset + centralSize > blob.size) {
    throw new Error("ZIP central directory is outside the archive bounds.");
  }
  const centralBytes = new Uint8Array(
    await blob.slice(centralOffset, centralOffset + centralSize).arrayBuffer(),
  );
  const centralView = new DataView(
    centralBytes.buffer,
    centralBytes.byteOffset,
    centralBytes.byteLength,
  );
  const entries: ZipBlobFileEntry[] = [];
  const seenPaths = new Set<string>();
  let totalUncompressedBytes = 0;
  let offset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > centralBytes.byteLength ||
      centralView.getUint32(offset, true) !== 0x02014b50
    ) {
      throw new Error("ZIP central directory entry is invalid.");
    }
    const flags = centralView.getUint16(offset + 8, true);
    const method = centralView.getUint16(offset + 10, true);
    const expectedCrc = centralView.getUint32(offset + 16, true);
    const compressedSize = centralView.getUint32(offset + 20, true);
    const uncompressedSize = centralView.getUint32(offset + 24, true);
    const nameLength = centralView.getUint16(offset + 28, true);
    const extraLength = centralView.getUint16(offset + 30, true);
    const commentLength = centralView.getUint16(offset + 32, true);
    const localOffset = centralView.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > centralBytes.byteLength) {
      throw new Error("ZIP entry metadata is outside the central directory.");
    }
    const rawName = decodeZipName(
      centralBytes.subarray(nameStart, nameEnd),
      Boolean(flags & 0x0800),
    );
    const name = validateArchivePath(rawName);
    offset = nameEnd + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    validateZipEntryLimits({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      limits,
    });
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new Error("ZIP archive exceeds the total expanded size limit.");
    }
    const key = name.toLocaleLowerCase("en-US");
    if (seenPaths.has(key)) {
      throw new Error(`ZIP archive contains a duplicate path: "${name}".`);
    }
    seenPaths.add(key);
    const localHeaderBytes = new Uint8Array(
      await blob.slice(localOffset, localOffset + 30).arrayBuffer(),
    );
    if (
      localHeaderBytes.byteLength !== 30 ||
      new DataView(localHeaderBytes.buffer).getUint32(0, true) !== 0x04034b50
    ) {
      throw new Error(`ZIP entry "${name}" has an invalid local header.`);
    }
    const localView = new DataView(localHeaderBytes.buffer);
    const localNameLength = localView.getUint16(26, true);
    const localExtraLength = localView.getUint16(28, true);
    const localMetadataBytes = new Uint8Array(
      await blob
        .slice(localOffset, localOffset + 30 + localNameLength + localExtraLength)
        .arrayBuffer(),
    );
    if (localMetadataBytes.byteLength !== 30 + localNameLength + localExtraLength) {
      throw new Error(`ZIP entry "${name}" has truncated local metadata.`);
    }
    const localName = validateArchivePath(
      decodeZipName(
        localMetadataBytes.subarray(30, 30 + localNameLength),
        Boolean(localView.getUint16(6, true) & 0x0800),
      ),
    );
    validateLocalHeaderMetadata({
      central: { compressedSize, expectedCrc, flags, method, name, uncompressedSize },
      local: {
        compressedSize: localView.getUint32(18, true),
        expectedCrc: localView.getUint32(14, true),
        flags: localView.getUint16(6, true),
        method: localView.getUint16(8, true),
        name: localName,
        uncompressedSize: localView.getUint32(22, true),
      },
    });
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > blob.size) {
      throw new Error(`ZIP entry "${name}" is outside the archive bounds.`);
    }
    const compressedBlob = blob.slice(dataStart, dataEnd);
    const expandedBlob =
      method === 0
        ? compressedBlob
        : await inflateRawBlob(compressedBlob, uncompressedSize, name);
    if (expandedBlob.size !== uncompressedSize) {
      throw new Error(`ZIP entry "${name}" expanded to an unexpected size.`);
    }
    if (await crc32Blob(expandedBlob) !== expectedCrc) {
      throw new Error(`ZIP entry "${name}" failed its CRC check.`);
    }
    entries.push({ name, blob: expandedBlob, byteLength: uncompressedSize });
  }
  return entries;
}

function validateZipEntryLimits({
  name,
  flags,
  method,
  compressedSize,
  uncompressedSize,
  limits,
}: {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  limits: Required<ReadZipArchiveOptions>;
}) {
  if (flags & 0x0001) throw new Error(`ZIP entry "${name}" is encrypted.`);
  if (method !== 0 && method !== 8) {
    throw new Error(`ZIP entry "${name}" uses an unsupported compression method.`);
  }
  if (method === 0 && compressedSize !== uncompressedSize) {
    throw new Error(`Stored ZIP entry "${name}" has inconsistent sizes.`);
  }
  if (uncompressedSize > limits.maxEntryUncompressedBytes) {
    throw new Error(`ZIP entry "${name}" exceeds the expanded size limit.`);
  }
  const ratio = compressedSize === 0 ? uncompressedSize : uncompressedSize / compressedSize;
  if (ratio > limits.maxCompressionRatio) {
    throw new Error(`ZIP entry "${name}" exceeds the compression ratio limit.`);
  }
}

async function inflateRawBlob(blob: Blob, maxOutputBytes: number, name: string) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot extract deflated ZIP archives.");
  }
  const stream = blob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = await readBoundedStream(stream, maxOutputBytes, name);
  return new Blob([inflated.buffer as ArrayBuffer]);
}

async function crc32Blob(blob: Blob) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value) {
        crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeZipOutputName(name: string, seenNames: Set<string>) {
  const normalized = validateArchivePath(name.replace(/\\/g, "/"));
  const nameBytes = encoder.encode(normalized);
  if (nameBytes.byteLength === 0 || nameBytes.byteLength > 0xffff) {
    throw new Error(`ZIP entry "${name}" name exceeds the ZIP32 limit.`);
  }
  const key = normalized.toLocaleLowerCase("en-US");
  if (seenNames.has(key)) {
    throw new Error(`ZIP output contains a duplicate path: "${normalized}".`);
  }
  seenNames.add(key);
  return nameBytes;
}

function assertZipEntryCount(count: number) {
  if (!Number.isInteger(count) || count < 0 || count >= 0xffff) {
    throw new Error("ZIP output contains too many entries for ZIP32.");
  }
}

function assertZip32Value(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} exceeds the ZIP32 limit.`);
  }
}

function assertCentralDirectoryLimits(offset: number, size: number) {
  assertZip32Value(offset, "ZIP central-directory offset");
  assertZip32Value(size, "ZIP central-directory size");
  if (size > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new Error("ZIP central directory exceeds the metadata size limit.");
  }
  assertZip32Value(offset + size + 22, "ZIP output size");
}

function validateArchivePath(name: string) {
  const slashed = name.replace(/\\/g, "/");
  if (
    !slashed ||
    slashed.includes("\0") ||
    slashed.startsWith("/") ||
    /^[a-zA-Z]:\//.test(slashed)
  ) {
    throw new Error(`ZIP entry has an unsafe path: "${name}".`);
  }

  const segments = slashed.split("/").filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`ZIP entry has an unsafe path: "${name}".`);
  }
  const normalized = segments.join("/");
  return slashed.endsWith("/") ? `${normalized}/` : normalized;
}

function findEndOfCentralDirectory(view: DataView) {
  if (view.byteLength < 22) {
    throw new Error("ZIP archive is too short.");
  }
  const minimumOffset = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === view.byteLength
    ) {
      return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record was not found.");
}

function decodeZipName(bytes: Uint8Array, isUtf8: boolean) {
  if (isUtf8) {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gbk").decode(bytes);
  }
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maxOutputBytes: number,
  name: string,
) {
  const reader = stream.getReader();
  const bytes = new Uint8Array(maxOutputBytes);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const nextOffset = offset + value.byteLength;
      if (nextOffset > maxOutputBytes) {
        await reader.cancel(`ZIP entry ${name} exceeded its expanded size budget.`);
        throw new Error(`ZIP entry "${name}" exceeds its actual expanded size limit.`);
      }
      bytes.set(value, offset);
      offset = nextOffset;
    }
  } finally {
    reader.releaseLock();
  }
  return offset === bytes.byteLength ? bytes : bytes.slice(0, offset);
}

function validateLocalHeaderMetadata({
  central,
  local,
}: {
  central: ZipHeaderMetadata;
  local: ZipHeaderMetadata;
}) {
  if (
    central.name !== local.name ||
    central.flags !== local.flags ||
    central.method !== local.method
  ) {
    throw new Error(`ZIP entry "${central.name}" local metadata does not match the central directory.`);
  }
  const usesDataDescriptor = Boolean(central.flags & 0x0008);
  if (
    !usesDataDescriptor &&
    (central.expectedCrc !== local.expectedCrc ||
      central.compressedSize !== local.compressedSize ||
      central.uncompressedSize !== local.uncompressedSize)
  ) {
    throw new Error(`ZIP entry "${central.name}" local sizes or CRC do not match the central directory.`);
  }
}

type ZipHeaderMetadata = {
  name: string;
  flags: number;
  method: number;
  expectedCrc: number;
  compressedSize: number;
  uncompressedSize: number;
};

function concatBytes(parts: readonly Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCRC32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
