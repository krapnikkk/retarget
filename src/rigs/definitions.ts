import {
  HUMANOID_BONES,
  type HumanoidBoneName,
} from "@/retarget/types";
import { REQUIRED_VRM_BONES } from "@/retarget/humanoid";
import type {
  RigDefinition,
  RigDefinitionId,
  RigRole,
} from "./types";

const HUMANOID_PARENT: Partial<Record<HumanoidBoneName, HumanoidBoneName>> = {
  spine: "hips",
  chest: "spine",
  upperChest: "chest",
  neck: "upperChest",
  head: "neck",
  leftShoulder: "upperChest",
  leftUpperArm: "leftShoulder",
  leftLowerArm: "leftUpperArm",
  leftHand: "leftLowerArm",
  rightShoulder: "upperChest",
  rightUpperArm: "rightShoulder",
  rightLowerArm: "rightUpperArm",
  rightHand: "rightLowerArm",
  leftUpperLeg: "hips",
  leftLowerLeg: "leftUpperLeg",
  leftFoot: "leftLowerLeg",
  leftToes: "leftFoot",
  rightUpperLeg: "hips",
  rightLowerLeg: "rightUpperLeg",
  rightFoot: "rightLowerLeg",
  rightToes: "rightFoot",
};

const HUMANOID_REQUIRED = new Set<string>(REQUIRED_VRM_BONES);

const HUMANOID_ROLES = HUMANOID_BONES.map(
  (bone): RigRole => ({
    id: bone,
    label: bone,
    ...(HUMANOID_PARENT[bone] ? { parent: HUMANOID_PARENT[bone] } : {}),
    required: HUMANOID_REQUIRED.has(bone),
    side: bone.startsWith("left")
      ? "left"
      : bone.startsWith("right")
        ? "right"
        : "center",
    kind: bone === "hips" ? "root" : "limb",
  }),
);

export const HUMANOID_RIG_DEFINITION = {
  schemaVersion: 1,
  id: "humanoid-v1",
  family: "humanoid",
  label: "Humanoid v1",
  rootRole: "hips",
  translationRole: "hips",
  roles: HUMANOID_ROLES,
  chains: [
    { id: "body", label: "Body", roles: ["hips", "spine", "chest", "neck", "head"], required: true },
    { id: "leftArm", label: "Left arm", roles: ["leftUpperArm", "leftLowerArm", "leftHand"], required: true },
    { id: "rightArm", label: "Right arm", roles: ["rightUpperArm", "rightLowerArm", "rightHand"], required: true },
    { id: "leftLeg", label: "Left leg", roles: ["leftUpperLeg", "leftLowerLeg", "leftFoot"], required: true, contactRole: "leftFoot" },
    { id: "rightLeg", label: "Right leg", roles: ["rightUpperLeg", "rightLowerLeg", "rightFoot"], required: true, contactRole: "rightFoot" },
  ],
  scaleRoles: ["hips", "head", "leftFoot", "rightFoot"],
  contactRoles: ["leftFoot", "rightFoot"],
} as const satisfies RigDefinition;

