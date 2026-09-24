extends Node
## STUB — owned by the Audio workstream. Silent implementation of the contract API.
## Full API: CONTRACT.md §3 "Audio".


func play_sfx(_id: StringName, _position: Variant = null, _volume_db := 0.0, _pitch := 1.0) -> void:
	pass


func play_sfx_attached(_id: StringName, _node: Node3D, _volume_db := 0.0) -> AudioStreamPlayer3D:
	return null


func play_loop(_id: StringName, _node: Node3D, _volume_db := 0.0) -> AudioStreamPlayer3D:
	return null


func play_ui(_id: StringName) -> void:
	pass


func play_voice(_line_id: StringName) -> float:
	return 0.0


func stop_voice() -> void:
	pass


func set_music_state(_state: StringName) -> void:
	pass


func play_stinger(_id: StringName) -> void:
	pass


func set_environment_reverb(_kind: StringName) -> void:
	pass


func set_muffled(_amount: float) -> void:
	pass
