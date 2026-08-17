import { createHash } from "node:crypto";
import { WebIO } from "@gltf-transform/core";
import {
  VRMC_VRM_EXTENSIONS,
  assertVRMDocument,
} from "gltf-transform-vrm-extensions";
import { convertMMDModelToGLBDocument } from "@/export/avatar-conversion";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { authorCanonicalGLBAsPMX, authorCanonicalGLBAsPMXBundle } from "@/export/pmx-authoring";
import {
  exportRigMotionGLTF,
  validateRigMotionGLTFReload,
} from "@/export/rig-motion-gltf";
import { authorCanonicalGLBAsVRM } from "@/export/vrm-authoring";
import { readZipBlobArchiveAsync } from "@/archive/zip";
import { readGLTFDocument } from "@/import/gltf-document";
import {
  importRigMotionDocument,
  listRigMotionActions,
} from "@/import/rig-motion-gltf";
import { assertInputByteLength } from "@/jobs/asset-input-safety";
import {
  DEFAULT_PROCESSING_BUDGET,
  assertOutputBytes,
  assertRigMotionProcessingBudget,
  createProcessingDeadline,
} from "@/processing-budget";
import { serializeRigInspection } from "@/jobs/serialize-rig-inspection";
import {
  RetargetError,
  REQUIRED_VRM_BONES,
  isRetargetError,
  type RetargetErrorCode,
} from "@/retarget";
import { inspectGLTFRig } from "@/rigs";
import type { RigInspection } from "@/rigs/gltf-inspection";
import { resolveNodeToolBudget } from "./budget";
import type {
  NodeArtifactDescriptor,
  NodeArtifactEvidence,
  NodeArtifactFormat,
  NodeArtifactValidationReport,
  NodeToolBudget,
  NodeToolDiagnostic,
  NodeToolPhase,
  NodeToolTask,
  NodeToolTaskResult,
  NodeToolWorkerRequest,
} from "./types";

type NodeToolExecution<TTask extends NodeToolTask> = {
  result: NodeToolTaskResult<TTask>;
  diagnostics: NodeToolDiagnostic[];
};

type NodeToolReporter = (phase: NodeToolPhase, progress: number) => void;

const ARTIFACT_MEDIA_TYPES: Record<NodeArtifactFormat, string> = {
  vrm: "model/gltf-binary",
  pmx: "application/octet-stream",
  "pmx-bundle": "application/zip",
  "rig-motion-gltf": "model/gltf-binary",
};

const ARTIFACT_ASSURANCE = {
  vrm: "experimental",
  pmx: "experimental",
  "pmx-bundle": "experimental",
  "rig-motion-gltf": "experimental",
} as const;

export async function executeNodeToolTask<TTask extends NodeToolTask>(
  request: Omit<NodeToolWorkerRequest, "task"> & { task: TTask },
  report: NodeToolReporter = () => undefined,
): Promise<NodeToolExecution<TTask>> {
  const budget = resolveNodeToolBudget(request.budget);
  const deadline = createProcessingDeadline(budget.softDeadlineMs);
  const diagnostics: NodeToolDiagnostic[] = [];
  report("validate", 0.02);
  try {
    validateTaskInputs(request.task, budget);
    deadline.checkpoint("validate");
    const result = await executeTask(
      request.task,
      budget,
      deadline,
      diagnostics,
      report,
    );
    deadline.checkpoint("complete");
    report("complete", 1);
    return {
      result: result as NodeToolTaskResult<TTask>,
      diagnostics,
    };
  } catch (cause) {
    throw normalizeTaskError(cause, request.task);
  }
}

