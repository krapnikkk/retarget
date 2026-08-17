import { assertInputByteLength } from "@/jobs/asset-input-safety";

export async function readFileArrayBufferWithSignal(
  file: File,
  role: "motion" | "avatar" | "resource",
  signal?: AbortSignal,
  maxBytes?: number,
) {
  return readBlobArrayBufferWithSignal(
    file,
    `${role}:${file.name}`,
    signal,
    maxBytes,
  );
}

export async function readBlobArrayBufferWithSignal(
  blob: Blob,
  label: string,
  signal?: AbortSignal,
  maxBytes?: number,
) {
  if (maxBytes !== undefined) {
    assertInputByteLength(blob.size, maxBytes, label);
  }
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
      if (nextOffset > blob.size) {
        assertInputByteLength(nextOffset, blob.size, label);
      }
      if (maxBytes !== undefined && nextOffset > maxBytes) {
        assertInputByteLength(nextOffset, maxBytes, label);
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
