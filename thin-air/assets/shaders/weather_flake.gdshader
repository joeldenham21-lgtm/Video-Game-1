// THIN AIR — weather particle rendering: soft camera-facing flakes stretched along their screen-space
// velocity by a camera shutter (motion blur), with energy conservation (a longer streak is fainter),
// forward-scattering glow toward the sun, sun glints ("sparkle" / diamond dust) and near/far fades.
// Lighting comes from the sky controller (ambient/sun radiance of a white diffuser) so flakes always match
// the scene exposure, day or night.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, world_vertex_coords;

uniform sampler2D flakes : filter_linear_mipmap, repeat_disable;
uniform vec3 light_ambient = vec3(0.3);
uniform vec3 light_sun = vec3(0.8);
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform vec3 tint = vec3(1.0);
uniform float opacity = 0.85;
uniform float shutter = 0.016;
uniform float sparkle = 0.0;
uniform float near_fade = 0.35;
uniform float far_fade = 16.0;
uniform float round_mix = 0.0;      // 0 = flake atlas, 1 = plain soft dot (rain/sleet/drift)
uniform float time_s = 0.0;
uniform float pixel_angle = 0.0017;   // radians per rendered pixel (set by WeatherFX)
uniform int debug_mode = 0;      // 1 = solid geometry, 2 = solid with computed alpha

varying float v_fade;
varying vec2 v_atlas;
varying float v_energy;
varying float v_fwd;
varying float v_glint;

void vertex() {
	// world_vertex_coords: VERTEX arrives in world space (particle position + unit quad corner).
	vec2 corner = vec2(UV.x - 0.5, 0.5 - UV.y);
	vec3 center = VERTEX - vec3(corner, 0.0);
	vec3 vel = INSTANCE_CUSTOM.xyz;
	float size = INSTANCE_CUSTOM.w;
	vec3 to_cam = CAMERA_POSITION_WORLD - center;
	float dist = length(to_cam);
	to_cam /= max(dist, 1e-4);
	vec3 vp = vel - to_cam * dot(vel, to_cam);
	float vl = length(vp);
	vec3 axis = vl > 1e-3 ? vp / vl : normalize(cross(to_cam, vec3(0.0, 0.0, 1.0)) + vec3(1e-4));
	vec3 side = normalize(cross(axis, to_cam));
	float streak = vl * shutter;
	// Never smaller than ~1.2 px: distant flakes become faint dots (energy conserving) instead of vanishing.
	float px = pixel_angle * dist;
	float size_eff = max(size, px * 1.7);
	float cover = clamp((size * size) / (size_eff * size_eff), 0.5, 1.0);
	VERTEX = center + side * corner.x * size_eff + axis * corner.y * (size_eff + streak);
	v_fade = smoothstep(near_fade * 0.4, near_fade, dist) * (1.0 - smoothstep(far_fade * 0.7, far_fade, dist)) * COLOR.a;
	v_energy = clamp(pow(size_eff / (size_eff + streak), 0.7), 0.1, 1.0) * cover;
	float cell = floor(COLOR.g * 15.999);
	v_atlas = vec2(mod(cell, 4.0), floor(cell / 4.0)) * 0.25;
	v_fwd = pow(max(dot(-to_cam, sun_dir), 0.0), 6.0);
	// Glints: each crystal flashes when its facets line up (tumbling), mostly toward/near the sun.
	float g = sin(time_s * (3.0 + 5.0 * COLOR.r) + COLOR.b * 60.0);
	v_glint = sparkle * pow(max(g, 0.0), 24.0) * (0.25 + 0.75 * max(dot(-to_cam, sun_dir), 0.0));
}

void fragment() {
	vec2 uv = v_atlas + clamp(UV, vec2(0.02), vec2(0.98)) * 0.25;
	// Flakes are only a few pixels wide: sample a fixed fine mip (the smallest mips would average the
	// empty space between atlas cells) and keep a soft analytic core so coverage never vanishes.
	float a = textureLod(flakes, uv, 1.0).a;
	vec2 q = UV * 2.0 - 1.0;
	float dot_a = clamp(1.0 - dot(q, q), 0.0, 1.0);
	dot_a *= dot_a;
	a = mix(max(a, dot_a * 0.75), dot_a, round_mix);
	// Ice crystals scatter strongly forward and look brighter than a matte diffuser.
	vec3 col = light_ambient * 1.6 + light_sun * (0.7 + 2.2 * v_fwd);
	col += light_sun * v_glint * 14.0;
	ALBEDO = col * tint;
	ALPHA = clamp(a * opacity * v_fade * v_energy + v_glint * a * 0.5, 0.0, 1.0);
	if (debug_mode == 1) {
		ALBEDO = vec3(1.0, 0.0, 0.0);
		ALPHA = 1.0;
	} else if (debug_mode == 2) {
		ALBEDO = vec3(v_fade, v_energy, a);
		ALPHA = 1.0;
	}
}
