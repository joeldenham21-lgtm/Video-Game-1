shader_type spatial;
// Decal atlas (registration letters, signage, gauges, maps, paper): UV 0..1 into poi_decals_albedo.png,
// alpha-scissored, sits a few mm above the surface it labels. COLOR.rgb = tint x AO, COLOR.a = exposure.
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
global uniform float snow_cover;
uniform sampler2D atlas : source_color, filter_linear_mipmap_anisotropic, hint_default_white;
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform float roughness = 0.6;
uniform float snow_line_low = 1720.0;
uniform float snow_line_high = 2150.0;
uniform float emission_energy = 0.0;
uniform float lit = 1.0;
varying vec3 v_wpos;
varying vec3 v_wn;

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec4 a = texture(atlas, UV);
	if (a.a < 0.5) {
		discard;
	}
	float n = texture(noise_tex, v_wpos.xz * 0.19 + v_wpos.y * 0.043).r;
	float amount = clamp(smoothstep(snow_line_low, snow_line_high, v_wpos.y) * 0.85 + snow_cover * 0.75, 0.0, 1.0);
	float s = amount * smoothstep(0.15, 0.75, v_wn.y) * COLOR.a;
	float snow = smoothstep(0.25, 0.65, s + (n - 0.5) * 0.45) * step(0.001, s);
	ALBEDO = mix(a.rgb * COLOR.rgb, vec3(0.84, 0.87, 0.92), snow);
	ROUGHNESS = roughness;
	EMISSION = a.rgb * emission_energy * lit;
}
