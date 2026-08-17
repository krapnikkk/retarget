import type { AvatarFormatId } from "@/formats";
import {
  DEFAULT_RETARGET_SOLVE_OPTIONS,
  HUMANOID_BONES,
  REQUIRED_VRM_BONES,
  createRetargetError,
  isRetargetError,
  type CanonicalHumanoidMotionClip,
  type RetargetDiagnostics,
  type RetargetSolveOptions,
  type TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import {
  DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
  type CustomRigMappingConfig,
} from "@/solvers";
import { runRetargetJob } from "@/jobs/browser-retarget-job";
import type { SerializedHumanoidAvatarRig } from "@/jobs/types";
import {
  collectTransferableAssetPackage,
} from "@/import/asset-package";
import {
  isRangeLoadableGLB,
} from "@/jobs/asset-input-safety";
import { readFileArrayBufferWithSignal } from "./read-file";
import { readGLBStructuralJSONBytes } from "@/import/glb-range";

export async function bindMotionClipToAvatar({
  avatarFile,
  avatarFormatId,
  clip,
  mappingConfig = DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
  solveOptions = DEFAULT_RETARGET_SOLVE_OPTIONS,
  signal,
}: {
  avatarFile: File;
  avatarFormatId: AvatarFormatId;
  clip: CanonicalHumanoidMotionClip;
  mappingConfig?: CustomRigMappingConfig;
  solveOptions?: RetargetSolveOptions;
  signal?: AbortSignal;
}): Promise<TargetBoundSolvedHumanoidMotionClip> {
  signal?.throwIfAborted();
  const rangeLoadable = isRangeLoadableGLB(avatarFile);
  let structuralJSONBytes: ArrayBuffer | undefined;
  try {
    structuralJSONBytes = rangeLoadable
      ? await readGLBStructuralJSONBytes(avatarFile, signal)
      : undefined;
  } catch (cause) {
    if (isRetargetError(cause) || isAbortError(cause)) throw cause;
    throw createRetargetError("TARGET_RIG_INVALID", cause);
  }
  signal?.throwIfAborted();
  const avatarBytes = rangeLoadable
    ? new ArrayBuffer(0)
    : await readFileArrayBufferWithSignal(
        avatarFile,
        "avatar",
        signal,
      );
  const assetPackage = avatarFormatId === "mmd-model" || /\.gltf$/i.test(avatarFile.name)
    ? await collectTransferableAssetPackage(avatarFile, signal)
    : undefined;
  signal?.throwIfAborted();
  const rig = await runRetargetJob(
    {
      type: "inspect-humanoid-avatar",
      bytes: avatarBytes,
      filename: avatarFile.name,
      formatId: avatarFormatId,
      structuralJSONBytes,
      assetPackage,
    },
    { bufferOwnership: "transfer", signal },
  );
  signal?.throwIfAborted();
  const solvedClip = await runRetargetJob(
    {
      type: "solve-humanoid",
      motion: clip,
      mapping: mappingConfig,
      options: solveOptions,
      targetRig: {
        rigSignature: rig.rigSignature,
        profile: rig.profile,
        bones: rig.bones,
        skeleton: rig.skeleton,
        restHipsHeight: rig.restHipsHeight,
      },
    },
    { signal },
  );
  signal?.throwIfAborted();

  return {
    ...solvedClip,
    target: {
      kind: rig.format,
      filename: avatarFile.name,
      rigSignature: rig.rigSignature,
      restHipsHeight: rig.restHipsHeight,
      profile: rig.profile.id,
    },
    diagnostics: solvedClip.diagnostics
      ? bindDiagnosticsToAvatar(solvedClip.diagnostics, rig)
      : solvedClip.diagnostics,
    metadata: {
      ...solvedClip.metadata,
      targetHeight: rig.restHipsHeight,
    },
  };
}

function isAbortError(value: unknown) {
  return value instanceof DOMException && value.name === "AbortError";
}

function bindDiagnosticsToAvatar(
  diagnostics: RetargetDiagnostics,
  rig: SerializedHumanoidAvatarRig,
): RetargetDiagnostics {
  return {
    ...diagnostics,
    profiles: {
      ...diagnostics.profiles,
      target: {
        id: rig.profile.id,
        label: rig.profile.label,
        restPose: rig.profile.restPose,
        detectedRestPose: rig.profile.restPose,
        forwardAxis: rig.profile.forwardAxis,
        upAxis: rig.profile.upAxis,
        scaleUnit: rig.profile.scaleUnit,
        rootMotion: rig.profile.rootMotion,
      },
    },
    skeletons: {
      ...diagnostics.skeletons,
      target: rig.skeleton,
    },
    mapping: {
      ...diagnostics.mapping,
      missingRequiredTargetBones: rig.missingRequiredBones,
      unmappedTargetBones: HUMANOID_BONES.filter(
        (bone) => !rig.bones.includes(bone),
      ),
    },
    assumptions: {
      ...diagnostics.assumptions,
      scaleNormalization: rig.restHipsHeight
        ? `${rig.profile.label} rest hips height ${rig.restHipsHeight}`
        : diagnostics.assumptions.scaleNormalization,
    },
  };
}
