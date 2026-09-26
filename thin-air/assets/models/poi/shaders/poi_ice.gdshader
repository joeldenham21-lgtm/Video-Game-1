shader_type spatial;
// Glacial ice-cave walls: daylight transmitted through metres of ice makes the walls glow blue (fake
// subsurface: emission scaled by daylight, wall thinness in COLOR.r and a layered parallax look into the ice
// — strata, bubbles and cracks at three depths), wet glossy scalloped surface on top.
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
global uniform float time_of_day;
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform sampler2D ice_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D ice_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 deep_color : source_color = vec3(0.02, 0.19, 0.42);
uniform vec3 glow_color : source_color = vec3(0.16, 0.52, 0.95);
uniform float glow_energy = 0.9;
uniform float night_glow = 0.03;
varying vec3 v_wpos;
varying vec3 v_wn;

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

float tri_noise(vec3 p, vec3 w) {
	return texture(noise_tex, p.xz).r * w.y + texture(noise_tex, p.xy).r * w.z + texture(noise_tex, p.zy).r * w.x;
}

void fragment() {
	vec3 w = abs(v_wn);
	w /= (w.x + w.y + w.z);
	vec3 vw = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);   // towards the eye
	float nv = max(dot(vw, v_wn), 0.25);
	vec3 into = -(vw - v_wn * dot(vw, v_wn)) / nv;                  // parallax direction into the ice
	float layers = 0.0;
	float bubbles = 0.0;
	for (int k = 1; k <= 3; k++) {
		float d = float(k) * 0.12;
		vec3 p = v_wpos + into * d;
		float strata = sin(p.y * 7.0 + tri_noise(p * 0.08, w) * 9.0) * 0.5 + 0.5;
		layers += strata * (0.5 / float(k));
		float b = tri_noise(p * 0.9 + float(k) * 0.37, w);
		bubbles += smoothstep(0.72, 0.8, b) * (0.6 / float(k));
	}
	vec2 uv = mix(mix(v_wpos.zy, v_wpos.xy, w.z), v_wpos.xz, w.y) * 0.4;
	vec3 surf = texture(ice_albedo, uv).rgb;
	vec3 nt = texture(ice_normal, uv).rgb;
	float scallop = tri_noise(v_wpos * 0.35, w);
	float thin = clamp(COLOR.r, 0.0, 1.5);
	float day = smoothstep(5.2, 7.8, time_of_day) * (1.0 - smoothstep(17.0, 19.6, time_of_day));
	vec3 col = mix(deep_color, glow_color, clamp(layers * 0.6 + scallop * 0.3, 0.0, 1.0));
	ALBEDO = mix(col * 0.35, surf * vec3(0.75, 0.88, 1.0), 0.18) + bubbles * 0.12;
	EMISSION = col * glow_energy * thin * (0.35 + layers * 0.5 + scallop * 0.35) * mix(night_glow, 1.0, day)
		+ vec3(0.5, 0.75, 1.0) * bubbles * 0.05 * thin * day;
	NORMAL_MAP = mix(vec3(0.5, 0.5, 1.0), nt, 0.7);
	ROUGHNESS = 0.07 + scallop * 0.12;
	SPECULAR = 0.55;
	AO = 1.0;
}
