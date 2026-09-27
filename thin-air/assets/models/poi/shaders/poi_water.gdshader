shader_type spatial;
// Still meltwater (ice cave pools, puddles): dark, glassy, faint slow ripples.
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform vec3 water_color : source_color = vec3(0.015, 0.03, 0.035);
varying vec3 v_wpos;

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = v_wpos.xz;
	float a = texture(noise_tex, p * 0.6 + vec2(TIME * 0.01, 0.0)).r;
	float b = texture(noise_tex, p * 0.6 + vec2(0.013, TIME * 0.008)).r;
	float c = texture(noise_tex, p * 0.6 + vec2(0.0, 0.013)).r;
	vec3 n = normalize(vec3((a - b) * 0.25, 1.0, (a - c) * 0.25));
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	ALBEDO = water_color * COLOR.rgb;
	ROUGHNESS = 0.03;
	SPECULAR = 0.5;
}
