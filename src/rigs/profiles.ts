import {
  ARACHNID_RIG_DEFINITION,
  AVIAN_RIG_DEFINITION,
  CREATURE_RIG_DEFINITION,
  HUMANOID_RIG_DEFINITION,
  QUADRUPED_RIG_DEFINITION,
  SERPENTINE_RIG_DEFINITION,
} from "./definitions";
import type { RigDefinition, SemanticRigProfile } from "./types";

export const CANONICAL_HUMANOID_SEMANTIC_PROFILE = canonicalProfile(
  HUMANOID_RIG_DEFINITION,
);
export const CANONICAL_QUADRUPED_PROFILE = canonicalProfile(
  QUADRUPED_RIG_DEFINITION,
);
export const CANONICAL_AVIAN_PROFILE = canonicalProfile(AVIAN_RIG_DEFINITION);
export const CANONICAL_SERPENTINE_PROFILE = canonicalProfile(
  SERPENTINE_RIG_DEFINITION,
);
export const CANONICAL_ARACHNID_PROFILE = canonicalProfile(
  ARACHNID_RIG_DEFINITION,
);
export const CANONICAL_CREATURE_PROFILE = canonicalProfile(
  CREATURE_RIG_DEFINITION,
);

export const MESH2MOTION_FOX_PROFILE = {
  id: "mesh2motion-fox",
  label: "Mesh2Motion Fox",
  family: "quadruped",
  rigDefinitionId: "quadruped-v1",
  upAxis: "y",
  forwardAxis: "-z",
  scaleUnit: "meters",
  roles: [
    aliases("root", "root", "Armature"),
    aliases("pelvis", "Hips"),
    aliases("spine", "Spine_1", "Stomach"),
    aliases("spine.2", "Spine_2"),
    aliases("chest", "Spine_2.001"),
    aliases("upperSpine", "Spine_3"),
    aliases("neck", "Neck", "Spine_4"),
    aliases("head", "Head", "Head.tip"),
    aliases("jaw", "Chin", "Jaw"),
    aliases("leftEar", "Ear_L", "Ear_L.tip"),
    aliases("rightEar", "Ear_R", "Ear_R.tip"),
    aliases("frontLeft.shoulder", "Front_Leg_Shoulder_L"),
    aliases("frontLeft.upper", "Front_Leg_Upper_L"),
    aliases("frontLeft.lower", "Front_Leg_Lower_L"),
    aliases("frontLeft.ankle", "Front_Leg_Ankle_L"),
    aliases("frontLeft.paw", "Front_Leg_Foot_L"),
    aliases("frontLeft.toes", "Front_Leg_Tip_L"),
    aliases("frontRight.shoulder", "Front_Leg_Shoulder_R"),
    aliases("frontRight.upper", "Front_Leg_Upper_R"),
    aliases("frontRight.lower", "Front_Leg_Lower_R"),
    aliases("frontRight.ankle", "Front_Leg_Ankle_R"),
    aliases("frontRight.paw", "Front_Leg_Foot_R"),
    aliases("frontRight.toes", "Front_Leg_Tip_R"),
    aliases("hindLeft.hip", "Back_Leg_Pelvis_L"),
    aliases("hindLeft.upper", "Back_Leg_Upper_L"),
    aliases("hindLeft.lower", "Back_Leg_Lower_L"),
    aliases("hindLeft.ankle", "Back_Leg_Ankle_L"),
    aliases("hindLeft.paw", "Back_Leg_Foot_L"),
    aliases("hindLeft.toesBase", "Back_Leg_Foot_1_L"),
    aliases("hindLeft.toes", "Back_Leg_Tip_L"),
    aliases("hindRight.hip", "Back_Leg_Pelvis_R"),
    aliases("hindRight.upper", "Back_Leg_Upper_R"),
    aliases("hindRight.lower", "Back_Leg_Lower_R"),
    aliases("hindRight.ankle", "Back_Leg_Ankle_R"),
    aliases("hindRight.paw", "Back_Leg_Foot_R"),
    aliases("hindRight.toesBase", "Back_Leg_Foot_1_R"),
    aliases("hindRight.toes", "Back_Leg_Tip_R"),
    aliases("tail.1", "Tail_Base"),
    aliases("tail.2", "Tail_Mid"),
    aliases("tail.3", "Tail_Mid.001"),
    aliases("tail.4", "Tail_End"),
    aliases("tail.5", "Tail_Tip"),
  ],
  notes: [
    "Alias profile verified against Mesh2Motion's pinned CC0 Fox fixtures.",
  ],
} as const satisfies SemanticRigProfile;

