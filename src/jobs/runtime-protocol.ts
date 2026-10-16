import type {
  AvatarExportFormatId,
  AvatarFormatId,
  MotionExportFormatId,
  MotionFormatId,
} from "@/formats";
import { RETARGET_ERROR_CODES, RetargetError } from "@/retarget/errors";
import { HUMANOID_BONES } from "@/retarget/types";
import {
  assertHumanoidBindingTask,
  assertHumanoidBindingTaskCooperatively,
  validateBindingSnapshot,
  validateBindingSnapshotCooperatively,
} from "@/binding/contracts";
import type { HumanoidBindingSnapshot } from "@/binding/types";
import {
  assertMotionProcessingBudget,
  assertOutputBytes,
  assertRigMotionProcessingBudget,
  resolveProcessingBudget,
  type ProcessingBudget,
} from "@/processing-budget";
import {
  assertInputWithinBudget,
  resolveParseBudget,
} from "@/import/parse-budget";
import { collectRetargetTaskTransfers } from "./transferables";
import {
  unpackHumanoidBindingSnapshotResult,
  usesHumanoidBindingSnapshotTransport,
} from "./humanoid-binding-snapshot-transport";
import {
  RETARGET_JOB_PROTOCOL_VERSION,
  type RetargetJobBudget,
  type RetargetJobRequest,
  type RetargetJobResponse,
  type RetargetJobTask,
} from "./types";

const TASK_TYPES = new Set<RetargetJobTask["type"]>([
  "humanoid-binding",
  "inspect-humanoid-avatar",
  "convert-mmd-avatar",
  "inspect-rigged-gltf",
  "import-motion",
  "solve-humanoid",
  "retarget-rigged-gltf",
  "export-motion",
  "validate-motion-export",
  "validate-avatar-export",
  "semantic-validate",
]);
const MOTION_FORMAT_IDS = new Set<string>([
  "mixamo-fbx",
  "vrma",
  "bvh",
  "vmd",
  "gltf-animation",
  "actorcore-fbx",
  "generic-fbx",
] satisfies readonly MotionFormatId[]);
const AVATAR_FORMAT_IDS = new Set<string>([
  "vrm",
  "gltf-humanoid",
  "mixamo-rigged",
  "ready-player-me",
  "reallusion",
  "mmd-model",
  "generic-fbx-avatar",
] satisfies readonly AvatarFormatId[]);
const MOTION_EXPORT_FORMAT_IDS = new Set<string>([
  "vrma",
  "motion-json",
  "vmd",
  "gltf-animation",
  "bvh",
  "fbx-animation",
] satisfies readonly MotionExportFormatId[]);
const AVATAR_EXPORT_FORMAT_IDS = new Set<string>([
  "animated-glb",
  "vrm-external-vrma",
  "baked-vrm",
  "fbx-avatar-animation",
  "animated-pmx",
] satisfies readonly AvatarExportFormatId[]);
const RESPONSE_TYPES = new Set(["progress", "success", "failure"]);
const PROGRESS_PHASES = new Set([
  "validate",
  "parse",
  "normalize",
  "solve",
  "refine",
  "export",
  "structural-validate",
  "semantic-validate",
  "complete",
]);

export function assertRetargetJobRequest(
  value: unknown,
): asserts value is RetargetJobRequest {
  const { task, parseBudget, processingBudget } = inspectRetargetJobRequest(value);
  assertTaskFields(task, processingBudget);
  assertTaskTransferBudget(task, parseBudget);
}

export async function assertRetargetJobRequestCooperatively(
  value: unknown,
  yieldControl: () => Promise<void>,
): Promise<void> {
  const { task, parseBudget, processingBudget } = inspectRetargetJobRequest(value);
  if (task.type === "humanoid-binding") await assertHumanoidBindingTaskCooperatively(task, yieldControl);
  else assertTaskFields(task, processingBudget);
  assertTaskTransferBudget(task, parseBudget);
}

