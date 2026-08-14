import hashlib
import json
import math
import pathlib
import sys
import traceback

import bpy


def user_args():
    try:
        separator = sys.argv.index("--")
    except ValueError as error:
        raise RuntimeError("Expected Blender verifier arguments after --") from error
    args = sys.argv[separator + 1 :]
    if len(args) != 4:
        raise RuntimeError(
            "Expected artifact path, result path, Blender version, and build hash"
        )
    return args


def text(value):
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)


def pose_snapshot(armatures):
    values = []
    for armature in armatures:
        for bone in armature.pose.bones:
            matrix = armature.matrix_world @ bone.matrix
            values.extend(component for row in matrix for component in row)
    return values


def changed_value_count(reference, candidate, epsilon=1e-6):
    if len(reference) != len(candidate):
        return max(len(reference), len(candidate))
    return sum(
        1
        for first, second in zip(reference, candidate)
        if math.fabs(first - second) > epsilon
    )


def main():
    artifact_arg, result_arg, expected_version, expected_build_hash = user_args()
    artifact_path = pathlib.Path(artifact_arg).resolve()
    result_path = pathlib.Path(result_arg).resolve()
    result_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_version = bpy.app.version_string
    build_hash = text(bpy.app.build_hash)
    result = {
        "runtime": "blender",
        "version": runtime_version,
        "buildHash": build_hash,
        "status": "failed",
    }

    try:
        if runtime_version != expected_version:
            raise RuntimeError(
                f"Blender version {runtime_version} does not match {expected_version}"
            )
        if build_hash != expected_build_hash:
            raise RuntimeError(
                f"Blender build {build_hash} does not match {expected_build_hash}"
            )

        artifact_bytes = artifact_path.read_bytes()
        bpy.ops.wm.read_factory_settings(use_empty=True)
        imported = bpy.ops.import_scene.gltf(filepath=str(artifact_path))
        if "FINISHED" not in imported:
            raise RuntimeError(f"Blender glTF import returned {sorted(imported)}")

        armatures = [item for item in bpy.data.objects if item.type == "ARMATURE"]
        meshes = [item for item in bpy.data.objects if item.type == "MESH"]
        actions = list(bpy.data.actions)
        bone_count = sum(len(item.data.bones) for item in armatures)
        if not armatures or not meshes or not actions or bone_count == 0:
            raise RuntimeError(
                "Blender import did not create an armature, mesh, action, and bones"
            )

        frame_start = min(float(action.frame_range[0]) for action in actions)
        frame_end = max(float(action.frame_range[1]) for action in actions)
        if frame_end <= frame_start:
            raise RuntimeError("Blender imported animation has no positive frame range")
        sample_frames = [
            frame_start,
            frame_start + (frame_end - frame_start) * 0.5,
            frame_end,
        ]
        snapshots = []
        for frame in sample_frames:
            bpy.context.scene.frame_set(
                int(math.floor(frame)), subframe=frame - math.floor(frame)
            )
            bpy.context.view_layer.update()
            snapshots.append(pose_snapshot(armatures))
        changed_values = sum(
            changed_value_count(snapshots[0], snapshot)
            for snapshot in snapshots[1:]
        )
        if changed_values == 0:
            raise RuntimeError("Blender animation sampling did not change any pose matrix")

        result.update(
            {
                "status": "passed",
                "artifactSha256": hashlib.sha256(artifact_bytes).hexdigest(),
                "checks": {
                    "armatureCount": len(armatures),
                    "meshCount": len(meshes),
                    "actionCount": len(actions),
                    "boneCount": bone_count,
                    "animationFrameStart": frame_start,
                    "animationFrameEnd": frame_end,
                    "sampleFrames": sample_frames,
                    "changedPoseValues": changed_values,
                },
            }
        )
    except Exception as error:
        result["error"] = str(error)
        result_path.write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        traceback.print_exc()
        return 1

    result_path.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print("BLENDER_ECOSYSTEM_RECEIPT=" + json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
