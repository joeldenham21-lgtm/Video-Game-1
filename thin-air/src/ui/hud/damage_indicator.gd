class_name HUDDamageIndicator
extends Control
## Directional hit markers around the crosshair (Events.player_damaged with a Node3D source): a red arc
## pointing towards the attacker that follows the camera as you turn and fades out.

const RADIUS := 170.0
const SPAN := 0.62          # radians
const LIFE := 1.6

var _hits: Array[Dictionary] = []     # {pos: Vector3, t: float, strength: float}
var camera: Camera3D = null


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func add_hit(world_pos: Vector3, amount: float) -> void:
	for h in _hits:
		if (h["pos"] as Vector3).distance_to(world_pos) < 1.5:
			h["t"] = 0.0
			h["strength"] = maxf(float(h["strength"]), clampf(amount / 25.0, 0.35, 1.0))
			return
	_hits.append({"pos": world_pos, "t": 0.0, "strength": clampf(amount / 25.0, 0.35, 1.0)})
	if _hits.size() > 6:
		_hits.pop_front()


## Screen angle (radians, 0 = up/ahead, + = clockwise/right) of a world point relative to the camera.
static func screen_angle(cam_xf: Transform3D, world_pos: Vector3) -> float:
	var local := cam_xf.affine_inverse() * world_pos
	return atan2(local.x, -local.z)


func active_count() -> int:
	return _hits.size()


func _process(delta: float) -> void:
	if _hits.is_empty():
		return
	var i := _hits.size() - 1
	while i >= 0:
		_hits[i]["t"] = float(_hits[i]["t"]) + delta
		if float(_hits[i]["t"]) > LIFE:
			_hits.remove_at(i)
		i -= 1
	queue_redraw()


func _draw() -> void:
	if camera == null or not is_instance_valid(camera):
		return
	var c := size * 0.5
	var xf := camera.global_transform
	for h in _hits:
		var ang := screen_angle(xf, h["pos"])
		var a := (1.0 - float(h["t"]) / LIFE) * float(h["strength"])
		var base := ang - PI * 0.5
		for k in 3:
			var w := 10.0 - k * 3.0
			var r := RADIUS + k * 3.0
			var col := Color(0.85, 0.12, 0.08, a * (0.55 - k * 0.15))
			draw_arc(c, r, base - SPAN * 0.5, base + SPAN * 0.5, 24, col, w, true)
		var tip := c + Vector2(sin(ang), -cos(ang)) * (RADIUS + 16.0)
		var side := Vector2(cos(ang), sin(ang)) * 9.0
		var back := Vector2(sin(ang), -cos(ang)) * -10.0
		draw_colored_polygon(PackedVector2Array([tip, tip + back + side, tip + back - side]), Color(0.9, 0.16, 0.1, a * 0.8))