function inspectRetargetJobRequest(value: unknown) {
  const request = asRecord(value, "Worker request");
  assertExactKeys(
    request,
    ["schemaVersion", "jobId", "deadlineMs", "budget", "task"],
    "Worker request",
  );
  if (request.schemaVersion !== RETARGET_JOB_PROTOCOL_VERSION) {
    protocolError("Worker request schemaVersion is unsupported.");
  }
  assertBoundedString(request.jobId, "Worker request jobId", 128);
  if (
    request.deadlineMs !== undefined &&
    (!Number.isSafeInteger(request.deadlineMs) ||
      (request.deadlineMs as number) <= 0)
  ) {
    protocolError("Worker request deadlineMs must be a positive safe integer.");
  }
  assertRetargetJobBudget(request.budget);
  const parseBudget = resolveParseBudget(request.budget?.parse);
  const processingBudget = resolveProcessingBudget(request.budget?.processing);
  const task = asRecord(request.task, "Worker request task");
  assertDataProperties(task, "Worker request task");
  if (typeof task.type !== "string" || !TASK_TYPES.has(task.type as never)) {
    protocolError("Worker request task discriminator is unsupported.");
  }
  const typedTask = task as unknown as RetargetJobTask;
  return { task: typedTask, parseBudget, processingBudget };
}

function assertTaskTransferBudget(task: RetargetJobTask, parseBudget: ReturnType<typeof resolveParseBudget>) {
  assertInputWithinBudget(
    collectRetargetTaskTransfers(task).reduce(
      (total, buffer) => total + buffer.byteLength,
      0,
    ),
    parseBudget,
    { section: `${task.type} Worker request` },
  );
}

export function assertRetargetJobResponse(
  value: unknown,
  request: RetargetJobRequest,
): asserts value is RetargetJobResponse {
  const response = asRecord(value, "Worker response");
  if (response.schemaVersion !== RETARGET_JOB_PROTOCOL_VERSION) {
    protocolError("Worker response schemaVersion is unsupported.");
  }
  if (response.jobId !== request.jobId) {
    protocolError("Worker response jobId does not match its request.");
  }
  if (typeof response.type !== "string" || !RESPONSE_TYPES.has(response.type)) {
    protocolError("Worker response discriminator is unsupported.");
  }
  if (response.type === "progress") {
    assertExactKeys(
      response,
      ["schemaVersion", "jobId", "type", "phase", "progress"],
      "Worker progress response",
    );
    if (
      typeof response.phase !== "string" ||
      !PROGRESS_PHASES.has(response.phase) ||
      typeof response.progress !== "number" ||
      !Number.isFinite(response.progress) ||
      response.progress < 0 ||
      response.progress > 1
    ) {
      protocolError("Worker progress response is invalid.");
    }
    return;
  }
  if (response.type === "failure") {
    assertExactKeys(
      response,
      ["schemaVersion", "jobId", "type", "error"],
      "Worker failure response",
    );
    const error = asRecord(response.error, "Worker failure error");
    assertExactKeys(
      error,
      ["name", "code", "message", "details"],
      "Worker failure error",
    );
    if (
      typeof error.code !== "string" ||
      !RETARGET_ERROR_CODES.includes(error.code as never)
    ) {
      protocolError("Worker failure code is not registered.");
    }
    assertBoundedString(error.name, "Worker failure name", 128);
    assertBoundedString(error.message, "Worker failure message", 16_384);
    return;
  }
  assertExactKeys(
    response,
    ["schemaVersion", "jobId", "type", "result"],
    "Worker success response",
  );
  assertTaskResult(
    request.task,
    response.result,
    resolveProcessingBudget(request.budget?.processing),
  );
}

export async function assertRetargetJobResponseCooperatively(
  value: unknown,
  request: RetargetJobRequest,
  yieldControl: () => Promise<void>,
): Promise<void> {
  const response = asRecord(value, "Worker response");
  assertDataProperties(response, "Worker response");
  if (response.type !== "success" || !usesHumanoidBindingSnapshotTransport(request.task)) {
    assertRetargetJobResponse(value, request);
    return;
  }
  if (response.schemaVersion !== RETARGET_JOB_PROTOCOL_VERSION || response.jobId !== request.jobId) {
    protocolError("Worker success response does not match its request.");
  }
  assertExactKeys(response, ["schemaVersion", "jobId", "type", "result"], "Worker success response");
  try {
    const snapshot = await unpackHumanoidBindingSnapshotResult(
      response.result,
      resolveProcessingBudget(request.budget?.processing),
      yieldControl,
    );
    await validateBindingSnapshotCooperatively(
      snapshot,
      yieldControl,
    );
    response.result = snapshot;
  } catch (cause) {
    if (cause instanceof RetargetError && cause.code === "WORKER_PROTOCOL_INVALID") throw cause;
    throw new RetargetError("WORKER_PROTOCOL_INVALID", {
      cause,
      message: "humanoid-binding result failed runtime validation.",
    });
  }
}

