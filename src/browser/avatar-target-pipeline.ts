import { disposeObject } from "@/resources/dispose-three";
import { loadCanonicalAvatarRig } from "@/browser/avatar-rig";
import type { AvatarFormatId } from "@/formats";
import {
  DEFAULT_RETARGET_SOLVE_OPTIONS,
  HUMANOID_BONES,
  REQUIRED_VRM_BONES,
  type CanonicalHumanoidMotionClip,
  type RetargetDiagnostics,
  type RetargetSolveOptions,
  type SolvedHumanoidMotionClip,
} from "@/retarget";
import {
  DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
  type CustomRigMappingConfig,
} from "@/solvers";
import { runRetargetJob } from "@/jobs/browser-retarget-job";

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
}): Promise<SolvedHumanoidMotionClip> {
  const rig = await loadCanonicalAvatarRig(avatarFile, avatarFormatId);

  try {
    signal?.throwIfAborted();
    const solvedClip = await runRetargetJob<SolvedHumanoidMotionClip>(
      {
        type: "solve-humanoid",
        motion: clip,
        mapping: mappingConfig,
        options: solveOptions,
        targetRig: {
          profile: rig.profile,
          bones: [...rig.bones.keys()],
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
        restHipsHeight: rig.restHipsHeight,
        profile: rig.profile.id,
        pending: false,
      },
      diagnostics: solvedClip.diagnostics
        ? bindDiagnosticsToAvatar(solvedClip.diagnostics, rig)
        : solvedClip.diagnostics,
      metadata: {
        ...solvedClip.metadata,
        targetHeight: rig.restHipsHeight,
      },
    };
  } finally {
    rig.resourceScope?.dispose();
    disposeObject(rig.root);
  }
}

function bindDiagnosticsToAvatar(
  diagnostics: RetargetDiagnostics,
  rig: Awaited<ReturnType<typeof loadCanonicalAvatarRig>>,
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
      missingRequiredTargetBones: REQUIRED_VRM_BONES.filter(
        (bone) => !rig.bones.has(bone),
      ),
      unmappedTargetBones: HUMANOID_BONES.filter((bone) => !rig.bones.has(bone)),
    },
    assumptions: {
      ...diagnostics.assumptions,
      scaleNormalization: rig.restHipsHeight
        ? `${rig.profile.label} rest hips height ${rig.restHipsHeight}`
        : diagnostics.assumptions.scaleNormalization,
    },
  };
}
