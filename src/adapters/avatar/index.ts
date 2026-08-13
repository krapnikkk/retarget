import type {
  AvatarImportAdapter,
  ImportAdapterProbe,
} from "@/adapters/types";
import type { AvatarFormatId } from "@/formats";
import { genericFbxAvatarAdapter } from "./generic-fbx-avatar";
import { gltfHumanoidAvatarAdapter } from "./gltf-humanoid";
import { mixamoRiggedAvatarAdapter } from "./mixamo-rigged";
import { mmdModelAvatarAdapter } from "./mmd-model";
import { readyPlayerMeAvatarAdapter } from "./ready-player-me";
import { reallusionAvatarAdapter } from "./reallusion";
import { vrmAvatarAdapter } from "./vrm";

export const AVATAR_IMPORT_ADAPTERS = [
  vrmAvatarAdapter,
  readyPlayerMeAvatarAdapter,
  reallusionAvatarAdapter,
  mixamoRiggedAvatarAdapter,
  gltfHumanoidAvatarAdapter,
  mmdModelAvatarAdapter,
  genericFbxAvatarAdapter,
] as const satisfies readonly AvatarImportAdapter[];

export type AvatarImportAdapterMatch = {
  adapter: AvatarImportAdapter;
  probe: ImportAdapterProbe;
};

export async function probeAvatarImportAdapter(
  file: File,
  preferredId?: AvatarFormatId,
): Promise<AvatarImportAdapterMatch | null> {
  const candidates = await Promise.all(
    AVATAR_IMPORT_ADAPTERS.map(async (adapter) => ({
      adapter,
      probe: await adapter.probe(file),
    })),
  );
  if (preferredId) {
    const preferred = candidates.find(
      (candidate) =>
        candidate.adapter.id === preferredId && candidate.probe.confidence > 0,
    );
    if (preferred) return preferred;
  }

  const evidenceMatches = candidates
    .filter((candidate) => candidate.probe.confidence >= 0.35)
    .sort((left, right) => right.probe.confidence - left.probe.confidence);
  if (evidenceMatches[0]) return evidenceMatches[0];

  const extensionOnlyMatches = candidates.filter(
    (candidate) => candidate.probe.confidence > 0,
  );
  return extensionOnlyMatches.length === 1 ? extensionOnlyMatches[0] : null;
}

export async function findAvatarImportAdapter(
  file: File,
  preferredId?: AvatarFormatId,
): Promise<AvatarImportAdapter | null> {
  return (await probeAvatarImportAdapter(file, preferredId))?.adapter ?? null;
}

export * from "./generic-fbx-avatar";
export * from "./gltf-humanoid";
export * from "./mixamo-rigged";
export * from "./mmd-model";
export * from "./ready-player-me";
export * from "./reallusion";
export * from "./vrm";
