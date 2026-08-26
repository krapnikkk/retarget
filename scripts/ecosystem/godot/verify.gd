extends SceneTree


func _initialize() -> void:
	call_deferred("_verify")


func _verify() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 4:
		push_error("Expected artifact path, result path, Godot version, and build hash")
		quit(2)
		return

	var artifact_path: String = args[0]
	var result_path: String = args[1]
	var expected_version: String = args[2]
	var expected_build_hash: String = args[3]
	var version_info := Engine.get_version_info()
	var version_string: String = str(version_info["string"])
	var result := {
		"runtime": "godot",
		"version": version_string,
		"buildHash": str(version_info["hash"]),
		"status": "failed",
	}
	var failure := ""

	if version_string != expected_version:
		failure = "Godot version %s does not match %s" % [version_string, expected_version]
	elif str(version_info["hash"]) != expected_build_hash:
		failure = "Godot build %s does not match %s" % [version_info["hash"], expected_build_hash]
	else:
		var packed := load(artifact_path) as PackedScene
		if packed == null:
			failure = "Godot could not load the imported glTF PackedScene"
		else:
			var instance := packed.instantiate()
			get_root().add_child(instance)
			await process_frame
			var skeletons: Array[Skeleton3D] = []
			var meshes: Array[MeshInstance3D] = []
			var players: Array[AnimationPlayer] = []
			_collect_nodes(instance, skeletons, meshes, players)
			var selection := _select_animation(players)
			if skeletons.is_empty() or meshes.is_empty() or players.is_empty():
				failure = "Godot import did not create a skeleton, mesh, and AnimationPlayer"
			elif selection.is_empty():
				failure = "Godot import did not expose a non-RESET animation"
			else:
				var player: AnimationPlayer = selection["player"]
				var animation_name: StringName = selection["name"]
				var animation: Animation = selection["animation"]
				var length := animation.length
				result["diagnostics"] = {
					"animationName": str(animation_name),
					"animationLengthSeconds": length,
					"trackCount": animation.get_track_count(),
				}
				if length <= 0.0 or animation.get_track_count() == 0:
					failure = "Godot imported animation has no duration or tracks"
				else:
					var sample_times := [0.0, length * 0.5, length]
					var snapshots: Array[Array] = []
					for sample_time in sample_times:
						player.stop()
						player.play(animation_name)
						player.advance(sample_time)
						for skeleton in skeletons:
							skeleton.force_update_all_bone_transforms()
						snapshots.append(_pose_snapshot(skeletons))
					var changed_values := _changed_value_count(snapshots[0], snapshots[1])
					changed_values += _changed_value_count(snapshots[0], snapshots[2])
					if changed_values == 0:
						failure = "Godot animation sampling did not change any bone pose"
					else:
						var bone_count := 0
						for skeleton in skeletons:
							bone_count += skeleton.get_bone_count()
						result.merge({
							"status": "passed",
							"artifactSha256": FileAccess.get_sha256(artifact_path),
							"checks": {
								"skeletonCount": skeletons.size(),
								"meshCount": meshes.size(),
								"animationPlayerCount": players.size(),
								"animationName": str(animation_name),
								"animationLengthSeconds": length,
								"trackCount": animation.get_track_count(),
								"boneCount": bone_count,
								"sampleTimes": sample_times,
								"poseChanged": true,
							},
						}, true)

	if not failure.is_empty():
		result["error"] = failure
	_write_json(result_path, result)
	print("GODOT_ECOSYSTEM_RECEIPT=" + JSON.stringify(result))
	quit(0 if failure.is_empty() else 1)


func _collect_nodes(
	node: Node,
	skeletons: Array[Skeleton3D],
	meshes: Array[MeshInstance3D],
	players: Array[AnimationPlayer],
) -> void:
	if node is Skeleton3D:
		skeletons.append(node)
	if node is MeshInstance3D:
		meshes.append(node)
	if node is AnimationPlayer:
		players.append(node)
	for child in node.get_children():
		_collect_nodes(child, skeletons, meshes, players)


func _select_animation(players: Array[AnimationPlayer]) -> Dictionary:
	for player in players:
		for animation_name in player.get_animation_list():
			if str(animation_name).to_upper() == "RESET":
				continue
			var animation := player.get_animation(animation_name)
			if animation != null:
				return {
					"player": player,
					"name": animation_name,
					"animation": animation,
				}
	return {}


func _pose_snapshot(skeletons: Array[Skeleton3D]) -> Array:
	var values: Array = []
	for skeleton in skeletons:
		for bone_index in skeleton.get_bone_count():
			var pose := skeleton.get_bone_global_pose(bone_index)
			var rotation := pose.basis.get_rotation_quaternion()
			values.append_array([
				pose.origin.x,
				pose.origin.y,
				pose.origin.z,
				rotation.x,
				rotation.y,
				rotation.z,
				rotation.w,
			])
	return values


func _changed_value_count(reference: Array, candidate: Array) -> int:
	if reference.size() != candidate.size():
		return maxi(reference.size(), candidate.size())
	var changed := 0
	for index in reference.size():
		if absf(float(reference[index]) - float(candidate[index])) > 0.000001:
			changed += 1
	return changed


func _write_json(path: String, value: Dictionary) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Could not write Godot ecosystem receipt to " + path)
		return
	file.store_string(JSON.stringify(value, "  ", false) + "\n")
