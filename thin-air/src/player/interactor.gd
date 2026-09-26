class_name PlayerInteractor
extends RayCast3D
## Camera-aligned interaction ray (CONTRACT §4 "Interactables"): 2.6 m, layers 1,4,5,7,10.
## Resolves the collider (then its parent) implementing get_interact_prompt / interact /
## optional get_interact_hold_time. Emits Events.interaction_prompt only when the prompt changes and
## Events.interaction_progress while a timed interaction is held.

const REACH := 2.6
const MASK := 1 | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 9)
const PROMPT_REFRESH := 0.1

var player: Node = null
## The resolved interactable node (or null).
var target: Node = null
var prompt := ""
var hold_time := 0.0
var hold_progress := 0.0
## When false the ray keeps tracking but prompts are hidden and input ignored (UI open, cinematic…).
var active := true
## Held items can suppress interaction while busy (e.g. bow at full draw).
var suppressed := false

var _refresh := 0.0
var _last_collider: Object = null
var _shown_prompt := ""
var _shown_hold := 0.0
var _holding := false


func _ready() -> void:
	target_position = Vector3(0.0, 0.0, -REACH)
	collision_mask = MASK
	collide_with_areas = true
	collide_with_bodies = true
	hit_from_inside = false
	exclude_parent = true


## Called by the Player every physics tick.
func tick(delta: float, input_enabled: bool) -> void:
	var col: Object = get_collider() if is_colliding() else null
	if col != _last_collider:
		_last_collider = col
		target = _resolve(col)
		_refresh = 0.0
		_cancel_hold()
	_refresh -= delta
	if _refresh <= 0.0:
		_refresh = PROMPT_REFRESH
		_update_prompt()
	var can := active and input_enabled and not suppressed and target != null and prompt != ""
	_show(prompt if can else "", hold_time if can else 0.0)
	if not can:
		_cancel_hold()
		return
	if hold_time <= 0.0:
		if Input.is_action_just_pressed(&"interact"):
			_do_interact()
		return
	# Timed (hold) interaction.
	if Input.is_action_pressed(&"interact"):
		if not _holding and Input.is_action_just_pressed(&"interact"):
			_holding = true
			hold_progress = 0.0
		if _holding:
			hold_progress += delta / hold_time
			if hold_progress >= 1.0:
				_holding = false
				hold_progress = 0.0
				Events.interaction_progress.emit(1.0)
				_do_interact()
			else:
				Events.interaction_progress.emit(hold_progress)
	else:
		_cancel_hold()


func _do_interact() -> void:
	if target == null or not is_instance_valid(target):
		return
	# Building stream hook: a full shoulder (two logs) can't take another log.
	var carry := player.get_node_or_null(^"LogCarry") if player else null
	if carry and carry.has_method(&"blocks") and carry.call(&"blocks", target):
		return
	target.interact(player)
	# Prompt may change immediately (door opened, item taken).
	_refresh = 0.0
	_last_collider = null


func _update_prompt() -> void:
	if target == null or not is_instance_valid(target):
		target = null
		prompt = ""
		hold_time = 0.0
		return
	prompt = String(target.get_interact_prompt(player))
	var carry := player.get_node_or_null(^"LogCarry") if player else null
	if carry and carry.has_method(&"filter_prompt"):
		prompt = String(carry.call(&"filter_prompt", target, prompt))
	hold_time = float(target.get_interact_hold_time()) if target.has_method(&"get_interact_hold_time") else 0.0


func _cancel_hold() -> void:
	if _holding or hold_progress > 0.0:
		_holding = false
		hold_progress = 0.0
		Events.interaction_progress.emit(-1.0)


func _show(text: String, hold: float) -> void:
	if text == _shown_prompt and is_equal_approx(hold, _shown_hold):
		return
	_shown_prompt = text
	_shown_hold = hold
	Events.interaction_prompt.emit(text, hold)


## Hides the prompt immediately (e.g. when input gets disabled).
func clear() -> void:
	_cancel_hold()
	_show("", 0.0)


static func _resolve(col: Object) -> Node:
	if col == null:
		return null
	var n := col as Node
	if n == null:
		return null
	if _is_interactable(n):
		return n
	var p := n.get_parent()
	if p != null and _is_interactable(p):
		return p
	return null


static func _is_interactable(n: Node) -> bool:
	return n.has_method(&"get_interact_prompt") and n.has_method(&"interact")


## The world point the ray hits (or its end point).
func get_aim_point() -> Vector3:
	if is_colliding():
		return get_collision_point()
	return global_transform * target_position
