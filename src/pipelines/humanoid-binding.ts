import { assertHumanoidBindingTask, bindingError, validateBindingSnapshot } from "@/binding/contracts";
import { createBindingRig, editBindingRig, fitBindingRig } from "@/binding/rig";
import { editBindingWeights, skinBindingRig } from "@/binding/weights";
import type { HumanoidBindingCommand, HumanoidBindingResult } from "@/binding/types";
import { readBindingGLB } from "@/import/binding-glb";
import { assertCountWithinBudget, resolveParseBudget, type ParseBudget } from "@/import/parse-budget";
import { assertOutputBytes, createProcessingDeadline, resolveProcessingBudget, type ProcessingBudget } from "@/processing-budget";
import { exportHumanoidBindingGLB } from "@/export/humanoid-binding-glb";
import { validateBindingDeformation } from "@/validation/binding-deformation";
import { isRetargetError, RetargetError } from "@/retarget/errors";

/** Explicit inline byte API for trusted tools. Browser applications use the
 * isolated humanoid-binding task through runRetargetJob. */
export async function processHumanoidBinding<T extends HumanoidBindingCommand>(
  bytes: ArrayBuffer, command: T,
  options: { parseBudget?: Partial<ParseBudget>; processingBudget?: Partial<ProcessingBudget>; deadlineMs?: number } = {},
): Promise<HumanoidBindingResult<T>> {
  return executeHumanoidBinding(bytes, command, options) as Promise<HumanoidBindingResult<T>>;
}

export async function executeHumanoidBinding(bytes: ArrayBuffer, command: HumanoidBindingCommand,
  options: { parseBudget?: Partial<ParseBudget>; processingBudget?: Partial<ProcessingBudget>; deadlineMs?: number } = {},
  report: (phase: "parse" | "solve" | "refine" | "export" | "structural-validate" | "semantic-validate", progress: number) => void = () => undefined,
  externalCheckpoint?: (phase: string) => void) {
  try {
    assertHumanoidBindingTask({ type: "humanoid-binding", bytes, command });
    if (options.deadlineMs !== undefined && (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)) bindingError("PROCESSING_OPTION_INVALID", "deadlineMs must be positive and finite.");
    const deadline = createProcessingDeadline(options.deadlineMs);
    const checkpoint = (phase: string) => { deadline.checkpoint(phase); externalCheckpoint?.(phase); };
    const parseBudget = resolveParseBudget(options.parseBudget);
    const processingBudget = resolveProcessingBudget(options.processingBudget);
    report("parse", .08);
    const asset = readBindingGLB(new Uint8Array(bytes), parseBudget, checkpoint, false, processingBudget.maxGeneratedValues);
    checkpoint("binding-parse");
    if (command.operation === "inspect") return asset.inspection;
    if (command.operation === "fit" || command.operation === "use-rig") {
      report("solve", .4);
      const rig = command.operation === "fit" ? fitBindingRig(asset, command, checkpoint)
        : createBindingRig(asset, command.joints, "existing-rig-v1");
      assertCountWithinBudget(rig.joints.length, parseBudget.maxBones, "binding joints");
      checkpoint("binding-fit-complete");
      return rig;
    }
    const snapshot = command.snapshot;
    validateBindingSnapshot(snapshot, asset.inspection.asset, command.expectedRevision);
    assertCountWithinBudget(snapshot.joints.length, parseBudget.maxBones, "binding joints");
    checkpoint("binding-validate-snapshot");
    if (command.operation === "edit-rig") { report("refine", .5); return editBindingRig(snapshot, command); }
    if (command.operation === "skin") {
      report("solve", .3);
      return skinBindingRig(asset, snapshot, command.iterations ?? 32, processingBudget, checkpoint);
    }
    if (command.operation === "edit-weights") { report("refine", .5); return editBindingWeights(snapshot, command.edits); }
    report("export", .4);
    const output = command.operation === "validate" ? new Uint8Array(command.outputBytes)
      : exportHumanoidBindingGLB(asset, snapshot, processingBudget, checkpoint);
    assertOutputBytes(output.byteLength, processingBudget);
    report("structural-validate", .7);
    report("semantic-validate", .8);
    const validation = await validateBindingDeformation(asset, snapshot, output, checkpoint,
      { ...parseBudget, maxInputBytes: processingBudget.maxOutputBytes }, processingBudget.maxGeneratedValues);
    checkpoint("binding-complete");
    if (command.operation === "validate") return validation;
    if (!validation.ok) bindingError("ARTIFACT_AUTHORING_FAILED", `Binding export failed independent reload/deformation validation: ${[...validation.structural.issues, ...validation.semantic.issues].join(" ")}`, { validation });
    return { bytes: output, snapshotRevision: snapshot.revision, rigRevision: snapshot.rigRevision, validation };
  } catch (cause) {
    if (isRetargetError(cause)) throw cause;
    throw new RetargetError("BINDING_INPUT_UNSUPPORTED", { cause, message: cause instanceof Error ? cause.message : String(cause) });
  }
}
