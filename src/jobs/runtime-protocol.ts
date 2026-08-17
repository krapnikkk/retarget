import type {
  AvatarExportFormatId,
  AvatarFormatId,
  MotionExportFormatId,
  MotionFormatId,
} from "@/formats";
import { RETARGET_ERROR_CODES, RetargetError } from "@/retarget/errors";
import {
  assertMotionProcessingBudget,
  assertRigMotionProcessingBudget,
} from "@/processing-budget";
import {
  RETARGET_JOB_PROTOCOL_VERSION,
  type RetargetJobRequest,
  type RetargetJobResponse,
  type RetargetJobTask,
} from "./types";

const TASK_TYPES = new Set<RetargetJobTask["type"]>([
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
  const request = asRecord(value, "Worker request");
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
  const task = asRecord(request.task, "Worker request task");
  if (typeof task.type !== "string" || !TASK_TYPES.has(task.type as never)) {
    protocolError("Worker request task discriminator is unsupported.");
  }
  assertTaskFields(task as unknown as RetargetJobTask);
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
    const error = asRecord(response.error, "Worker failure error");
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
  assertTaskResult(request.task, response.result);
}

function assertTaskFields(task: RetargetJobTask) {
  switch (task.type) {
    case "inspect-humanoid-avatar":
      assertArrayBuffer(task.bytes, "inspect-humanoid-avatar.bytes");
      assertFilename(task.filename);
      assertFormat(task.formatId, AVATAR_FORMAT_IDS);
      assertResources(task.resources, "inspect-humanoid-avatar.resources");
      return;
    case "convert-mmd-avatar":
      assertArrayBuffer(task.bytes, "convert-mmd-avatar.bytes");
      assertFilename(task.filename);
      return;
    case "inspect-rigged-gltf":
      assertArrayBuffer(task.bytes, "inspect-rigged-gltf.bytes");
      assertFilename(task.filename);
      assertResources(task.resources, "inspect-rigged-gltf.resources");
      return;
    case "import-motion":
      assertArrayBuffer(task.bytes, "import-motion.bytes");
      assertFilename(task.filename);
      assertFormat(task.formatId, MOTION_FORMAT_IDS);
      assertResources(task.resources, "import-motion.resources");
      assertAnimationSelection(task);
      return;
    case "solve-humanoid":
      if (!isRecord(task.motion)) protocolError("solve-humanoid.motion is invalid.");
      if (!isRecord(task.mapping)) protocolError("solve-humanoid.mapping is invalid.");
      if (!isRecord(task.options)) protocolError("solve-humanoid.options is invalid.");
      return;
    case "retarget-rigged-gltf":
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
      return;
    case "export-motion":
      assertFormat(task.formatId, MOTION_EXPORT_FORMAT_IDS);
      if (!isRecord(task.clip)) protocolError("export-motion.clip is invalid.");
      return;
    case "validate-motion-export":
      assertArrayBuffer(task.bytes, "validate-motion-export.bytes");
      assertFormat(task.formatId, MOTION_EXPORT_FORMAT_IDS);
      if (!isRecord(task.expected)) {
        protocolError("validate-motion-export.expected is invalid.");
      }
      return;
    case "validate-avatar-export":
      assertArrayBuffer(task.bytes, "validate-avatar-export.bytes");
      assertFormat(task.formatId, AVATAR_EXPORT_FORMAT_IDS);
      if (!isRecord(task.expected)) {
        protocolError("validate-avatar-export.expected is invalid.");
      }
      return;
    case "semantic-validate":
      if (!isRecord(task.actual) || !isRecord(task.expected)) {
        protocolError("semantic-validate clips are invalid.");
      }
      return;
    default:
      return assertNever(task);
  }
}

function assertTaskResult(task: RetargetJobTask, result: unknown) {
  try {
    switch (task.type) {
      case "convert-mmd-avatar":
      case "export-motion":
        if (!(result instanceof Uint8Array)) {
          protocolError(`${task.type} result must be Uint8Array.`);
        }
        return;
      case "import-motion":
      case "solve-humanoid":
        assertMotionProcessingBudget(result as never);
        return;
      case "retarget-rigged-gltf": {
        const record = asRecord(result, "retarget-rigged-gltf result");
        assertRigMotionProcessingBudget(record.motion as never);
        assertRigMotionProcessingBudget(record.sourceMotion as never);
        if (!isRecord(record.sourceInspection) || !isRecord(record.targetInspection)) {
          protocolError("retarget-rigged-gltf inspections are invalid.");
        }
        return;
      }
      case "inspect-humanoid-avatar": {
        const record = asRecord(result, "inspect-humanoid-avatar result");
        assertBoundedString(record.rigSignature, "avatar rigSignature", 1024);
        if (!Array.isArray(record.bones) || !isRecord(record.skeleton)) {
          protocolError("inspect-humanoid-avatar result is invalid.");
        }
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

function assertArrayBuffer(value: unknown, label: string) {
  if (!(value instanceof ArrayBuffer)) protocolError(`${label} must be ArrayBuffer.`);
}

function assertResources(value: unknown, label: string) {
  if (value === undefined) return;
  const resources = asRecord(value, label);
  const entries = Object.entries(resources);
  for (const [uri, bytes] of entries) {
    assertBoundedString(uri, `${label} URI`, 4096);
    assertArrayBuffer(bytes, `${label}[${JSON.stringify(uri)}]`);
  }
}

function assertAnimationSelection(task: Extract<RetargetJobTask, { type: "import-motion" }>) {
  if (task.animationIndex === undefined && task.animationName === undefined) return;
  if (!task.formatId.endsWith("fbx")) {
    protocolError("Animation selection is only supported for FBX motion imports.");
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
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function protocolError(message: string): never {
  throw new RetargetError("WORKER_PROTOCOL_INVALID", { message });
}

function assertNever(value: never): never {
  return protocolError(`Unsupported Worker task: ${String(value)}`);
}
