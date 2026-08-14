import { probeAvatarImportAdapter } from "@/adapters/avatar";
import { probeMotionImportAdapter } from "@/adapters/motion";
import {
  inspectImportContent,
  type ImportProbeContainer,
} from "@/adapters/probe";
import type { AssetPackageRole } from "@/import/asset-package";
import type { BrowserInputSelection } from "./input-preparation-types";

const SUPPORTED_CONTAINERS = {
  avatar: new Set<ImportProbeContainer>(["fbx", "gltf", "mmd-model"]),
  motion: new Set<ImportProbeContainer>(["bvh", "fbx", "gltf", "vmd"]),
} as const;

export async function classifyBrowserInput(
  file: File,
  role: AssetPackageRole,
  maxProbeBytes: number,
): Promise<BrowserInputSelection> {
  const options = { maxBytes: maxProbeBytes };
  const inspection = await inspectImportContent(file, options);
  const match = role === "avatar"
    ? await probeAvatarImportAdapter(file, undefined, options)
    : await probeMotionImportAdapter(file, undefined, options);
  const unsupported = Boolean(
    inspection.container && !SUPPORTED_CONTAINERS[role].has(inspection.container),
  );
  const evidence = uniqueEvidence([
    ...inspection.evidence,
    ...(match?.probe.evidenceDetails ?? []),
  ]);
  return {
    status: match ? "matched" : unsupported ? "unsupported" : "inconclusive",
    role,
    formatId: match?.adapter.id ?? null,
    profileId: match?.probe.profile ?? null,
    container: inspection.container,
    confidence: match?.probe.confidence ?? 0,
    evidence,
    warnings: uniqueStrings([
      ...inspection.warnings,
      ...(match?.probe.warnings ?? []),
    ]),
    bytesInspected: Math.max(
      inspection.bytesInspected,
      match?.probe.bytesInspected ?? 0,
    ),
  };
}

export function browserInputRoleSupportsContainer(
  role: AssetPackageRole,
  container: ImportProbeContainer,
) {
  return SUPPORTED_CONTAINERS[role].has(container);
}

function uniqueEvidence(
  evidence: BrowserInputSelection["evidence"],
) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.code}\0${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)];
}
