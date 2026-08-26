import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Sha256Hasher, sha256Hex } from "@/core/sha256";

describe("browser-safe SHA-256", () => {
  it.each(["", "abc", "stable rig identity", "骨架身份"])(
    "matches Node crypto for %j",
    (value) => {
      const bytes = new TextEncoder().encode(value);
      expect(sha256Hex(bytes)).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    },
  );

  it("matches Node crypto across multiple compression blocks", () => {
    const bytes = Uint8Array.from({ length: 1025 }, (_, index) => index % 251);
    expect(sha256Hex(bytes)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it("matches one-shot hashing across uneven incremental chunks", () => {
    const bytes = Uint8Array.from({ length: 4097 }, (_, index) => index % 239);
    const hasher = new Sha256Hasher();
    for (let offset = 0; offset < bytes.length; offset += 73) {
      hasher.update(bytes.subarray(offset, Math.min(offset + 73, bytes.length)));
    }
    expect(hasher.digestHex()).toBe(sha256Hex(bytes));
  });
});
