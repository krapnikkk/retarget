import type { RigInspection } from "@/rigs";
import type { SerializedRigInspection } from "./types";

export function serializeRigInspection(
  inspection: RigInspection | SerializedRigInspection,
): SerializedRigInspection {
  if (!("nodesByRole" in inspection) && !("rolesByNode" in inspection)) {
    return inspection;
  }
  const serialized = { ...inspection } as Partial<RigInspection>;
  delete serialized.nodesByRole;
  delete serialized.rolesByNode;
  return serialized as SerializedRigInspection;
}