async function executeTask(
  task: NodeToolTask,
  budget: NodeToolBudget,
  deadline: ReturnType<typeof createProcessingDeadline>,
  diagnostics: NodeToolDiagnostic[],
  report: NodeToolReporter,
): Promise<unknown> {
  if (task.type === "inspect-rigged-gltf") {
    report("parse", 0.12);
    const document = await readTaskGLTF(task.bytes, task.resources);
    deadline.checkpoint("parse");
    report("inspect", 0.62);
    const inspection = inspectGLTFRig(document, task.options);
    diagnostics.push(...inspectionDiagnostics(inspection));
    return {
      inspection: serializeRigInspection(inspection),
      actions: listRigMotionActions(document),
    };
  }

  if (task.type === "import-rig-motion-gltf") {
    assertCanonicalTimestamp(task.createdAt);
    report("parse", 0.12);
    const document = await readTaskGLTF(task.bytes, task.resources);
    deadline.checkpoint("parse");
    report("inspect", 0.42);
    const inspection = inspectGLTFRig(document, task.options);
    const actions = listRigMotionActions(document);
    diagnostics.push(...inspectionDiagnostics(inspection));
    const motion = importRigMotionDocument(document, task.filename, {
      ...task.options,
      createdAt: task.createdAt,
    });
    assertRigMotionProcessingBudget(motion);
    deadline.checkpoint("import-rig-motion");
    return {
      motion,
      inspection: serializeRigInspection(inspection),
      actions,
    };
  }

  if (task.type === "export-rig-motion-gltf") {
    assertArtifactName(task.artifactName, ".glb");
    assertRigMotionProcessingBudget(task.motion);
    report("author", 0.18);
    const bytes = await exportRigMotionGLTF(task.motion);
    assertOutputBytes(bytes.byteLength, processingBudget(budget));
    deadline.checkpoint("export-rig-motion");
    const artifact = createArtifactDescriptor(
      "rig-motion-gltf",
      task.artifactName,
      bytes,
    );
    report("structural-validate", 0.68);
    const validation = await validateRigMotionArtifact(
      artifact,
      task.motion,
      diagnostics,
    );
    if (!validation.ok) {
      throw new RetargetError("ARTIFACT_AUTHORING_FAILED", {
        details: { format: artifact.format, filename: artifact.filename },
        message: validation.structural.issues
          .concat(validation.semantic.issues)
          .join(" "),
      });
    }
    return { artifact, validation };
  }

  if (task.type === "validate-rig-motion-gltf") {
    assertArtifactName(task.artifactName, ".glb");
    assertRigMotionProcessingBudget(task.expected);
    const artifact = createArtifactDescriptor(
      "rig-motion-gltf",
      task.artifactName,
      new Uint8Array(task.bytes),
    );
    report("structural-validate", 0.32);
    return validateRigMotionArtifact(artifact, task.expected, diagnostics);
  }

  if (task.type === "author-vrm") {
    assertArtifactName(task.artifactName, ".vrm");
    validateMetadata(task.metadata);
    report("parse", 0.12);
    const document = await readCanonicalGLB(task.canonicalGLBBytes);
    deadline.checkpoint("parse-canonical-glb");
    report("author", 0.34);
    const bytes = await authorCanonicalGLBAsVRM(document, task.metadata);
    assertOutputBytes(bytes.byteLength, processingBudget(budget));
    deadline.checkpoint("author-vrm");
    const artifact = createArtifactDescriptor("vrm", task.artifactName, bytes);
    report("structural-validate", 0.76);
    const validation = await validateCharacterArtifact(
      artifact,
      budget,
      diagnostics,
    );
    assertAuthoredArtifactValidation(validation);
    return { artifact, validation };
  }

  if (task.type === "author-pmx") {
    const format = task.output === "bundle" ? "pmx-bundle" : "pmx";
    assertArtifactName(task.artifactName, task.output === "bundle" ? ".zip" : ".pmx");
    validateMetadata(task.metadata);
    report("parse", 0.12);
    const document = await readCanonicalGLB(task.canonicalGLBBytes);
    deadline.checkpoint("parse-canonical-glb");
    report("author", 0.34);
    const bytes = task.output === "bundle"
      ? await authorCanonicalGLBAsPMXBundle(document, task.metadata)
      : await authorCanonicalGLBAsPMX(document, task.metadata);
    assertOutputBytes(bytes.byteLength, processingBudget(budget));
    deadline.checkpoint("author-pmx");
    const artifact = createArtifactDescriptor(format, task.artifactName, bytes);
    report("structural-validate", 0.76);
    const validation = await validateCharacterArtifact(
      artifact,
      budget,
      diagnostics,
    );
    assertAuthoredArtifactValidation(validation);
    return { artifact, validation };
  }

  const expectedExtension = task.format === "vrm"
    ? ".vrm"
    : task.format === "pmx"
      ? ".pmx"
      : ".zip";
  assertArtifactName(task.artifactName, expectedExtension);
  const artifact = createArtifactDescriptor(
    task.format,
    task.artifactName,
    new Uint8Array(task.bytes),
  );
  report("structural-validate", 0.32);
  return validateCharacterArtifact(artifact, budget, diagnostics);
}

