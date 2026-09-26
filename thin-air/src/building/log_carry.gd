class_name LogCarry
extends Node3D
## Sons-of-the-Forest log carrying (child "LogCarry" of the Player, added by BuildingRoot). Logs you pick up
## ride on your right shoulder — visible at the edge of the first-person view, bobbing with your stride — and
## weigh you down: one log caps you at a steady jog, two at a trudge and no sprinting. You can carry two; a
## third stays on the ground (the interaction prompt says so). `drop` with empty hands sets one down as a
## physics log; interacting with a blueprint frame feeds it logs first (BuildComponent.next_needed).

const MAX_LOGS := 2
const CAP_ONE := 3.0            ## m/s
const CAP_TWO := 2.2
const LOG_ID := &"log"

var player: Node = null
var count := 0
var _holder: Node3D
var _logs: Array[MeshInstance3D] = []
var _applied_cap := INF
var _bob := 0.0
var _shown := 0.0
var _enforce_t := 0.0


func _ready() -> void:
	if player == null:
		player = get_parent()
	_holder = Node3D.new()
	_holder.name = "ShoulderLogs"
	var cam: Camera3D = player.call(&"get_camera") if player and player.has_method(&"get_camera") else null
	if cam:
		cam.add_child(_holder)
	else:
		add_child(_holder)
	var mesh := _log_mesh()
	for i in MAX_LOGS:
		var mi := MeshInstance3D.new()
		mi.name = "Log%d" % i
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.visible = false
		_holder.add_child(mi)
		_logs.append(mi)
	_layout()


func _exit_tree() -> void:
	if _holder and is_instance_valid(_holder) and _holder.get_parent() != self:
		_holder.queue_free()


## The log item's model with its long axis turned along −Z (camera forward).
func _log_mesh() -> Mesh:
	var m: Mesh = null
	var path := String(ItemDB.get_item(LOG_ID).get("model", ""))
	if path != "" and ResourceLoader.exists(path):
		var ps := load(path) as PackedScene
		if ps:
			var n := ps.instantiate()
			var found := n.find_children("*", "MeshInstance3D", true, false)
			if not found.is_empty():
				m = (found[0] as MeshInstance3D).mesh
			n.free()
	if m == null:
		m = ItemVisuals.get_mesh(LOG_ID)
	return m


func _layout() -> void:
	if _logs.is_empty() or _logs[0].mesh == null:
		return
	var aabb := _logs[0].mesh.get_aabb()
	var s := aabb.size
	# rotate so the longest axis points along −Z
	var b := Basis.IDENTITY
	if s.x >= s.y and s.x >= s.z:
		b = Basis(Vector3.UP, PI * 0.5)
	elif s.y >= s.x and s.y >= s.z:
		b = Basis(Vector3.RIGHT, -PI * 0.5)
	var c := aabb.get_center()
	for i in _logs.size():
		var mi := _logs[i]
		# on the right shoulder, just below and beside the eye, running forward past the view edge
		var off := Vector3(0.46 + 0.17 * i, -0.4 + 0.05 * i, -0.16)
		var tilt := Basis(Vector3.UP, deg_to_rad(-16.0 - 4.0 * i)) * Basis(Vector3.RIGHT, deg_to_rad(6.0)) \
			* Basis(Vector3.FORWARD, deg_to_rad(8.0 + 10.0 * i))
		mi.transform = Transform3D(tilt * b, off - (tilt * b) * c)


func _process(delta: float) -> void:
	if player == null or not is_instance_valid(player):
		return
	var inv: Inventory = player.get(&"inventory")
	count = inv.count(LOG_ID) if inv else 0
	_enforce_t -= delta
	if count > MAX_LOGS and _enforce_t <= 0.0:
		_enforce_t = 0.25
		_drop_excess(inv)
	var want := float(mini(count, MAX_LOGS))
	_shown = move_toward(_shown, want, delta * 4.0)
	for i in _logs.size():
		_logs[i].visible = float(i) < ceilf(_shown - 0.01) and _visible_ok()
	# stride bob and a heavy settle
	var speed := float(player.get(&"ground_speed")) if player.get(&"ground_speed") != null else 0.0
	_bob += delta * (2.0 + speed * 2.2)
	var k := clampf(speed / 3.0, 0.0, 1.0)
	_holder.position = Vector3(0.0, -0.02 * absf(sin(_bob)) * k - 0.12 * (1.0 - clampf(_shown, 0.0, 1.0)), 0.0)
	_holder.rotation = Vector3(0.0, 0.0, 0.015 * sin(_bob * 0.5) * k)
	_apply_speed_cap()
	if Input.is_action_just_pressed(&"drop") and count > 0 and player.has_method(&"get_active_item") \
			and player.call(&"get_active_item") == &"" and player.has_method(&"is_input_enabled") and player.call(&"is_input_enabled"):
		drop_one()


func _visible_ok() -> bool:
	if player.get(&"is_swimming") == true or player.get(&"is_climbing") == true:
		return false
	return not (player.has_method(&"is_dead") and player.call(&"is_dead"))


## Movement cap from the logs on the shoulder (merged with whatever the held item asked for this frame).
func carry_cap() -> float:
	if count <= 0:
		return INF
	return CAP_ONE if count == 1 else CAP_TWO


func _apply_speed_cap() -> void:
	var cur := float(player.get(&"speed_cap"))
	var base := INF if is_equal_approx(cur, _applied_cap) or (is_inf(cur) and is_inf(_applied_cap)) else cur
	var cap := minf(base, carry_cap())
	player.set(&"speed_cap", cap)
	_applied_cap = cap


## Sets one log down in front of the player (a physics pickup that rolls and settles).
func drop_one() -> void:
	var inv: Inventory = player.get(&"inventory")
	if inv == null or not inv.remove(LOG_ID, 1):
		return
	var p3 := player as Node3D
	var fwd := -p3.global_basis.z
	var at := p3.global_position + fwd * 0.9 + Vector3(0.0, 1.1, 0.0)
	var node := ItemsRoot.spawn(LOG_ID, 1, at, fwd * 1.2 + Vector3(0.0, 0.5, 0.0))
	if node:
		node.rotation = Vector3(0.0, p3.global_rotation.y + PI * 0.5, 0.0)
	Events.item_dropped.emit(LOG_ID, 1)
	Audio.play_sfx(&"tree_impact", at, -12.0, 1.6)


func _drop_excess(inv: Inventory) -> void:
	while inv.count(LOG_ID) > MAX_LOGS:
		drop_one()
	Game.notify("You can carry two logs on your shoulder.", &"info")


## Interaction filter (called by the Player's interactor): a full shoulder can't take another log.
func filter_prompt(target: Node, prompt: String) -> String:
	if target != null and count >= MAX_LOGS and StringName(target.get(&"item_id") if target.get(&"item_id") != null else &"") == LOG_ID:
		return "Your shoulder is full (2 logs)"
	return prompt


func blocks(target: Node) -> bool:
	return target != null and count >= MAX_LOGS and StringName(target.get(&"item_id") if target.get(&"item_id") != null else &"") == LOG_ID
