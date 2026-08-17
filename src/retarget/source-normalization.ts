import { Quaternion, Vector3 } from "three";
import { VRM_HUMANOID_PROFILE, type RigProfile } from "@/profiles";
import { createAxisCorrection } from "./coordinate-space";
import type { HumanoidBoneName, MotionTrack } from "./types";

export type SourceRotationSemantics = "absolute-local" | "delta-local";
export type SourceTranslationSemantics = "absolute-local" | "root-offset";

export type SourceBoneRestTransform = {
  localPosition: [number, number, number];
  parentWorldQuaternion: [number, number, number, number];
  worldQuaternion: [number, number, number, number];
};

export type RawImportedHumanoidMotion = {
  profile: RigProfile;
  tracks: MotionTrack[];
  restTransforms?: ReadonlyMap<HumanoidBoneName, SourceBoneRestTransform>;
  rotationSemantics?: SourceRotationSemantics;
  translationSemantics?: SourceTranslationSemantics;
};

export type SourceNormalizationResult = {
  tracks: MotionTrack[];
  sourceProfile: RigProfile;
  canonicalProfile: RigProfile;
  axisCorrectionApplied: boolean;
  scaleToMeters: number;
  unitScaleKnown: boolean;
  usedRestTransforms: boolean;
};

export function normalizeSourceMotionToCanonical({
  profile,
  restTransforms,
  rotationSemantics = "delta-local",
  tracks,
  translationSemantics = "root-offset",
}: RawImportedHumanoidMotion): SourceNormalizationResult {
  const axisCorrection = createAxisCorrection(profile, VRM_HUMANOID_PROFILE);
  const axisCorrectionApplied = axisCorrection.angleTo(new Quaternion()) > 1e-6;
  const { known: unitScaleKnown, scale: scaleToMeters } = scaleUnitToMeters(
    profile.scaleUnit,
  );
  let usedRestTransforms = false;

  const normalizedTracks = tracks.map((track) => {
    const rest = restTransforms?.get(track.bone);
    if (track.path === "rotation") {
      const values: number[] = [];
      let previous: Quaternion | null = null;
      for (let index = 0; index < track.values.length; index += 4) {
        const rotation = new Quaternion(
          track.values[index] ?? 0,
          track.values[index + 1] ?? 0,
          track.values[index + 2] ?? 0,
          track.values[index + 3] ?? 1,
        ).normalize();
        if (rotationSemantics === "absolute-local" && rest) {
          rotation
            .premultiply(new Quaternion(...rest.parentWorldQuaternion))
            .multiply(new Quaternion(...rest.worldQuaternion).invert())
            .normalize();
          usedRestTransforms = true;
        }
        if (axisCorrectionApplied) {
          rotation
            .premultiply(axisCorrection)
            .multiply(axisCorrection.clone().invert())
            .normalize();
        }
        if (previous && previous.dot(rotation) < 0) {
          rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
        }
        values.push(
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.w,
        );
        previous = rotation;
      }
      return { ...track, values };
    }

    const values: number[] = [];
    for (let index = 0; index < track.values.length; index += 3) {
      const translation = new Vector3(
        track.values[index] ?? 0,
        track.values[index + 1] ?? 0,
        track.values[index + 2] ?? 0,
      );
      if (translationSemantics === "absolute-local" && rest) {
        translation.sub(new Vector3(...rest.localPosition));
        usedRestTransforms = true;
      }
      if (rest) {
        translation.applyQuaternion(new Quaternion(...rest.parentWorldQuaternion));
        usedRestTransforms = true;
      }
      translation.multiplyScalar(scaleToMeters);
      if (axisCorrectionApplied) {
        translation.applyQuaternion(axisCorrection);
      }
      values.push(translation.x, translation.y, translation.z);
    }
    return { ...track, values };
  });

  return {
    tracks: normalizedTracks,
    sourceProfile: profile,
    canonicalProfile: VRM_HUMANOID_PROFILE,
    axisCorrectionApplied,
    scaleToMeters,
    unitScaleKnown,
    usedRestTransforms,
  };
}

function scaleUnitToMeters(unit: RigProfile["scaleUnit"]) {
  if (unit === "centimeters") return { known: true, scale: 0.01 };
  if (unit === "meters") return { known: true, scale: 1 };
  return { known: false, scale: 1 };
}
