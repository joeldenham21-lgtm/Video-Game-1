// Dev-only stand-in terrain material for sky look-dev (not shipped in the world).
shader_type spatial;
render_mode cull_back;

global uniform float snow_cover;

varying vec3 wpos;
varying vec3 wnrm;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 5; i++) {
		s += a * vnoise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return s;
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = normalize(wnrm);
	float slope = 1.0 - n.y;
	float big = fbm(wpos.xz * 0.0015);
	float mid = fbm(wpos.xz * 0.011);
	float fine = vnoise(wpos.xz * 0.09);
	vec3 rock = mix(vec3(0.16, 0.15, 0.14), vec3(0.26, 0.24, 0.21), big) * (0.8 + 0.35 * mid);
	rock = mix(rock, vec3(0.12, 0.12, 0.13), smoothstep(0.55, 0.8, fine) * 0.4);
	vec3 meadow = mix(vec3(0.16, 0.13, 0.08), vec3(0.20, 0.18, 0.10), mid) * (0.85 + 0.3 * fine);
	vec3 forest_floor = vec3(0.07, 0.075, 0.05);
	vec3 snow = vec3(0.86, 0.89, 0.93) * (0.94 + 0.06 * fine);
	float alt = wpos.y;
	vec3 base = mix(meadow, forest_floor, smoothstep(1500.0, 1700.0, alt) * (1.0 - smoothstep(1900.0, 2100.0, alt)) * 0.7);
	base = mix(base, rock, smoothstep(0.2, 0.34, slope + 0.1 * mid));
	// Snowline ~1,850 m with noisy edge; dusting from the global snow cover lower down; steep rock sheds snow.
	float line = 1850.0 + 250.0 * (big - 0.5) - 350.0 * snow_cover;
	float s_alt = smoothstep(line - 120.0, line + 120.0, alt);
	float s_low = snow_cover * smoothstep(0.35, 0.8, mid + 0.35 * snow_cover);
	float s_amt = max(s_alt, s_low * 0.85);
	float hold = 1.0 - smoothstep(0.3, 0.46, slope + 0.16 * (mid - 0.5) + 0.1 * (fine - 0.5));
	s_amt *= hold;
	ALBEDO = mix(base, snow, clamp(s_amt, 0.0, 1.0));
	ROUGHNESS = mix(0.88, 0.62, s_amt);
	SPECULAR = 0.35;
}
