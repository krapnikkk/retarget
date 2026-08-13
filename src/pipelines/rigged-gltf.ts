import type { RigRecipe } from "@/rigs";
import { isRangeLoadableGLB } from "@/jobs/asset-memory-policy";
import { readGLTFStructuralDocument } from "@/import/gltf-structural-document";
import { inspectGLTFRig } from "@/rigs";
import { runRetargetJob } from "@/jobs/browser-retarget-job";
import { collectTransferableGLTFResources } from "@/import/gltf-document";
import { serializeRigInspection } from "@/jobs/serialize-rig-inspection";
import type {
  RiggedGLTFRetargetJobResult,
  SerializedRigInspection,
} from "@/jobs/types";

export async function retargetRiggedGLTF({
  motionFile,
  avatarFile,
  recipe,
  animationIndex,
  animationName,
  signal,
}: {
  motionFile: File;
  avatarFile: File;
  recipe?: RigRecipe;
  animationIndex?: number;
  animationName?: string;
  signal?: AbortSignal;
}) {
  signal?.throwIfAborted();
  const targetOptions = {
    familyOverride: recipe?.family ?? "auto",
    profileId: recipe?.targetProfileId ?? "auto",
    roleOverrides: recipe?.targetRoleOverrides,
  } as const;
  let targetInspection: SerializedRigInspection | undefined;
  let targetBytes: ArrayBuffer | undefined;
  let targetResources: Record<string, ArrayBuffer> | undefined;
  if (isRangeLoadableGLB(avatarFile)) {
    const inspection = inspectGLTFRig(
      (await readGLTFStructuralDocument(avatarFile)).document,
      targetOptions,
    );
    targetInspection = serializeRigInspection(inspection);
  } else {
    targetBytes = await avatarFile.arrayBuffer();
    targetResources = await collectTransferableGLTFResources(
      new Uint8Array(targetBytes),
      avatarFile,
    );
  }
  signal?.throwIfAborted();
  const motionBytes = await motionFile.arrayBuffer();
  const motionResources = await collectTransferableGLTFResources(
    new Uint8Array(motionBytes),
    motionFile,
  );
  signal?.throwIfAborted();
  return runRetargetJob<RiggedGLTFRetargetJobResult>(
    {
      type: "retarget-rigged-gltf",
      motionBytes,
      motionFilename: motionFile.name,
      motionResources,
      targetBytes,
      targetFilename: avatarFile.name,
      targetResources,
      targetInspection,
      recipe,
      animationIndex,
      animationName,
    },
    { signal },
  );
}
