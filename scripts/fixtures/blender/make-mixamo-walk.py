"""Build a Mixamo-structured FBX walk with Blender's own FBX exporter.

Usage (Blender 5.2 LTS, headless):
  blender --background --factory-startup \
    --python scripts/fixtures/blender/make-mixamo-walk.py -- <source.animated.glb> <out-dir>

<source.animated.glb> is the certified CC0 Quaternius walk on the CC0 Studio
Mannequin (RETARGET_ECOSYSTEM_ARTIFACT_PATH from
tests/certification/generate-ecosystem-artifact.test.ts, SHA-256 171bd29b...).
The mannequin rests in a T-pose, like Mixamo, so its skeleton is renamed to
mixamorig: names and the motion carries over key for key.
"""

import sys

import bpy

SOURCE, OUT_DIR = sys.argv[sys.argv.index("--") + 1:][:2]
CM_PER_M = 100.0

# Canonical humanoid name -> Mixamo name (src/profiles/bone-naming.ts).
MIXAMO = {
    "hips": "Hips", "spine": "Spine", "chest": "Spine1", "upperChest": "Spine2",
    "neck": "Neck", "head": "Head",
}
for side, Side in (("left", "Left"), ("right", "Right")):
    MIXAMO.update({
        f"{side}Shoulder": f"{Side}Shoulder", f"{side}UpperArm": f"{Side}Arm",
        f"{side}LowerArm": f"{Side}ForeArm", f"{side}Hand": f"{Side}Hand",
        f"{side}UpperLeg": f"{Side}UpLeg", f"{side}LowerLeg": f"{Side}Leg",
        f"{side}Foot": f"{Side}Foot", f"{side}Toes": f"{Side}ToeBase",
        f"{side}ThumbMetacarpal": f"{Side}HandThumb1", f"{side}ThumbProximal": f"{Side}HandThumb2",
        f"{side}ThumbDistal": f"{Side}HandThumb3",
    })
    for finger, Finger in (("Index", "Index"), ("Middle", "Middle"), ("Ring", "Ring"), ("Little", "Pinky")):
        MIXAMO.update({
            f"{side}{finger}Proximal": f"{Side}Hand{Finger}1",
            f"{side}{finger}Intermediate": f"{Side}Hand{Finger}2",
            f"{side}{finger}Distal": f"{Side}Hand{Finger}3",
        })
    suffix = side[0]
    MIXAMO.update({
        f"thumb_04_leaf_{suffix}": f"{Side}HandThumb4",
        f"index_04_leaf_{suffix}": f"{Side}HandIndex4",
        f"middle_04_leaf_{suffix}": f"{Side}HandMiddle4",
        f"ring_04_leaf_{suffix}": f"{Side}HandRing4",
        f"pinky_04_leaf_{suffix}": f"{Side}HandPinky4",
        f"ball_leaf_{suffix}": f"{Side}Toe_End",
    })


def iter_fcurves(action):
    """Legacy and layered (Blender 4.4+) actions."""
    yield from getattr(action, "fcurves", [])
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=SOURCE)
for obj in [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("Icosphere")]:
    bpy.data.objects.remove(obj)  # glTF importer bone display shape
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = next(o for o in bpy.data.objects if o.type == "MESH")
action = arm.animation_data.action

# Centimetres: scene unit scale 0.01 makes the FBX exporter declare
# UnitScaleFactor = 1 and write the values as they are (verified on 5.2).
scene.unit_settings.scale_length = 0.01
bpy.ops.object.select_all(action="DESELECT")
for obj in (arm, body):
    obj.select_set(True)
bpy.context.view_layer.objects.active = arm
arm.scale = (CM_PER_M,) * 3
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for fcurve in iter_fcurves(action):  # applying scale leaves pose offsets in metres
    if fcurve.data_path.endswith(".location"):
        for key in fcurve.keyframe_points:
            key.co[1] *= CM_PER_M
            key.handle_left[1] *= CM_PER_M
            key.handle_right[1] *= CM_PER_M