export const MESH2MOTION_BIRD_PROFILE = {
  id: "mesh2motion-bird",
  label: "Mesh2Motion Bird",
  family: "avian",
  rigDefinitionId: "avian-v1",
  upAxis: "y",
  forwardAxis: "-z",
  scaleUnit: "meters",
  roles: [
    aliases("root", "root"),
    aliases("body", "hips"),
    aliases("spine", "spine_0"),
    aliases("chest", "spine_2"),
    aliases("neck", "spine_3"),
    aliases("head", "head"),
    ...sideAliases("Wing", [
      ["upper", "wing_1"],
      ["mid", "wing_3"],
      ["lower", "wing_5"],
      ["tip", "wing_tip"],
    ]),
    ...sideAliases("Leg", [
      ["upper", "UpperLeg"],
      ["lower", "LowerLeg"],
      ["ankle", "AnkleLeg"],
      ["foot", "Foot"],
      ["toes", "Toes"],
    ]),
    aliases("tail.1", "tail_1"),
    aliases("tail.2", "tail_2"),
    aliases("tail.3", "tail_3"),
    aliases("tail.4", "tail_tip"),
  ],
  notes: ["Mesh2Motion CC0 bird with paired wing, leg, and tail chains."],
} as const satisfies SemanticRigProfile;

export const MESH2MOTION_SNAKE_PROFILE = {
  id: "mesh2motion-snake",
  label: "Mesh2Motion Snake",
  family: "serpentine",
  rigDefinitionId: "serpentine-v1",
  upAxis: "y",
  forwardAxis: "-z",
  scaleUnit: "meters",
  roles: [
    aliases("root", "root"),
    aliases("head", "head"),
    aliases("jaw", "mouth"),
    aliases("neck", "neck"),
    aliases("tailTip", "tail_tip"),
  ],
  orderedChains: [
    {
      roles: SERPENTINE_RIG_DEFINITION.chains.find(
        (chain) => chain.id === "axial",
      )!.roles,
      nodePattern: "^tail(\\d+)$",
    },
  ],
  notes: [
    "Numeric tail joints are distributed over normalized axial roles for variable-length resampling.",
  ],
} as const satisfies SemanticRigProfile;

export const MESH2MOTION_SPIDER_PROFILE = {
  id: "mesh2motion-spider",
  label: "Mesh2Motion Spider",
  family: "arachnid",
  rigDefinitionId: "arachnid-v1",
  upAxis: "y",
  forwardAxis: "-z",
  scaleUnit: "meters",
  roles: [
    aliases("root", "root"),
    aliases("body", "hips"),
    aliases("chest", "spine_2"),
    aliases("head", "head"),
    ...(["left", "right"] as const).flatMap((side) =>
      ["a", "b", "c", "d"].flatMap((letter, index) => {
        const suffix = side === "left" ? "l" : "r";
        const prefix = `${side}Leg${index + 1}`;
        return [
          aliases(`${prefix}.upper`, `leg_${letter}_1_${suffix}`),
          aliases(`${prefix}.mid`, `leg_${letter}_2_${suffix}`),
          aliases(`${prefix}.lower`, `leg_${letter}_3_${suffix}`),
          aliases(`${prefix}.tip`, `leg_${letter}_tip_${suffix}`),
        ];
      }),
    ),
    aliases("tail.1", "tail_1"),
    aliases("tail.2", "tail_2"),
    aliases("tail.3", "tail_3"),
    aliases("tail.4", "tail_tip"),
  ],
  notes: ["Mesh2Motion CC0 spider with eight ordinal radial leg chains."],
} as const satisfies SemanticRigProfile;

