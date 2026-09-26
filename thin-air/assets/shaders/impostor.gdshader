// THIN AIR — hemi-octahedral tree impostors (atlases baked by tools/blender/vegetation/impostors.py).
// One MultiMesh of unit quads per far cell draws every tree species: INSTANCE_CUSTOM = (atlas layer,
// crown radius, pivot height, tree height) in object units. The quad is billboarded toward the viewer in the
// vertex shader (toward the light in the directional shadow pass, so shadows use the light's frame); the
// three frames around the view direction are blended with their own plane projections. Albedo (with AO) +
// object-space normals are lit like the mesh tree: translucency, snow on upward normals, same per-instance
// tint variation and LOD dither (fades in where the mesh LOD band fades out).
shader_type spatial;
render_mode cull_disabled, depth_draw_opaque, alpha_to_coverage, diffuse_burley, specular_schlick_ggx;

#include "res://src/vegetation/shaders/veg_common.gdshaderinc"

uniform sampler2DArray albedo_array : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2DArray normal_array : filter_linear_mipmap, repeat_disable;
uniform float frames = 8.0;
uniform float margin = 1.06;
uniform float tile_px = 128.0;
uniform float alpha_cut : hint_range(0.05, 0.95) = 0.5;
uniform bool temporal_dither = true;
uniform float tint_variation = 0.08;
uniform float translucency = 0.5;
uniform float roughness : hint_range(0.0, 1.0) = 0.6;
uniform float specular : hint_range(0.0, 1.0) = 0.35;
uniform float trunk_sway = 0.010;
uniform float snow_exposure = 1.0;
uniform float max_lod = 2.5;

instance uniform float lod_begin = 0.0;
instance uniform float lod_end = 0.0;
instance uniform float lod_margin = 4.0;

varying flat vec3 v_w;
varying flat vec4 v_t01;
varying flat vec2 v_t2;
varying vec2 v_uv0;
varying vec2 v_uv1;
varying vec2 v_uv2;
varying flat float v_layer;
varying flat vec2 v_fade;
varying flat float v_inst;
varying vec3 v_world;

vec3 hemi_decode(vec2 g) {
	vec2 e = g * 2.0 - 1.0;
	vec2 o = vec2(e.x + e.y, e.x - e.y) * 0.5;
	return normalize(vec3(o.x, 1.0 - abs(o.x) - abs(o.y), o.y));
}

vec2 hemi_encode(vec3 d) {
	d.y = max(d.y, 0.0);
	vec3 a = d / (abs(d.x) + abs(d.y) + abs(d.z));
	return vec2(a.x + a.z, a.x - a.z) * 0.5 + 0.5;
}

void frame_basis(vec3 d, out vec3 r, out vec3 u) {
	if (abs(d.y) > 0.999) {
		r = vec3(1.0, 0.0, 0.0);
	} else {
		r = normalize(cross(vec3(0.0, 1.0, 0.0), d));
	}
	u = cross(d, r);
}

vec2 frame_extent(vec3 d, float rad, float h) {
	return vec2(2.0 * rad * margin, (h * sqrt(max(0.0, 1.0 - d.y * d.y)) + 2.0 * rad * d.y) * margin);
}

vec2 project_to_frame(vec2 fr, vec3 q, vec3 view, float rad, float h) {
	vec3 d = hemi_decode(fr / (frames - 1.0));
	vec3 r;
	vec3 u;
	frame_basis(d, r, u);
	vec2 ex = frame_extent(d, rad, h);
	float t = dot(q, d) / max(dot(view, d), 0.08);
	vec3 qp = q - view * t;
	return vec2(dot(qp, r) / ex.x + 0.5, 0.5 - dot(qp, u) / ex.y);
}

