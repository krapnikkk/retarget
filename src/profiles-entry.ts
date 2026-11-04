// Humanoid rig profiles and bone tables without the retarget engine.
//
// Viewers import this entry to recognize a rig before any retargeting happens,
// so nothing reachable from here may pull in solving, binding, import, export,
// or job code. tests/architecture/profiles-entry.test.ts checks the source
// graph and scripts/verify-package.mjs checks the packed bundle.
export * from "./profiles";
export { HUMANOID_BONES, isHumanoidBoneName } from "./retarget/humanoid-bones";
export type { HumanoidBoneName } from "./retarget/humanoid-bones";
export {
  MIXAMO_BONE_MAP,
  REQUIRED_VRM_BONES,
  getMissingRequiredBones,
  normalizeMixamoBoneName,
  resolveMixamoBoneName,
} from "./retarget/humanoid";
