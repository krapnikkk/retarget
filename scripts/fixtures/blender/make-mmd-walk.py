"""Build an MMD-unit VMD walk with MMD Tools' VMD exporter.

Usage (Blender 5.2 LTS, headless; MMD Tools 4.5.14 unpacked under TOOLS):
  blender --background --factory-startup \
    --python scripts/fixtures/blender/make-mmd-walk.py -- <source.animated.glb> <out-dir> <mmd-tools-dir>

<mmd-tools-dir> contains the mmd_tools package and a `site` folder with its
bundled opencc wheel extracted, e.g. D:\\Tools\\mmd_tools-v4.5.14. MMD Tools is
loaded for this run only, not installed into the Blender profile.

The source is the certified CC0 Quaternius walk on the CC0 Studio Mannequin
(see make-mixamo-walk.py). A standard-proportion MMD skeleton (Japanese bone
names, leg roots at 10 MMD units = 0.80 m, arms in a 34 degree A-pose)
follows it through world-space constraints, is baked to FK keys, and is
exported at scale 12.5 (1 unit = 0.08 m).
"""

import math
import sys

import bpy
from mathutils import Matrix, Vector

SOURCE, OUT_DIR, TOOLS = sys.argv[sys.argv.index("--") + 1:][:3]
sys.path.insert(0, TOOLS)
sys.path.insert(0, TOOLS + "\\site")
import mmd_tools  # noqa: E402

mmd_tools.register()

LEG_ROOT_HEIGHT = 0.80  # 10 MMD units at 0.08 m per unit
A_POSE_DEGREES = 34.0  # measured on MMDAgent-EX Gene (issue #14)

# MMD bone -> (source bone, MMD parent). Root offsets ride on センター;
# 下半身 carries the pelvis rotation, 上半身 the spine.
BONES = {
    "センター": ("hips", None),
    "下半身": ("hips", "センター"),
    "上半身": ("spine", "センター"),
    "上半身2": ("chest", "上半身"),
    "首": ("neck", "上半身2"),
    "頭": ("head", "首"),
}
for side, mmd in (("left", "左"), ("right", "右")):
    BONES.update({
        f"{mmd}肩": (f"{side}Shoulder", "上半身2"),
        f"{mmd}腕": (f"{side}UpperArm", f"{mmd}肩"),
        f"{mmd}ひじ": (f"{side}LowerArm", f"{mmd}腕"),
        f"{mmd}手首": (f"{side}Hand", f"{mmd}ひじ"),
        f"{mmd}足": (f"{side}UpperLeg", "下半身"),
        f"{mmd}ひざ": (f"{side}LowerLeg", f"{mmd}足"),
        f"{mmd}足首": (f"{side}Foot", f"{mmd}ひざ"),
        f"{mmd}つま先": (f"{side}Toes", f"{mmd}足首"),
    })
ARM_CHAIN = ("腕", "ひじ", "手首")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=SOURCE)
for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
    bpy.data.objects.remove(obj)  # only the skeleton and its motion are needed
src = next(o for o in bpy.data.objects if o.type == "ARMATURE")
action = src.animation_data.action
start, end = (round(f) for f in action.frame_range)
scene.frame_start, scene.frame_end = start, end

# Scale the source object (not applied) so world positions and strides match
# the MMD skeleton's proportions; constraints read world space.
scene.frame_set(start)
bpy.context.view_layer.update()
rest_world = {b.name: src.matrix_world @ b.matrix_local for b in src.data.bones}
leg_root = (rest_world["leftUpperLeg"].translation.z + rest_world["rightUpperLeg"].translation.z) / 2
k = LEG_ROOT_HEIGHT / leg_root
src.scale = (k, k, k)
bpy.context.view_layer.update()
rest_world = {b.name: src.matrix_world @ b.matrix_local for b in src.data.bones}


# Each MMD bone takes its source bone's rest frame (head, direction, roll),
# scaled, so non-arm bones rest exactly like the source. The arm chain is then
# turned from the source T-pose into the A-pose about each 腕 head. MMD bones
# have no local axes, so Blender bone directions only affect display; MMD Tools
# converts rotations through each bone's rest matrix.
def rest_frame(source):
    world = rest_world[source]
    bone = src.data.bones[source]
    length = bone.length * k
    return world.translation.copy(), (world.to_3x3() @ Vector((0, length, 0))), world.to_3x3() @ Vector((0, 0, 1))


frames = {name: rest_frame(source) for name, (source, _) in BONES.items()}
for mmd_side, sign in (("左", 1.0), ("右", -1.0)):
    pivot = frames[f"{mmd_side}腕"][0]
    turn = Matrix.Rotation(math.radians(A_POSE_DEGREES) * sign, 3, "Y")
    for part in ARM_CHAIN:
        head, axis, z_axis = frames[f"{mmd_side}{part}"]
        frames[f"{mmd_side}{part}"] = (pivot + turn @ (head - pivot), turn @ axis, turn @ z_axis)

arm_data = bpy.data.armatures.new("mmd-walk")
mmd = bpy.data.objects.new("mmd-walk", arm_data)
scene.collection.objects.link(mmd)
bpy.context.view_layer.objects.active = mmd
bpy.ops.object.mode_set(mode="EDIT")
for name in BONES:
    head, axis, z_axis = frames[name]
    bone = arm_data.edit_bones.new(name)
    bone.head = head
    bone.tail = head + axis
    bone.align_roll(z_axis)
for name, (_, parent) in BONES.items():
    if parent:
        arm_data.edit_bones[name].parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="POSE")

# World-space constraints: every bone takes its source bone's world
# orientation; センター also follows the hips position (root offsets).
for name, (source, _) in BONES.items():
    pose = mmd.pose.bones[name]
    if name == "センター":
        loc = pose.constraints.new("COPY_LOCATION")
        loc.target, loc.subtarget = src, source
        continue
    rot = pose.constraints.new("COPY_ROTATION")
    rot.target, rot.subtarget = src, source
    rot.owner_space = rot.target_space = "WORLD"
    rot.mix_mode = "REPLACE"
bpy.context.view_layer.update()

# Bake to FK keys and drop the constraints; no IK bones exist.
bpy.ops.pose.select_all(action="SELECT")
bpy.ops.nla.bake(
    frame_start=start,
    frame_end=end,
    only_selected=True,
    visual_keying=True,
    clear_constraints=True,
    use_current_action=True,
    bake_types={"POSE"},
)
bpy.ops.object.mode_set(mode="OBJECT")

bpy.ops.wm.save_as_mainfile(filepath=f"{OUT_DIR}/mmd-walk.blend")
bpy.ops.object.select_all(action="DESELECT")
mmd.select_set(True)
bpy.context.view_layer.objects.active = mmd
bpy.ops.mmd_tools.export_vmd(
    filepath=f"{OUT_DIR}/mmd-walk.vmd",
    scale=12.5,
    use_pose_mode=False,
    use_frame_range=True,
)
print(f"RESULT wrote {OUT_DIR}/mmd-walk.vmd (k={k:.6f}, leg root {LEG_ROOT_HEIGHT} m)")
