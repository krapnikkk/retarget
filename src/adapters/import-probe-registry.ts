import {
  MIN_IMPORT_PROBE_CONFIDENCE,
  probeImportAdapter,
  type ImportProbeConfig,
} from "@/adapters/probe";
import type {
  AvatarImportAdapter,
  ImportAdapterProbe,
  ImportAdapterProbeOptions,
  MotionImportAdapter,
} from "@/adapters/types";
import type { AvatarFormatId, MotionFormatId } from "@/formats";

export type AvatarImportProbe = Pick<
  AvatarImportAdapter,
  "id" | "label" | "profileId" | "maturity" | "probe"
>;

export type MotionImportProbe = Pick<
  MotionImportAdapter,
  "id" | "label" | "profileId" | "maturity" | "probe"
>;

export type AvatarImportProbeMatch = {
  adapter: AvatarImportProbe;
  probe: ImportAdapterProbe;
};

export type MotionImportProbeMatch = {
  adapter: MotionImportProbe;
  probe: ImportAdapterProbe;
};

type ProbeDefinition<TId extends AvatarFormatId | MotionFormatId> = {
  id: TId;
  label: string;
  profileId: AvatarImportAdapter["profileId"];
  maturity: AvatarImportAdapter["maturity"];
  config: Omit<ImportProbeConfig, "container" | "profile" | "role"> & {
    container:
      | ImportProbeConfig["container"]
      | ((file: File) => ImportProbeConfig["container"]);
  };
};

function createImportProbe<
  TId extends AvatarFormatId | MotionFormatId,
  TRole extends ImportProbeConfig["role"],
>(definition: ProbeDefinition<TId>, role: TRole) {
  return {
    id: definition.id,
    label: definition.label,
    profileId: definition.profileId,
    maturity: definition.maturity,
    probe(file: File, options?: ImportAdapterProbeOptions) {
      const { container, ...config } = definition.config;
      return probeImportAdapter(file, {
        ...config,
        container: typeof container === "function" ? container(file) : container,
        profile: definition.profileId,
        role,
      }, options);
    },
  };
}

const avatarProbe = <TId extends AvatarFormatId>(definition: ProbeDefinition<TId>) =>
  createImportProbe(definition, "avatar") satisfies AvatarImportProbe;

const motionProbe = <TId extends MotionFormatId>(definition: ProbeDefinition<TId>) =>
  createImportProbe(definition, "motion") satisfies MotionImportProbe;

export const vrmAvatarImportProbe = avatarProbe({
  id: "vrm",
  label: "VRM Avatar",
  profileId: "vrm-humanoid",
  maturity: "active",
  config: {
    container: "gltf",
    extensions: [".vrm"],
    requiredExtensions: ["VRMC_vrm", "VRM"],
  },
});

export const readyPlayerMeAvatarImportProbe = avatarProbe({
  id: "ready-player-me",
  label: "Ready Player Me Avatar",
  profileId: "ready-player-me",
  maturity: "active",
  config: {
    container: "gltf",
    ecosystemMarkers: ["Wolf3D_Head", "Wolf3D_Body"],
    extensions: [".glb"],
  },
});

export const reallusionAvatarImportProbe = avatarProbe({
  id: "reallusion",
  label: "Reallusion-compatible Avatar",
  profileId: "actorcore",
  maturity: "active",
  config: {
    container: (file) =>
      file.name.toLowerCase().endsWith(".fbx") ? "fbx" : "gltf",
    ecosystemMarkers: ["CC_Base_Hip", "CC_Base_L_Upperarm"],
    extensions: [".fbx", ".glb"],
  },
});

export const mixamoRiggedAvatarImportProbe = avatarProbe({
  id: "mixamo-rigged",
  label: "Mixamo-rigged Avatar",
  profileId: "mixamo",
  maturity: "active",
  config: {
    container: (file) =>
      file.name.toLowerCase().endsWith(".fbx") ? "fbx" : "gltf",
    ecosystemMarkers: ["mixamorigHips", "mixamorig:LeftArm"],
    extensions: [".fbx", ".glb"],
  },
});

export const gltfHumanoidAvatarImportProbe = avatarProbe({
  id: "gltf-humanoid",
  label: "glTF / GLB Humanoid Avatar",
  profileId: "generic-gltf-humanoid",
  maturity: "active",
  config: {
    container: "gltf",
    extensions: [".glb", ".gltf"],
  },
});

export const mmdModelAvatarImportProbe = avatarProbe({
  id: "mmd-model",
  label: "MMD PMX / PMD Avatar",
  profileId: "mmd-body",
  maturity: "active",
  config: {
    container: "mmd-model",
    extensions: [".pmx", ".pmd"],
  },
});

