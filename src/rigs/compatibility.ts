import { getRigDefinition } from "./definitions";
import type {
  RigCompatibility,
  RigDefinitionId,
  RigFamilyId,
  RigRecipe,
} from "./types";

export function getRigCompatibility(
  source: { rigFamily: RigFamilyId; rigDefinitionId: RigDefinitionId },
  target: { rigFamily: RigFamilyId; rigDefinitionId: RigDefinitionId },
): RigCompatibility {
  if (source.rigFamily !== target.rigFamily) {
    return { compatible: false, reason: "family-mismatch" };
  }
  if (source.rigDefinitionId !== target.rigDefinitionId) {
    return { compatible: false, reason: "definition-mismatch" };
  }
  if (!getRigDefinition(source.rigDefinitionId)) {
    return { compatible: false, reason: "unsupported-definition" };
  }
  return { compatible: true, reason: "same-definition" };
}

export function createDefaultRigRecipe({
  family,
  rigDefinitionId,
}: {
  family: RigFamilyId;
  rigDefinitionId: RigDefinitionId;
}): RigRecipe {
  return {
    schemaVersion: 1,
    family,
    rigDefinitionId,
    sourceProfileId: "auto",
    targetProfileId: "auto",
    sourceRoleOverrides: {},
    targetRoleOverrides: {},
  };
}

export function parseRigRecipe(json: string): RigRecipe {
  const value = JSON.parse(json) as Partial<RigRecipe> | null;
  if (!value || value.schemaVersion !== 1) {
    throw new Error("Rig recipe schemaVersion must be 1.");
  }
  if (!value.family || !value.rigDefinitionId) {
    throw new Error("Rig recipe must declare family and rigDefinitionId.");
  }
  const definition = getRigDefinition(value.rigDefinitionId);
  if (!definition) {
    throw new Error(`Unsupported rig definition: ${value.rigDefinitionId}.`);
  }
  if (value.family !== definition.family) {
    throw new Error(
      `Rig recipe family ${value.family} does not match ${definition.id}.`,
    );
  }
  return {
    schemaVersion: 1,
    family: value.family,
    rigDefinitionId: value.rigDefinitionId,
    sourceProfileId: value.sourceProfileId ?? "auto",
    targetProfileId: value.targetProfileId ?? "auto",
    sourceRoleOverrides: readOverrides(value.sourceRoleOverrides),
    targetRoleOverrides: readOverrides(value.targetRoleOverrides),
  };
}

export function serializeRigRecipe(recipe: RigRecipe) {
  return JSON.stringify(parseRigRecipe(JSON.stringify(recipe)), null, 2);
}

function readOverrides(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