function assertTaskFields(task: RetargetJobTask, budget: ProcessingBudget) {
  switch (task.type) {
    case "humanoid-binding":
      assertHumanoidBindingTask(task);
      return;
    case "inspect-humanoid-avatar":
      assertExactKeys(task, [
        "type",
        "bytes",
        "filename",
        "formatId",
        "structuralJSONBytes",
        "resources",
        "assetPackage",
      ], task.type);
      assertArrayBuffer(task.bytes, "inspect-humanoid-avatar.bytes");
      if (task.structuralJSONBytes !== undefined) {
        assertArrayBuffer(
          task.structuralJSONBytes,
          "inspect-humanoid-avatar.structuralJSONBytes",
        );
      }
      assertFilename(task.filename);
      assertFormat(task.formatId, AVATAR_FORMAT_IDS);
      assertResources(task.resources, "inspect-humanoid-avatar.resources");
      assertAssetPackage(task.assetPackage, "inspect-humanoid-avatar.assetPackage");
      return;
    case "convert-mmd-avatar":
      assertExactKeys(
        task,
        ["type", "bytes", "filename", "assetPackage"],
        task.type,
      );
      assertArrayBuffer(task.bytes, "convert-mmd-avatar.bytes");
      assertFilename(task.filename);
      assertAssetPackage(task.assetPackage, "convert-mmd-avatar.assetPackage");
      return;
    case "inspect-rigged-gltf":
      assertExactKeys(
        task,
        ["type", "bytes", "filename", "resources"],
        task.type,
      );
      assertArrayBuffer(task.bytes, "inspect-rigged-gltf.bytes");
      assertFilename(task.filename);
      assertResources(task.resources, "inspect-rigged-gltf.resources");
      return;
    case "import-motion":
      assertExactKeys(task, [
        "type",
        "formatId",
        "filename",
        "bytes",
        "resources",
        "animationIndex",
        "animationName",
      ], task.type);
      assertArrayBuffer(task.bytes, "import-motion.bytes");
      assertFilename(task.filename);
      assertFormat(task.formatId, MOTION_FORMAT_IDS);
      assertResources(task.resources, "import-motion.resources");
      assertAnimationSelection(task);
      return;
    case "solve-humanoid":
      assertExactKeys(
        task,
        ["type", "motion", "mapping", "options", "targetRig"],
        task.type,
      );
      assertMotionProcessingBudget(task.motion, budget);
      assertMapping(task.mapping);
      assertSolveOptions(task.options);
      if (task.targetRig !== undefined) {
        const targetRig = asRecord(task.targetRig, "solve-humanoid.targetRig");
        assertExactKeys(
          targetRig,
          ["rigSignature", "profile", "bones", "skeleton", "restHipsHeight", "restJoints"],
          "solve-humanoid.targetRig",
        );
        if (typeof targetRig.rigSignature !== "string" ||
          targetRig.rigSignature.length === 0 ||
          !Array.isArray(targetRig.bones) || !isRecord(targetRig.profile) ||
          !isRecord(targetRig.skeleton)) {
          protocolError("solve-humanoid.targetRig is invalid.");
        }
        assertRestJoints(targetRig.restJoints, "solve-humanoid.targetRig.restJoints");
      }
      return;
    case "retarget-rigged-gltf":
      assertExactKeys(task, [
        "type",
        "motionBytes",
        "motionFilename",
        "motionResources",
        "targetBytes",
        "targetFilename",
        "targetResources",
        "targetInspection",
        "recipe",
        "animationIndex",
        "animationName",
      ], task.type);
      assertArrayBuffer(task.motionBytes, "retarget-rigged-gltf.motionBytes");
      assertFilename(task.motionFilename);
      assertFilename(task.targetFilename);
      if (task.targetBytes !== undefined) {
        assertArrayBuffer(task.targetBytes, "retarget-rigged-gltf.targetBytes");
      }
      assertResources(
        task.motionResources,
        "retarget-rigged-gltf.motionResources",
      );
      assertResources(
        task.targetResources,
        "retarget-rigged-gltf.targetResources",
      );
      if (task.targetInspection !== undefined && !isRecord(task.targetInspection)) {
        protocolError("retarget-rigged-gltf.targetInspection is invalid.");
      }
      if (task.targetBytes === undefined && task.targetInspection === undefined) {
        protocolError("retarget-rigged-gltf requires target bytes or inspection.");
      }
      assertRiggedGLTFAnimationSelection(task);
      if (task.recipe !== undefined) {
        asRecord(task.recipe, "retarget-rigged-gltf.recipe");
      }
      return;
    case "export-motion":
      assertExactKeys(
        task,
        ["type", "formatId", "clip", "options"],
        task.type,
      );
      assertFormat(task.formatId, MOTION_EXPORT_FORMAT_IDS);
      assertMotionProcessingBudget(task.clip, budget);
      if (task.options !== undefined) {
        const options = asRecord(task.options, "export-motion.options");
        assertExactKeys(options, ["boneNamingProfile"], "export-motion.options");
        if (
          options.boneNamingProfile !== undefined &&
          !["canonical", "mixamo", "actorcore", "bvh-standard", "mmd"]
            .includes(options.boneNamingProfile as string)
        ) {
          protocolError("export-motion.options is invalid.");
        }
      }
      return;
    case "validate-motion-export":
      assertExactKeys(
        task,
        ["type", "formatId", "bytes", "expected"],
        task.type,
      );
      assertArrayBuffer(task.bytes, "validate-motion-export.bytes");
      assertFormat(task.formatId, MOTION_EXPORT_FORMAT_IDS);
      assertMotionProcessingBudget(task.expected, budget);
      return;
    case "validate-avatar-export":
      assertExactKeys(
        task,
        ["type", "formatId", "bytes", "expected"],
        task.type,
      );
      assertArrayBuffer(task.bytes, "validate-avatar-export.bytes");
      assertFormat(task.formatId, AVATAR_EXPORT_FORMAT_IDS);
      assertMotionProcessingBudget(task.expected, budget);
      return;
    case "semantic-validate":
      assertExactKeys(
        task,
        ["type", "actual", "expected", "restPose"],
        task.type,
      );
      assertMotionProcessingBudget(task.actual, budget);
      assertMotionProcessingBudget(task.expected, budget);
      if (task.restPose !== undefined && !Array.isArray(task.restPose)) {
        protocolError("semantic-validate.restPose is invalid.");
      }
      return;
    default:
      return assertNever(task);
  }
}

