import type { ActiveRigDefinitionId } from "@/rigs";
import type { RigMotionSolverId } from "@/rig-motion";
import { solveRigMotionToTarget } from "./rig-chain-swing-twist";

export type RigSolverDescriptor = {
  id: Exclude<RigMotionSolverId, "same-rest-node-skin-signature">;
  sourceDefinitionId: ActiveRigDefinitionId;
  targetDefinitionId: ActiveRigDefinitionId;
  solve: typeof solveRigMotionToTarget;
};

export const RIG_SOLVER_REGISTRY = [
  descriptor("quadruped-v1", "definition-mapped-swing-twist-v1"),
  descriptor("avian-v1", "definition-mapped-swing-twist-v1"),
  descriptor("serpentine-v1", "serpentine-chain-resample-v1"),
  descriptor("arachnid-v1", "definition-mapped-swing-twist-v1"),
  descriptor("creature-v1", "definition-mapped-swing-twist-v1"),
] as const satisfies readonly RigSolverDescriptor[];

export function getRigSolver(
  sourceDefinitionId: ActiveRigDefinitionId,
  targetDefinitionId: ActiveRigDefinitionId,
) {
  return (
    RIG_SOLVER_REGISTRY.find(
      (solver) =>
        solver.sourceDefinitionId === sourceDefinitionId &&
        solver.targetDefinitionId === targetDefinitionId,
    ) ?? null
  );
}

function descriptor(
  definitionId: Exclude<ActiveRigDefinitionId, "humanoid-v1">,
  id: Exclude<RigMotionSolverId, "same-rest-node-skin-signature">,
): RigSolverDescriptor {
  return {
    id,
    sourceDefinitionId: definitionId,
    targetDefinitionId: definitionId,
    solve: solveRigMotionToTarget,
  };
}
