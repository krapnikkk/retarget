import type { MotionExportAdapter } from "@/adapters/types";
import { serializeMotionClip } from "@/retarget";

export const motionJsonExportAdapter = {
  id: "motion-json",
  label: "Motion JSON",
  maturity: "active",
  extension: ".motion.json",
  mimeType: "application/json",
  async exportMotion(clip) {
    return new TextEncoder().encode(serializeMotionClip(clip));
  },
} satisfies MotionExportAdapter;
