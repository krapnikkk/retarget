export const RIG_FAMILIES = [
  "humanoid",
  "quadruped",
  "avian",
  "serpentine",
  "arachnid",
  "creature",
] as const;

export type RigFamilyId = (typeof RIG_FAMILIES)[number];

export type ActiveRigDefinitionId =
  | "humanoid-v1"
  | "quadruped-v1"
  | "avian-v1"
  | "serpentine-v1"
  | "arachnid-v1"
  | "creature-v1";
export type RigDefinitionId = ActiveRigDefinitionId;

export type RigRoleId = string;

export type RigRole = {
  id: RigRoleId;
  label: string;
  parent?: RigRoleId;
  required?: boolean;
  side?: "left" | "right" | "center";
  kind?: "root" | "body" | "limb" | "contact" | "detail";
};

export type RigChain = {
  id: string;
  label: string;
  roles: readonly RigRoleId[];
  required?: boolean;
  contactRole?: RigRoleId;
  minimumMappedRoles?: number;
};

export type RigDefinition = {
  schemaVersion: 1;
  id: ActiveRigDefinitionId;
  family: RigFamilyId;
  label: string;
  rootRole: RigRoleId;
  translationRole: RigRoleId;
  roles: readonly RigRole[];
  chains: readonly RigChain[];
  scaleRoles: readonly RigRoleId[];
  contactRoles: readonly RigRoleId[];
};

export type RigProfileRole = {
  role: RigRoleId;
  aliases: readonly string[];
};

export type SemanticRigProfile = {
  id: string;
  label: string;
  family: RigFamilyId;
  rigDefinitionId: RigDefinitionId;
  upAxis: "x" | "y" | "z" | "-x" | "-y" | "-z";
  forwardAxis: "x" | "y" | "z" | "-x" | "-y" | "-z";
  scaleUnit: "meters" | "centimeters" | "unknown";
  roles: readonly RigProfileRole[];
  orderedChains?: readonly {
    roles: readonly RigRoleId[];
    nodePattern: string;
  }[];
  notes: readonly string[];
};

export type RigCompatibility = {
  compatible: boolean;
  reason:
    | "same-definition"
    | "family-mismatch"
    | "definition-mismatch"
    | "unsupported-definition";
};

export type RigRecipe = {
  schemaVersion: 1;
  family: RigFamilyId;
  rigDefinitionId: RigDefinitionId;
  sourceProfileId: string | "auto";
  targetProfileId: string | "auto";
  sourceRoleOverrides: Record<RigRoleId, string>;
  targetRoleOverrides: Record<RigRoleId, string>;
};

export type RigTopologyConflict = {
  role: RigRoleId;
  expectedParentRole?: RigRoleId;
  actualParentRole?: RigRoleId;
};

export type RigNodeIdentity = {
  nodeIndex: number;
  canonicalPath: string;
  skinIndex?: number;
  jointIndex?: number;
};