function assertTaskResult(
  task: RetargetJobTask,
  result: unknown,
  budget: ProcessingBudget,
) {
  try {
    switch (task.type) {
      case "humanoid-binding": {
        const value = asRecord(result, "humanoid-binding result");
        if (task.command.operation === "inspect") {
          if (value.schemaVersion !== 1 || !isRecord(value.asset) || !isRecord(value.bounds) || !Array.isArray(value.diagnostics)) protocolError("Invalid binding inspection.");
        } else if (task.command.operation === "export") {
          assertExactKeys(value, ["bytes", "snapshotRevision", "rigRevision", "validation"], "Binding export");
          if (!(value.bytes instanceof Uint8Array) || !isSha256(value.snapshotRevision) || !isSha256(value.rigRevision) ||
            value.snapshotRevision !== task.command.expectedRevision || value.snapshotRevision !== task.command.snapshot.revision ||
            value.rigRevision !== task.command.snapshot.rigRevision) protocolError("Invalid binding export identity.");
          assertGLBContainer(value.bytes);
          assertBindingValidation(value.validation, true);
          assertOutputBytes(value.bytes.byteLength, budget);
        } else if (task.command.operation === "validate") {
          assertBindingValidation(value, false);
        } else {
          validateBindingSnapshot(value as HumanoidBindingSnapshot);
        }
        return;
      }
      case "convert-mmd-avatar":
      case "export-motion":
        if (!(result instanceof Uint8Array)) {
          protocolError(`${task.type} result must be Uint8Array.`);
        }
        assertOutputBytes(result.byteLength, budget);
        return;
      case "import-motion":
      case "solve-humanoid":
        assertMotionProcessingBudget(result as never, budget);
        return;
      case "retarget-rigged-gltf": {
        const record = asRecord(result, "retarget-rigged-gltf result");
        assertRigMotionProcessingBudget(record.motion as never, budget);
        assertRigMotionProcessingBudget(record.sourceMotion as never, budget);
        if (!isRecord(record.sourceInspection) || !isRecord(record.targetInspection)) {
          protocolError("retarget-rigged-gltf inspections are invalid.");
        }
        return;
      }
      case "inspect-humanoid-avatar": {
        const record = asRecord(result, "inspect-humanoid-avatar result");
        // humanoid-rest-v1 retains canonical per-bone evidence, not a short
        // hash. Bound by the role count and serialized transform/revision size.
        assertBoundedString(record.rigSignature, "avatar rigSignature", HUMANOID_BONES.length * 512 + 1024);
        if (!Array.isArray(record.bones) || !isRecord(record.skeleton)) {
          protocolError("inspect-humanoid-avatar result is invalid.");
        }
        assertRestJoints(record.restJoints, "inspect-humanoid-avatar result.restJoints");
        return;
      }
      case "inspect-rigged-gltf": {
        const record = asRecord(result, "inspect-rigged-gltf result");
        if (!isRecord(record.inspection) || !Array.isArray(record.actions)) {
          protocolError("inspect-rigged-gltf result is invalid.");
        }
        return;
      }
      case "validate-motion-export":
      case "validate-avatar-export": {
        const record = asRecord(result, `${task.type} result`);
        if (!isRecord(record.structural)) {
          protocolError(`${task.type} structural result is invalid.`);
        }
        return;
      }
      case "semantic-validate":
        asRecord(result, "semantic-validate result");
        return;
      default:
        return assertNever(task);
    }
  } catch (cause) {
    if (cause instanceof RetargetError && cause.code === "WORKER_PROTOCOL_INVALID") {
      throw cause;
    }
    throw new RetargetError("WORKER_PROTOCOL_INVALID", {
      cause,
      message: `${task.type} result failed runtime validation.`,
    });
  }
}

