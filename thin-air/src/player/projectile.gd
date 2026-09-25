class_name PlayerProjectile
extends Node3D
## Ballistic projectile thrown or shot by the player: arrows, spears, road flares, flare-gun shells.
## Integrates gravity + drag, ray-tests each tick (no per-frame allocation), damages what it hits,
## sticks into surfaces/creatures and becomes an interactable pickup (arrows, spears). Burning flares
## carry a flickering light and are heat sources until they burn out.

enum Kind { ARROW, SPEAR, FLARE, SHELL }

const MASK := 1 | (1 << 2) | (1 << 3) | (1 << 6) | (1 << 9)   # world, creatures, items, building, vegetation

var kind: Kind = Kind.ARROW
var item_id: StringName = &"arrow"
var velocity := Vector3.ZERO
var gravity := PlayerMotion.GRAVITY
var drag := 0.02
var damage := 20.0
var damage_type: StringName = &"pierce"
var shooter: Node = null
var durability := 1.0
var stuck := false
var burn_time := 0.0
## Heat source contract (lit flares).
var heat_radius := 1.2
var heat_celsius := 4.0
var _flare_energy := 3.0

var _ray: RayCast3D
var _life := 90.0
var _light: OmniLight3D = null
var _fx: Array[CPUParticles3D] = []
var _flicker_t := 0.0
var _pickup_body: StaticBody3D = null
var _travel := 0.0


## Builds and launches a projectile into the world.
static func launch(parent: Node, k: Kind, id: StringName, from: Vector3, vel: Vector3, dmg: float, by: Node) -> PlayerProjectile:
	var p := PlayerProjectile.new()
	p.kind = k
	p.item_id = id
	p.velocity = vel
	p.damage = dmg
	p.shooter = by
	parent.add_child(p)
	p.global_position = from
	p._orient()
	return p


func _ready() -> void:
	_ray = RayCast3D.new()
	_ray.enabled = false
	_ray.top_level = true
	_ray.collision_mask = MASK
	_ray.collide_with_areas = false
	add_child(_ray)
	if shooter is CollisionObject3D:
		_ray.add_exception(shooter as CollisionObject3D)
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	match kind:
		Kind.ARROW:
			mi.mesh = FPModels.arrow_mesh(true)
			drag = 0.012
		Kind.SPEAR:
			mi.mesh = FPModels.spear_mesh(true)
			drag = 0.03
		Kind.FLARE:
			mi.mesh = FPModels.flare_mesh(true)
			mi.rotation.x = -PI * 0.5
			drag = 0.08
			# Same light as the hand-held flare: items.json "light" {radius, energy, color, heat_celsius}.
			var ld: Dictionary = ItemDB.get_item(item_id).get("light", {})
			var col := String(ld.get("color", ""))
			_flare_energy = float(ld.get("energy", 3.0))
			heat_celsius = float(ld.get("heat_celsius", heat_celsius))
			_make_burning(Color.html(col) if col != "" and Color.html_is_valid(col) else Color(1.0, 0.18, 0.08),
				_flare_energy, float(ld.get("radius", 16.0)))
		Kind.SHELL:
			drag = 0.25
			gravity = 3.0
			_make_burning(Color(1.0, 0.22, 0.1), 6.0, 60.0)
			heat_radius = 0.0
	if kind != Kind.SHELL:
		add_child(mi)
	if kind == Kind.FLARE or kind == Kind.SHELL:
		add_to_group(&"heat_source")
		add_to_group(&"flare")


func is_heat_active() -> bool:
	return burn_time > 0.0 and heat_radius > 0.0


func _make_burning(col: Color, energy: float, light_range: float) -> void:
	_light = OmniLight3D.new()
	_light.light_color = col
	_light.light_energy = energy
	_light.omni_range = light_range
	_light.omni_attenuation = 1.4
	_light.shadow_enabled = not Settings.is_mobile() and int(Settings.get_value(&"shadow_quality", 2)) >= 3
	add_child(_light)
	var sparks := _particles(&"spark", 24, 0.5, Color(3.0, 0.9, 0.5), 0.012, 1.5)
	sparks.gravity = Vector3(0, -3.0, 0)
	var smoke := _particles(&"smoke", 18, 2.8, Color(0.75, 0.6, 0.6, 0.55), 0.18, 0.6)
	smoke.gravity = Vector3(0, 0.9, 0)
	_fx.append(sparks)
	_fx.append(smoke)


func _particles(tex_kind: StringName, amount: int, life: float, col: Color, size: float, speed: float) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2.ONE * size
	var m := StandardMaterial3D.new()
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_texture = FPMaterials.tex("spark.png" if tex_kind == &"spark" else "smoke.png")
	if tex_kind == &"spark":
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	q.material = m
	p.mesh = q
	p.amount = maxi(4, amount / (2 if Settings.is_mobile() else 1))
	p.lifetime = life
	p.local_coords = false
	p.direction = Vector3.UP
	p.spread = 35.0
	p.initial_velocity_min = speed * 0.5
	p.initial_velocity_max = speed
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.4
	var g := Gradient.new()
	g.set_color(0, col)
	g.set_color(1, Color(col.r, col.g, col.b, 0.0))
	p.color_ramp = g
	add_child(p)
	return p


