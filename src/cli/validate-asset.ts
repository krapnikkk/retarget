import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  formatAssetValidationReport,
  validateAssetFile,
  DEFAULT_ASSET_RIG_CONTRACT,
  type AssetRigContract,
  type AssetValidationKind,
} from "@/asset-validation";

export async function runValidateAssetCLI(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    console.error(parsed.message);
    console.error(
      "Usage: pnpm validate-asset <file.glb> --kind character|motion [--rig-family quadruped --rig-definition quadruped-v1 --rig-profile canonical-quadruped-v1]",
    );
    return 1;
  }

  const bytes = await readFile(parsed.filePath);
  const file = new File([bytes], path.basename(parsed.filePath), {
    type: "model/gltf-binary",
  });
  const result = await validateAssetFile(file, parsed.kind, parsed.rigContract);
  console.log(formatAssetValidationReport(result));
  return result.ok ? 0 : 1;
}

function parseArgs(args: string[]):
  | {
      ok: true;
      filePath: string;
      kind: AssetValidationKind;
      rigContract: AssetRigContract;
    }
  | { ok: false; message: string } {
  const filePath = args[0] && !args[0].startsWith("-") ? args[0] : undefined;
  const kindFlag = args.findIndex((arg) => arg === "--kind");
  const kind = kindFlag >= 0 ? args[kindFlag + 1] : undefined;
  const rigFamily = readFlag(args, "--rig-family");
  const rigDefinitionId = readFlag(args, "--rig-definition");
  const rigProfileId = readFlag(args, "--rig-profile");

  if (!filePath) {
    return { ok: false, message: "Missing GLB file path." };
  }
  if (kind !== "character" && kind !== "motion") {
    return { ok: false, message: "Missing or invalid --kind." };
  }

  if ([rigFamily, rigDefinitionId, rigProfileId].some(Boolean)) {
    if (!rigFamily || !rigDefinitionId || !rigProfileId) {
      return {
        ok: false,
        message:
          "--rig-family, --rig-definition, and --rig-profile must be provided together.",
      };
    }
  }

  return {
    ok: true,
    filePath,
    kind,
    rigContract: rigFamily
      ? {
          rigFamily: rigFamily as AssetRigContract["rigFamily"],
          rigDefinitionId:
            rigDefinitionId as AssetRigContract["rigDefinitionId"],
          rigProfileId: rigProfileId!,
        }
      : DEFAULT_ASSET_RIG_CONTRACT,
  };
}

function readFlag(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