const QUADRUPED_ROLES = [
  role("root", "Root", undefined, true, "center", "root"),
  role("pelvis", "Pelvis", "root", true),
  role("spine", "Spine", "pelvis", true),
  role("spine.2", "Spine 2", "spine"),
  role("chest", "Chest", "spine.2", true),
  role("upperSpine", "Upper spine", "chest"),
  role("neck", "Neck", "upperSpine", true),
  role("head", "Head", "neck", true),
  role("jaw", "Jaw", "head"),
  role("leftEar", "Left ear", "head", false, "left", "detail"),
  role("rightEar", "Right ear", "head", false, "right", "detail"),
  role("frontLeft.shoulder", "Front left shoulder", "chest", false, "left"),
  role("frontLeft.upper", "Front left upper", "frontLeft.shoulder", true, "left"),
  role("frontLeft.lower", "Front left lower", "frontLeft.upper", true, "left"),
  role("frontLeft.ankle", "Front left ankle", "frontLeft.lower", false, "left"),
  role("frontLeft.paw", "Front left paw", "frontLeft.ankle", true, "left", "contact"),
  role("frontLeft.toes", "Front left toes", "frontLeft.paw", false, "left", "contact"),
  role("frontRight.shoulder", "Front right shoulder", "chest", false, "right"),
  role("frontRight.upper", "Front right upper", "frontRight.shoulder", true, "right"),
  role("frontRight.lower", "Front right lower", "frontRight.upper", true, "right"),
  role("frontRight.ankle", "Front right ankle", "frontRight.lower", false, "right"),
  role("frontRight.paw", "Front right paw", "frontRight.ankle", true, "right", "contact"),
  role("frontRight.toes", "Front right toes", "frontRight.paw", false, "right", "contact"),
  role("hindLeft.hip", "Hind left hip", "pelvis", false, "left"),
  role("hindLeft.upper", "Hind left upper", "hindLeft.hip", true, "left"),
  role("hindLeft.lower", "Hind left lower", "hindLeft.upper", true, "left"),
  role("hindLeft.ankle", "Hind left ankle", "hindLeft.lower", false, "left"),
  role("hindLeft.paw", "Hind left paw", "hindLeft.ankle", true, "left", "contact"),
  role("hindLeft.toesBase", "Hind left toes base", "hindLeft.paw", false, "left", "contact"),
  role("hindLeft.toes", "Hind left toes", "hindLeft.toesBase", false, "left", "contact"),
  role("hindRight.hip", "Hind right hip", "pelvis", false, "right"),
  role("hindRight.upper", "Hind right upper", "hindRight.hip", true, "right"),
  role("hindRight.lower", "Hind right lower", "hindRight.upper", true, "right"),
  role("hindRight.ankle", "Hind right ankle", "hindRight.lower", false, "right"),
  role("hindRight.paw", "Hind right paw", "hindRight.ankle", true, "right", "contact"),
  role("hindRight.toesBase", "Hind right toes base", "hindRight.paw", false, "right", "contact"),
  role("hindRight.toes", "Hind right toes", "hindRight.toesBase", false, "right", "contact"),
  role("tail.1", "Tail 1", "pelvis", false, "center", "detail"),
  role("tail.2", "Tail 2", "tail.1", false, "center", "detail"),
  role("tail.3", "Tail 3", "tail.2", false, "center", "detail"),
  role("tail.4", "Tail 4", "tail.3", false, "center", "detail"),
  role("tail.5", "Tail 5", "tail.4", false, "center", "detail"),
] as const;

export const QUADRUPED_RIG_DEFINITION = {
  schemaVersion: 1,
  id: "quadruped-v1",
  family: "quadruped",
  label: "Quadruped v1",
  rootRole: "root",
  translationRole: "root",
  roles: QUADRUPED_ROLES,
  chains: [
    { id: "body", label: "Body", roles: ["pelvis", "spine", "chest"], required: true },
    { id: "neck", label: "Neck", roles: ["chest", "neck", "head"], required: true },
    { id: "frontLeftLeg", label: "Front left leg", roles: ["frontLeft.upper", "frontLeft.lower", "frontLeft.paw"], required: true, contactRole: "frontLeft.paw" },
    { id: "frontRightLeg", label: "Front right leg", roles: ["frontRight.upper", "frontRight.lower", "frontRight.paw"], required: true, contactRole: "frontRight.paw" },
    { id: "hindLeftLeg", label: "Hind left leg", roles: ["hindLeft.upper", "hindLeft.lower", "hindLeft.paw"], required: true, contactRole: "hindLeft.paw" },
    { id: "hindRightLeg", label: "Hind right leg", roles: ["hindRight.upper", "hindRight.lower", "hindRight.paw"], required: true, contactRole: "hindRight.paw" },
    { id: "tail", label: "Tail", roles: ["tail.1", "tail.2", "tail.3", "tail.4", "tail.5"] },
  ],
  scaleRoles: ["pelvis", "chest", "frontLeft.paw", "frontRight.paw", "hindLeft.paw", "hindRight.paw"],
  contactRoles: ["frontLeft.paw", "frontRight.paw", "hindLeft.paw", "hindRight.paw"],
} as const satisfies RigDefinition;

