shader_type spatial;
// Avgas / oil sheen on standing water (crash-site furrow): thin-film interference tints the sky reflection.
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable, hint_default_white;
varying vec3 v_wpos;

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float n = texture(noise_tex, v_wpos.xz * 0.23).r * 0.7 + texture(noise_tex, v_wpos.xz * 0.9 + 0.3).r * 0.3;
	float nv = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float film = n * 2.2 + (1.0 - nv) * 0.8;
	vec3 irid = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + film));
	float edge = smoothstep(0.15, 0.45, n);
	ALBEDO = mix(vec3(0.03, 0.028, 0.022), irid * 0.55, edge * 0.8);
	METALLIC = 0.55 * edge;
	ROUGHNESS = 0.06 + 0.1 * (1.0 - edge);
	SPECULAR = 0.5;
}
