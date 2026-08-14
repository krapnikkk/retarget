import receiptJSON from "./receipts/quaternius-walk-gltf-to-studio-mannequin-glb.json";
import type { EcosystemRuntimeName } from "./humanoid-pipeline-certification";

export type EcosystemRuntimeReceipt = {
  runtime: string;
  version: string;
  buildHash: string;
  status: "passed" | "failed";
  artifactSha256: string;
  checks: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
};

export type HumanoidEcosystemReceipt = {
  schemaVersion: 1;
  caseId: string;
  status: "passed" | "failed";
  requiredRuntimes: EcosystemRuntimeName[];
  artifact: {
    filename: string;
    byteLength: number;
    sha256: string;
  };
  runtimes: {
    blender: EcosystemRuntimeReceipt;
    godot: EcosystemRuntimeReceipt;
    unity: {
      required: boolean;
      status: "deferred" | "passed" | "failed";
      reason?: string;
    };
  };
};

export const HUMANOID_ECOSYSTEM_RECEIPTS = Object.freeze([
  receiptJSON as HumanoidEcosystemReceipt,
]);

export function getHumanoidEcosystemReceipt(caseId: string) {
  return HUMANOID_ECOSYSTEM_RECEIPTS.find(
    (receipt) => receipt.caseId === caseId,
  );
}