function validateTaskInputs(task: NodeToolTask, budget: NodeToolBudget) {
  let totalInputBytes = 0;
  if ("bytes" in task) {
    assertInputByteLength(
      task.bytes.byteLength,
      budget.maxInputBytes,
      `node-tool:${task.type}`,
    );
    totalInputBytes += task.bytes.byteLength;
  }
  if ("canonicalGLBBytes" in task) {
    assertInputByteLength(
      task.canonicalGLBBytes.byteLength,
      budget.maxInputBytes,
      `node-tool:${task.type}:canonical-glb`,
    );
    totalInputBytes += task.canonicalGLBBytes.byteLength;
  }
  if ("resources" in task && task.resources) {
    for (const [name, bytes] of Object.entries(task.resources)) {
      assertInputByteLength(
        bytes.byteLength,
        budget.maxInputBytes,
        `node-tool:${task.type}:resource:${name}`,
      );
      totalInputBytes += bytes.byteLength;
      assertInputByteLength(
        totalInputBytes,
        budget.maxInputBytes,
        `node-tool:${task.type}:resources`,
      );
    }
  }
}

async function readTaskGLTF(
  bytes: ArrayBuffer,
  resources?: Readonly<Record<string, ArrayBuffer>>,
) {
  return readGLTFDocument(
    new Uint8Array(bytes),
    undefined,
    resources
      ? Object.fromEntries(
          Object.entries(resources).map(([name, value]) => [
            name,
            new Uint8Array(value),
          ]),
        )
      : undefined,
  );
}

async function readCanonicalGLB(bytes: ArrayBuffer) {
  const value = new Uint8Array(bytes);
  if (
    value.byteLength < 12 ||
    new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, true) !==
      0x46546c67
  ) {
    throw new RetargetError("ARTIFACT_INVALID", {
      details: { expected: "canonical GLB" },
      message: "Canonical authoring input must be a binary glTF container.",
    });
  }
  return readGLTFDocument(value);
}

async function validateRigMotionArtifact(
  artifact: NodeArtifactDescriptor,
  expected: import("@/rig-motion").RigMotionV2,
  diagnostics: NodeToolDiagnostic[],
): Promise<NodeArtifactValidationReport> {
  const validation = await validateRigMotionGLTFReload(
    new Uint8Array(artifact.bytes),
    expected,
  );
  const structural = validation.ok
    ? evidence("passed", ["GLB reload", "animation channel count"])
    : evidence("failed", [], [validation.issue]);
  const semanticResult = validation.ok ? validation.semantic : undefined;
  const semantic = !semanticResult
    ? evidence("not-run", [], validation.ok ? [] : ["Structural validation failed."])
    : semanticResult.ok
      ? evidence("passed", ["world-space rig motion comparison"], [], {
          metrics: semanticResult.metrics,
        })
      : evidence("failed", ["world-space rig motion comparison"], semanticResult.issues, {
          metrics: semanticResult.metrics,
        });
  if (!validation.ok) {
    diagnostics.push({
      level: "error",
      phase: "structural-validate",
      code: "ARTIFACT_INVALID",
      message: validation.issue,
    });
  } else if (semanticResult && !semanticResult.ok) {
    diagnostics.push({
      level: "error",
      phase: "semantic-validate",
      code: "ARTIFACT_INVALID",
      message: semanticResult.issues.join(" "),
    });
  }
  return validationReport(
    artifact,
    structural,
    semantic,
    evidence("not-run", [], ["No pinned ecosystem runtime was requested."]),
    diagnostics,
  );
}

