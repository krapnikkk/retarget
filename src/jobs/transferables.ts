import type { RetargetJobTask } from "./types";

export function collectRetargetTaskTransfers(
  task: RetargetJobTask,
): ArrayBuffer[] {
  const transfers = new Set<ArrayBuffer>();
  const add = (value: ArrayBuffer | undefined) => {
    if (value) transfers.add(value);
  };
  const addResources = (resources?: Readonly<Record<string, ArrayBuffer>>) => {
    if (!resources) return;
    for (const bytes of Object.values(resources)) add(bytes);
  };
  const addPackage = (
    assetPackage?: { resources: Readonly<Record<string, ArrayBuffer>> },
  ) => addResources(assetPackage?.resources);

  switch (task.type) {
    case "humanoid-binding":
      add(task.bytes);
      if (task.command.operation === "validate") add(task.command.outputBytes);
      break;
    case "inspect-humanoid-avatar":
      add(task.bytes);
      add(task.structuralJSONBytes);
      addResources(task.resources);
      addPackage(task.assetPackage);
      break;
    case "convert-mmd-avatar":
      add(task.bytes);
      addPackage(task.assetPackage);
      break;
    case "inspect-rigged-gltf":
    case "import-motion":
      add(task.bytes);
      addResources(task.resources);
      break;
    case "retarget-rigged-gltf":
      add(task.motionBytes);
      add(task.targetBytes);
      addResources(task.motionResources);
      addResources(task.targetResources);
      break;
    case "validate-motion-export":
    case "validate-avatar-export":
      add(task.bytes);
      break;
    case "solve-humanoid":
    case "export-motion":
    case "semantic-validate":
      break;
  }
  return [...transfers];
}

export function collectRetargetResultTransfers(
  task: RetargetJobTask,
  result: unknown,
): ArrayBuffer[] {
  if (task.type === "humanoid-binding" && result && typeof result === "object" && "bytes" in result &&
    result.bytes instanceof Uint8Array && result.bytes.buffer instanceof ArrayBuffer) return [result.bytes.buffer];
  if (
    (task.type === "convert-mmd-avatar" || task.type === "export-motion") &&
    result instanceof Uint8Array &&
    result.buffer instanceof ArrayBuffer
  ) {
    return [result.buffer];
  }
  return [];
}
