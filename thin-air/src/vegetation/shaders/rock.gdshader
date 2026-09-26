// THIN AIR — scattered rocks (boulders, outcrop slabs, small rocks, talus).
// Macro shape detail: per-rock tangent normal map baked from the high-res sculpt (UV). Surface: the shared
// rock_boulder PBR set, world-space triplanar (3 m tile) with whiteout-blended detail normals on top of the
// macro normal. Vertex AO (cavities, ground contact), snow on upward faces above the snow line + snow_cover,
// damp darkening, per-instance tone variation, LOD cross-fade like the trees.
shader_type spatial;
render_mode cull_back, depth_draw_opaque, diffuse_burley, specular_schlick_ggx;

#include "res://src/vegetation/shaders/veg_common.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D macro_normal : hint_normal, filter_linear_mipmap, repeat_disable;
uniform float tile_m = 3.0;
uniform float macro_strength = 1.0;
uniform float detail_strength = 0.8;
uniform float sharpness = 4.0;
uniform float tone_variation = 0.12;
uniform float snow_exposure = 1.0;

instance uniform float lod_begin = 0.0;
instance uniform float lod_end = 0.0;
instance uniform float lod_margin = 3.0;

varying flat vec2 v_fade;
varying flat float v_inst;
varying vec3 v_world;
varying vec3 v_wnormal;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	v_inst = veg_hash12(origin.xz + origin.y);
	v_fade = veg_band_fades(distance(view_origin, origin), lod_begin, lod_end, lod_margin);
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wnormal = normalize(mat3(MODEL_MATRIX) * NORMAL);
	if (v_fade.x * v_fade.y <= 0.001) {
		VERTEX = vec3(0.0);
	}
}

// Normal maps are imported RGTC/BC5 (two channels): rebuild Z (sampling .z of such a texture returns 0,
// which turns every normal inside out).
vec3 unpack_normal(vec4 t) {
	vec2 xy = t.xy * 2.0 - 1.0;
	return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
}

vec3 whiteout(vec3 base_ts, vec3 detail_ts) {
	return normalize(vec3(base_ts.xy + detail_ts.xy, base_ts.z * detail_ts.z));
}

void fragment() {
	if (veg_faded_out(veg_ign(FRAGCOORD.xy, v_inst * 7.0), v_fade)) {
		discard;
	}
	// macro normal (baked) in world space
	vec3 mn = unpack_normal(texture(macro_normal, UV));
	mn.xy *= macro_strength;
	mn = normalize(mn);
	vec3 t_w = normalize((INV_VIEW_MATRIX * vec4(TANGENT, 0.0)).xyz);
	vec3 b_w = normalize((INV_VIEW_MATRIX * vec4(BINORMAL, 0.0)).xyz);
	vec3 n_w = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	vec3 N = normalize(t_w * mn.x + b_w * mn.y + n_w * mn.z);
	// triplanar surface
	vec3 w = pow(abs(N), vec3(sharpness));
	w /= (w.x + w.y + w.z);
	vec3 p = v_world / tile_m + vec3(v_inst * 5.3, 0.0, v_inst * 2.1);
	vec2 uvx = p.zy;
	vec2 uvy = p.xz;
	vec2 uvz = p.xy;
	vec3 alb = texture(albedo_tex, uvx).rgb * w.x + texture(albedo_tex, uvy).rgb * w.y + texture(albedo_tex, uvz).rgb * w.z;
	vec3 orm = texture(orm_tex, uvx).rgb * w.x + texture(orm_tex, uvy).rgb * w.y + texture(orm_tex, uvz).rgb * w.z;
	vec3 tx = unpack_normal(texture(normal_tex, uvx));
	vec3 ty = unpack_normal(texture(normal_tex, uvy));
	vec3 tz = unpack_normal(texture(normal_tex, uvz));
	tx.xy *= detail_strength;
	ty.xy *= detail_strength;
	tz.xy *= detail_strength;
	// whiteout triplanar (Ben Golus): swizzle tangent normals into world space per projection
	vec3 nx = whiteout(vec3(N.zy, abs(N.x)), tx);
	vec3 ny = whiteout(vec3(N.xz, abs(N.y)), ty);
	vec3 nz = whiteout(vec3(N.xy, abs(N.z)), tz);
	vec3 Nd = normalize(vec3(nx.z * sign(N.x), nx.y, nx.x) * w.x + vec3(ny.x, ny.z * sign(N.y), ny.y) * w.y
		+ vec3(nz.x, nz.y, nz.z * sign(N.z)) * w.z);
	float tone = (v_inst - 0.5) * tone_variation;
	alb *= 1.0 + tone;
	float ao = COLOR.g * orm.r;
	float snow = veg_snow(v_world, Nd, veg_hash13(floor(v_world * 5.0)), snow_exposure);
	alb = mix(alb, vec3(0.86, 0.89, 0.93), snow);
	float wet = clamp(wetness, 0.0, 1.0) * (1.0 - snow);
	alb *= 1.0 - 0.35 * wet;
	ALBEDO = alb;
	ROUGHNESS = mix(mix(orm.g, orm.g * 0.45, wet), 0.75, snow);
	METALLIC = 0.0;
	AO = ao;
	AO_LIGHT_AFFECT = 0.35;
	NORMAL = normalize((VIEW_MATRIX * vec4(Nd, 0.0)).xyz);
}
