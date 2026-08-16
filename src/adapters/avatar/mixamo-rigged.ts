import type { AvatarImportAdapter } from "@/adapters/types";
import { mixamoRiggedAvatarImportProbe } from "@/adapters/import-probe-registry";

export const mixamoRiggedAvatarAdapter = {
  ...mixamoRiggedAvatarImportProbe,
} satisfies AvatarImportAdapter;
