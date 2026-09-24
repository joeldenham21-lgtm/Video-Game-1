// THIN AIR — weather particle simulation (snowfall, blizzard streaks, spindrift, diamond dust, sleet, rain).
// Particles live forever inside a box that follows the camera (positions wrap), so density is constant and
// nothing pops in or out. Motion = wind + terminal fall speed + per-flake turbulence (flutter/tumble).
// CUSTOM.xyz = velocity (the draw shader stretches flakes along it), CUSTOM.w = flake size.
// COLOR.rgb = per-particle randoms (phase, atlas cell, visibility threshold); COLOR.a = visible.
shader_type particles;
render_mode disable_velocity, disable_force;

uniform vec3 box_size = vec3(32.0, 22.0, 32.0);
uniform vec3 box_offset = vec3(0.0, 3.0, 0.0);
uniform vec3 wind = vec3(0.0);
uniform float wind_follow = 1.0;
uniform float fall_speed = 1.0;
uniform float fall_var = 0.35;
uniform float turbulence = 0.5;
uniform float lift = 0.0;
uniform float size_min = 0.004;
uniform float size_max = 0.012;
uniform float density = 1.0;

float hash_u(uint n) {
	n = (n << 13u) ^ n;
	n = n * (n * n * 15731u + 789221u) + 1376312589u;
	return float(n & 0x7fffffffu) / 2147483647.0;
}

void start() {
	uint seed = INDEX * 7919u + RANDOM_SEED * 13u + 17u;
	vec3 r = vec3(hash_u(seed), hash_u(seed + 1u), hash_u(seed + 2u));
	vec3 c = EMISSION_TRANSFORM[3].xyz + box_offset;
	TRANSFORM = mat4(1.0);
	TRANSFORM[3].xyz = c + (r - 0.5) * box_size;
	float s = hash_u(seed + 3u);
	CUSTOM = vec4(0.0, -fall_speed, 0.0, mix(size_min, size_max, s * s));
	COLOR = vec4(hash_u(seed + 4u), hash_u(seed + 5u), hash_u(seed + 6u), 1.0);
}

void process() {
	vec3 p = TRANSFORM[3].xyz;
	float ph = COLOR.r;
	float t = TIME;
	// Flutter: flakes tumble and zig-zag; bigger aggregates wobble more slowly.
	vec3 turb;
	turb.x = sin(p.y * 0.73 + t * 1.3 + ph * 6.283) + 0.5 * sin(p.z * 1.9 + t * 2.3 + ph * 11.0);
	turb.z = cos(p.x * 0.61 + t * 1.1 + ph * 3.1) + 0.5 * cos(p.y * 1.7 - t * 1.9 + ph * 7.0);
	turb.y = 0.45 * sin(p.x * 0.37 + p.z * 0.41 + t * 0.9 + ph * 5.0);
	vec3 v = wind * wind_follow * (0.82 + 0.36 * COLOR.g);
	v.y -= fall_speed * (1.0 - fall_var + 2.0 * fall_var * ph);
	v += turb * turbulence;
	v.y += lift * (0.35 + 0.65 * sin(t * 0.8 + ph * 20.0) * sin(p.x * 0.2 + t));
	p += v * DELTA;
	vec3 c = EMISSION_TRANSFORM[3].xyz + box_offset;
	vec3 rel = mod(p - c + box_size * 0.5, box_size) - box_size * 0.5;
	TRANSFORM[3].xyz = c + rel;
	CUSTOM.xyz = v;
	COLOR.a = step(COLOR.b, density);
}
