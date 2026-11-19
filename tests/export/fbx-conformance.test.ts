import { readFile } from "node:fs/promises";
import path from "node:path";
import { AnimationMixer, LoopOnce, Vector3, type Object3D } from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { exportFBXAnimation } from "@/export";
import { getRetargetPipeline } from "@/pipelines";
import { DEFAULT_RETARGET_SOLVE_OPTIONS } from "@/retarget";
import { DEFAULT_CUSTOM_RIG_MAPPING_CONFIG } from "@/solvers";
import { readStudioMannequinVRM } from "../fixtures/vrm-variants";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

const WALK = "tests/fixtures/certification/golden-motion/motions/quaternius-walk/quaternius-walk.animation.glb";

// The oracles are independent of the 3dretarget importer: a minimal binary
// FBX record reader checks the encoding Blender and the Autodesk FBX SDK
// expect, and three.js FBXLoader plays the motion so the pose can be checked
// against physical facts about walking.
describe("FBX animation export conformance", () => {
  let bytes: Uint8Array;
  beforeAll(async () => {
    // Solving does not depend on the output format.
    const { solvedClip } = await getRetargetPipeline("gltf-animation", "vrm", "vrma")!.retarget({
      motionFile: new File([new Uint8Array(await readFile(path.join(process.cwd(), WALK)))], "walk.glb"),
      avatarFile: new File([await readStudioMannequinVRM()], "avatar.vrm"),
      mapping: DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
      solveOptions: DEFAULT_RETARGET_SOLVE_OPTIONS,
    });
    bytes = await exportFBXAnimation(solvedClip, { boneNamingProfile: "mixamo" });
  });

  it("labels property types as the FBX SDK does", () => {
    const records = readFBXRecords(bytes);
    const settings = propertyRecords(records, "GlobalSettings");
    expect(settings.get("UnitScaleFactor")?.slice(1, 4)).toEqual(["double", "Number", ""]);
    expect(settings.get("UpAxis")?.slice(1, 4)).toEqual(["int", "Integer", ""]);
    const model = records.find((record) => record.name === "Objects")!.children
      .find((record) => record.name === "Model")!;
    const modelProperties = propertyRecords([model], "Model");
    expect(modelProperties.get("Lcl Rotation")?.slice(1, 4)).toEqual(["Lcl Rotation", "", "A"]);
    expect(modelProperties.get("RotationOrder")?.slice(1, 4)).toEqual(["enum", "", ""]);
  });

  it("uses the Euler order readers apply without RotationActive", () => {
    // Blender and the FBX SDK ignore RotationOrder unless RotationActive is
    // set, while three.js FBXLoader always applies it. Only eEulerXYZ (0)
    // means the same thing to all of them.
    const objects = readFBXRecords(bytes).find((record) => record.name === "Objects")!.children;
    for (const model of objects.filter((record) => record.name === "Model")) {
      const properties = propertyRecords([model], "Model");
      if (properties.get("RotationActive")?.[4] === 1) continue;
      expect(properties.get("RotationOrder")?.[4] ?? 0, String(model.properties[1])).toBe(0);
    }
  });

  it("encodes object names as binary FBX Name\\0\\x01Class", () => {
    const objects = readFBXRecords(bytes).find((record) => record.name === "Objects")!.children;
    for (const object of objects) {
      const name = object.properties[1];
      expect(typeof name, object.name).toBe("string");
      expect(name, object.name).not.toContain("::");
      expect(name, object.name).toContain("\u0000\u0001");
    }
    const hips = objects.find((object) => object.properties[1] === "mixamorig:Hips\u0000\u0001Model");
    expect(hips).toBeDefined();
  });

  it("walks forward along the declared front axis with arms down in a standard reader", () => {
    const root = new FBXLoader().parse(toArrayBuffer(bytes), "");
    const bone = (name: string) => {
      const object = root.getObjectByName(`mixamorig${name}`);
      expect(object, name).toBeDefined();
      return object!;
    };
    const world = (object: Object3D) => object.getWorldPosition(new Vector3());
    root.updateMatrixWorld(true);
    // GlobalSettings declare +Y up and +Z front, so the character's left is +X.
    expect(world(bone("LeftUpLeg")).x).toBeGreaterThan(world(bone("RightUpLeg")).x);

    const clip = root.animations[0]!;
    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const hipsStart = new Vector3();
    const samples = 24;
    for (let index = 0; index <= samples; index += 1) {
      mixer.setTime((clip.duration * index) / samples);
      root.updateMatrixWorld(true);
      if (index === 0) hipsStart.copy(world(bone("Hips")));
      for (const side of ["Left", "Right"]) {
        expect(world(bone(`${side}Hand`)).y, `${side} hand at ${index}`).toBeLessThan(world(bone(`${side}Arm`)).y);
        expect(world(bone(`${side}Foot`)).y, `${side} foot at ${index}`).toBeLessThan(world(bone("Hips")).y);
      }
    }
    const travel = world(bone("Hips")).sub(hipsStart).setY(0);
    expect(travel.length()).toBeGreaterThan(0.1);
    expect(travel.normalize().z).toBeGreaterThan(0.9);
  });
});

type FBXRecord = { name: string; properties: unknown[]; children: FBXRecord[] };

/** Reads FBX 7.4 binary records (32-bit offsets); array payloads are skipped. */
function readFBXRecords(bytes: Uint8Array): FBXRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const records: FBXRecord[] = [];
  let offset = 27;
  const readRecord = (): FBXRecord | null => {
    const end = view.getUint32(offset, true);
    const count = view.getUint32(offset + 4, true);
    const nameLength = view.getUint8(offset + 12);
    if (end === 0) {
      offset += 13;
      return null;
    }
    const name = decoder.decode(bytes.subarray(offset + 13, offset + 13 + nameLength));
    offset += 13 + nameLength;
    const properties: unknown[] = [];
    for (let index = 0; index < count; index += 1) {
      const type = String.fromCharCode(view.getUint8(offset));
      offset += 1;
      if (type === "S" || type === "R") {
        const length = view.getUint32(offset, true);
        const value = bytes.subarray(offset + 4, offset + 4 + length);
        properties.push(type === "S" ? decoder.decode(value) : value);
        offset += 4 + length;
      } else if (type === "I") {
        properties.push(view.getInt32(offset, true));
        offset += 4;
      } else if (type === "L") {
        properties.push(Number(view.getBigInt64(offset, true)));
        offset += 8;
      } else if (type === "D") {
        properties.push(view.getFloat64(offset, true));
        offset += 8;
      } else if ("fdlib".includes(type)) {
        offset += 12 + view.getUint32(offset + 8, true);
        properties.push(null);
      } else {
        throw new Error(`Unsupported FBX property type ${type}`);
      }
    }
    const children: FBXRecord[] = [];
    while (offset < end) {
      const child = readRecord();
      if (child) children.push(child);
    }
    return { name, properties, children };
  };
  while (offset < bytes.byteLength) {
    const record = readRecord();
    if (!record) break;
    records.push(record);
  }
  return records;
}

function propertyRecords(records: FBXRecord[], owner: string) {
  const table = new Map<string, unknown[]>();
  const holder = records.find((record) => record.name === owner);
  for (const record of holder?.children.find((child) => child.name === "Properties70")?.children ?? []) {
    table.set(record.properties[0] as string, record.properties);
  }
  return table;
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