function assertBindingValidation(value: unknown, requireOk: boolean) {
  const validation = asRecord(value, "Binding validation");
  assertExactKeys(validation, ["ok", "assurance", "structural", "semantic", "ecosystem"], "Binding validation");
  const structural = asRecord(validation.structural, "Binding structural validation");
  assertExactKeys(structural, ["ok", "issues"], "Binding structural validation");
  const semantic = asRecord(validation.semantic, "Binding semantic validation");
  assertExactKeys(semantic, ["ok", "issues", "verticesCompared", "posesCompared", "maxRestPositionError",
    "maxDeformedPositionError", "tolerance"], "Binding semantic validation");
  const ecosystem = asRecord(validation.ecosystem, "Binding ecosystem validation");
  assertExactKeys(ecosystem, ["status"], "Binding ecosystem validation");
  assertIssueList(structural.issues, "Binding structural issues");
  assertIssueList(semantic.issues, "Binding semantic issues");
  if (typeof validation.ok !== "boolean" || validation.assurance !== "experimental" ||
    typeof structural.ok !== "boolean" || typeof semantic.ok !== "boolean" || ecosystem.status !== "not-run" ||
    !Number.isSafeInteger(semantic.verticesCompared) || (semantic.verticesCompared as number) < 0 ||
    !Number.isSafeInteger(semantic.posesCompared) || (semantic.posesCompared as number) < 0 ||
    ![semantic.maxRestPositionError, semantic.maxDeformedPositionError, semantic.tolerance]
      .every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0) ||
    (semantic.tolerance as number) === 0 || validation.ok !== (structural.ok && semantic.ok) ||
    (structural.ok && (structural.issues as unknown[]).length !== 0) ||
    (semantic.ok && (semantic.issues as unknown[]).length !== 0) ||
    (requireOk && (validation.ok !== true || (semantic.verticesCompared as number) === 0 ||
      (semantic.posesCompared as number) === 0))) {
    protocolError("Invalid binding validation result.");
  }
}

function assertIssueList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 1024) protocolError(`${label} must be a bounded array.`);
  for (const item of value) assertBoundedString(item, label, 16_384);
}

