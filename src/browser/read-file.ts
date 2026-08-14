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
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        assertInputByteLength(byteLength, maxBytes, label);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  signal?.throwIfAborted();
  return bytes.buffer;
}
