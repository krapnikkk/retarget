import {
  assertFileWithinLimit,
  assertInputByteLength,
} from "@/jobs/asset-memory-policy";

export async function readFileArrayBufferWithSignal(
  file: File,
  maxBytes: number,
  role: "motion" | "avatar" | "resource",
  signal?: AbortSignal,
) {
  assertFileWithinLimit(file, maxBytes, role);
  return readBlobArrayBufferWithSignal(file, maxBytes, `${role}:${file.name}`, signal);
}

export async function readBlobArrayBufferWithSignal(
  blob: Blob,
  maxBytes: number,
  label: string,
  signal?: AbortSignal,
) {
  assertInputByteLength(blob.size, maxBytes, label);
  signal?.throwIfAborted();
  const reader = blob.stream().getReader();
  const bytes = new Uint8Array(blob.size);
  let offset = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      const nextOffset = offset + value.byteLength;
      if (nextOffset > blob.size || nextOffset > maxBytes) {
        assertInputByteLength(nextOffset, Math.min(blob.size, maxBytes), label);
      }
      bytes.set(value, offset);
      offset = nextOffset;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== blob.size) {
    throw new RangeError(
      `${label} stream produced ${offset} bytes; Blob declares ${blob.size}.`,
    );
  }
  signal?.throwIfAborted();
  return bytes.buffer;
}
