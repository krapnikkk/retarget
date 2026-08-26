import { importBVH } from "@/import/bvh";
import { importGLTFAnimation } from "@/import/gltf-animation";
import { importVMD } from "@/import/vmd";
import { importVRMA } from "@/import/vrma";
import {
  importRigMotionDocument,
  listRigMotionActions,
} from "@/import/rig-motion-gltf";
import { readGLTFDocument } from "@/import/gltf-document";
import { importFBXHumanoidMotionBytes } from "@/import/fbx-motion";
import {
  ACTORCORE_PROFILE,
  GENERIC_FBX_HUMANOID_PROFILE,
  MIXAMO_RIG_PROFILE,
} from "@/profiles";
import { createRetargetError, serializeMotionClip } from "@/retarget";
import { validateHumanoidMotionSemantics } from "@/validation";
import { solveHumanoidCustomRigMotion } from "@/solvers";
import { getRigSolver } from "@/solvers";
import {
  calculateRequiredChainCoverage,
  getRequiredRigRoles,
  getRigDefinition,
  getSemanticRigProfile,
  inspectGLTFRig,
} from "@/rigs";
import { assertValidParentGraph } from "@/core/parent-graph";
import { createTransferableAssetPackageResolver } from "@/import/asset-package";
import {
  assertMotionProcessingBudget,
  assertOutputBytes,
  assertRigMotionProcessingBudget,
  createProcessingDeadline,
  resolveProcessingBudget,
  type ProcessingBudget,
} from "@/processing-budget";
import {
  assertInputWithinBudget,
  resolveParseBudget,
  type ParseBudget,
} from "@/import/parse-budget";
import type {
  RetargetJobPhase,
  RetargetJobRequest,
  RetargetJobTask,
  SerializedRigInspection,
} from "./types";
import { serializeRigInspection } from "./serialize-rig-inspection";
import { assertRetargetJobRequest } from "./runtime-protocol";
import { collectRetargetTaskTransfers } from "./transferables";

export type RetargetJobReporter = (
  phase: RetargetJobPhase,
  progress: number,
) => void;

export async function executeRetargetJob(
  request: RetargetJobRequest,
  report: RetargetJobReporter = () => undefined,
) {
  assertRetargetJobRequest(request);
  const parseBudget = resolveParseBudget(request.budget?.parse);
  const processingBudget = resolveProcessingBudget(request.budget?.processing);
  assertTaskInputBudget(request.task, parseBudget);
  const deadline = createProcessingDeadline(request.deadlineMs);
  report("validate", 0.02);
  deadline.checkpoint("validate");

  const result = await executeTask(
    request.task,
    report,
    deadline,
    parseBudget,
    processingBudget,
  );
  deadline.checkpoint("complete");
  report("complete", 1);
  return result;
}