const AVIAN_ROLES = [
  role("root", "Root", undefined, true, "center", "root"),
  role("body", "Body", "root", true, "center", "body"),
  role("spine", "Spine", "body", true, "center", "body"),
  role("chest", "Chest", "spine", true, "center", "body"),
  role("neck", "Neck", "chest", false, "center", "body"),
  role("head", "Head", "neck", true, "center", "body"),
  ...pairedChainRoles("wing", "spine", ["upper", "mid", "lower", "tip"], true),
  ...pairedChainRoles("leg", "body", ["upper", "lower", "ankle", "foot", "toes"], true, "contact"),
  ...linearRoles("tail", "body", 4, false),
] as const;

export const AVIAN_RIG_DEFINITION = {
  schemaVersion: 1,
  id: "avian-v1",
  family: "avian",
  label: "Avian v1",
  rootRole: "root",
  translationRole: "root",
  roles: AVIAN_ROLES,
  chains: [
    { id: "body", label: "Body", roles: ["body", "spine", "chest", "head"], required: true },
    { id: "leftWing", label: "Left wing", roles: ["leftWing.upper", "leftWing.mid", "leftWing.lower", "leftWing.tip"], required: true },
    { id: "rightWing", label: "Right wing", roles: ["rightWing.upper", "rightWing.mid", "rightWing.lower", "rightWing.tip"], required: true },
    { id: "leftLeg", label: "Left leg", roles: ["leftLeg.upper", "leftLeg.lower", "leftLeg.foot"], required: true, contactRole: "leftLeg.foot" },
    { id: "rightLeg", label: "Right leg", roles: ["rightLeg.upper", "rightLeg.lower", "rightLeg.foot"], required: true, contactRole: "rightLeg.foot" },
    { id: "tail", label: "Tail feathers", roles: ["tail.1", "tail.2", "tail.3", "tail.4"] },
  ],
  scaleRoles: ["body", "head", "leftWing.tip", "rightWing.tip", "leftLeg.foot", "rightLeg.foot"],
  contactRoles: ["leftLeg.foot", "rightLeg.foot"],
} as const satisfies RigDefinition;

const SERPENTINE_AXIAL_ROLES = Array.from(
  { length: 20 },
  (_, index) => `axial.${String(index + 1).padStart(2, "0")}`,
);
const SERPENTINE_ROLES = [
  role("root", "Root", undefined, true, "center", "root"),
  role("head", "Head", "root", true, "center", "body"),
  role("jaw", "Jaw", "head", false, "center", "detail"),
  role("neck", "Neck", "head", true, "center", "body"),
  ...SERPENTINE_AXIAL_ROLES.map((id, index) =>
    role(
      id,
      `Axial ${index + 1}`,
      index === 0 ? "neck" : SERPENTINE_AXIAL_ROLES[index - 1],
      index === 0 || index === SERPENTINE_AXIAL_ROLES.length - 1,
      "center",
      "body",
    ),
  ),
  role("tailTip", "Tail tip", SERPENTINE_AXIAL_ROLES.at(-1)),
] as const;

