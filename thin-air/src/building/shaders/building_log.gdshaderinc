// Peeled building logs with remnant bark strips, saw-cut endgrain and mortar/moss chinking.
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

#include "res://src/building/shaders/building.gdshaderinc"

uniform sampler2D wood_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D wood_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D wood_orm : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D bark_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D bark_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D bark_orm : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D end_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D end_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D end_orm : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec2 wood_scale = vec2(1.0, 1.0);        // 1 / tile size in metres (materials.json)
uniform vec2 bark_scale = vec2(2.0, 1.0);
uniform vec3 wood_tint : source_color = vec3(0.84, 0.74, 0.62);
uniform float bark_amount : hint_range(0.0, 2.0) = 1.0;
uniform vec3 chink_color : source_color = vec3(0.55, 0.51, 0.45);
uniform vec3 moss_color : source_color = vec3(0.22, 0.25, 0.13);

void vertex() {
	BUILDING_VERTEX
}

void fragment() {
#ifdef FRAME
	frame_clip();
#endif
	float flag = COLOR.a;
	float ao = COLOR.r;
	vec2 seed = UV2 + vec2(v_seed * 37.0, v_seed * 91.0);
	float n = texture(noise_tex, (UV + seed) * vec2(0.37, 0.11)).r;
	vec3 alb;
	vec3 nrm;
	vec3 orm;
	if (flag > 0.75) {
		// chinking: lime-mud daub with moss fibres and grit
		float n1 = texture(noise_tex, UV * vec2(3.1, 9.0) + seed).r;
		float n2 = texture(noise_tex, UV * vec2(17.0, 23.0) + seed * 1.7).r;
		alb = chink_color * (0.82 + 0.3 * n1) * (0.9 + 0.2 * n2);
		alb = mix(alb, moss_color, smoothstep(0.62, 0.8, n1) * 0.55);
		nrm = normalize(vec3((n2 - 0.5) * 0.8, (n1 - 0.5) * 0.8, 1.0)) * 0.5 + 0.5;
		orm = vec3(1.0, 0.95, 0.0);
	} else if (flag > 0.25) {
		// saw-cut endgrain disc (UV 0..1), weathered darker toward the rim
		vec2 euv = UV;
		alb = texture(end_albedo, euv).rgb;
		nrm = texture(end_normal, euv).rgb;
		orm = texture(end_orm, euv).rgb;
		alb *= 0.88;
	} else {
		vec2 wuv = (UV + seed) * wood_scale;
		// each log a slightly different tree: tone and how far it has silvered in the weather
		float lh = fract(sin(dot(floor(UV2 * 7.0), vec2(12.9898, 78.233)) + v_seed * 17.0) * 43758.5453);
		vec3 w_alb = texture(wood_albedo, wuv).rgb * wood_tint * (0.74 + 0.4 * lh);
		float silver = clamp(0.22 + 0.25 * lh * v_exposed, 0.0, 0.5);
		w_alb = mix(w_alb, vec3(dot(w_alb, vec3(0.3, 0.59, 0.11))) * vec3(0.98, 0.97, 0.96), silver);
		vec3 w_nrm = texture(wood_normal, wuv).rgb;
		vec3 w_orm = texture(wood_orm, wuv).rgb;
		vec2 buv = (UV + seed * 1.3) * bark_scale;
		vec3 b_alb = texture(bark_albedo, buv).rgb;
		vec3 b_nrm = texture(bark_normal, buv).rgb;
		vec3 b_orm = texture(bark_orm, buv).rgb;
		// bark strips left by the drawknife: elongated along the grain, denser on log bellies (COLOR.b)
		float dens = COLOR.b * bark_amount;
		float th = 1.0 - dens * 0.62 - smoothstep(0.7, 1.0, dens) * 0.5;
		float m = texture(noise_tex, (UV + seed) * vec2(0.9, 0.16)).r * 0.75 + n * 0.25;
		float bark = smoothstep(th - 0.025, th + 0.01, m);
		float rim = smoothstep(th - 0.09, th - 0.02, m) * (1.0 - bark);
		// cambium stain around the strips, darker checks where the wood dried
		w_alb *= mix(vec3(1.0), vec3(0.78, 0.6, 0.45), rim * 0.55);
		alb = mix(w_alb, b_alb, bark);
		nrm = mix(w_nrm, b_nrm, bark);
		orm = mix(w_orm, b_orm, bark);
	}
	float rough = orm.g;
	vec3 nts = nrm;
	apply_weather(alb, rough, nts, n);
	ALBEDO = alb;
	ROUGHNESS = rough;
	METALLIC = 0.0;
	NORMAL_MAP = nts;
	NORMAL_MAP_DEPTH = 1.0;
	AO = orm.r * mix(1.0, ao, 0.85);
	AO_LIGHT_AFFECT = 0.25;
	SPECULAR = 0.4;
}