async function executeTask(
  task: RetargetJobTask,
  report: RetargetJobReporter,
  deadline: ReturnType<typeof createProcessingDeadline>,
  parseBudget: ParseBudget,
  processingBudget: ProcessingBudget,
) {
  assertTaskInputSafety(task, processingBudget);
  if (task.type === "humanoid-binding") {
    const { executeHumanoidBinding } = await import("@/pipelines/humanoid-binding");
    return executeHumanoidBinding(task.bytes, task.command, { parseBudget, processingBudget }, report,
      (phase) => deadline.checkpoint(phase));
  }
  if (task.type === "inspect-humanoid-avatar") {
    report("parse", 0.08);
    const { inspectHumanoidAvatarBytes } = await import(
      "./inspect-humanoid-avatar"
    );
    const inspection = await inspectHumanoidAvatarBytes(task);
    deadline.checkpoint("inspect-humanoid-avatar");
    report("normalize", 0.88);
    return inspection;
  }
  if (task.type === "convert-mmd-avatar") {
    report("parse", 0.08);
    const [{ WebIO }, { convertMMDModelToGLBDocument }] = await Promise.all([
      import("@gltf-transform/core"),
      import("@/export/avatar-conversion"),
    ]);
    const resolveResource = createTransferableAssetPackageResolver(
      task.assetPackage,
    );
    const document = convertMMDModelToGLBDocument(
      new Uint8Array(task.bytes),
      task.filename,
      resolveResource,
    );
    deadline.checkpoint("convert-mmd-avatar");
    report("export", 0.78);
    const bytes = await new WebIO().writeBinary(document);
    assertOutputBytes(bytes.byteLength, processingBudget);
    return bytes;
  }

  if (task.type === "inspect-rigged-gltf") {
    report("parse", 0.1);
    const document = await readGLTFDocument(
      new Uint8Array(task.bytes),
      undefined,
      restoreGLTFResources(task.resources),
    );
    deadline.checkpoint("parse-rigged-gltf");
    const inspection = inspectGLTFRig(document);
    report("normalize", 0.82);
    return {
      inspection: serializeRigInspection(inspection),
      actions: listRigMotionActions(document),
    };
  }

  if (task.type === "import-motion") {
    report("parse", 0.1);
    const bytes = new Uint8Array(task.bytes);
    const clip =
      task.formatId === "mixamo-fbx" ||
      task.formatId === "actorcore-fbx" ||
      task.formatId === "generic-fbx"
        ? importFBXHumanoidMotionBytes({
            bytes: task.bytes,
            filename: task.filename,
            kind: task.formatId,
            profile:
              task.formatId === "mixamo-fbx"
                ? MIXAMO_RIG_PROFILE
                : task.formatId === "actorcore-fbx"
                  ? ACTORCORE_PROFILE
                  : GENERIC_FBX_HUMANOID_PROFILE,
            animationIndex: task.animationIndex,
            animationName: task.animationName,
            budget: parseBudget,
          })
        : task.formatId === "bvh"
        ? importBVH(bytes, task.filename, parseBudget)
        : task.formatId === "vmd"
          ? importVMD(bytes, task.filename, parseBudget)
          : task.formatId === "vrma"
            ? await importVRMA(bytes, task.filename, parseBudget)
            : task.formatId === "gltf-animation"
              ? await importGLTFAnimation(
                  bytes,
                  task.filename,
                  {
                    animationIndex: task.animationIndex,
                    animationName: task.animationName,
                    budget: parseBudget,
                    resources: restoreGLTFResources(task.resources),
                  },
                )
              : assertNever(task.formatId);
    deadline.checkpoint("parse");
    report("normalize", 0.82);
    assertMotionProcessingBudget(clip, processingBudget);
    return clip;
  }

  if (task.type === "solve-humanoid") {
    assertMotionProcessingBudget(task.motion, processingBudget);
    report("solve", 0.18);
    const targetRig = task.targetRig
      ? { ...task.targetRig, bones: new Set(task.targetRig.bones) }
      : undefined;
    const clip = solveHumanoidCustomRigMotion(
      task.motion,
      task.mapping,
      targetRig,
      task.options,
      processingBudget,
    );
    deadline.checkpoint("solve");
    report("refine", 0.82);
    assertMotionProcessingBudget(clip, processingBudget);
    return clip;
  }

  if (task.type === "retarget-rigged-gltf") {
    report("parse", 0.08);
    const sourceDocument = await readGLTFDocument(
      new Uint8Array(task.motionBytes),
      undefined,
      restoreGLTFResources(task.motionResources),
    );
    deadline.checkpoint("parse-source-rig");
    const sourceOptions = {
      familyOverride: task.recipe?.family ?? "auto",
      profileId: task.recipe?.sourceProfileId ?? "auto",
      roleOverrides: task.recipe?.sourceRoleOverrides,
    } as const;
    const targetOptions = {
      familyOverride: task.recipe?.family ?? "auto",
      profileId: task.recipe?.targetProfileId ?? "auto",
      roleOverrides: task.recipe?.targetRoleOverrides,
    } as const;
    const sourceInspection = inspectGLTFRig(sourceDocument, sourceOptions);
    if (!task.targetInspection && !task.targetBytes) {
      throw new Error(
        "Rigged glTF retarget jobs require target bytes or a structural target inspection.",
      );
    }
    const targetInspection =
      task.targetInspection ??
      inspectGLTFRig(
        await readGLTFDocument(
          new Uint8Array(task.targetBytes!),
          undefined,
          restoreGLTFResources(task.targetResources),
        ),
        targetOptions,
      );
    const serializedTargetInspection = serializeRigInspection(targetInspection);
    deadline.checkpoint("inspect-rigs");
    const solver = getRigSolver(
      sourceInspection.definition.id,
      targetInspection.definition.id,
    );
    if (!solver) {
      throw new Error(
        `No active solver for ${sourceInspection.definition.id} -> ${targetInspection.definition.id}.`,
      );
    }
    const sourceMotion = importRigMotionDocument(
      sourceDocument,
      task.motionFilename,
      {
        ...sourceOptions,
        animationIndex: task.animationIndex,
        animationName: task.animationName,
      },
    );
    assertRigMotionProcessingBudget(sourceMotion, processingBudget);
    report("solve", 0.55);
    const motion = solver.solve({
      motion: sourceMotion,
      target: targetInspection,
      targetFilename: task.targetFilename,
    });
    deadline.checkpoint("solve-rig-motion");
    assertRigMotionProcessingBudget(motion, processingBudget);
    return {
      motion,
      sourceMotion,
      sourceInspection: serializeRigInspection(sourceInspection),
      targetInspection: serializedTargetInspection,
      solver: solver.id,
    };
  }

  if (task.type === "export-motion") {
    assertMotionProcessingBudget(task.clip, processingBudget);
    report("export", 0.15);
    const bytes = await exportMotion(task, processingBudget);
    assertOutputBytes(bytes.byteLength, processingBudget);
    deadline.checkpoint("export");
    return bytes;
  }

  if (task.type === "validate-motion-export") {
    report("structural-validate", 0.15);
    const { validateMotionExportReload, validateMotionExportSemantics } =
      await import("@/export/reload-validation");
    const bytes = new Uint8Array(task.bytes);
    const structural = await validateMotionExportReload(task.formatId, bytes);
    deadline.checkpoint("structural-validate");
    report("semantic-validate", 0.55);
    const semantic = structural.ok
      ? await validateMotionExportSemantics(
          task.formatId,
          bytes,
          task.expected,
        )
      : null;
    return { structural, semantic };
  }

  if (task.type === "validate-avatar-export") {
    report("structural-validate", 0.15);
    const { validateAvatarExportReload, validateAvatarExportSemantics } =
      await import("@/export/reload-validation");
    const bytes = new Uint8Array(task.bytes);
    const structural = await validateAvatarExportReload(task.formatId, bytes);
    deadline.checkpoint("structural-validate");
    report("semantic-validate", 0.55);
    const semantic = structural.ok
      ? await validateAvatarExportSemantics(
          task.formatId,
          bytes,
          task.expected,
        )
      : null;
    return { structural, semantic };
  }

  if (task.type === "semantic-validate") {
    report("semantic-validate", 0.15);
    assertMotionProcessingBudget(task.actual, processingBudget);
    assertMotionProcessingBudget(task.expected, processingBudget);
    return validateHumanoidMotionSemantics({
      actual: task.actual,
      expected: task.expected,
      restPose: task.restPose ? new Map(task.restPose) : undefined,
    });
  }
  return assertNever(task);
}