export const SERPENTINE_RIG_DEFINITION = {
  schemaVersion: 1,
  id: "serpentine-v1",
  family: "serpentine",
  label: "Serpentine v1",
  rootRole: "root",
  translationRole: "root",
  roles: SERPENTINE_ROLES,
  chains: [
    { id: "head", label: "Head", roles: ["root", "head", "neck"], required: true },
    { id: "axial", label: "Variable axial chain", roles: SERPENTINE_AXIAL_ROLES, required: true, minimumMappedRoles: 2 },
  ],
  scaleRoles: ["head", "axial.01", "axial.20", "tailTip"],
  contactRoles: [],
} as const satisfies RigDefinition;

const ARACHNID_LEG_ROLES = (["left", "right"] as const).flatMap((side) =>
  [1, 2, 3, 4].flatMap((ordinal) => {
    const prefix = `${side}Leg${ordinal}`;
    return [
      role(`${prefix}.upper`, `${side} leg ${ordinal} upper`, "body", true, side),
      role(`${prefix}.mid`, `${side} leg ${ordinal} mid`, `${prefix}.upper`, true, side),
      role(`${prefix}.lower`, `${side} leg ${ordinal} lower`, `${prefix}.mid`, true, side),
      role(`${prefix}.tip`, `${side} leg ${ordinal} tip`, `${prefix}.lower`, true, side, "contact"),
    ];
  }),
);
const ARACHNID_ROLES = [
  role("root", "Root", undefined, true, "center", "root"),
  role("body", "Body", "root", true, "center", "body"),
  role("chest", "Chest", "body", true, "center", "body"),
  role("head", "Head", "chest", true, "center", "body"),
  ...ARACHNID_LEG_ROLES,
  ...linearRoles("tail", "body", 4, false),
] as const;
const ARACHNID_CONTACT_ROLES = (["left", "right"] as const).flatMap((side) =>
  [1, 2, 3, 4].map((ordinal) => `${side}Leg${ordinal}.tip`),
);

export const ARACHNID_RIG_DEFINITION = {
  schemaVersion: 1,
  id: "arachnid-v1",
  family: "arachnid",
  label: "Arachnid v1",
  rootRole: "root",
  translationRole: "root",
  roles: ARACHNID_ROLES,
  chains: [
    { id: "body", label: "Body", roles: ["body", "chest", "head"], required: true },
    ...(["left", "right"] as const).flatMap((side) =>
      [1, 2, 3, 4].map((ordinal) => ({
        id: `${side}Leg${ordinal}`,
        label: `${side} leg ${ordinal}`,
        roles: [`${side}Leg${ordinal}.upper`, `${side}Leg${ordinal}.mid`, `${side}Leg${ordinal}.lower`, `${side}Leg${ordinal}.tip`],
        required: true,
        contactRole: `${side}Leg${ordinal}.tip`,
      })),
    ),
    { id: "tail", label: "Tail", roles: ["tail.1", "tail.2", "tail.3", "tail.4"] },
  ],
  scaleRoles: ["body", "head", ...ARACHNID_CONTACT_ROLES],
  contactRoles: ARACHNID_CONTACT_ROLES,
} as const satisfies RigDefinition;

const CREATURE_ROLES = [
  role("root", "Root", undefined, true, "center", "root"),
  role("pelvis", "Pelvis", "root", true, "center", "body"),
  role("spine", "Spine", "pelvis", true, "center", "body"),
  role("chest", "Chest", "spine", true, "center", "body"),
  role("neck", "Neck", "chest", true, "center", "body"),
  role("head", "Head", "neck", true, "center", "body"),
  ...pairedChainRoles("frontLeg", "spine", ["upper", "lower", "foot"], true, "contact"),
  ...pairedChainRoles("hindLeg", "pelvis", ["upper", "lower", "foot"], true, "contact"),
  ...pairedChainRoles("wing", "spine", ["upper", "mid", "lower", "tip"], true),
  ...linearRoles("tail", "pelvis", 7, false),
] as const;

