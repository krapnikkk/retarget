import type { ActiveRigDefinitionId, RigDefinitionId } from "./types";

export type RigOutputCapability =
  | "motion-json-v1"
  | "rig-motion-json-v2"
  | "gltf-animation"
  | "animated-glb"
  | "vrma"
  | "vmd"
  | "bvh"
  | "fbx-animation"
  | "vrm"
  | "pmx";

const OUTPUT_CAPABILITIES = {
  "humanoid-v1": [
    "motion-json-v1",
    "gltf-animation",
    "animated-glb",
    "vrma",
    "vmd",
    "bvh",
    "fbx-animation",
    "vrm",
    "pmx",
  ],
  "quadruped-v1": [
    "rig-motion-json-v2",
    "gltf-animation",
    "animated-glb",
  ],
  "avian-v1": ["rig-motion-json-v2", "gltf-animation", "animated-glb"],
  "serpentine-v1": [
    "rig-motion-json-v2",
    "gltf-animation",
    "animated-glb",
  ],
  "arachnid-v1": [
    "rig-motion-json-v2",
    "gltf-animation",
    "animated-glb",
  ],
  "creature-v1": [
    "rig-motion-json-v2",
    "gltf-animation",
    "animated-glb",
  ],
} as const satisfies Record<
  ActiveRigDefinitionId,
  readonly RigOutputCapability[]
>;

export function getRigOutputCapabilities(
  rigDefinitionId: ActiveRigDefinitionId,
): readonly RigOutputCapability[] {
  return OUTPUT_CAPABILITIES[rigDefinitionId];
}

export function rigSupportsOutput(
  rigDefinitionId: RigDefinitionId,
  output: RigOutputCapability,
) {
  const capabilities = OUTPUT_CAPABILITIES[
    rigDefinitionId as ActiveRigDefinitionId
  ] as readonly string[] | undefined;
  return capabilities?.includes(output) ?? false;
}
