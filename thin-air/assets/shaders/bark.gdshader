// THIN AIR — tree bark (trunks + branches of generated trees, stumps, logs).
// Uses the shared bark_* PBR maps (UVs in metres * uv_scale), the same wind as foliage.gdshader so branch
// tubes and their needle cards move together, snow on upward faces, baked vertex AO, per-instance LOD
// cross-fade and object-space clip planes (felled trees / stumps / bucked logs).
shader_type spatial;
render_mode cull_back, depth_draw_opaque, diffuse_burley, specular_schlick_ggx;

#include "res://src/vegetation/shaders/veg_common.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec2 uv_scale = vec2(2.0, 1.0);
uniform float uv_jitter = 1.0;          // per-instance texture offset (0 for non-tiling maps like end grain)
uniform vec3 tint : source_color = vec3(1.0);
uniform float normal_strength : hint_range(0.0, 2.0) = 1.0;
uniform float trunk_sway = 0.010;
uniform float branch_sway = 0.14;
uniform float snow_exposure = 0.8;
uniform float moss_amount : hint_range(0.0, 1.0) = 0.0;   // lichen/moss tint on the shaded lower trunk
uniform vec3 moss_color : source_color = vec3(0.23, 0.26, 0.16);

instance uniform float lod_begin = 0.0;
instance uniform float lod_end = 0.0;
instance uniform float lod_margin = 3.0;
instance uniform float clip_below = -100000.0;
instance uniform float clip_above = 100000.0;
instance uniform float wind_scale = 1.0;       // 0 on felled trees, stumps and logs

varying flat vec2 v_fade;   // (fade-in, fade-out) of this LOD band
varying flat float v_inst;
varying vec3 v_world;
varying float v_obj_y;
varying vec3 v_obj_n;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	v_inst = veg_hash12(origin.xz + origin.y);
	v_fade = veg_band_fades(distance(view_origin, origin), lod_begin, lod_end, lod_margin);
	v_obj_y = VERTEX.y;
	v_obj_n = NORMAL;
	VERTEX += wind_scale * veg_wind_offset(VERTEX, NORMAL, COLOR, UV2.x, MODEL_MATRIX, TIME, trunk_sway, branch_sway, 0.0);
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (v_fade.x * v_fade.y <= 0.001) {
		VERTEX = vec3(0.0);
	}
}

void fragment() {
	if (v_obj_y < clip_below || v_obj_y > clip_above) {
		discard;
	}
	if (veg_faded_out(veg_ign(FRAGCOORD.xy, v_inst * 7.0), v_fade)) {
		discard;
	}
	vec2 uv = UV * uv_scale + vec2(v_inst * 3.7, v_inst * 11.3) * uv_jitter;
	vec3 alb = texture(albedo_tex, uv).rgb * tint;
	vec3 orm = texture(orm_tex, uv).rgb;
	float ao = COLOR.g * orm.r;
	vec3 n_world = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	// moss / lichen on the lower, north-ish side
	float moss = moss_amount * smoothstep(3.0, 0.2, v_obj_y) * smoothstep(0.2, -0.6, n_world.z * 0.7 + n_world.x * 0.3);
	alb = mix(alb, moss_color * (0.7 + 0.6 * orm.g), clamp(moss, 0.0, 1.0) * 0.6);
	float snow = veg_snow(v_world, n_world, veg_hash13(floor(v_world * 9.0)), snow_exposure);
	alb = mix(alb, vec3(0.85, 0.88, 0.92), snow);
	float wet = clamp(wetness, 0.0, 1.0) * (1.0 - snow);
	alb *= 1.0 - 0.3 * wet;
	ALBEDO = alb;
	ROUGHNESS = mix(mix(orm.g, orm.g * 0.5, wet), 0.75, snow);
	METALLIC = 0.0;
	AO = ao;
	AO_LIGHT_AFFECT = 0.25;
	NORMAL_MAP = texture(normal_tex, uv).xyz;
	NORMAL_MAP_DEPTH = normal_strength * (1.0 - snow * 0.7);
}