export const genericFbxAvatarImportProbe = avatarProbe({
  id: "generic-fbx-avatar",
  label: "Generic Humanoid FBX Avatar",
  profileId: "generic-fbx-humanoid",
  maturity: "active",
  config: {
    container: "fbx",
    extensions: [".fbx"],
  },
});

export const bvhMotionImportProbe = motionProbe({
  id: "bvh",
  label: "BVH Motion",
  profileId: "bvh-humanoid",
  maturity: "active",
  config: {
    container: "bvh",
    extensions: [".bvh"],
  },
});

export const vmdMotionImportProbe = motionProbe({
  id: "vmd",
  label: "VMD Body Motion",
  profileId: "mmd-body",
  maturity: "active",
  config: {
    container: "vmd",
    extensions: [".vmd"],
  },
});

export const gltfAnimationMotionImportProbe = motionProbe({
  id: "gltf-animation",
  label: "glTF / GLB Animation",
  profileId: "generic-gltf-humanoid",
  maturity: "active",
  config: {
    container: "gltf",
    extensions: [".glb", ".gltf"],
  },
});

export const actorcoreFbxMotionImportProbe = motionProbe({
  id: "actorcore-fbx",
  label: "ActorCore / Reallusion FBX Motion",
  profileId: "actorcore",
  maturity: "active",
  config: {
    container: "fbx",
    ecosystemMarkers: ["CC_Base_Hip", "CC_Base_L_Upperarm"],
    extensions: [".fbx"],
  },
});

export const mixamoFbxMotionImportProbe = motionProbe({
  id: "mixamo-fbx",
  label: "Mixamo FBX Motion",
  profileId: "mixamo",
  maturity: "active",
  config: {
    container: "fbx",
    ecosystemMarkers: ["mixamorigHips", "mixamorig:LeftArm"],
    extensions: [".fbx"],
  },
});

export const genericFbxMotionImportProbe = motionProbe({
  id: "generic-fbx",
  label: "Generic Humanoid FBX Motion",
  profileId: "generic-fbx-humanoid",
  maturity: "active",
  config: {
    container: "fbx",
    extensions: [".fbx"],
  },
});

export const vrmaMotionImportProbe = motionProbe({
  id: "vrma",
  label: "VRM Animation",
  profileId: "vrm-humanoid",
  maturity: "active",
  config: {
    container: "gltf",
    extensions: [".vrma"],
    requiredExtensions: ["VRMC_vrm_animation"],
  },
});

export const AVATAR_IMPORT_PROBES = [
  vrmAvatarImportProbe,
  readyPlayerMeAvatarImportProbe,
  reallusionAvatarImportProbe,
  mixamoRiggedAvatarImportProbe,
  gltfHumanoidAvatarImportProbe,
  mmdModelAvatarImportProbe,
  genericFbxAvatarImportProbe,
] as const satisfies readonly AvatarImportProbe[];

export const MOTION_IMPORT_PROBES = [
  bvhMotionImportProbe,
  vmdMotionImportProbe,
  gltfAnimationMotionImportProbe,
  actorcoreFbxMotionImportProbe,
  mixamoFbxMotionImportProbe,
  genericFbxMotionImportProbe,
  vrmaMotionImportProbe,
] as const satisfies readonly MotionImportProbe[];

export function probeAvatarImportFormat(
  file: File,
  preferredId?: AvatarFormatId,
  options?: ImportAdapterProbeOptions,
): Promise<AvatarImportProbeMatch | null> {
  return selectImportProbe(AVATAR_IMPORT_PROBES, file, preferredId, options);
}

export function probeMotionImportFormat(
  file: File,
  preferredId?: MotionFormatId,
  options?: ImportAdapterProbeOptions,
): Promise<MotionImportProbeMatch | null> {
  return selectImportProbe(MOTION_IMPORT_PROBES, file, preferredId, options);
}

async function selectImportProbe<
  TProbe extends AvatarImportProbe | MotionImportProbe,
  TId extends TProbe["id"],
>(
  probes: readonly TProbe[],
  file: File,
  preferredId?: TId,
  options?: ImportAdapterProbeOptions,
) {
  const candidates = await Promise.all(
    probes.map(async (adapter) => ({
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
  return candidates
    .filter(
      (candidate) => candidate.probe.confidence >= MIN_IMPORT_PROBE_CONFIDENCE,
    )
    .sort((left, right) => right.probe.confidence - left.probe.confidence)[0] ?? null;
}
