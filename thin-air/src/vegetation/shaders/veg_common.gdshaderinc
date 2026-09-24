// THIN AIR vegetation shader library: wind, snow, LOD/near fades, hashing.
// Vertex data layout (tools/blender/vegetation/vegcommon.py):
//   COLOR.r wind weight (0 trunk -> 1 branch tips)   COLOR.g baked AO   COLOR.b branch phase
//   COLOR.a cards: card width / 4 m (axial facing), 0 on bark
//   UV2.x  normalised height in the tree (trunk bend weight)
// Globals (project.godot, driven by Climate / Player): wind_direction, wind_strength (m/s / 12), snow_cover,
// wetness, player_position, time_of_day.

global uniform vec3 wind_direction;
global uniform float wind_strength;
global uniform float snow_cover;
global uniform float wetness;
global uniform vec3 player_position;

// Main camera position pushed by Vegetation each frame. Used for LOD cross-fades so that shadow passes
// (whose "camera" is the light) fade exactly like the main view.
uniform vec3 view_origin = vec3(0.0, 1e6, 0.0);
// Snow line (m ASL): everything above snow_full carries snow on upward faces; snow_cover adds a dusting.
uniform float snow_start = 1720.0;
uniform float snow_full = 2150.0;

float veg_hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float veg_hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

// Interleaved gradient noise for dithered fades (stable per pixel, offset per instance).
float veg_ign(vec2 frag, float offset) {
	return fract(52.9829189 * fract(dot(frag + offset * 17.0, vec2(0.06711056, 0.00583715))));
}

// 1 = fully visible. begin/end in metres with fade margins (Godot visibility-range style).
float veg_band_fade(float d, float begin, float end, float margin) {
	float a = begin <= 0.0 ? 1.0 : smoothstep(begin - margin, begin + margin, d);
	float b = end <= 0.0 ? 1.0 : 1.0 - smoothstep(end - margin, end + margin, d);
	return a * b;
}

// Gust envelope travelling across the landscape along the wind (0.35..1.25).
float veg_gust(vec3 world_origin, float t) {
	vec2 wd = normalize(wind_direction.xz + vec2(1e-4, 0.0));
	float along = dot(world_origin.xz, wd);
	float g = sin(t * 0.55 - along * 0.035) * 0.5 + 0.5;
	g *= sin(t * 0.21 - along * 0.011 + 1.3) * 0.35 + 0.65;
	return 0.35 + 0.9 * g;
}

// Object-space wind offset for tree vertices. `model` = MODEL_MATRIX (instance transform included).
// trunk_k: trunk bend (m per m of height per unit strength); branch_k / flutter_k: amplitudes in metres.
vec3 veg_wind_offset(vec3 v, vec3 nrm, vec4 col, float hnorm, mat4 model, float t,
		float trunk_k, float branch_k, float flutter_k) {
	float s = clamp(wind_strength, 0.0, 2.0);
	if (s < 0.001) {
		return vec3(0.0);
	}
	vec3 origin = model[3].xyz;
	float inst = veg_hash12(origin.xz);
	mat3 m3 = mat3(model);
	float sc2 = max(dot(m3[0], m3[0]), 1e-6);
	// world -> object for directions (rotation + uniform scale)
	vec3 wd_obj = (transpose(m3) * normalize(wind_direction + vec3(1e-4, 0.0, 0.0))) / sc2;
	wd_obj.y = 0.0;
	float gust = veg_gust(origin, t);
	// trunk: quadratic bend with height, static lean + slow sway (tree eigen-frequency ~0.3-0.5 Hz)
	float sway = gust + 0.22 * sin(t * (1.9 + inst * 0.8) + inst * 6.28) * (0.4 + s);
	vec3 off = wd_obj * (trunk_k * max(v.y, 0.0) * hnorm * s * sway);
	// branches: bob + push along the wind, desynchronised per branch
	float ph = col.b * 6.2831 + inst * 6.2831;
	float bw = col.r;
	float bob = sin(t * (2.6 + col.b * 1.4) + ph) * 0.6 + sin(t * 4.3 + ph * 1.7) * 0.25;
	off += (wd_obj * (0.55 + 0.45 * bob) + vec3(0.0, 0.55 * bob, 0.0)) * (branch_k * bw * s * (0.5 + 0.5 * gust));
	// needle/leaf flutter along the normal
	float fl = sin(t * 9.0 + dot(v, vec3(3.1, 2.3, 4.7)) + ph) * sin(t * 5.3 + ph);
	off += nrm * (flutter_k * bw * s * fl * gust);
	return off;
}

// Snow amount (0..1) on a surface with world-space normal n at world position p.
float veg_snow(vec3 p, vec3 n_world, float noise, float exposure) {
	float alt = smoothstep(snow_start, snow_full, p.y) * 0.85;
	float amount = clamp(alt + snow_cover * 0.75, 0.0, 1.0);
	float up = smoothstep(0.15, 0.75, n_world.y);
	float s = amount * up * exposure;
	return smoothstep(0.25, 0.65, s + (noise - 0.5) * 0.45);
}

// Axial facing for needle cards: turns a card about its long axis toward the viewer (conifer shoots are
// bottle-brushes, rotationally symmetric about the shoot, so this is what a real spray looks like from any
// side). Rebuilds the card centre line from UV.x (atlas regions are 0.5 wide) and COLOR.a (= width / 4 m).
// Works in the shadow pass too (orthographic: the light direction is the view direction).
void veg_face_card(inout vec3 v, inout vec3 n, inout vec3 t, vec2 uv, float width, mat4 model,
		mat4 inv_view, mat4 proj, float amount) {
	if (amount <= 0.0 || width <= 0.0) {
		return;
	}
	float u0 = uv.x < 0.5 ? 0.0 : 0.5;
	float x = (uv.x - u0) * 2.0 - 0.5;           // -0.5 .. 0.5 across the card
	vec3 w0 = normalize(t);
	vec3 axis = normalize(cross(n, w0));
	vec3 center = v - w0 * (x * width);
	mat3 m3 = mat3(model);
	float sc2 = max(dot(m3[0], m3[0]), 1e-6);
	vec3 view_w;
	if (proj[3][3] != 0.0) {
		view_w = inv_view[2].xyz;                   // orthographic (directional shadow): toward the light
	} else {
		view_w = inv_view[3].xyz - (model * vec4(center, 1.0)).xyz;
	}
	vec3 view_o = normalize(transpose(m3) * view_w / sc2);
	vec3 w1 = cross(axis, view_o);
	float l = length(w1);
	if (l < 1e-4) {
		return;
	}
	w1 /= l;
	if (dot(w1, w0) < 0.0) {
		w1 = -w1;
	}
	vec3 w = normalize(mix(w0, w1, amount * smoothstep(0.02, 0.2, l)));
	v = center + w * (x * width);
	n = normalize(cross(w, axis));
	if (dot(n, view_o) < 0.0) {
		n = -n;
	}
	t = w;
}
