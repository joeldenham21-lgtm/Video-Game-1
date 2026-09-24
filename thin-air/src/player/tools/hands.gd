extends MeleeTool
## Empty hands: relaxed hands low in view. `use` throws a short jab (or shoves a loose prop), `aim`
## raises open hands; pickups go through the interaction system.

const PUSH_IMPULSE := 5.5

var arm_r: Node3D = null
var arm_l: Node3D = null
var _base_r := Transform3D.IDENTITY
var _base_l := Transform3D.IDENTITY
var _guard := 0.0


func setup(p: Player, vm: Node3D, id: StringName) -> void:
	t_windup = 0.13
	t_strike = 0.07
	t_follow = 0.07
	t_recover = 0.26
	super.setup(p, vm, id)
	damage = 3.0
	damage_type = &"blunt"
	reach = 1.25
	stamina_cost = 4.0
	swing_sfx = &"axe_swing"
	harvest_family = &"hand"
	noise_radius = 6.0
	trauma_hit = 0.1
	windup_pos = Vector3(0.02, -0.01, 0.07)
	windup_rot = Vector3(4.0, 4.0, 10.0)
	strike_pos = Vector3(-0.07, 0.05, -0.2)
	strike_rot = Vector3(-6.0, -8.0, -4.0)
	follow_pos = Vector3(-0.08, 0.05, -0.22)
	follow_rot = Vector3(-8.0, -10.0, -6.0)
	recoil_rot = Vector3(2.0, 0.0, 0.0)
	sprint_pos = Vector3(0.0, -0.03, 0.02)
	sprint_rot = Vector3(-6.0, 0.0, 0.0)


func build_visual() -> void:
	rest_pos = Vector3.ZERO
	# Wrists low at the edges of view, fingers forward and slightly in, palms turned down-in.
	arm_r = add_arm_free(&"relaxed", false, Vector3(0.21, -0.27, -0.27), Vector3(-0.22, 0.42, -0.88), Vector3(0.55, 0.8, 0.2))
	arm_l = add_arm_free(&"relaxed", true, Vector3(-0.23, -0.28, -0.28), Vector3(0.22, 0.42, -0.88), Vector3(-0.55, 0.8, 0.2))
	_base_r = arm_r.transform
	_base_l = arm_l.transform


func item_process(delta: float, can_act: bool) -> void:
	super.item_process(delta, can_act)
	# The jab animates the right arm only; the node itself stays still.
	var jab_pos := anim_pos
	var jab_rot := anim_rot
	anim_pos = Vector3.ZERO
	anim_rot = Vector3.ZERO
	var aiming := can_act and Input.is_action_pressed(&"aim")
	_guard = move_toward(_guard, 1.0 if aiming else 0.0, delta * 5.0)
	var g := smooth(_guard)
	var fist := 1.0 if phase != Phase.IDLE else 0.0
	var rot_r := Basis.from_euler(Vector3(deg_to_rad(jab_rot.x), deg_to_rad(jab_rot.y), deg_to_rad(jab_rot.z)))
	arm_r.transform = Transform3D(rot_r * _base_r.basis, _base_r.origin + jab_pos + Vector3(-0.03, 0.12, -0.05) * g)
	arm_l.transform = Transform3D(_base_l.basis, _base_l.origin + Vector3(0.03, 0.12, -0.05) * g)
	if fist > 0.5 and arm_r.get_meta(&"pose", &"") != &"fist":
		FPHands.set_pose(arm_r, &"fist")
		register(arm_r)
	elif fist < 0.5 and arm_r.get_meta(&"pose", &"") == &"fist":
		FPHands.set_pose(arm_r, &"relaxed")
		register(arm_r)


## Shove loose physics props instead of punching them (mostly horizontal, a little lift).
func on_hit(col: Object, point: Vector3, _normal: Vector3) -> void:
	var rb := col as RigidBody3D
	if rb == null or rb.freeze:
		return
	var dir := player.get_look_direction()
	dir.y = 0.0
	dir = (dir.normalized() + Vector3.UP * 0.25).normalized()
	rb.sleeping = false
	rb.apply_impulse(dir * PUSH_IMPULSE * clampf(rb.mass, 1.0, 40.0) * 0.25, point - rb.global_position)