function assertTaskInputBudget(task: RetargetJobTask, budget: ParseBudget) {
  const byteLength = collectRetargetTaskTransfers(task).reduce(
    (total, buffer) => total + buffer.byteLength,
    0,
  );
  assertInputWithinBudget(byteLength, budget, {
    section: `${task.type} Worker request`,
  });
}

function assertTaskInputSafety(
  task: RetargetJobTask,
  processingBudget: ProcessingBudget,
) {
  if (
    task.type === "convert-mmd-avatar" ||
    task.type === "inspect-rigged-gltf" ||
    task.type === "inspect-humanoid-avatar"
  ) {
    if (task.type === "inspect-humanoid-avatar" && task.structuralJSONBytes) {
      if (task.bytes.byteLength !== 0) {
        throw createRetargetError("TARGET_RIG_INVALID");
      }
    }
    return;
  }
  if (task.type === "retarget-rigged-gltf") {
    if (task.targetInspection) {
      assertSerializedRigInspection(task.targetInspection, processingBudget);
    }
    return;
  }
  if (task.type === "validate-motion-export") {
    assertMotionProcessingBudget(task.expected, processingBudget);
    return;
  }
  if (task.type === "validate-avatar-export") {
    assertMotionProcessingBudget(task.expected, processingBudget);
  }
}

