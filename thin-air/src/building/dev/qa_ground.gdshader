// Dev-only ground for the building QA scene: forest floor / dry autumn grass / trampled dirt from the terrain
// layer textures, with a snow dusting from the global snow cover. Not shipped in the world.
shader_type spatial;
render_mode cull_back;

global uniform float snow_cover;
uniform sampler2D forest_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D forest_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D dirt_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D dirt_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 camp_centre = vec3(0.0, 0.0, 3.0);

varying vec3 wpos;

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

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = wpos.xz;
	float n1 = vnoise(p * 0.11) * 0.6 + vnoise(p * 0.37) * 0.4;
	float n2 = vnoise(p * 1.3 + 7.0);
	vec3 fa = texture(forest_albedo, p / 2.5).rgb;
	vec3 fn = texture(forest_normal, p / 2.5).rgb;
	vec3 ga = texture(grass_albedo, p / 3.0).rgb;
	vec3 gn = texture(grass_normal, p / 3.0).rgb;
	vec3 da = texture(dirt_albedo, p / 3.0).rgb;
	vec3 dn = texture(dirt_normal, p / 3.0).rgb;
	float r = length(p - camp_centre.xz);
	float grass = smoothstep(0.35, 0.65, n1) * smoothstep(9.0, 16.0, r) * 0.9;
	float dirt = (1.0 - smoothstep(4.0, 11.0, r + (n1 - 0.5) * 6.0)) * 0.85;
	vec3 alb = mix(fa, ga, grass);
	vec3 nrm = mix(fn, gn, grass);
	alb = mix(alb, da, dirt);
	nrm = mix(nrm, dn, dirt);
	float snow = snow_cover * smoothstep(0.45, 0.75, n1 + n2 * 0.3 + snow_cover * 0.4) * (1.0 - dirt * 0.7);
	alb = mix(alb, vec3(0.84, 0.87, 0.92), snow);
	nrm = mix(nrm, vec3(0.5, 0.5, 1.0), snow * 0.7);
	ALBEDO = alb;
	NORMAL_MAP = nrm;
	ROUGHNESS = mix(0.9, 0.65, snow);
	SPECULAR = 0.35;
}
