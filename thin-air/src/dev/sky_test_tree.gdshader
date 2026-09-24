// Dev-only stand-in conifer material for sky look-dev.
shader_type spatial;
render_mode cull_disabled;

global uniform float snow_cover;

varying vec3 wnrm;
varying float wy;

void vertex() {
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	wy = (MODEL_MATRIX * vec4(VERTEX, 1.0)).y;
}

void fragment() {
	vec3 needles = vec3(0.035, 0.055, 0.04) * COLOR.rgb;
	vec3 bark = vec3(0.07, 0.05, 0.04);
	vec3 alb = mix(needles, bark, step(0.99, UV.x));
	float s = clamp(snow_cover * 1.3 + smoothstep(1750.0, 2000.0, wy) * 0.6, 0.0, 1.0);
	float up = smoothstep(0.25, 0.8, normalize(wnrm).y);
	alb = mix(alb, vec3(0.8, 0.83, 0.87), up * s * 0.75);
	ALBEDO = alb;
	ROUGHNESS = 0.9;
	SPECULAR = 0.25;
	BACKLIGHT = vec3(0.04, 0.06, 0.03);
}