export const CREATURE_RIG_DEFINITION = {
  schemaVersion: 1,
  id: "creature-v1",
  family: "creature",
  label: "Dragon / Creature v1",
  rootRole: "root",
  translationRole: "root",
  roles: CREATURE_ROLES,
  chains: [
    { id: "body", label: "Body", roles: ["pelvis", "spine", "chest", "neck", "head"], required: true },
    ...(["left", "right"] as const).flatMap((side) => [
      { id: `${side}FrontLeg`, label: `${side} front leg`, roles: [`${side}FrontLeg.upper`, `${side}FrontLeg.lower`, `${side}FrontLeg.foot`], required: true, contactRole: `${side}FrontLeg.foot` },
      { id: `${side}HindLeg`, label: `${side} hind leg`, roles: [`${side}HindLeg.upper`, `${side}HindLeg.lower`, `${side}HindLeg.foot`], required: true, contactRole: `${side}HindLeg.foot` },
      { id: `${side}Wing`, label: `${side} wing`, roles: [`${side}Wing.upper`, `${side}Wing.mid`, `${side}Wing.lower`, `${side}Wing.tip`], required: true },
    ]),
    { id: "tail", label: "Tail", roles: ["tail.1", "tail.2", "tail.3", "tail.4", "tail.5", "tail.6", "tail.7"] },
  ],
  scaleRoles: ["pelvis", "head", "leftWing.tip", "rightWing.tip", "leftFrontLeg.foot", "rightFrontLeg.foot", "leftHindLeg.foot", "rightHindLeg.foot"],
  contactRoles: ["leftFrontLeg.foot", "rightFrontLeg.foot", "leftHindLeg.foot", "rightHindLeg.foot"],
} as const satisfies RigDefinition;

export const ACTIVE_RIG_DEFINITIONS = [
  HUMANOID_RIG_DEFINITION,
  QUADRUPED_RIG_DEFINITION,
  AVIAN_RIG_DEFINITION,
  SERPENTINE_RIG_DEFINITION,
  ARACHNID_RIG_DEFINITION,
  CREATURE_RIG_DEFINITION,
] as const satisfies readonly RigDefinition[];

export function getRigDefinition(
  id: RigDefinitionId | string,
): RigDefinition | null {
  return (
    ACTIVE_RIG_DEFINITIONS.find((definition) => definition.id === id) ?? null
  );
}

export function getRigDefinitionForFamily(family: RigDefinition["family"]) {
  return (
    ACTIVE_RIG_DEFINITIONS.find(
      (definition) => definition.family === family,
    ) ?? null
  );
}

export function getRequiredRigRoles(definition: RigDefinition) {
  return definition.roles.filter((item) => item.required).map((item) => item.id);
}

function role(
  id: string,
  label: string,
  parent?: string,
  required = false,
  side: RigRole["side"] = "center",
  kind: RigRole["kind"] = "limb",
): RigRole {
  return { id, label, ...(parent ? { parent } : {}), required, side, kind };
}

function pairedChainRoles(
  stem: string,
  parent: string,
  segments: readonly string[],
  required: boolean,
  lastKind: RigRole["kind"] = "limb",
) {
  return (["left", "right"] as const).flatMap((side) =>
    segments.map((segment, index) => {
      const prefix = `${side}${stem[0]?.toUpperCase() ?? ""}${stem.slice(1)}`;
      return role(
        `${prefix}.${segment}`,
        `${side} ${stem} ${segment}`,
        index === 0 ? parent : `${prefix}.${segments[index - 1]}`,
        required && segment !== "ankle" && segment !== "toes",
        side,
        index === segments.length - 1 ? lastKind : "limb",
      );
    }),
  );
}

function linearRoles(
  stem: string,
  parent: string,
  count: number,
  required: boolean,
) {
  return Array.from({ length: count }, (_, index) =>
    role(
      `${stem}.${index + 1}`,
      `${stem} ${index + 1}`,
      index === 0 ? parent : `${stem}.${index}`,
      required,
      "center",
      "detail",
    ),
  );
}