function assertSerializedRigInspection(
  inspection: SerializedRigInspection,
  budget: ProcessingBudget,
) {
  const canonicalDefinition = getRigDefinition(inspection.definition?.id);
  if (
    !canonicalDefinition ||
    JSON.stringify(inspection.definition) !== JSON.stringify(canonicalDefinition)
  ) {
    throw createRetargetError("TARGET_RIG_INVALID");
  }
  const canonicalProfile = getSemanticRigProfile(inspection.profile?.id);
  if (
    !canonicalProfile ||
    canonicalProfile.rigDefinitionId !== canonicalDefinition.id ||
    JSON.stringify(inspection.profile) !== JSON.stringify(canonicalProfile) ||
    !new RegExp(
      `^${escapeRegExp(canonicalDefinition.id)}:rest-node-skin-v3:sha256:[0-9a-f]{64}$`,
    ).test(inspection.signature)
  ) {
    throw createRetargetError("TARGET_RIG_INVALID");
  }
  if (!Array.isArray(inspection.restPose) || inspection.restPose.length === 0) {
    throw createRetargetError("TARGET_RIG_INVALID");
  }
  if (
    inspection.restPose.length > budget.maxTracks ||
    !Number.isFinite(inspection.requiredChainCoverage) ||
    inspection.requiredChainCoverage < 0 ||
    inspection.requiredChainCoverage > 1 ||
    !isBoundedStringArray(inspection.unmappedNodes, budget.maxTracks) ||
    !isBoundedStringArray(inspection.axisWarnings, budget.maxTracks) ||
    !Array.isArray(inspection.topologyConflicts) ||
    inspection.topologyConflicts.length > budget.maxTracks ||
    inspection.topologyConflicts.some((conflict) =>
      !conflict ||
      typeof conflict !== "object" ||
      !validRolesForConflict(canonicalDefinition, conflict)
    )
  ) {
    throw createRetargetError("TARGET_RIG_INVALID");
  }
  const validRoles = new Set(canonicalDefinition.roles.map((role) => role.id));
  const mappedRoles = new Set<string>();
  const nodeIndices = new Set<number>();
  for (const transform of inspection.restPose) {
    if (!transform || typeof transform !== "object") {
      throw createRetargetError("TARGET_RIG_INVALID");
    }
    const identity = transform.nodeIdentity;
    if (
      !validRoles.has(transform.role) ||
      mappedRoles.has(transform.role) ||
      (transform.parentRole !== undefined && !validRoles.has(transform.parentRole)) ||
      !isFiniteTuple(transform.translation, 3) ||
      !isFiniteTuple(transform.rotation, 4) ||
      !isFiniteTuple(transform.worldTranslation, 3) ||
      !isFiniteTuple(transform.worldRotation, 4) ||
      (transform.primaryAxis !== undefined && !isFiniteTuple(transform.primaryAxis, 3)) ||
      !identity ||
      !Number.isInteger(identity.nodeIndex) ||
      identity.nodeIndex < 0 ||
      nodeIndices.has(identity.nodeIndex) ||
      typeof identity.canonicalPath !== "string" ||
      identity.canonicalPath.length === 0 ||
      identity.canonicalPath.length > 4096 ||
      !isOptionalNonNegativeInteger(identity.skinIndex) ||
      !isOptionalNonNegativeInteger(identity.jointIndex)
    ) {
      throw createRetargetError("TARGET_RIG_INVALID");
    }
    mappedRoles.add(transform.role);
    nodeIndices.add(identity.nodeIndex);
  }
  assertValidParentGraph({
    nodeIds: mappedRoles,
    edges: inspection.restPose.flatMap((transform) =>
      transform.parentRole
        ? [{ childId: transform.role, parentId: transform.parentRole }]
        : []
    ),
    label: "Serialized target rig inspection",
  });
  const missingRequiredRoles = getRequiredRigRoles(canonicalDefinition)
    .filter((role) => !mappedRoles.has(role))
    .sort();
  if (
    !sameStrings(inspection.missingRequiredRoles, missingRequiredRoles) ||
    Math.abs(
      inspection.requiredChainCoverage -
      calculateRequiredChainCoverage(canonicalDefinition, mappedRoles)
    ) > 1e-12
  ) {
    throw createRetargetError("TARGET_RIG_INVALID");
  }
  const roleDefinitions = new Map(
    canonicalDefinition.roles.map((role) => [role.id, role]),
  );
  const derivedConflicts = inspection.restPose.flatMap((transform) => {
    let expectedParentRole = roleDefinitions.get(transform.role)?.parent;
    while (expectedParentRole && !mappedRoles.has(expectedParentRole)) {
      expectedParentRole = roleDefinitions.get(expectedParentRole)?.parent;
    }
    if (expectedParentRole === transform.parentRole) return [];
    if (!expectedParentRole && !transform.parentRole) return [];
    return [{
      role: transform.role,
      ...(expectedParentRole ? { expectedParentRole } : {}),
      ...(transform.parentRole ? { actualParentRole: transform.parentRole } : {}),
    }];
  });
  if (
    JSON.stringify(sortTopologyConflicts(inspection.topologyConflicts)) !==
      JSON.stringify(sortTopologyConflicts(derivedConflicts))
  ) {
    throw createRetargetError("TARGET_RIG_INVALID");
  }
}

