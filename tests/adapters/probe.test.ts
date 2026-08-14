import { describe, expect, it } from "vitest";
import {
  findAvatarImportAdapter,
  probeAvatarImportAdapter,
} from "@/adapters/avatar";
import {
  findMotionImportAdapter,
  probeMotionImportAdapter,
} from "@/adapters/motion";

function file(name: string, content: string) {
  return new File([content], name, { type: "application/octet-stream" });
}

function fbx(name: string, content: string) {
  return file(
    name,
    `FBXHeaderExtension: {\nUpAxis: 1\nFrontAxis: 2\nUnitScaleFactor: 1\n${content}\n}`,
  );
}

function glb(name: string, document: object) {
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(encoded.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + jsonLength);
  bytes.fill(0x20, 20);
  bytes.set(encoded, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  return new File([bytes], name, { type: "model/gltf-binary" });
}

describe("bounded adapter probes", () => {
  it("uses content evidence instead of an ecosystem-looking filename", async () => {
    const match = await probeMotionImportAdapter(
      fbx("actorcore-dance.fbx", "mixamorigHips mixamorig:LeftArm"),
    );

    expect(match?.adapter.id).toBe("mixamo-fbx");
    expect(match?.probe.evidence).toContain(
      "ecosystem markers: mixamorigHips, mixamorig:LeftArm",
    );
  });

  it("keeps unknown FBX humanoids out of the Mixamo profile", async () => {
    const adapter = await findMotionImportAdapter(
      fbx("walk.fbx", "Hips Spine LeftArm RightArm LeftUpLeg RightUpLeg"),
    );

    expect(adapter).toMatchObject({
      id: "generic-fbx",
      profileId: "generic-fbx-humanoid",
    });
  });

  it("reports bounded evidence and uncertainty", async () => {
    const match = await probeMotionImportAdapter(
      fbx("walk.fbx", "CC_Base_Hip CC_Base_L_Upperarm"),
    );

    expect(match).toMatchObject({
      adapter: { id: "actorcore-fbx", profileId: "actorcore" },
      probe: { profile: "actorcore" },
    });
    expect(match?.probe.confidence).toBeGreaterThanOrEqual(0.35);
    expect(match?.probe.evidence).toEqual(
      expect.arrayContaining([
        "FBX header signature found",
        "FBX UpAxis metadata found",
      ]),
    );
  });

  it("does not guess when an extension maps to competing ecosystems", async () => {
    await expect(
      findMotionImportAdapter(file("empty.fbx", "not motion data")),
    ).resolves.toBeNull();
    await expect(
      findAvatarImportAdapter(file("empty.glb", "not glTF")),
    ).resolves.toBeNull();
  });

  it("treats extensions as hints and requires bounded content evidence", async () => {
    await expect(
      findMotionImportAdapter(file("garbage.bvh", "not motion data")),
    ).resolves.toBeNull();
    await expect(
      findMotionImportAdapter(
        file(
          "renamed.txt",
          "HIERARCHY\nROOT Hips\n{\n  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\n}\nMOTION\nFrames: 1\nFrame Time: 0.033333\n0 0 0 0 0 0",
        ),
      ),
    ).resolves.toMatchObject({ id: "bvh" });
  });

  it("recognizes avatar ecosystems from node evidence", async () => {
    const avatar = glb(
      "renamed.glb",
      {
        nodes: [{ name: "Wolf3D_Head" }, { name: "Wolf3D_Body" }],
        skins: [{}],
      },
    );
    const match = await probeAvatarImportAdapter(avatar);

    expect(match?.adapter.id).toBe("ready-player-me");
    expect(match?.probe.evidence).toContain(
      "ecosystem markers: Wolf3D_Head, Wolf3D_Body",
    );
  });
});
