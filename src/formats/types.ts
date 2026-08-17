export type CapabilityAssurance = "experimental" | "beta" | "certified";

export type MotionFormatId =
  | "mixamo-fbx"
  | "vrma"
  | "bvh"
  | "vmd"
  | "gltf-animation"
  | "actorcore-fbx"
  | "generic-fbx";

export type AvatarFormatId =
  | "vrm"
  | "gltf-humanoid"
  | "mixamo-rigged"
  | "ready-player-me"
  | "reallusion"
  | "mmd-model"
  | "generic-fbx-avatar";

export type MotionExportFormatId =
  | "vrma"
  | "motion-json"
  | "vmd"
  | "gltf-animation"
  | "bvh"
  | "fbx-animation";

export type AvatarExportFormatId =
  | "animated-glb"
  | "vrm-external-vrma"
  | "baked-vrm"
  | "fbx-avatar-animation"
  | "animated-pmx";

export type FileFormatDescriptor<TId extends string> = {
  id: TId;
  label: string;
  extensions: readonly string[];
  mimeTypes?: readonly string[];
  assurance: CapabilityAssurance;
};

export type MotionFormatDescriptor = FileFormatDescriptor<MotionFormatId> & {
  role: "motion";
};

export type AvatarFormatDescriptor = FileFormatDescriptor<AvatarFormatId> & {
  role: "avatar";
};

export type MotionExportFormatDescriptor =
  FileFormatDescriptor<MotionExportFormatId> & {
    role: "motion-export";
  };

export type AvatarExportFormatDescriptor =
  FileFormatDescriptor<AvatarExportFormatId> & {
    role: "avatar-export";
  };