function assertGLBContainer(bytes: Uint8Array) {
  if (bytes.byteLength < 28) protocolError("Binding export is too short to be a GLB container.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const binaryHeader = 20 + jsonLength;
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength || jsonLength === 0 || jsonLength % 4 !== 0 ||
    view.getUint32(16, true) !== 0x4e4f534a || binaryHeader + 8 > bytes.byteLength ||
    view.getUint32(binaryHeader + 4, true) !== 0x004e4942 ||
    binaryHeader + 8 + view.getUint32(binaryHeader, true) !== bytes.byteLength) {
    protocolError("Binding export is not a complete GLB 2.0 container.");
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function assertRetargetJobBudget(
  value: unknown,
): asserts value is RetargetJobBudget | undefined {
  if (value === undefined) return;
  const budget = asRecord(value, "Worker request budget");
  assertExactKeys(budget, ["parse", "processing"], "Worker request budget");
  if (budget.parse !== undefined) {
    const parse = asRecord(budget.parse, "Worker request budget.parse");
    assertExactKeys(parse, [
      "maxInputBytes",
      "maxTracks",
      "maxSamplesPerTrack",
      "maxTotalSamples",
      "maxDurationSeconds",
      "maxFps",
      "maxStringBytes",
      "maxVertices",
      "maxIndices",
      "maxMaterials",
      "maxBones",
      "maxMorphs",
    ], "Worker request budget.parse");
    try {
      resolveParseBudget(parse);
    } catch {
      protocolError("Worker request budget.parse is invalid.");
    }
    if (Object.values(parse).some((value) => (value as number) <= 0)) {
      protocolError("Worker request budget.parse limits must be positive.");
    }
  }
  if (budget.processing !== undefined) {
    const processing = asRecord(
      budget.processing,
      "Worker request budget.processing",
    );
    assertExactKeys(processing, [
      "maxDurationSeconds",
      "maxFps",
      "maxFrames",
      "maxTracks",
      "maxTotalSamples",
      "maxGeneratedValues",
      "maxOutputBytes",
    ], "Worker request budget.processing");
    try {
      resolveProcessingBudget(processing);
    } catch {
      protocolError("Worker request budget.processing is invalid.");
    }
    if (Object.values(processing).some((value) => (value as number) <= 0)) {
      protocolError("Worker request budget.processing limits must be positive.");
    }
  }
}

function assertArrayBuffer(
  value: unknown,
  label: string,
): asserts value is ArrayBuffer {
  if (!(value instanceof ArrayBuffer)) protocolError(`${label} must be ArrayBuffer.`);
}

function assertResources(value: unknown, label: string) {
  if (value === undefined) return;
  const resources = asRecord(value, label);
  assertDataProperties(resources, label);
  const entries = Object.entries(resources);
  let totalBytes = 0;
  for (const [uri, bytes] of entries) {
    assertBoundedString(uri, `${label} URI`, 4096);
    assertArrayBuffer(bytes, `${label}[${JSON.stringify(uri)}]`);
    totalBytes += bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes)) {
      protocolError(`${label} byte total is not a safe integer.`);
    }
  }
}

function assertAssetPackage(value: unknown, label: string) {
  if (value === undefined) return;
  const assetPackage = asRecord(value, label);
  assertExactKeys(assetPackage, ["primaryPath", "resources"], label);
  assertBoundedString(assetPackage.primaryPath, `${label}.primaryPath`, 4096);
  assertResources(assetPackage.resources, `${label}.resources`);
}

function assertAnimationSelection(task: Extract<RetargetJobTask, { type: "import-motion" }>) {
  if (task.animationIndex === undefined && task.animationName === undefined) return;
  if (!task.formatId.endsWith("fbx") && task.formatId !== "gltf-animation") {
    protocolError("Animation selection is unsupported for this motion format.");
  }
  if (
    task.animationIndex !== undefined &&
    (!Number.isInteger(task.animationIndex) ||
      task.animationIndex < 0 ||
      task.animationIndex > Number.MAX_SAFE_INTEGER)
  ) {
    protocolError("import-motion.animationIndex is invalid.");
  }
  if (task.animationName !== undefined) {
    assertBoundedString(task.animationName, "import-motion.animationName", 1024);
  }
}

function assertRiggedGLTFAnimationSelection(
  task: Extract<RetargetJobTask, { type: "retarget-rigged-gltf" }>,
) {
  if (
    task.animationIndex !== undefined &&
    (!Number.isSafeInteger(task.animationIndex) || task.animationIndex < 0)
  ) {
    protocolError("retarget-rigged-gltf.animationIndex is invalid.");
  }
  if (task.animationName !== undefined) {
    assertBoundedString(
      task.animationName,
      "retarget-rigged-gltf.animationName",
      1024,
    );
  }
}

