// THIN AIR — needle / leaf cards (conifers, shrubs, ferns).
// Alpha scissor (+ alpha-to-coverage under MSAA), two-sided with back-face normal flip for the card part
// while the crown-volume normal stays unflipped, backlit translucency, global wind (trunk + branch +
// flutter from vertex weights), fresh snow on upward card faces (altitude snow line + snow_cover),
// dithered near-camera fade, per-instance LOD cross-fade and colour variation.
shader_type spatial;
render_mode cull_disabled, depth_draw_opaque, alpha_to_coverage, diffuse_burley, specular_schlick_ggx;

#include "res://src/vegetation/shaders/veg_common.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform vec2 atlas_size = vec2(1024.0, 1024.0);
uniform vec3 tint : source_color = vec3(1.0);
uniform float tint_variation = 0.08;
uniform float alpha_cut : hint_range(0.05, 0.95) = 0.45;
uniform float alpha_mip_boost = 0.07;
uniform bool temporal_dither = true;
uniform float dither_amount : hint_range(0.0, 1.0) = 0.85;
uniform float normal_strength : hint_range(0.0, 2.0) = 1.0;
uniform float crown_bend : hint_range(0.0, 1.0) = 0.4;   // blend card normal -> crown-volume normal
uniform float crown_up = 0.6;
uniform float facing : hint_range(0.0, 1.0) = 0.85;    // axial turn of cards toward the viewer
uniform float translucency : hint_range(0.0, 2.0) = 0.55;
uniform float roughness : hint_range(0.0, 1.0) = 0.55;
uniform float specular : hint_range(0.0, 1.0) = 0.45;
uniform float ao_light = 0.55;
uniform float trunk_sway = 0.010;
uniform float branch_sway = 0.14;
uniform float flutter = 0.018;
uniform float near_fade = 0.7;
uniform float snow_exposure = 1.0;
uniform float clip_margin = 0.0;

instance uniform float lod_begin = 0.0;
instance uniform float lod_end = 0.0;
instance uniform float lod_margin = 3.0;
instance uniform float clip_below = -100000.0;   // object-space Y cut (felled crowns / stumps)
instance uniform float clip_above = 100000.0;

varying flat float v_fade;
varying flat float v_inst;
varying vec3 v_crown_n;     // view space
varying vec3 v_world;
varying float v_obj_y;
varying vec3 v_geo_n;       // object-space card normal before facing (snow sits on the upper face)

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	v_inst = veg_hash12(origin.xz + origin.y);
	float d = distance(view_origin, origin);
	v_fade = veg_band_fade(d, lod_begin, lod_end, lod_margin);
	v_obj_y = VERTEX.y;
	v_geo_n = NORMAL;
	veg_face_card(VERTEX, NORMAL, TANGENT, UV, COLOR.a * 4.0, MODEL_MATRIX, INV_VIEW_MATRIX, PROJECTION_MATRIX, facing);
	BINORMAL = normalize(cross(NORMAL, TANGENT));
	vec3 radial = vec3(VERTEX.x, 0.0, VERTEX.z);
	vec3 crown_obj = normalize(radial + vec3(0.0, crown_up * max(length(radial), 0.35), 0.0));
	VERTEX += veg_wind_offset(VERTEX, NORMAL, COLOR, UV2.x, MODEL_MATRIX, TIME, trunk_sway, branch_sway, flutter);
	v_crown_n = normalize((MODELVIEW_MATRIX * vec4(crown_obj, 0.0)).xyz);
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (v_fade <= 0.001) {
		// culled by LOD band: collapse the vertex so nothing is rasterised
		VERTEX = vec3(0.0);
	}
}

void fragment() {
	if (v_obj_y < clip_below || v_obj_y > clip_above) {
		discard;
	}
	float dith = veg_ign(FRAGCOORD.xy, v_inst * 7.0);
	if (v_fade < 0.999 && dith > v_fade) {
		discard;
	}
	float cam_d = length(VERTEX);
	if (cam_d < near_fade && dith > smoothstep(near_fade * 0.35, near_fade, cam_d)) {
		discard;
	}
	vec4 tex = texture(albedo_tex, UV);
	// mip-aware coverage: a mild boost keeps distant sprays from thinning out; under TAA the cut-off
	// threshold is dithered per pixel and per frame so blurred far mips resolve to lacy partial coverage
	// instead of solid blobs (MSAA path: alpha-to-coverage does the same job).
	vec2 px = UV * atlas_size;
	float mip = max(0.0, 0.5 * log2(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px)))));
	float a = clamp(tex.a * (1.0 + min(mip, 6.0) * alpha_mip_boost), 0.0, 1.0);
	float cut = alpha_cut;
	if (temporal_dither) {
		float n = veg_ign(FRAGCOORD.xy + vec2(fract(TIME * 7.31) * 61.0, fract(TIME * 3.17) * 37.0), 0.0);
		cut = mix(alpha_cut, 0.08 + 0.84 * n, clamp((mip - 0.5) / 2.5, 0.0, 1.0) * dither_amount);
	}
	ALPHA = a;
	ALPHA_SCISSOR_THRESHOLD = cut;
	ALPHA_ANTIALIASING_EDGE = 0.25;
	ALPHA_TEXTURE_COORDINATE = px;

	// normals: Godot already flipped NORMAL for back faces (card part); the crown normal is unflipped
	vec3 card_n = NORMAL;
	vec3 n = normalize(mix(card_n, v_crown_n, crown_bend));
	NORMAL = n;
	NORMAL_MAP = texture(normal_tex, UV).xyz;
	NORMAL_MAP_DEPTH = normal_strength;

	vec3 alb = tex.rgb * tint;
	float h = v_inst;
	alb *= mix(vec3(1.0 - tint_variation, 1.0 - tint_variation * 0.4, 1.0 - tint_variation * 0.8),
		vec3(1.0 + tint_variation * 0.6, 1.0 + tint_variation * 0.5, 1.0 - tint_variation * 0.3), h);
	float ao = COLOR.g;
	alb *= mix(1.0, ao, 0.55);

	// snow on the upper face of the (un-faced) card
	vec3 geo_n_world = normalize((MODEL_MATRIX * vec4(v_geo_n, 0.0)).xyz);
	float snow_noise = veg_hash13(floor(v_world * 7.0));
	float snow = veg_snow(v_world, geo_n_world, snow_noise, snow_exposure * mix(0.55, 1.0, ao));
	snow *= mix(0.25, 1.0, smoothstep(-0.2, 0.3, dot(normalize((INV_VIEW_MATRIX * vec4(card_n, 0.0)).xyz), vec3(0.0, 1.0, 0.0))));
	alb = mix(alb, vec3(0.86, 0.89, 0.93), snow);

	float wet = clamp(wetness, 0.0, 1.0) * (1.0 - snow);
	alb *= 1.0 - 0.22 * wet;
	ALBEDO = alb;
	ROUGHNESS = mix(mix(roughness, roughness * 0.55, wet), 0.75, snow);
	SPECULAR = mix(specular, 0.4, snow);
	AO = ao;
	AO_LIGHT_AFFECT = ao_light;
	BACKLIGHT = alb * translucency * (1.0 - snow * 0.8);
}