function isFiniteTuple(value: unknown, size: number) {
  return Array.isArray(value) && value.length === size &&
    value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function sameStrings(actual: unknown, expected: readonly string[]) {
  return Array.isArray(actual) &&
    actual.every((item) => typeof item === "string") &&
    JSON.stringify([...actual].sort()) === JSON.stringify(expected);
}

function isBoundedStringArray(value: unknown, maxItems: number) {
  return Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === "string" && item.length <= 1024);
}

function validRolesForConflict(
  definition: NonNullable<ReturnType<typeof getRigDefinition>>,
  conflict: { role?: unknown; expectedParentRole?: unknown; actualParentRole?: unknown },
) {
  const roles = new Set(definition.roles.map((role) => role.id));
  return typeof conflict.role === "string" && roles.has(conflict.role) &&
    (conflict.expectedParentRole === undefined ||
      (typeof conflict.expectedParentRole === "string" &&
        roles.has(conflict.expectedParentRole))) &&
    (conflict.actualParentRole === undefined ||
      (typeof conflict.actualParentRole === "string" &&
        roles.has(conflict.actualParentRole)));
}

function isOptionalNonNegativeInteger(value: unknown) {
  return value === undefined || (Number.isInteger(value) && (value as number) >= 0);
}

function sortTopologyConflicts(
  conflicts: readonly {
    role: string;
    expectedParentRole?: string;
    actualParentRole?: string;
  }[],
) {
  return conflicts.map((conflict) => ({ ...conflict })).sort((left, right) =>
    left.role.localeCompare(right.role)
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function restoreGLTFResources(
  resources?: Readonly<Record<string, ArrayBuffer>>,
) {
  if (!resources) return undefined;
  return Object.fromEntries(
    Object.entries(resources).map(([uri, bytes]) => [uri, new Uint8Array(bytes)]),
  );
}

async function exportMotion(
  task: Extract<RetargetJobTask, { type: "export-motion" }>,
  budget: ProcessingBudget,
) {
  if (task.formatId === "motion-json") {
    return new TextEncoder().encode(serializeMotionClip(task.clip));
  }
  if (task.formatId === "vrma") {
    return (await import("@/export/vrma")).exportVRMA(task.clip, task.options);
  }
  if (task.formatId === "vmd") {
    return (await import("@/export/vmd")).exportVMD(
      task.clip,
      task.options,
      budget,
    );
  }
  if (task.formatId === "gltf-animation") {
    return (await import("@/export/gltf-animation")).exportGLTFAnimation(
      task.clip,
      task.options,
    );
  }
  if (task.formatId === "bvh") {
    return (await import("@/export/bvh")).exportBVH(
      task.clip,
      task.options,
      budget,
    );
  }
  if (task.formatId === "fbx-animation") {
    return (await import("@/export/fbx")).exportFBXAnimation(
      task.clip,
      task.options,
    );
  }
  return assertNever(task.formatId);
}

function assertNever(value: never): never {
  throw createRetargetError("UNSUPPORTED_FORMAT", String(value));
}
