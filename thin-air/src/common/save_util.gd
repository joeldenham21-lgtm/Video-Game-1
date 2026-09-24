class_name SaveUtil
## JSON-safe conversion helpers for save_state()/load_state().


static func v3(v: Vector3) -> Array:
	return [snappedf(v.x, 0.001), snappedf(v.y, 0.001), snappedf(v.z, 0.001)]


static func to_v3(a: Variant, default := Vector3.ZERO) -> Vector3:
	if a is Array and a.size() >= 3:
		return Vector3(float(a[0]), float(a[1]), float(a[2]))
	return default


static func basis_to_array(b: Basis) -> Array:
	var q := b.get_rotation_quaternion()
	return [q.x, q.y, q.z, q.w]


static func array_to_basis(a: Variant) -> Basis:
	if a is Array and a.size() >= 4:
		return Basis(Quaternion(float(a[0]), float(a[1]), float(a[2]), float(a[3])).normalized())
	return Basis.IDENTITY


static func xform(t: Transform3D) -> Array:
	return v3(t.origin) + basis_to_array(t.basis) + [t.basis.get_scale().x]


static func to_xform(a: Variant) -> Transform3D:
	if a is Array and a.size() >= 7:
		var b := array_to_basis(a.slice(3, 7))
		if a.size() >= 8:
			b = b.scaled(Vector3.ONE * float(a[7]))
		return Transform3D(b, to_v3(a))
	return Transform3D.IDENTITY