void vertex() {
	vec4 cd = INSTANCE_CUSTOM;
	v_layer = cd.x;
	vec3 origin = MODEL_MATRIX[3].xyz;
	// far cells are thinned by distance (Vegetation._update_far_thinning); survivors grow slightly
	float thin = smoothstep(700.0, 2500.0, distance(view_origin.xz, origin.xz));
	float grow = 1.0 + 0.22 * thin;
	float rad = max(cd.y, 0.1) * grow;
	float cy = cd.z * grow;
	float h = max(cd.w, 0.5) * grow;
	v_inst = veg_hash12(origin.xz + origin.y);
	v_fade = veg_band_fades(distance(view_origin, origin), lod_begin, lod_end, lod_margin);
	vec3 c = vec3(0.0, cy, 0.0);
	mat3 m3 = mat3(MODEL_MATRIX);
	float sc2 = max(dot(m3[0], m3[0]), 1e-6);
	vec3 vw;
	if (PROJECTION_MATRIX[3][3] != 0.0) {
		vw = INV_VIEW_MATRIX[2].xyz;
	} else {
		vw = INV_VIEW_MATRIX[3].xyz - (MODEL_MATRIX * vec4(c, 1.0)).xyz;
	}
	vec3 V = transpose(m3) * vw / sc2;
	V.y = max(V.y, 0.0);
	V = normalize(V + vec3(0.0, 1e-4, 0.0));
	vec3 r;
	vec3 u;
	frame_basis(V, r, u);
	vec2 ex = frame_extent(V, rad, h);
	vec3 P = c + r * (VERTEX.x * ex.x) + u * (VERTEX.y * ex.y);
	vec3 q = P - c;
	vec2 g = hemi_encode(V) * (frames - 1.0);
	vec2 cell = clamp(floor(g), vec2(0.0), vec2(frames - 2.0));
	vec2 f = clamp(g - cell, 0.0, 1.0);
	vec2 fa;
	vec2 fb;
	vec2 fc;
	if (f.x + f.y <= 1.0) {
		fa = cell;
		fb = cell + vec2(1.0, 0.0);
		fc = cell + vec2(0.0, 1.0);
		v_w = vec3(1.0 - f.x - f.y, f.x, f.y);
	} else {
		fa = cell + vec2(1.0, 1.0);
		fb = cell + vec2(1.0, 0.0);
		fc = cell + vec2(0.0, 1.0);
		v_w = vec3(f.x + f.y - 1.0, 1.0 - f.y, 1.0 - f.x);
	}
	v_t01 = vec4(fa, fb);
	v_t2 = fc;
	v_uv0 = project_to_frame(fa, q, V, rad, h);
	v_uv1 = project_to_frame(fb, q, V, rad, h);
	v_uv2 = project_to_frame(fc, q, V, rad, h);
	// gentle whole-tree sway (matches the mesh trunk bend)
	float s = clamp(wind_strength, 0.0, 2.0);
	vec3 wd = transpose(m3) * normalize(wind_direction + vec3(1e-4, 0.0, 0.0)) / sc2;
	wd.y = 0.0;
	float sway = veg_gust(origin, TIME) + 0.22 * sin(TIME * (1.9 + v_inst * 0.8) + v_inst * 6.28) * (0.4 + s);
	P += wd * (trunk_sway * max(P.y, 0.0) * clamp(P.y / (cy * 2.0), 0.0, 1.2) * s * sway);
	VERTEX = P;
	NORMAL = V;
	TANGENT = r;
	BINORMAL = u;
	v_world = (MODEL_MATRIX * vec4(P, 1.0)).xyz;
	if (v_fade.x * v_fade.y <= 0.001) {
		VERTEX = vec3(0.0);
	}
}

vec4 tap(sampler2DArray tex, vec2 tile, vec2 uv, float lod) {
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
		return vec4(0.0);
	}
	return textureLod(tex, vec3((tile + uv) / frames, v_layer), lod);
}

void fragment() {
	float dith = veg_ign(FRAGCOORD.xy, v_inst * 7.0);
	if (veg_faded_out(dith, v_fade)) {
		discard;
	}
	vec2 px = v_uv0 * tile_px;
	float lod = clamp(0.5 * log2(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px)))), 0.0, max_lod);
	vec4 a0 = tap(albedo_array, v_t01.xy, v_uv0, lod);
	vec4 a1 = tap(albedo_array, v_t01.zw, v_uv1, lod);
	vec4 a2 = tap(albedo_array, v_t2, v_uv2, lod);
	vec4 alb4 = a0 * v_w.x + a1 * v_w.y + a2 * v_w.z;
	vec4 n0 = tap(normal_array, v_t01.xy, v_uv0, lod);
	vec4 n1 = tap(normal_array, v_t01.zw, v_uv1, lod);
	vec4 n2 = tap(normal_array, v_t2, v_uv2, lod);
	vec3 nobj = (n0.rgb * a0.a * v_w.x + n1.rgb * a1.a * v_w.y + n2.rgb * a2.a * v_w.z)
		/ max(a0.a * v_w.x + a1.a * v_w.y + a2.a * v_w.z, 1e-4);
	nobj = normalize(nobj * 2.0 - 1.0);
	float a = clamp(alb4.a * (1.0 + lod * 0.12), 0.0, 1.0);
	float cut = alpha_cut;
	if (temporal_dither) {
		float n = veg_ign(FRAGCOORD.xy + vec2(fract(TIME * 7.31) * 61.0, fract(TIME * 3.17) * 37.0), 0.0);
		cut = mix(alpha_cut, 0.1 + 0.8 * n, 0.6);
	}
	ALPHA = a;
	ALPHA_SCISSOR_THRESHOLD = cut;
	ALPHA_ANTIALIASING_EDGE = 0.25;
	ALPHA_TEXTURE_COORDINATE = px;
	vec3 alb = alb4.rgb / max(alb4.a, 1e-3);
	alb = clamp(alb, 0.0, 1.0);
	float h = v_inst;
	alb *= mix(vec3(1.0 - tint_variation, 1.0 - tint_variation * 0.4, 1.0 - tint_variation * 0.8),
		vec3(1.0 + tint_variation * 0.6, 1.0 + tint_variation * 0.5, 1.0 - tint_variation * 0.3), h);
	vec3 nworld = normalize(mat3(MODEL_MATRIX) * nobj);
	float snow = veg_snow(v_world, nworld, veg_hash13(floor(v_world * 3.0)), snow_exposure);
	alb = mix(alb, vec3(0.86, 0.89, 0.93), snow * 0.9);
	float wet = clamp(wetness, 0.0, 1.0) * (1.0 - snow);
	alb *= 1.0 - 0.22 * wet;
	ALBEDO = alb;
	NORMAL = normalize((VIEW_MATRIX * vec4(nworld, 0.0)).xyz);
	ROUGHNESS = mix(roughness, 0.75, snow);
	SPECULAR = specular;
	BACKLIGHT = alb * translucency * (1.0 - snow * 0.8);
}