# Hips becomes the root, as in Mixamo; fold any root weights into hips.
root_group = body.vertex_groups.get("root")
hips_group = body.vertex_groups.get("hips")
if root_group and hips_group:
    for vertex in body.data.vertices:
        for element in vertex.groups:
            if element.group == root_group.index and element.weight > 0:
                hips_group.add([vertex.index], element.weight, "ADD")
    body.vertex_groups.remove(root_group)
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
edit = arm.data.edit_bones
edit["hips"].parent = None
edit.remove(edit["root"])
head = edit["head"]
top = edit.new("HeadTop_End")
top.head = head.tail
top.tail = head.tail + (head.tail - head.head) * 0.5
top.roll = head.roll
top.parent = head
top.use_deform = False
bpy.ops.object.mode_set(mode="OBJECT")
arm.data.bones["HeadTop_End"].name = "mixamorig:HeadTop_End"

# Renaming bones also renames their vertex groups and animation paths.
for bone in list(arm.data.bones):
    if bone.name in MIXAMO:
        bone.name = "mixamorig:" + MIXAMO[bone.name]
leftovers = [b.name for b in arm.data.bones if not b.name.startswith("mixamorig:")]
if leftovers:
    raise SystemExit(f"unmapped bones: {leftovers}")
arm.name = "Armature"
action.name = "mixamo.com"
scene.name = "mixamo.com"  # the FBX AnimationStack (take) is named after the scene

# A small embedded diffuse texture ("With Skin"): a 64x64 checker PNG.
image = bpy.data.images.new("mixamo-walk-diffuse", 64, 64)
pixels = []
for y in range(64):
    for x in range(64):
        light = ((x // 8) + (y // 8)) % 2 == 0
        pixels.extend((0.8, 0.8, 0.8, 1.0) if light else (0.25, 0.35, 0.6, 1.0))
image.pixels = pixels
image.filepath_raw = f"{OUT_DIR}/mixamo-walk-diffuse.png"
image.file_format = "PNG"
image.save()
for material in body.data.materials:
    material.use_nodes = True
    nodes = material.node_tree.nodes
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])

# Mixamo-like weights: at most 4 influences, normalized.
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

# Bake exactly the walk cycle; the exporter bakes the scene frame range.
scene.frame_start, scene.frame_end = (round(f) for f in action.frame_range)

# Blender writes each bone's Lcl transform from the pose at the current frame,
# while Mixamo files carry the T-pose there and readers take it as the rest
# pose. Key the rest pose one frame before the cycle (outside the baked range)
# and export standing on that frame.
rest_frame = scene.frame_start - 1
for pose_bone in arm.pose.bones:
    pose_bone.location = (0.0, 0.0, 0.0)
    pose_bone.rotation_mode = "QUATERNION"
    pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    pose_bone.scale = (1.0, 1.0, 1.0)
    for data_path in ("location", "rotation_quaternion", "scale"):
        pose_bone.keyframe_insert(data_path=data_path, frame=rest_frame)
scene.frame_set(rest_frame)

bpy.ops.wm.save_as_mainfile(filepath=f"{OUT_DIR}/mixamo-walk.blend")
bpy.ops.export_scene.fbx(
    filepath=f"{OUT_DIR}/mixamo-walk.fbx",
    object_types={"ARMATURE", "MESH"},
    apply_scale_options="FBX_SCALE_NONE",
    axis_forward="-Z",
    axis_up="Y",
    path_mode="COPY",
    embed_textures=True,
    add_leaf_bones=False,
    primary_bone_axis="Y",
    secondary_bone_axis="X",
    bake_anim=True,
    bake_anim_use_nla_strips=False,
    bake_anim_use_all_actions=False,
    bake_anim_step=1.0,
    bake_anim_simplify_factor=0.0,
)
print(f"RESULT wrote {OUT_DIR}/mixamo-walk.fbx")
