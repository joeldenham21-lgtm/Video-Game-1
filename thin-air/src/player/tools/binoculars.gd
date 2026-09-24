extends HeldItem
## 8×42 binoculars: hold `aim` (or `use`) to raise them to the eyes — the FOV narrows to ~15° (roughly an
## 8× view at the default FOV), look sensitivity scales with the zoom, and a double-eyepiece mask frames
## the view. Your breathing and cold hands make the image sway.

const ZOOM_FOV := 15.0

var _raise := 0.0
var _mask: CanvasLayer = null
var _mask_rect: ColorRect = null
var _holder: Node3D = null


func build_visual() -> void:
	rest_pos = Vector3(0.0, -0.3, 0.0)
	sprint_pos = Vector3(0.0, -0.08, 0.06)
	sprint_rot = Vector3(-20.0, 0.0, 0.0)
	_holder = Node3D.new()
	_holder.name = "Binoculars"
	var basis := Basis.from_euler(Vector3(deg_to_rad(-12.0), 0.0, 0.0))
	_holder.transform = Transform3D(basis, Vector3(0.0, -0.18, -0.32) - rest_pos)
	model.add_child(_holder)
	var ext := FPModels.external(item_id)
	if ext:
		_holder.add_child(ext)
	else:
		var mi := MeshInstance3D.new()
		mi.mesh = FPModels.binoculars_mesh()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_holder.add_child(mi)
	for side: float in [-1.0, 1.0]:
		var left := side < 0.0
		var arm := FPHands.make_arm(&"hold", left, Vector3(side * 0.044, -0.012, -0.05), Vector3(0, 0, -1),
			basis.inverse() * elbow_toward(Vector3(side * 0.05, -0.2, -0.36), ELBOW_L if left else ELBOW_R))
		_holder.add_child(arm)
		if viewmodel and viewmodel.has_method(&"register_arm"):
			viewmodel.call(&"register_arm", arm)
	_build_mask()


func _build_mask() -> void:
	_mask = CanvasLayer.new()
	_mask.layer = 5
	_mask_rect = ColorRect.new()
	_mask_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_mask_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = """shader_type canvas_item;
uniform float amount = 0.0;
void fragment() {
	vec2 res = 1.0 / SCREEN_PIXEL_SIZE;
	vec2 p = (FRAGCOORD.xy - res * 0.5) / res.y;
	float r = 0.46;
	float d1 = length(p - vec2(-0.2, 0.0));
	float d2 = length(p - vec2(0.2, 0.0));
	float d = min(d1, d2);
	float edge = smoothstep(r - 0.05, r, d);
	float vig = smoothstep(0.1, r, d) * 0.35;
	COLOR = vec4(0.0, 0.0, 0.0, clamp(edge + vig, 0.0, 1.0) * amount);
}
"""
	var m := ShaderMaterial.new()
	m.shader = sh
	_mask_rect.material = m
	_mask.add_child(_mask_rect)
	_mask.visible = false
	add_child(_mask)


func on_holster() -> void:
	if _mask:
		_mask.visible = false


func item_process(delta: float, can_act: bool) -> void:
	var want := can_act and not player.tool_blocked and (Input.is_action_pressed(&"aim") or Input.is_action_pressed(&"use"))
	_raise = move_toward(_raise, 1.0 if want else 0.0, delta * 3.2)
	var k := smooth(_raise)
	anim_pos = Vector3(0.0, 0.22, 0.2) * k
	anim_rot = Vector3(12.0, 0.0, 0.0) * k
	_holder.visible = k < 0.92
	var through := smoothstep(0.75, 1.0, _raise)
	_mask.visible = through > 0.01
	(_mask_rect.material as ShaderMaterial).set_shader_parameter(&"amount", through)


func get_fov() -> float:
	if _raise < 0.75:
		return 0.0
	var base := float(Settings.get_value(&"fov", 75.0))
	return lerpf(base, ZOOM_FOV, smoothstep(0.75, 1.0, _raise))


func get_look_scale() -> float:
	var base := float(Settings.get_value(&"fov", 75.0))
	return lerpf(1.0, ZOOM_FOV / base, smoothstep(0.75, 1.0, _raise))


func get_speed_cap() -> float:
	return PlayerMotion.WALK_SPEED if _raise > 0.5 else INF