async function validateCharacterArtifact(
  artifact: NodeArtifactDescriptor,
  budget: NodeToolBudget,
  diagnostics: NodeToolDiagnostic[],
): Promise<NodeArtifactValidationReport> {
  try {
    if (artifact.format !== "vrm") {
      return validatePMXArtifact(artifact, budget, diagnostics);
    }
    const inspection = await inspectVRMArtifact(artifact);
    const structural = inspection.missingRequiredRoles.length === 0
      ? evidence("passed", ["format reload", "required rig roles"])
      : evidence(
          "failed",
          ["format reload"],
          [`Missing required roles: ${inspection.missingRequiredRoles.join(", ")}.`],
        );
    diagnostics.push(...inspectionDiagnostics(inspection));
    return validationReport(
      artifact,
      structural,
      evidence("not-applicable", [], ["Character authoring has no motion to compare."]),
      evidence("not-run", [], ["No pinned ecosystem runtime was requested."]),
      diagnostics,
      serializeRigInspection(inspection),
    );
  } catch (cause) {
    const error = errorMessage(cause);
    diagnostics.push({
      level: "error",
      phase: "structural-validate",
      code: isRetargetError(cause) ? cause.code : "ARTIFACT_INVALID",
      message: error,
      details: isRetargetError(cause) ? cause.details : undefined,
    });
    return validationReport(
      artifact,
      evidence("failed", [], [error]),
      evidence("not-run", [], ["Structural validation failed."]),
      evidence("not-run", [], ["Structural validation failed."]),
      diagnostics,
    );
  }
}

async function inspectVRMArtifact(artifact: NodeArtifactDescriptor) {
  const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
  const document = await io.readBinary(new Uint8Array(artifact.bytes));
  assertVRMDocument(document);
  return inspectGLTFRig(document, { familyOverride: "humanoid" });
}

async function inspectPMXArtifact(
  artifact: NodeArtifactDescriptor,
  budget: NodeToolBudget,
): Promise<ReturnType<typeof collectHumanoidNodes>> {
  if (artifact.format === "pmx") {
    return collectHumanoidNodes(
      convertMMDModelToGLBDocument(
        new Uint8Array(artifact.bytes),
        artifact.filename,
      ),
    );
  }
  const entries = await readZipBlobArchiveAsync(
    new Blob([artifact.bytes], { type: "application/zip" }),
    {
      maxCompressionRatio: budget.maxArchiveCompressionRatio,
      maxEntries: budget.maxArchiveEntries,
      maxEntryUncompressedBytes: budget.maxArchiveEntryBytes,
      maxTotalUncompressedBytes: budget.maxArchiveExpandedBytes,
    },
  );
  const files = await Promise.all(
    entries.map(async (entry) => ({
      name: entry.name,
      bytes: new Uint8Array(await entry.blob.arrayBuffer()),
    })),
  );
  const pmxFiles = files.filter((entry) => entry.name.toLowerCase().endsWith(".pmx"));
  if (pmxFiles.length !== 1) {
    throw new RetargetError("PACKAGE_INVALID", {
      details: { pmxEntries: pmxFiles.map((entry) => entry.name) },
      message: "A PMX bundle must contain exactly one .pmx model.",
    });
  }
  const pmx = pmxFiles[0]!;
  const byName = new Map(files.map((entry) => [entry.name, entry.bytes]));
  return collectHumanoidNodes(
    convertMMDModelToGLBDocument(
      pmx.bytes,
      pmx.name,
      (uri) => byName.get(uri.replace(/\\/g, "/")) ?? null,
    ),
  );
}

async function validatePMXArtifact(
  artifact: NodeArtifactDescriptor,
  budget: NodeToolBudget,
  diagnostics: NodeToolDiagnostic[],
): Promise<NodeArtifactValidationReport> {
  const bones = await inspectPMXArtifact(artifact, budget);
  const missing = REQUIRED_VRM_BONES.filter((bone) => !bones.has(bone));
  const structural = missing.length === 0
    ? evidence("passed", ["PMX reload", "required humanoid bone mapping"], [], {
        mappedBones: bones.size,
      })
    : evidence(
        "failed",
        ["PMX reload"],
        [`Missing required humanoid bones: ${missing.join(", ")}.`],
        { mappedBones: bones.size },
      );
  if (missing.length > 0) {
    diagnostics.push({
      level: "error",
      phase: "structural-validate",
      code: "ARTIFACT_INVALID",
      message: structural.issues.join(" "),
    });
  }
  return validationReport(
    artifact,
    structural,
    evidence("not-applicable", [], ["Character authoring has no motion to compare."]),
    evidence("not-run", [], ["No pinned ecosystem runtime was requested."]),
    diagnostics,
  );
}

