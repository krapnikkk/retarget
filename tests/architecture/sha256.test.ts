import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/core/sha256";

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
});
