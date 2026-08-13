import type { MotionExportFormatId } from "@/formats";
import type { AvatarExportFormatId } from "@/formats";
import type {
  AvatarExportAdapter,
  MotionExportAdapter,
  MotionExportOptions,
} from "@/adapters/types";
import { animatedGlbExportAdapter } from "./animated-glb";
import { animatedPmxExportAdapter } from "./animated-pmx";
import { bakedVrmExportAdapter } from "./baked-vrm";
import { bvhExportAdapter } from "./bvh";
import { fbxAnimationExportAdapter } from "./fbx-animation";
import { fbxAvatarAnimationExportAdapter } from "./fbx-avatar-animation";
import { gltfAnimationExportAdapter } from "./gltf-animation";
import { motionJsonExportAdapter } from "./motion-json";
import { vmdExportAdapter } from "./vmd";
import { vrmExternalVrmaExportAdapter } from "./vrm-external-vrma";
import { vrmaExportAdapter } from "./vrma";

export const MOTION_EXPORT_ADAPTERS = [
  vrmaExportAdapter,
  motionJsonExportAdapter,
  vmdExportAdapter,
  gltfAnimationExportAdapter,
  bvhExportAdapter,
  fbxAnimationExportAdapter,
] as const satisfies readonly MotionExportAdapter[];

export const AVATAR_EXPORT_ADAPTERS = [
  animatedGlbExportAdapter,
  vrmExternalVrmaExportAdapter,
  bakedVrmExportAdapter,
  fbxAvatarAnimationExportAdapter,
  animatedPmxExportAdapter,
] as const satisfies readonly AvatarExportAdapter[];

export function getMotionExportAdapter(id: MotionExportFormatId) {
  return MOTION_EXPORT_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}

export function getAvatarExportAdapter(id: AvatarExportFormatId) {
  return AVATAR_EXPORT_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}

export * from "./animated-glb";
export * from "./animated-pmx";
export * from "./baked-vrm";
export * from "./bvh";
export * from "./fbx-animation";
export * from "./fbx-avatar-animation";
export * from "./gltf-animation";
export * from "./motion-json";
export * from "./vmd";
export * from "./vrm-external-vrma";
export * from "./vrma";
export type { MotionExportOptions };
