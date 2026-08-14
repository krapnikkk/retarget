import type {
  ImportAdapterProbeOptions,
  ImportAdapterProbe,
  MotionImportAdapter,
} from "@/adapters/types";
import type { MotionFormatId } from "@/formats";
import { actorcoreFbxMotionAdapter } from "./actorcore-fbx";
import { bvhMotionAdapter } from "./bvh";
import { genericFbxMotionAdapter } from "./generic-fbx";
import { gltfAnimationMotionAdapter } from "./gltf-animation";
import { mixamoFbxMotionAdapter } from "./mixamo-fbx";
import { vmdMotionAdapter } from "./vmd";
import { vrmaMotionAdapter } from "./vrma";
import { MIN_IMPORT_PROBE_CONFIDENCE } from "@/adapters/probe";

export const MOTION_IMPORT_ADAPTERS = [
  bvhMotionAdapter,
  vmdMotionAdapter,
  gltfAnimationMotionAdapter,
  actorcoreFbxMotionAdapter,
  mixamoFbxMotionAdapter,
  genericFbxMotionAdapter,
  vrmaMotionAdapter,
] as const satisfies readonly MotionImportAdapter[];

export type MotionImportAdapterMatch = {
  adapter: MotionImportAdapter;
  probe: ImportAdapterProbe;
};

export async function probeMotionImportAdapter(
  file: File,
  preferredId?: MotionFormatId,
  options?: ImportAdapterProbeOptions,
): Promise<MotionImportAdapterMatch | null> {
  const candidates = await Promise.all(
    MOTION_IMPORT_ADAPTERS.map(async (adapter) => ({
      adapter,
      probe: await adapter.probe(file, options),
    })),
  );
  if (preferredId) {
    const preferred = candidates.find(
      (candidate) =>
        candidate.adapter.id === preferredId &&
        candidate.probe.confidence >= MIN_IMPORT_PROBE_CONFIDENCE,
    );
    if (preferred) return preferred;
  }

  const evidenceMatches = candidates
    .filter(
      (candidate) => candidate.probe.confidence >= MIN_IMPORT_PROBE_CONFIDENCE,
    )
    .sort((left, right) => right.probe.confidence - left.probe.confidence);
  return evidenceMatches[0] ?? null;
}

export async function findMotionImportAdapter(
  file: File,
  preferredId?: MotionFormatId,
  options?: ImportAdapterProbeOptions,
): Promise<MotionImportAdapter | null> {
  return (await probeMotionImportAdapter(file, preferredId, options))?.adapter ?? null;
}

export * from "./actorcore-fbx";
export * from "./bvh";
export * from "./generic-fbx";
export * from "./gltf-animation";
export * from "./mixamo-fbx";
export * from "./vmd";
export * from "./vrma";