export const MESH2MOTION_DRAGON_PROFILE = {
  id: "mesh2motion-dragon",
  label: "Mesh2Motion Dragon",
  family: "creature",
  rigDefinitionId: "creature-v1",
  upAxis: "y",
  forwardAxis: "-z",
  scaleUnit: "meters",
  roles: [
    aliases("root", "root"),
    aliases("pelvis", "hips"),
    aliases("spine", "spine_0"),
    aliases("chest", "spine_2"),
    aliases("neck", "spine_4"),
    aliases("head", "head"),
    ...dragonSideAliases("FrontLeg", "front", [
      ["upper", "leg_collar"],
      ["lower", "leg"],
      ["foot", "foot"],
    ]),
    ...dragonSideAliases("HindLeg", "back", [
      ["upper", "leg_hip"],
      ["lower", "leg"],
      ["foot", "foot"],
    ]),
    ...dragonSideAliases("Wing", "wing", [
      ["upper", "1"],
      ["mid", "3"],
      ["lower", "5"],
      ["tip", "tip"],
    ]),
    aliases("tail.1", "tail_1"),
    aliases("tail.2", "tail_2"),
    aliases("tail.3", "tail_3"),
    aliases("tail.4", "tail_4"),
    aliases("tail.5", "tail_5"),
    aliases("tail.6", "tail_6"),
    aliases("tail.7", "tail_tip"),
  ],
  notes: [
    "Explicit Mesh2Motion CC0 dragon composition: body, four legs, two wings, and tail.",
  ],
} as const satisfies SemanticRigProfile;

export const SEMANTIC_RIG_PROFILES = [
  CANONICAL_HUMANOID_SEMANTIC_PROFILE,
  CANONICAL_QUADRUPED_PROFILE,
  CANONICAL_AVIAN_PROFILE,
  CANONICAL_SERPENTINE_PROFILE,
  CANONICAL_ARACHNID_PROFILE,
  CANONICAL_CREATURE_PROFILE,
  MESH2MOTION_FOX_PROFILE,
  MESH2MOTION_BIRD_PROFILE,
  MESH2MOTION_SNAKE_PROFILE,
  MESH2MOTION_SPIDER_PROFILE,
  MESH2MOTION_DRAGON_PROFILE,
] as const satisfies readonly SemanticRigProfile[];

export function getSemanticRigProfile(id: string) {
  return SEMANTIC_RIG_PROFILES.find((profile) => profile.id === id) ?? null;
}

function canonicalProfile(definition: RigDefinition): SemanticRigProfile {
  return {
    id: `canonical-${definition.id}`,
    label: `Canonical ${definition.label}`,
    family: definition.family,
    rigDefinitionId: definition.id,
    upAxis: "y",
    forwardAxis: "-z",
    scaleUnit: "meters",
    roles: definition.roles.map(({ id }) => ({ role: id, aliases: [id] })),
    notes: [`Exact ${definition.id} semantic role names.`],
  };
}

function aliases(role: string, ...names: string[]) {
  return { role, aliases: names };
}

function sideAliases(
  stem: string,
  segments: readonly (readonly [string, string])[],
) {
  return (["left", "right"] as const).flatMap((side) => {
    const suffix = side === "left" ? "L" : "R";
    return segments.map(([roleSegment, source]) =>
      aliases(`${side}${stem}.${roleSegment}`, `${source}_${suffix}`),
    );
  });
}

function dragonSideAliases(
  stem: string,
  sourceStem: string,
  segments: readonly (readonly [string, string])[],
) {
  return (["left", "right"] as const).flatMap((side) => {
    const suffix = side === "left" ? "l" : "r";
    return segments.map(([roleSegment, sourceSegment]) =>
      aliases(
        `${side}${stem}.${roleSegment}`,
        `${sourceStem}_${sourceSegment}_${suffix}`,
      ),
    );
  });
}