function createArtifactDescriptor(
  format: NodeArtifactFormat,
  filename: string,
  sourceBytes: Uint8Array,
): NodeArtifactDescriptor {
  const bytes = sourceBytes.slice();
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return {
    format,
    assurance: ARTIFACT_ASSURANCE[format],
    filename,
    mediaType: ARTIFACT_MEDIA_TYPES[format],
    bytes: buffer,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function validationReport(
  artifact: NodeArtifactDescriptor,
  structural: NodeArtifactEvidence,
  semantic: NodeArtifactEvidence,
  ecosystem: NodeArtifactEvidence,
  diagnostics: NodeToolDiagnostic[],
  inspection?: ReturnType<typeof serializeRigInspection>,
): NodeArtifactValidationReport {
  return {
    ok:
      structural.status === "passed" &&
      (semantic.status === "passed" || semantic.status === "not-applicable"),
    artifact: {
      format: artifact.format,
      filename: artifact.filename,
      mediaType: artifact.mediaType,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
    },
    structural,
    semantic,
    ecosystem,
    ...(inspection ? { inspection } : {}),
    diagnostics: [...diagnostics],
  };
}

function evidence(
  status: NodeArtifactEvidence["status"],
  checks: string[],
  issues: string[] = [],
  details?: Record<string, unknown>,
): NodeArtifactEvidence {
  return { status, checks, issues, ...(details ? { details } : {}) };
}

function inspectionDiagnostics(inspection: RigInspection): NodeToolDiagnostic[] {
  const diagnostics: NodeToolDiagnostic[] = [];
  if (inspection.missingRequiredRoles.length > 0) {
    diagnostics.push({
      level: "error",
      phase: "inspect",
      code: "ARTIFACT_INVALID",
      message: `Missing required roles: ${inspection.missingRequiredRoles.join(", ")}.`,
    });
  }
  if (inspection.topologyConflicts.length > 0) {
    diagnostics.push({
      level: "warning",
      phase: "inspect",
      message: `Rig has ${inspection.topologyConflicts.length} topology conflict(s).`,
      details: { topologyConflicts: inspection.topologyConflicts },
    });
  }
  if (inspection.axisWarnings.length > 0) {
    diagnostics.push({
      level: "warning",
      phase: "inspect",
      message: `Rig has ${inspection.axisWarnings.length} unresolved primary axis value(s).`,
      details: { axisWarnings: inspection.axisWarnings },
    });
  }
  return diagnostics;
}

function assertAuthoredArtifactValidation(report: NodeArtifactValidationReport) {
  if (!report.ok) {
    throw new RetargetError("ARTIFACT_AUTHORING_FAILED", {
      details: { format: report.artifact.format, filename: report.artifact.filename },
      message: report.structural.issues.concat(report.semantic.issues).join(" "),
    });
  }
}

function assertArtifactName(value: string, extension: string) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    /[<>:"/\\|?*\x00-\x1f]/.test(value) ||
    !value.toLowerCase().endsWith(extension)
  ) {
    throw new RetargetError("PROCESSING_OPTION_INVALID", {
      details: { artifactName: value, expectedExtension: extension },
      message: `artifactName must be a safe basename ending in ${extension}.`,
    });
  }
}

function validateMetadata(metadata: object) {
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RetargetError("PROCESSING_OPTION_INVALID", {
        details: { key },
        message: `${key} must be a non-empty string.`,
      });
    }
    const byteLength = new TextEncoder().encode(value).byteLength;
    if (byteLength > 64 * 1024) {
      throw new RetargetError("PROCESSING_OPTION_INVALID", {
        details: { key, byteLength, maxBytes: 64 * 1024 },
        message: `${key} exceeds the metadata byte budget.`,
      });
    }
  }
}

function assertCanonicalTimestamp(value: string) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new RetargetError("PROCESSING_OPTION_INVALID", {
      details: { createdAt: value },
      message: "createdAt must be an explicit canonical ISO-8601 timestamp.",
    });
  }
}

function processingBudget(budget: NodeToolBudget) {
  return { ...DEFAULT_PROCESSING_BUDGET, maxOutputBytes: budget.maxOutputBytes };
}

function normalizeTaskError(cause: unknown, task: NodeToolTask) {
  if (isRetargetError(cause)) return cause;
  const code: RetargetErrorCode =
    task.type === "author-vrm" ||
    task.type === "author-pmx" ||
    task.type === "export-rig-motion-gltf"
      ? "ARTIFACT_AUTHORING_FAILED"
      : task.type === "validate-artifact" && task.format === "pmx-bundle"
        ? "PACKAGE_INVALID"
        : "ARTIFACT_INVALID";
  return new RetargetError(code, {
    cause,
    details: { taskType: task.type },
    message: errorMessage(cause),
  });
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
