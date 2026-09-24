class_name HeldItem
extends Node3D
## Base class for everything the player holds (tools, weapons, lights, consumables, empty hands).
## The Viewmodel creates one per active item (script chosen by ItemDB tool.type), calls setup(), then
## item_process() every frame and composes this node's transform as rest pose ∘ animation offsets.
##
## The node origin is the swing pivot (roughly the shoulder/elbow); build the model offset from it.
## Subclasses override build_visual(), item_process(), and optionally get_fov()/get_speed_cap()/…

## Emitted when the item is used up / breaks and the hands should switch away.
signal depleted()

var player: Player = null
var viewmodel: Node3D = null
var item_id: StringName = &""
var def: Dictionary = {}
var tool: Dictionary = {}
var tool_type: StringName = &""

## Rest pose in camera space (metres / degrees).
var rest_pos := Vector3(0.2, -0.28, -0.12)
var rest_rot := Vector3.ZERO
## Animation offsets written by subclasses each frame (degrees for rotation).
var anim_pos := Vector3.ZERO
var anim_rot := Vector3.ZERO
## Pose while sprinting (added, weighted) and while lowered (swimming, ladders).
var sprint_pos := Vector3(0.03, -0.05, 0.05)
var sprint_rot := Vector3(-14.0, 22.0, 12.0)
## True mid-action (swing, draw…): the viewmodel waits before switching items.
var busy := false
## Sway multiplier (heavy tools sway more slowly).
var sway_scale := 1.0
var model: Node3D = null

var _cooldown := 0.0


func setup(p: Player, vm: Node3D, id: StringName) -> void:
	player = p
	viewmodel = vm
	item_id = id
	def = ItemDB.get_item(id) if id != &"" else {}
	tool = def.get("tool", {})
	tool_type = StringName(tool.get("type", ""))
	model = Node3D.new()
	model.name = "Model"
	add_child(model)
	build_visual()


# ---- Overridables ---------------------------------------------------------------------------------

func build_visual() -> void:
	pass


## Called every frame while held. `can_act` is false while switching, in UI, climbing, swimming…
func item_process(_delta: float, _can_act: bool) -> void:
	pass


func on_equip() -> void:
	pass


func on_holster() -> void:
	pass


## FOV the camera should use (0 = normal).
func get_fov() -> float:
	return 0.0


func get_speed_cap() -> float:
	return INF


func get_look_scale() -> float:
	return 1.0


## Ice-axe climbing animation hook.
func climb_swing() -> void:
	pass


# ---- Helpers --------------------------------------------------------------------------------------

func tool_value(key: String, default: float) -> float:
	return float(tool.get(key, default))


func inventory_index() -> int:
	if player == null or item_id == &"":
		return -1
	return player.inventory.find(item_id)


## Wears the held item by `hits` uses (tool.durability = uses until broken). Returns true if it broke.
func wear(hits := 1.0) -> bool:
	var idx := inventory_index()
	if idx < 0:
		return false
	var uses := maxf(tool_value("durability", 100.0), 1.0)
	var broke := player.inventory.use_durability(idx, hits / uses)
	if broke:
		Game.notify("%s broke" % String(def.get("name", item_id)), &"warning")
		Audio.play_sfx(&"wood_creak", player.get_eye_position(), -4.0, 1.4)
		depleted.emit()
	return broke


## Removes one of this item from the inventory (consumed / thrown). Returns true if none are left.
func consume_one() -> bool:
	var idx := inventory_index()
	if idx >= 0:
		player.inventory.remove_at(idx, 1)
	var left := player.inventory.count(item_id) if item_id != &"" else 0
	if left <= 0:
		depleted.emit()
		return true
	return false


func cooldown_ready() -> bool:
	return _cooldown <= 0.0


func start_cooldown(seconds: float) -> void:
	_cooldown = seconds


func tick_cooldown(delta: float) -> void:
	_cooldown = maxf(_cooldown - delta, 0.0)


## Adds a MeshInstance3D (viewmodel-ready) under the model root.
func add_mesh(mesh: Mesh, xf := Transform3D.IDENTITY, n := "Mesh") -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = n
	mi.mesh = mesh
	mi.transform = xf
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	model.add_child(mi)
	return mi


## Adds a posed arm to the model: grip point, handle direction toward the thumb, forearm direction.
func add_arm(pose: StringName, left: bool, grip: Vector3, thumb_dir: Vector3, elbow_dir: Vector3, sleeve := 0.42) -> MeshInstance3D:
	var arm := FPHands.make_arm(pose, left, grip, thumb_dir, elbow_dir, sleeve)
	model.add_child(arm)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)
	return arm


## Smooth 0..1 easing helpers for procedural animation.
static func ease_out(t: float) -> float:
	var x := clampf(t, 0.0, 1.0)
	return 1.0 - (1.0 - x) * (1.0 - x)


static func ease_in(t: float) -> float:
	var x := clampf(t, 0.0, 1.0)
	return x * x


static func smooth(t: float) -> float:
	var x := clampf(t, 0.0, 1.0)
	return x * x * (3.0 - 2.0 * x)


## Resolves the harvest/damage target of a physics hit (collider, then parent).
static func resolve_target(col: Object, method: StringName) -> Node:
	var n := col as Node
	if n == null:
		return null
	if n.has_method(method):
		return n
	var p := n.get_parent()
	if p and p.has_method(method):
		return p
	return null
