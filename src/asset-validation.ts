import { WebIO, type Document } from "@gltf-transform/core";
import { Vector3, type Object3D } from "three";
import { findMotionImportAdapter } from "@/adapters/motion";
import { loadCanonicalAvatarRig } from "@/browser/avatar-rig";
import { disposeObject } from "@/resources/dispose-three";
import {
  HUMANOID_BONES,
  REQUIRED_VRM_BONES,
  type HumanoidBoneName,
} from "@/retarget";
import {
  getRigDefinition,
  getSemanticRigProfile,
  inspectGLTFRig,
  type RigDefinitionId,
  type RigFamilyId,
} from "@/rigs";
import {
  importRigMotionDocument,
  listRigMotionActions,
} from "@/import/rig-motion-gltf";
import { getAvatarEagerInputLimit } from "@/jobs/asset-memory-policy";
import { readFileArrayBufferWithSignal } from "@/browser/read-file";

export type AssetValidationKind = "character" | "motion";

export type AssetValidationCheck = {
  name: string;
  ok: boolean;
  details?: string[];
};

export type AssetValidationWarning = {
  name: string;
  message: string;
};

export type AssetValidationResult = {
  ok: boolean;
  kind: AssetValidationKind;
  filename: string;
  checks: AssetValidationCheck[];
  warnings: AssetValidationWarning[];
  summary: {
    boneCount?: number;
    skinnedPrimitiveCount?: number;
    motionTrackCount?: number;
    rigFamily?: RigFamilyId;
    rigDefinitionId?: RigDefinitionId;
    rigProfileId?: string;
  };
};

export type AssetRigContract = {
  rigFamily: RigFamilyId;
  rigDefinitionId: RigDefinitionId;
  rigProfileId: string;
};

export const DEFAULT_ASSET_RIG_CONTRACT = {
  rigFamily: "humanoid",
  rigDefinitionId: "humanoid-v1",
  rigProfileId: "canonical-humanoid-v1",
} as const satisfies AssetRigContract;

const WEIGHT_TOLERANCE = 1e-3;
const HUMAN_BONE_SET = new Set<string>(HUMANOID_BONES);

export async function validateAssetFile(
  file: File,
  kind: AssetValidationKind,
  rigContract: AssetRigContract = DEFAULT_ASSET_RIG_CONTRACT,
): Promise<AssetValidationResult> {
  try {
    assertRigContract(rigContract);
    if (rigContract.rigFamily === "humanoid") {
      return kind === "character"
        ? validateHumanoidCharacterAsset(file, rigContract)
        : validateHumanoidMotionAsset(file, rigContract);
    }
    return kind === "character"
      ? validateSemanticCharacterAsset(file, rigContract)
      : validateSemanticMotionAsset(file, rigContract);
  } catch (error) {
    return {
      ok: false,
      kind,
      filename: file.name,
      checks: [
        {
          name: "GLB parses through the validator",
          ok: false,
          details: [errorMessage(error)],
        },
      ],
      warnings: [],
      summary: {},
    };
  }
}