func _orient() -> void:
	if velocity.length_squared() < 1e-4 or kind == Kind.SHELL:
		return
	var d := velocity.normalized()
	var up := Vector3.UP if absf(d.y) < 0.99 else Vector3.RIGHT
	global_basis = Basis.looking_at(d, up)


func _physics_process(delta: float) -> void:
	if burn_time > 0.0:
		burn_time -= delta
		if _light:
			_flicker_t += delta
			_light.light_energy = (_flare_energy if kind == Kind.FLARE else 5.5) * (0.85 + 0.15 * sin(_flicker_t * 37.0) * sin(_flicker_t * 23.0))
		if burn_time <= 0.0:
			_burn_out()
	if stuck:
		_life -= delta
		if _life <= 0.0:
			queue_free()
		return
	velocity.y -= gravity * delta
	velocity *= 1.0 - minf(drag * delta, 0.5)
	var motion := velocity * delta
	_ray.global_position = global_position
	_ray.target_position = motion
	_ray.force_raycast_update()
	if _ray.is_colliding():
		_hit(_ray.get_collider(), _ray.get_collision_point(), _ray.get_collision_normal())
	else:
		global_position += motion
		_travel += motion.length()
		_orient()
		# Hitting water: slow right down.
		var wl := TerrainData.get_water_level(global_position.x, global_position.z)
		if wl > -1e20 and global_position.y < wl:
			velocity *= 0.2
			gravity = 1.0
			if kind == Kind.FLARE or kind == Kind.SHELL:
				burn_time = minf(burn_time, 0.5)
	if _travel > 400.0 or global_position.y < -1000.0:
		queue_free()


func _hit(col: Object, point: Vector3, normal: Vector3) -> void:
	var speed := velocity.length()
	var node := col as Node
	var target := HeldItem.resolve_target(col, &"take_damage")
	if target and target != shooter and damage > 0.0:
		var k := clampf(speed / 50.0, 0.3, 1.2) if kind == Kind.ARROW else 1.0
		target.call(&"take_damage", damage * k, damage_type, shooter, point)
		Audio.play_sfx(&"arrow_hit", point)
		ImpactFX.spawn(get_parent(), &"blood" if target.is_in_group(&"creature") else &"wood", point, normal)
	else:
		var surf := MeleeTool._surface_of(col, point)
		Audio.play_sfx(&"arrow_hit", point, -4.0)
		ImpactFX.spawn(get_parent(), MeleeTool._fx_for_surface(surf), point, normal)
		if (surf == &"rock" or surf == &"scree" or surf == &"metal") and kind == Kind.ARROW:
			if randf() < 0.3:
				queue_free()
				return
			durability -= 0.25
	Events.noise_emitted.emit(point, 8.0, shooter)
	if kind == Kind.FLARE or kind == Kind.SHELL:
		# Flares skid and come to rest; shells fizzle out on impact.
		if kind == Kind.SHELL:
			burn_time = minf(burn_time, 1.0)
		global_position = point + normal * 0.03
		var hd := Vector3(velocity.x, 0.0, velocity.z)
		if hd.length_squared() < 1e-4:
			hd = Vector3.FORWARD
		hd = (hd - normal * hd.dot(normal)).normalized()
		if hd.length_squared() > 0.5:
			global_basis = Basis.looking_at(hd, normal)
		stuck = true
		_life = maxf(burn_time, 0.0) + 40.0
		return
	# Stick in: penetrate a little along the flight direction.
	var dir := velocity.normalized()
	var depth := 0.08 if kind == Kind.ARROW else 0.14
	global_position = point + dir * depth
	stuck = true
	_life = 300.0
	if node is Node3D and not (node is StaticBody3D) and not node.is_in_group(&"terrain"):
		# Follow moving targets (creatures, props).
		reparent(node, true)
	_make_pickup()


func _make_pickup() -> void:
	_pickup_body = StaticBody3D.new()
	_pickup_body.collision_layer = 1 << 4
	_pickup_body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = 0.12 if kind == Kind.ARROW else 0.2
	cs.shape = sh
	cs.position = Vector3(0.0, 0.0, 0.2 if kind == Kind.ARROW else 0.4)
	_pickup_body.add_child(cs)
	add_child(_pickup_body)


func get_interact_prompt(_player: Node) -> String:
	if not stuck or durability <= 0.0:
		return ""
	return "Pick up %s" % String(ItemDB.get_item(item_id).get("name", String(item_id).capitalize()))


func interact(p: Node) -> void:
	var pl := p as Player
	if pl == null:
		return
	if pl.inventory.add(item_id, 1, clampf(durability, 0.05, 1.0)) == 0:
		Events.item_picked_up.emit(item_id, 1)
		Audio.play_sfx(&"pickup", global_position)
		queue_free()
	else:
		Game.notify("No room in your pack", &"warning")


func _burn_out() -> void:
	burn_time = 0.0
	if _light:
		_light.queue_free()
		_light = null
	for p in _fx:
		if is_instance_valid(p):
			p.emitting = false
	if kind == Kind.SHELL:
		queue_free.call_deferred()
