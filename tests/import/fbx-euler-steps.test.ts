import { Euler, MathUtils, Quaternion, type KeyframeTrack } from "three";
import { FBXLoader as UpstreamFBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { describe, expect, it } from "vitest";
import { importFBXHumanoidMotionBytes } from "@/import/fbx-motion";
import { FBXLoader } from "@/parsers/fbx-loader";
import { MIXAMO_RIG_PROFILE } from "@/profiles";

// FBX KTime ticks per second.
const SECOND = 46_186_158_000;

/**
 * A hand-written ASCII FBX: one Mixamo hips bone whose X rotation keys are
 * 0, 10, 200, 210 degrees at 0..3 s. The 10 -> 200 step is the >= 180 degree
 * Euler step that Mixamo exports contain (spins, swings, sparse keys).
 */
const KEY_SECONDS = [0, 1, 2, 3];
const KEY_X_DEGREES = [0, 10, 200, 210];

describe("FBX rotation keys around Euler steps of 180 degrees or more", () => {
  it("keeps every source key, in strictly increasing time, with its own rotation", () => {
    const track = hipsRotation(new FBXLoader());
    const times = Array.from(track.times);

    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]!, `times[${index}]`).toBeGreaterThan(times[index - 1]!);
    }
    for (const [keyIndex, seconds] of KEY_SECONDS.entries()) {
      const sample = times.findIndex((time) => Math.abs(time - seconds) < 1e-6);
      expect(sample, `key at ${seconds} s`).toBeGreaterThanOrEqual(0);
      // The oracle is the file's own key: eEulerXYZ (RotationOrder 0) in degrees.
      const expected = new Quaternion().setFromEuler(
        new Euler(MathUtils.degToRad(KEY_X_DEGREES[keyIndex]!), 0, 0, "XYZ"),
      );
      const actual = new Quaternion().fromArray(track.values, sample * 4);
      // Track values are float32; acos near 1 turns that rounding into ~1e-4 rad.
      expect(actual.angleTo(expected), `rotation at ${seconds} s`).toBeLessThan(1e-3);
    }
  });

  it("imports the clip instead of rejecting repeated key times", () => {
    const clip = importFBXHumanoidMotionBytes({
      bytes: fixtureBytes(),
      filename: "euler-step.fbx",
      kind: "mixamo-fbx",
      profile: MIXAMO_RIG_PROFILE,
    });
    const hips = clip.tracks.find((track) => track.bone === "hips" && track.path === "rotation");
    expect(hips).toBeDefined();
    expect(KEY_SECONDS.every((seconds) => hips!.times.some((time) => Math.abs(time - seconds) < 1e-6))).toBe(true);
  });

  it("still needs the vendored loader: upstream repeats the start key and drops the end key", () => {
    // When this fails, three.js has fixed interpolateRotations. Delete
    // src/parsers/fbx/three-fbx-loader.js and import FBXLoader from three again.
    const times = Array.from(hipsRotation(new UpstreamFBXLoader()).times);
    expect(times.filter((time, index) => index > 0 && time <= times[index - 1]!)).toEqual([1]);
    expect(times.some((time) => Math.abs(time - 2) < 1e-6)).toBe(false);
  });
});

function hipsRotation(loader: { parse(buffer: ArrayBuffer, path: string): { animations: { tracks: KeyframeTrack[] }[] } }) {
  const group = loader.parse(fixtureBytes(), "");
  const track = group.animations[0]?.tracks.find((candidate) => candidate.name === "mixamorigHips.quaternion");
  if (!track) throw new Error("The fixture has no hips rotation track.");
  return track;
}

function fixtureBytes(): ArrayBuffer {
  const times = KEY_SECONDS.map((seconds) => seconds * SECOND);
  const curve = (id: number, values: number[]) => `	AnimationCurve: ${id}, "AnimCurve::", "" {
		Default: 0
		KeyVer: 4009
		KeyTime: *${times.length} {
			a: ${times.join(",")}
		}
		KeyValueFloat: *${values.length} {
			a: ${values.join(",")}
		}
		KeyAttrFlags: *1 {
			a: 24836
		}
		KeyAttrDataFloat: *4 {
			a: 0,0,0,0
		}
		KeyAttrRefCount: *1 {
			a: ${times.length}
		}
	}`;
  const zeros = KEY_SECONDS.map(() => 0);
  const text = `; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UnitScaleFactor", "double", "Number", "",1
	}
}
Objects:  {
	Model: 100, "Model::mixamorig:Hips", "LimbNode" {
		Version: 232
		Properties70:  {
			P: "RotationOrder", "enum", "", "",0
		}
	}
	AnimationStack: 200, "AnimStack::Take 001", "" {
		Properties70:  {
			P: "LocalStop", "KTime", "Time", "",${times[times.length - 1]}
		}
	}
	AnimationLayer: 300, "AnimLayer::BaseLayer", "" {
	}
	AnimationCurveNode: 400, "AnimCurveNode::R", "" {
		Properties70:  {
			P: "d|X", "Number", "", "A",0
			P: "d|Y", "Number", "", "A",0
			P: "d|Z", "Number", "", "A",0
		}
	}
${curve(501, KEY_X_DEGREES)}
${curve(502, zeros)}
${curve(503, zeros)}
}
Connections:  {
	C: "OO",100,0
	C: "OO",300,200
	C: "OO",400,300
	C: "OP",400,100, "Lcl Rotation"
	C: "OP",501,400, "d|X"
	C: "OP",502,400, "d|Y"
	C: "OP",503,400, "d|Z"
}
`;
  return new TextEncoder().encode(text).buffer;
}
