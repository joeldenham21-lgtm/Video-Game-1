class_name WaterUnderwater
extends CanvasLayer
## Underwater camera effect — Water stream. Whenever the active camera is below the water surface
## (TerrainData.get_water_level, the same level the renderer draws) a full-screen overlay tints, fogs and (on
## Forward+) blurs the view; the audio is muffled while there is no Player doing that itself.
## Mobile path: water_underwater_mobile.gdshader (no screen texture read).

const SHADER_FWD := "res://assets/shaders/water_underwater.gdshader"
const SHADER_MOBILE := "res://assets/shaders/water_underwater_mobile.gdshader"

var underwater := false
var depth := 0.0
var _rect: ColorRect
var _mat: ShaderMaterial
var _amount := 0.0
var _muffled_by_us := false
var _forced := -1                     # tests: 1 force under, 0 force above, -1 camera


func _ready() -> void:
	layer = -4                        # above the 3D view, below the HUD
	process_mode = Node.PROCESS_MODE_ALWAYS
	_rect = ColorRect.new()
	_rect.name = "Overlay"
	_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mat = ShaderMaterial.new()
	_rect.material = _mat
	add_child(_rect)
	_apply_shader()
	_rect.visible = false
	if Events.has_signal(&"settings_changed"):
		Events.settings_changed.connect(_apply_shader)


func _apply_shader() -> void:
	var fwd := Settings.is_forward_plus() and not Settings.is_mobile()
	_mat.shader = load(SHADER_FWD if fwd else SHADER_MOBILE)


## Is this world point under water (and how deep)? Returns the depth below the surface, or -1.
static func depth_below_surface(p: Vector3) -> float:
	var wl := TerrainData.get_water_level(p.x, p.z)
	if wl == -INF or p.y >= wl or wl - TerrainData.get_height(p.x, p.z) <= 0.0:
		return -1.0
	return wl - p.y


func force_state(state: int) -> void:
	_forced = state


func _process(delta: float) -> void:
	var cam := get_viewport().get_camera_3d() if get_viewport() else null
	var d := -1.0
	if _forced == 1:
		d = 1.0
	elif _forced == -1 and cam:
		d = depth_below_surface(cam.global_position)
	var now := d >= 0.02
	if now != underwater:
		underwater = now
		_set_muffle(now)
	depth = maxf(d, 0.0)
	_amount = move_toward(_amount, 1.0 if underwater else 0.0, delta * 6.0)
	_rect.visible = _amount > 0.001
	if _rect.visible:
		_mat.set_shader_parameter(&"amount", _amount)
		_mat.set_shader_parameter(&"depth", depth)
		_mat.set_shader_parameter(&"light", clampf(Climate.get_daylight(), 0.05, 1.0) if Climate.has_method(&"get_daylight") else 1.0)


func _set_muffle(on: bool) -> void:
	# The Player muffles for its own eyes (player.gd _feed_vitals); only step in when there is none.
	var p := Game.player if "player" in Game else null
	if p != null and is_instance_valid(p):
		if _muffled_by_us and not on:
			Audio.set_muffled(0.0)
			_muffled_by_us = false
		return
	if on:
		Audio.set_muffled(0.85)
		_muffled_by_us = true
	elif _muffled_by_us:
		Audio.set_muffled(0.0)
		_muffled_by_us = false


func _exit_tree() -> void:
	if _muffled_by_us:
		Audio.set_muffled(0.0)
		_muffled_by_us = false
