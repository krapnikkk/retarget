import type { RigRecipe } from "@/rigs";
import { isRangeLoadableGLB } from "@/jobs/asset-input-safety";
import { readFileArrayBufferWithSignal } from "@/browser/read-file";
import { readGLTFStructuralDocument } from "@/import/gltf-structural-document";
import { inspectGLTFRig } from "@/rigs";
import { runRetargetJob } from "@/jobs/browser-retarget-job";
import { collectTransferableGLTFResources } from "@/import/gltf-document";
import { serializeRigInspection } from "@/jobs/serialize-rig-inspection";
import type {
  SerializedRigInspection,
} from "@/jobs/types";
import { exportAnimatedRigGLB } from "@/export/rig-motion-gltf";

export type RiggedGLTFPipelineOutput = {
  format: "animated-glb";
  bytes: Uint8Array;
};

export async function runRiggedGLTFPipeline(
  input: Parameters<typeof retargetRiggedGLTF>[0],
) {
  const result = await retargetRiggedGLTF(input);
  input.signal?.throwIfAborted();
  const inspectionOptions = {
    familyOverride: input.recipe?.family ?? "auto",
    profileId: input.recipe?.targetProfileId ?? "auto",
    roleOverrides: input.recipe?.targetRoleOverrides,
  } as const;
  const bytes = await exportAnimatedRigGLB({
    avatarFile: input.avatarFile,
    motion: result.motion,
    inspectionOptions,
    signal: input.signal,
  });
  return {
    ...result,
    output: {
      format: "animated-glb" as const,
      bytes,
    } satisfies RiggedGLTFPipelineOutput,
  };
}

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
      (await readGLTFStructuralDocument(avatarFile, signal)).document,
      targetOptions,
    );
    targetInspection = serializeRigInspection(inspection);
  } else {
    targetBytes = await readFileArrayBufferWithSignal(
      avatarFile,
      "avatar",
      signal,
    );
    targetResources = await collectTransferableGLTFResources(
      new Uint8Array(targetBytes),
      avatarFile,
      signal,
    );
  }
  signal?.throwIfAborted();
  const motionBytes = await readFileArrayBufferWithSignal(
    motionFile,
    "motion",
    signal,
  );
  const motionResources = await collectTransferableGLTFResources(
    new Uint8Array(motionBytes),
    motionFile,
    signal,
  );
  signal?.throwIfAborted();
  return runRetargetJob(
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
    { bufferOwnership: "transfer", signal },
  );
}