export function formatAssetValidationReport(result: AssetValidationResult) {
  const lines = [
    `${result.ok ? "PASS" : "FAIL"} ${result.kind} asset: ${result.filename}`,
  ];

  if (result.summary.boneCount !== undefined) {
    lines.push(`Bones: ${result.summary.boneCount}`);
  }
  if (result.summary.skinnedPrimitiveCount !== undefined) {
    lines.push(`Skinned primitives: ${result.summary.skinnedPrimitiveCount}`);
  }
  if (result.summary.motionTrackCount !== undefined) {
    lines.push(`Motion tracks: ${result.summary.motionTrackCount}`);
  }
  if (result.summary.rigDefinitionId) {
    lines.push(
      `Rig: ${result.summary.rigFamily}/${result.summary.rigDefinitionId}/${result.summary.rigProfileId}`,
    );
  }

  lines.push("", "Checks:");
  for (const check of result.checks) {
    lines.push(`${check.ok ? "  PASS" : "  FAIL"} ${check.name}`);
    for (const detail of check.details ?? []) {
      lines.push(`    - ${detail}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) {
      lines.push(`  WARN ${warning.name}: ${warning.message}`);
    }
  }

  return lines.join("\n");
}

async function validateHumanoidCharacterAsset(
  file: File,
  rigContract: AssetRigContract,
): Promise<AssetValidationResult> {
  const document = await readGLBDocument(file);
  const exactMissingBones = REQUIRED_VRM_BONES.filter(
    (bone) => !document.getRoot().listNodes().some((node) => node.getName() === bone),
  );
  const skinning = validateSkinning(document);
  const textureIssues = validateEmbeddedBaseColorTextures(document);
  const rigFile = await createTexturelessRigCheckFile(document, file.name);
  const rig = await loadCanonicalAvatarRig(rigFile, "gltf-humanoid").catch(
    (error: unknown) => ({
      bones: new Map<HumanoidBoneName, Object3D>(),
      missingRequiredBones: [...REQUIRED_VRM_BONES],
      restHipsHeight: undefined,
      error: errorMessage(error),
    }),
  );
  const warnings = [
    ...warnOnRestPose(rig.bones),
    ...warnOnScale(rig.restHipsHeight),
  ];

  const checks: AssetValidationCheck[] = [
    {
      name: "Required bones are present with exact canonical names",
      ok: exactMissingBones.length === 0,
      details: exactMissingBones.map((bone) => `Missing ${bone}`),
    },
    {
      name: "Skinned vertex influences use at most 4 weights and sum to 1",
      ok: skinning.issues.length === 0,
      details: skinning.issues,
    },
    {
      name: "baseColorTexture images are embedded",
      ok: textureIssues.length === 0,
      details: textureIssues,
    },
    {
      name: "loadCanonicalAvatarRig reports all required bones",
      ok: !("error" in rig) && rig.missingRequiredBones.length === 0,
      details: [
        ...("error" in rig ? [rig.error] : []),
        ...rig.missingRequiredBones.map((bone) => `Missing ${bone}`),
      ],
    },
  ];

  const result: AssetValidationResult = {
    ok: checks.every((check) => check.ok),
    kind: "character",
    filename: file.name,
    checks,
    warnings,
    summary: {
      boneCount: rig.bones.size,
      skinnedPrimitiveCount: skinning.skinnedPrimitiveCount,
      ...rigContract,
    },
  };
  if (!("error" in rig)) {
    rig.resourceScope?.dispose();
    disposeObject(rig.root);
  }
  return result;
}

async function validateHumanoidMotionAsset(
  file: File,
  rigContract: AssetRigContract,
): Promise<AssetValidationResult> {
  const exactMissingBones = await getExactMissingAnimatedBones(file);
  const adapter = await findMotionImportAdapter(file, "gltf-animation");
  let importError: string | null = null;
  let trackCount = 0;
  let missingTrackBones: HumanoidBoneName[] = [...REQUIRED_VRM_BONES];

  if (!adapter?.importMotion) {
    importError = "No gltf-animation importer accepts this file.";
  } else {
    try {
      const motion = await adapter.importMotion(file);
      trackCount = motion.tracks.length;
      const trackedBones = new Set(motion.tracks.map((track) => track.bone));
      missingTrackBones = REQUIRED_VRM_BONES.filter((bone) => !trackedBones.has(bone));
    } catch (error) {
      importError = error instanceof Error ? error.message : String(error);
    }
  }

  const checks: AssetValidationCheck[] = [
    {
      name: "Required bones are present with exact canonical names",
      ok: exactMissingBones.length === 0,
      details: exactMissingBones.map((bone) => `Missing ${bone}`),
    },
    {
      name: "gltf-animation importer returns tracks for all required bones",
      ok: !importError && missingTrackBones.length === 0,
      details: [
        ...(importError ? [importError] : []),
        ...missingTrackBones.map((bone) => `Missing track for ${bone}`),
      ],
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    kind: "motion",
    filename: file.name,
    checks,
    warnings: [],
    summary: {
      motionTrackCount: trackCount,
      ...rigContract,
    },
  };
}

async function validateSemanticCharacterAsset(
  file: File,
  rigContract: AssetRigContract,
): Promise<AssetValidationResult> {
  const document = await readGLBDocument(file);
  const inspection = inspectGLTFRig(document, {
    familyOverride: rigContract.rigFamily,
    profileId: rigContract.rigProfileId,
  });
  const skinning = validateSkinning(document);
  const textureIssues = validateEmbeddedBaseColorTextures(document);
  const contractIssues = getInspectionContractIssues(inspection, rigContract);
  const checks: AssetValidationCheck[] = [
    {
      name: `${rigContract.rigDefinitionId} required roles are mapped`,
      ok: inspection.missingRequiredRoles.length === 0,
      details: inspection.missingRequiredRoles.map((role) => `Missing ${role}`),
    },
    {
      name: "Declared rig metadata matches detected rig",
      ok: contractIssues.length === 0,
      details: contractIssues,
    },
    {
      name: "All required semantic chains have 100% coverage",
      ok: inspection.requiredChainCoverage === 1,
      details:
        inspection.requiredChainCoverage === 1
          ? []
          : [`Coverage ${round(inspection.requiredChainCoverage * 100)}%`],
    },
    {
      name: "Skinned vertex influences use at most 4 weights and sum to 1",
      ok: skinning.issues.length === 0,
      details: skinning.issues,
    },
    {
      name: "baseColorTexture images are embedded",
      ok: textureIssues.length === 0,
      details: textureIssues,
    },
  ];
  return {
    ok: checks.every((check) => check.ok),
    kind: "character",
    filename: file.name,
    checks,
    warnings: [],
    summary: {
      boneCount: inspection.nodesByRole.size,
      skinnedPrimitiveCount: skinning.skinnedPrimitiveCount,
      ...rigContract,
    },
  };
}

async function validateSemanticMotionAsset(
  file: File,
  rigContract: AssetRigContract,
): Promise<AssetValidationResult> {
  const document = await readGLBDocument(file);
  const inspection = inspectGLTFRig(document, {
    familyOverride: rigContract.rigFamily,
    profileId: rigContract.rigProfileId,
  });
  const contractIssues = getInspectionContractIssues(inspection, rigContract);
  let motionTrackCount = 0;
  let importIssue: string | null = null;
  try {
    const actions = listRigMotionActions(document);
    if (actions.length === 0) {
      throw new Error("glTF file does not contain an animation.");
    }
    for (const action of actions) {
      const motion = importRigMotionDocument(document, file.name, {
        familyOverride: rigContract.rigFamily,
        profileId: rigContract.rigProfileId,
        animationIndex: action.index,
      });
      motionTrackCount += motion.tracks.length;
    }
  } catch (error) {
    importIssue = errorMessage(error);
  }
  const checks: AssetValidationCheck[] = [
    {
      name: `${rigContract.rigDefinitionId} required roles are animated`,
      ok: inspection.missingRequiredRoles.length === 0,
      details: inspection.missingRequiredRoles.map((role) => `Missing ${role}`),
    },
    {
      name: "Declared rig metadata matches detected rig",
      ok: contractIssues.length === 0,
      details: contractIssues,
    },
    {
      name: "Rig Motion v2 importer accepts the animation",
      ok: !importIssue && motionTrackCount > 0,
      details: importIssue ? [importIssue] : [],
    },
  ];
  return {
    ok: checks.every((check) => check.ok),
    kind: "motion",
    filename: file.name,
    checks,
    warnings: [],
    summary: {
      motionTrackCount,
      ...rigContract,
    },
  };
}

function assertRigContract(contract: AssetRigContract) {
  const definition = getRigDefinition(contract.rigDefinitionId);
  const profile = getSemanticRigProfile(contract.rigProfileId);
  if (!definition || definition.family !== contract.rigFamily) {
    throw new Error(
      `Invalid rig contract ${contract.rigFamily}/${contract.rigDefinitionId}.`,
    );
  }
  if (
    !profile ||
    profile.family !== contract.rigFamily ||
    profile.rigDefinitionId !== contract.rigDefinitionId
  ) {
    throw new Error(
      `Rig profile ${contract.rigProfileId} does not match ${contract.rigDefinitionId}.`,
    );
  }
}

function getInspectionContractIssues(
  inspection: ReturnType<typeof inspectGLTFRig>,
  contract: AssetRigContract,
) {
  const issues: string[] = [];
  if (inspection.definition.family !== contract.rigFamily) {
    issues.push(
      `Detected family ${inspection.definition.family}, declared ${contract.rigFamily}.`,
    );
  }
  if (inspection.definition.id !== contract.rigDefinitionId) {
    issues.push(
      `Detected definition ${inspection.definition.id}, declared ${contract.rigDefinitionId}.`,
    );
  }
  if (inspection.profile.id !== contract.rigProfileId) {
    issues.push(
      `Detected profile ${inspection.profile.id}, declared ${contract.rigProfileId}.`,
    );
  }
  return issues;
}

async function readGLBDocument(file: File) {
  return new WebIO().readBinary(
    new Uint8Array(
      await readFileArrayBufferWithSignal(
        file,
        getAvatarEagerInputLimit(file),
        "avatar",
      ),
    ),
  );
}

async function createTexturelessRigCheckFile(document: Document, filename: string) {
  // GLTFLoader's image decoding is browser-only. Texture embedding is checked
  // directly above; this second pass only needs the same mesh and skeleton.
  for (const texture of document.getRoot().listTextures()) {
    texture.dispose();
  }
  const bytes = await new WebIO().writeBinary(document);
  return new File(
    [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
    filename,
    { type: "model/gltf-binary" },
  );
}

function validateSkinning(document: Document) {
  const issues: string[] = [];
  let skinnedPrimitiveCount = 0;

  for (const node of document.getRoot().listNodes()) {
    if (!node.getSkin() || !node.getMesh()) {
      continue;
    }

    for (const primitive of node.getMesh()!.listPrimitives()) {
      skinnedPrimitiveCount += 1;
      const weights = listNumberedAttributes(primitive, "WEIGHTS");
      const joints = listNumberedAttributes(primitive, "JOINTS");
      const primaryWeights = primitive.getAttribute("WEIGHTS_0");
      const primaryJoints = primitive.getAttribute("JOINTS_0");
      if (!primaryWeights || !primaryJoints) {
        issues.push(`${node.getName() || "mesh"} is skinned without JOINTS_0/WEIGHTS_0.`);
        continue;
      }

      for (let vertex = 0; vertex < primaryWeights.getCount(); vertex += 1) {
        let influenceCount = 0;
        let weightSum = 0;
        for (let index = 0; index < Math.max(weights.length, joints.length); index += 1) {
          const weight = weights[index]?.accessor;
          if (!weight) {
            continue;
          }
          const values = weight.getElement(vertex, []);
          for (const value of values) {
            if (Math.abs(value) > WEIGHT_TOLERANCE) {
              influenceCount += 1;
            }
            weightSum += value;
          }
        }

        if (influenceCount > 4) {
          issues.push(
            `${node.getName() || "mesh"} vertex ${vertex} has ${influenceCount} non-zero joint weights.`,
          );
        }
        if (Math.abs(weightSum - 1) > WEIGHT_TOLERANCE) {
          issues.push(
            `${node.getName() || "mesh"} vertex ${vertex} weights sum to ${round(weightSum)}.`,
          );
        }
      }
    }
  }

  return { issues, skinnedPrimitiveCount };
}

function listNumberedAttributes(
  primitive: ReturnType<Document["createPrimitive"]>,
  prefix: "JOINTS" | "WEIGHTS",
) {
  return primitive
    .listSemantics()
    .map((semantic) => {
      const match = semantic.match(new RegExp(`^${prefix}_(\\d+)$`));
      return match
        ? { index: Number(match[1]), accessor: primitive.getAttribute(semantic)! }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => left.index - right.index);
}

function validateEmbeddedBaseColorTextures(document: Document) {
  return document
    .getRoot()
    .listMaterials()
    .flatMap((material) => {
      const texture = material.getBaseColorTexture();
      if (!texture || texture.getImage()) {
        return [];
      }

      return [
        `${material.getName() || "material"} baseColorTexture references external URI ${texture.getURI() || "(missing URI)"}.`,
      ];
    });
}

async function getExactMissingAnimatedBones(file: File) {
  const document = await readGLBDocument(file);
  const animatedBones = new Set<string>();
  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      if (node && HUMAN_BONE_SET.has(node.getName())) {
        animatedBones.add(node.getName());
      }
    }
  }

  return REQUIRED_VRM_BONES.filter((bone) => !animatedBones.has(bone));
}

function warnOnRestPose(bones: ReadonlyMap<HumanoidBoneName, Object3D>) {
  const warnings: AssetValidationWarning[] = [];
  const left = armLooksHorizontal(bones.get("leftUpperArm"), bones.get("leftLowerArm"));
  const right = armLooksHorizontal(bones.get("rightUpperArm"), bones.get("rightLowerArm"));
  if (left === false || right === false) {
    warnings.push({
      name: "Rest pose",
      message: "Arm bones do not look roughly horizontal; confirm this is a T-pose.",
    });
  }

  return warnings;
}

function armLooksHorizontal(upper?: Object3D, lower?: Object3D) {
  if (!upper || !lower) {
    return undefined;
  }

  const start = worldPosition(upper);
  const end = worldPosition(lower);
  const delta = end.sub(start);
  const horizontal = Math.hypot(delta.x, delta.z);
  return horizontal > 0 && Math.abs(delta.y) <= horizontal * 0.35;
}

function warnOnScale(restHipsHeight?: number) {
  if (restHipsHeight === undefined || (restHipsHeight >= 0.5 && restHipsHeight <= 2.2)) {
    return [];
  }

  return [
    {
      name: "Meter scale",
      message: `hips rest height is ${round(restHipsHeight)}m; confirm the asset is exported in meters.`,
    },
  ];
}

function worldPosition(object: Object3D) {
  object.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(object.matrixWorld);
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
