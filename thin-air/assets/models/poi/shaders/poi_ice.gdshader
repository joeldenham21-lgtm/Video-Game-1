shader_type spatial;
// Glacial ice-cave walls. Daylight transmitted through metres of ice makes the walls glow blue - faked as emission
// scaled by daylight (global time_of_day) and by the wall thinness in COLOR.r (brighter near the roof and the
// mouth). A parallax look into the ice at three depths shows horizontal annual layers, bubble-rich white bands and
// dark debris bands; the surface is wet and scalloped (two octaves of the terrain ice normal map, triplanar).
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
global uniform float time_of_day;
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform sampler2D ice_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D ice_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 deep_color : source_color = vec3(0.03, 0.2, 0.42);
uniform vec3 glow_color : source_color = vec3(0.3, 0.68, 0.95);
uniform vec3 white_color : source_color = vec3(0.78, 0.9, 0.98);
uniform vec3 debris_color : source_color = vec3(0.16, 0.15, 0.14);
uniform float glow_energy = 0.8;
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
	vec3 w = pow(abs(v_wn), vec3(3.0));
	w /= (w.x + w.y + w.z);
	vec3 vw = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);
	float nv = max(dot(vw, v_wn), 0.3);
	vec3 into = -(vw - v_wn * dot(vw, v_wn)) / nv;
	float white = 0.0;
	float debris = 0.0;
	float depth_col = 0.0;
	for (int k = 0; k < 3; k++) {
		float d = 0.06 + float(k) * 0.14;
		vec3 p = v_wpos + into * d - v_wn * d;
		// annual layers: noise stretched horizontally, warped
		float warp = tri_noise(p * 0.11, w) * 0.6;
		float lay = tri_noise(vec3(p.x * 0.16, p.y * 0.75 + warp, p.z * 0.16), w);
		float att = 1.0 / (1.0 + float(k) * 1.2);
		white += smoothstep(0.58, 0.72, lay) * att * smoothstep(0.3, 0.6, tri_noise(p * 0.45 + 0.5, w));
		debris += smoothstep(0.79, 0.83, lay) * smoothstep(0.45, 0.7, tri_noise(p * 0.3, w)) * att * 0.6;
		depth_col += (tri_noise(p * 0.5 + float(k) * 0.31, w) - 0.5) * att;
	}
	vec2 uvx = v_wpos.zy, uvy = v_wpos.xz, uvz = v_wpos.xy;
	vec3 n1 = texture(ice_normal, uvx * 0.9).rgb * w.x + texture(ice_normal, uvy * 0.9).rgb * w.y + texture(ice_normal, uvz * 0.9).rgb * w.z;
	vec3 n2 = texture(ice_normal, uvx * 2.6).rgb * w.x + texture(ice_normal, uvy * 2.6).rgb * w.y + texture(ice_normal, uvz * 2.6).rgb * w.z;
	vec3 nt = normalize((n1 * 2.0 - 1.0) + (n2 * 2.0 - 1.0) * vec3(0.5, 0.5, 0.0));
	float scallop = tri_noise(v_wpos * 0.6, w);
	float thin = clamp(COLOR.r, 0.0, 1.6);
	float day = smoothstep(5.2, 7.8, time_of_day) * (1.0 - smoothstep(17.0, 19.6, time_of_day));
	vec3 col = mix(deep_color, glow_color, clamp(thin * 0.45 + depth_col * 0.8 + scallop * 0.25, 0.0, 1.0));
	col = mix(col, white_color, clamp(white * 0.45, 0.0, 0.6));
	col = mix(col, debris_color, clamp(debris * 0.7, 0.0, 0.6));
	ALBEDO = col * 0.3;
	EMISSION = col * glow_energy * thin * (0.45 + 0.35 * scallop) * mix(night_glow, 1.0, day) * (1.0 - debris * 0.7);
	NORMAL_MAP = nt * 0.5 + 0.5;
	ROUGHNESS = 0.05 + scallop * 0.1 + debris * 0.4;
	SPECULAR = 0.55;
}
