// Shared viewmodel projection: a fixed viewmodel FOV (independent of sprint/zoom/FOV slider) and a depth
// squeeze into the nearest slice of the (reverse-Z) depth range so world geometry never cuts through the
// hands or tools, while the viewmodel keeps correct self-occlusion.

uniform float vm_fov = 62.0;          // degrees; <= 1 uses the camera projection unchanged
uniform float vm_depth_scale = 0.06;  // fraction of the depth range the viewmodel occupies

vec4 vm_project(mat4 proj, vec4 view_pos) {
	mat4 p = proj;
	if (vm_fov > 1.0) {
		// Keep the signs: the Vulkan projection may flip axes.
		float f = 1.0 / tan(radians(vm_fov) * 0.5);
		float aspect = abs(proj[1][1] / proj[0][0]);
		p[0][0] = sign(proj[0][0]) * f / aspect;
		p[1][1] = sign(proj[1][1]) * f;
	}
	vec4 pos = p * view_pos;
	// Reverse-Z: z/w == 1 at the near plane. Remap z/w from [0,1] to [1 - scale, 1].
	pos.z = mix(pos.w, pos.z, vm_depth_scale);
	return pos;
}
