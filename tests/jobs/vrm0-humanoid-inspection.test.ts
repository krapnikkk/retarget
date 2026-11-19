import { WebIO } from "@gltf-transform/core";
import { VRMC_VRM_EXTENSIONS } from "gltf-transform-vrm-extensions";
import { describe, expect, it } from "vitest";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { runRetargetJobInline } from "@/jobs/browser-retarget-job";
import {
  deriveVRM0,
  readStudioMannequinVRM,
  withOpaqueNodeNames,
} from "../fixtures/vrm-variants";

// VRoid's VRM 0.x exports name their nodes `J_Bip_*`, which no rig profile
// alias matches, so their bones are known only from the VRM bone table.
async function readBoneTableOnlyVRM0() {
  return withOpaqueNodeNames(deriveVRM0(await readStudioMannequinVRM()));
}

describe("VRM 0.x humanoid bone table", () => {
  it("inspects the same rig from full bytes and from the GLB JSON chunk", async () => {
    const avatar = await readBoneTableOnlyVRM0();
    const inspect = (structural: boolean) =>
      runRetargetJobInline({
        type: "inspect-humanoid-avatar",
        bytes: structural ? new ArrayBuffer(0) : avatar.slice().buffer,
        structuralJSONBytes: structural ? glbJSONChunk(avatar) : undefined,
        filename: "avatar.vrm",
        formatId: "vrm",
      });
    const [full, structural] = await Promise.all([inspect(false), inspect(true)]);

    expect(full.missingRequiredBones).toEqual([]);
    expect([...full.bones].sort()).toEqual([...structural.bones].sort());
    expect(full.restHipsHeight).toBeCloseTo(structural.restHipsHeight!, 6);
    // The two paths compute world transforms in float32 and float64.
    for (const bone of full.bones) {
      full.restJoints![bone]!.position.forEach((value, axis) =>
        expect(value, `${bone}[${axis}]`).toBeCloseTo(structural.restJoints![bone]!.position[axis]!, 5),
      );
    }
  });

  it("maps bones, including VRM 0.x thumb names, to the nodes the table names", async () => {
    const avatar = await readBoneTableOnlyVRM0();
    const document = await new WebIO()
      .registerExtensions(VRMC_VRM_EXTENSIONS)
      .readBinary(avatar);
    const table = readVRM0BoneTable(avatar);
    const nodes = collectHumanoidNodes(document);
    const nodeOf = (vrm0Bone: string) => `node_${table.get(vrm0Bone)}`;

    expect(nodes.get("hips")?.getName()).toBe(nodeOf("hips"));
    expect(nodes.get("leftHand")?.getName()).toBe(nodeOf("leftHand"));
    // VRM 0.x Proximal / Intermediate / Distal are VRM 1.0 Metacarpal / Proximal / Distal.
    expect(nodes.get("leftThumbMetacarpal")?.getName()).toBe(nodeOf("leftThumbProximal"));
    expect(nodes.get("leftThumbProximal")?.getName()).toBe(nodeOf("leftThumbIntermediate"));
    expect(nodes.get("leftThumbDistal")?.getName()).toBe(nodeOf("leftThumbDistal"));
    expect(new Set([...nodes.values()]).size).toBe(nodes.size);
  });
});

function glbJSONChunk(bytes: Uint8Array) {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  return bytes.slice(20, 20 + length).buffer;
}

function readVRM0BoneTable(bytes: Uint8Array) {
  const json = JSON.parse(new TextDecoder().decode(glbJSONChunk(bytes))) as {
    extensions: { VRM: { humanoid: { humanBones: Array<{ bone: string; node: number }> } } };
  };
  return new Map(json.extensions.VRM.humanoid.humanBones.map(({ bone, node }) => [bone, node]));
}
