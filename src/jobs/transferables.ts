export function collectArrayBufferTransfers(value: unknown): ArrayBuffer[] {
  const transfers = new Set<ArrayBuffer>();
  const visited = new WeakSet<object>();
  const pending: unknown[] = [value];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (current instanceof ArrayBuffer) {
      transfers.add(current);
      continue;
    }
    if (ArrayBuffer.isView(current)) {
      if (current.buffer instanceof ArrayBuffer) transfers.add(current.buffer);
      continue;
    }
    if (visited.has(current)) continue;
    visited.add(current);
    if (current instanceof Map) {
      for (const [key, entry] of current) pending.push(key, entry);
      continue;
    }
    if (current instanceof Set) {
      for (const entry of current) pending.push(entry);
      continue;
    }
    pending.push(...Object.values(current));
  }

  return [...transfers];
}