function assertMapping(value: unknown) {
  const mapping = asRecord(value, "solve-humanoid.mapping");
  assertExactKeys(mapping, [
    "enabled",
    "sourceProfileOverride",
    "targetProfileOverride",
    "chainPreset",
    "footCleanup",
    "boneMap",
  ], "solve-humanoid.mapping");
  if (
    typeof mapping.enabled !== "boolean" ||
    typeof mapping.footCleanup !== "boolean" ||
    !["full-body", "upper-body", "lower-body"].includes(
      mapping.chainPreset as string,
    )
  ) {
    protocolError("solve-humanoid.mapping is invalid.");
  }
  for (const key of ["sourceProfileOverride", "targetProfileOverride"] as const) {
    const profile = mapping[key];
    if (
      profile !== undefined &&
      (typeof profile !== "string" || profile.length === 0 || profile.length > 128)
    ) {
      protocolError("solve-humanoid.mapping profile override is invalid.");
    }
  }
  const boneMap = asRecord(mapping.boneMap, "solve-humanoid.mapping.boneMap");
  assertDataProperties(boneMap, "solve-humanoid.mapping.boneMap");
  for (const [target, source] of Object.entries(boneMap)) {
    if (
      !isHumanoidBone(target) ||
      (source !== "none" &&
        (typeof source !== "string" || !isHumanoidBone(source)))
    ) {
      protocolError("solve-humanoid.mapping.boneMap is invalid.");
    }
  }
}

function assertSolveOptions(value: unknown) {
  const options = asRecord(value, "solve-humanoid.options");
  assertExactKeys(
    options,
    ["heightScale", "rootMotion", "armOffsetDegrees", "grounding", "yawOffsetDegrees"],
    "solve-humanoid.options",
  );
  if (
    typeof options.heightScale !== "number" ||
    !Number.isFinite(options.heightScale) ||
    typeof options.rootMotion !== "boolean" ||
    typeof options.armOffsetDegrees !== "number" ||
    !Number.isFinite(options.armOffsetDegrees) ||
    (options.grounding !== undefined &&
      options.grounding !== "none" &&
      options.grounding !== "constant") ||
    (options.yawOffsetDegrees !== undefined &&
      (typeof options.yawOffsetDegrees !== "number" ||
        !Number.isFinite(options.yawOffsetDegrees)))
  ) {
    protocolError("solve-humanoid.options is invalid.");
  }
}

function assertRestJoints(value: unknown, label: string) {
  if (value === undefined) return;
  const joints = asRecord(value, label);
  for (const [bone, joint] of Object.entries(joints)) {
    if (!isHumanoidBone(bone)) protocolError(`${label} contains an unknown bone.`);
    const record = asRecord(joint, label);
    assertExactKeys(record, ["position", "rotation"], label);
    if (
      !isFiniteTuple(record.position, 3) ||
      !isFiniteTuple(record.rotation, 4)
    ) {
      protocolError(`${label} is invalid.`);
    }
  }
}

function isFiniteTuple(value: unknown, length: number) {
  return Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "number" && Number.isFinite(item));
}

const HUMANOID_BONE_NAMES = new Set<string>(HUMANOID_BONES);

function isHumanoidBone(value: string) {
  return HUMANOID_BONE_NAMES.has(value);
}

function assertFilename(value: unknown) {
  assertBoundedString(value, "task filename", 1024);
}

function assertFormat(value: unknown, allowed: ReadonlySet<string>) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new RetargetError("UNSUPPORTED_FORMAT", {
      details: { formatId: value },
    });
  }
}

function assertBoundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    protocolError(`${label} must be a non-empty bounded string.`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) protocolError(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      protocolError(`${label} contains an unknown field.`);
    }
  }
  assertDataProperties(record, label);
}

function assertDataProperties(record: Record<string, unknown>, label: string) {
  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      protocolError(`${label} contains an unsupported property.`);
    }
  }
}

function protocolError(message: string): never {
  throw new RetargetError("WORKER_PROTOCOL_INVALID", { message });
}

function assertNever(value: never): never {
  return protocolError(`Unsupported Worker task: ${String(value)}`);
}
