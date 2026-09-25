// THIN AIR — ground cover (dry grass / sedge tufts, dead fern clumps) drawn by VegGrass as MultiMeshes in a
// ring around the camera. Alpha scissor (+ alpha-to-coverage under MSAA), two-sided; late-October colour
// (mostly cured straw with green bases, patchy per meadow), wind waves travelling downwind + per-blade
// flutter from the global wind, player trampling (player_position), burial under snow (altitude snow line +
// snow_cover), distance thinning (instances drop out by hash and shrink first, so the ring edge never pops).
shader_type spatial;
render_mode cull_disabled, depth_draw_opaque, alpha_to_coverage, diffuse_burley, specular_schlick_ggx;

#include "res://src/vegetation/shaders/veg_common.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform vec3 tint : source_color = vec3(1.0);
uniform vec3 dry_tint : source_color = vec3(1.06, 0.96, 0.8);
uniform vec3 green_tint : source_color = vec3(0.84, 0.93, 0.74);
uniform float greenness : hint_range(0.0, 1.0) = 0.25;  // share of still-green tufts (late October: few)
uniform float alpha_cut : hint_range(0.05, 0.95) = 0.42;
uniform float fade_start = 18.0;   // full density inside (VegGrass: 0.3 x grass_distance)
uniform float fade_end = 60.0;     // grass_distance
uniform float trample_radius = 1.0;
uniform float wind_amp = 0.11;
uniform float translucency : hint_range(0.0, 2.0) = 0.55;
uniform float roughness : hint_range(0.0, 1.0) = 0.82;
uniform float up_normal : hint_range(0.0, 1.0) = 0.6;   // bend card normals up: tufts shade like a sward

varying flat float v_inst;
varying flat float v_green;
varying vec3 v_world;
varying float v_snow;
varying flat float v_base_y;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	v_inst = veg_hash12(origin.xz * 1.37);
	v_base_y = origin.y;
	float d = distance(CAMERA_POSITION_WORLD.xz, origin.xz);
	// density LOD: same curve as VegGrass.keep_at(); tufts whose rank is above it shrink away
	float mid = mix(fade_start, fade_end, 0.6);
	float keep = d <= mid ? mix(1.0, 0.15, smoothstep(fade_start, mid, d)) : mix(0.15, 0.0, smoothstep(mid, fade_end, d));
	float grow = clamp((keep - INSTANCE_CUSTOM.r) * 10.0, 0.0, 1.0);
	// burial under snow: altitude snow line + global snow cover
	float snow_depth = clamp(smoothstep(snow_start, snow_full, origin.y) * 0.9 + snow_cover * 0.8, 0.0, 1.0);
	v_snow = snow_depth;
	float bury = smoothstep(0.35, 1.0, snow_depth);
	mat3 m3 = mat3(MODEL_MATRIX);
	float sc2 = max(dot(m3[0], m3[0]), 1e-6);
	float w = clamp(COLOR.r, 0.0, 1.0) * clamp(VERTEX.y * 3.0, 0.0, 1.0);
	VERTEX.y *= grow * (1.0 - 0.8 * bury);
	VERTEX.xz *= mix(0.4, 1.0, grow);
	// wind: gust waves rolling downwind across the meadow + per-blade flutter
	float s = clamp(wind_strength, 0.0, 2.0);
	vec2 wd = normalize(wind_direction.xz + vec2(1e-4, 0.0));
	float along = dot(origin.xz, wd);
	float wave = sin(along * 0.45 - TIME * (1.6 + s * 1.4)) * 0.5 + 0.5;
	wave = wave * wave * (0.6 + 0.4 * sin(along * 0.07 - TIME * 0.4));
	float flutter = sin(TIME * (6.0 + v_inst * 3.0) + v_inst * 40.0 + VERTEX.y * 7.0) * 0.18;
	vec3 push = vec3(wd.x, 0.0, wd.y) * (wind_amp * s * (0.25 + 1.1 * wave + flutter));
	push.y = -0.25 * length(push);
	// trampling: bend away from the player and flatten
	vec3 to = origin - player_position;
	float pd = length(to.xz);
	float t = (1.0 - smoothstep(trample_radius * 0.35, trample_radius, pd)) * step(abs(to.y), 2.0);
	push += normalize(vec3(to.x, 0.0, to.z) + vec3(1e-4, 0.0, 0.0)) * (0.28 * t);
	VERTEX += (transpose(m3) * (push * w)) / sc2;
	VERTEX.y *= 1.0 - 0.6 * t;
	v_green = step(1.0 - greenness, veg_hash12(origin.xz * 0.73 + 5.1));
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (grow <= 0.0) {
		VERTEX = vec3(0.0);
	}
}

void fragment() {
	vec4 tex = texture(albedo_tex, UV);
	ALPHA = tex.a;
	ALPHA_SCISSOR_THRESHOLD = alpha_cut;
	ALPHA_ANTIALIASING_EDGE = 0.25;
	ALPHA_TEXTURE_COORDINATE = UV * vec2(textureSize(albedo_tex, 0));
	// meadow-scale patches (wetter hollows stay greener) + per-tuft variation
	float patch = veg_hash12(floor(v_world.xz / 9.0)) * 0.5 + veg_hash12(floor(v_world.xz / 3.0)) * 0.5;
	vec3 var_tint = mix(dry_tint, green_tint, clamp(v_green * 0.8 + (patch - 0.6) * 0.5, 0.0, 1.0));
	vec3 alb = tex.rgb * tint * var_tint * (0.88 + 0.24 * v_inst);
	float ao = COLOR.g * mix(0.7, 1.0, smoothstep(0.0, 0.2, v_world.y - v_base_y));
	// snow caught in the tufts
	float snow = smoothstep(0.3, 0.8, v_snow + (veg_hash13(floor(v_world * 11.0)) - 0.5) * 0.3) * 0.8;
	alb = mix(alb, vec3(0.86, 0.89, 0.93), snow);
	float wet = clamp(wetness, 0.0, 1.0) * (1.0 - snow);
	alb *= 1.0 - 0.25 * wet;
	ALBEDO = alb;
	vec3 up_v = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	NORMAL = normalize(mix(NORMAL, up_v, up_normal));
	NORMAL_MAP = texture(normal_tex, UV).xyz;
	NORMAL_MAP_DEPTH = 0.6;
	ROUGHNESS = mix(roughness, 0.6, wet);
	SPECULAR = 0.35;
	AO = ao;
	AO_LIGHT_AFFECT = 0.4;
	BACKLIGHT = alb * translucency * (1.0 - snow);
}
