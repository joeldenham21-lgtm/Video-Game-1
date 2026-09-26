shader_type spatial;
// THIN AIR fauna: one fur shell. A second, shadow-less MeshInstance3D shares the animal's skinned mesh
// and renders this material chained through next_pass (8–16 shells on Forward+, 0–3 on Mobile).
// Each shell pushes the surface out along the normal by shell_t × local fur length (coat alpha), bent by the
// hair lay (comb), gravity, wind and body motion; the strand map keeps a tapering disc per strand.
render_mode diffuse_burley, specular_schlick_ggx, cull_back, depth_draw_opaque;

uniform sampler2D coat_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D strand_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float strand_scale = 8.0;
uniform float shell_t = 0.5;
uniform float fur_length = 0.035;
uniform vec3 comb = vec3(0.0, -0.3, 0.95);
uniform float comb_amount = 0.55;
uniform float gravity = 0.3;
uniform vec3 tint : source_color = vec3(1.0);
uniform float root_dark = 0.42;
uniform float tip_shift = 0.08;
uniform float sheen = 0.55;
uniform float wet_response = 1.0;
global uniform vec3 wind_direction;
global uniform float wind_strength;
global uniform float wetness;
instance uniform vec3 fur_motion = vec3(0.0);

varying float v_len;

void vertex() {
	float fl = textureLod(coat_tex, UV, 0.0).a;
	v_len = fl;
	float w = clamp(wetness * wet_response, 0.0, 1.0);
	float L = fur_length * fl * shell_t * mix(1.0, 0.55, w);
	vec3 wind_m = (vec4(wind_direction, 0.0) * MODEL_MATRIX).xyz;
	float sway = 0.5 + 0.5 * sin(TIME * 2.7 + VERTEX.x * 11.0 + VERTEX.z * 7.0 + VERTEX.y * 5.0);
	vec3 bend = normalize(comb) * comb_amount + vec3(0.0, -gravity * (1.0 + w), 0.0)
		+ wind_m * wind_strength * (0.25 + 0.5 * sway) - fur_motion * 0.05;
	vec3 dir = normalize(NORMAL + bend * shell_t);
	VERTEX += dir * L;
}

void fragment() {
	vec4 c = texture(coat_tex, UV);
	vec4 s = texture(strand_tex, UV * strand_scale);
	float t = shell_t / max(s.r, 0.001);
	float keep = step(t, 1.0) * step(s.g, (1.0 - t) * 0.92 + 0.06) * step(0.04, v_len);
	ALPHA = keep;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	vec3 col = c.rgb * tint;
	col *= mix(1.0 - root_dark, 1.0 + tip_shift, shell_t) * mix(0.85, 1.08, s.b);
	col *= mix(1.0, 0.62, clamp(wetness * wet_response, 0.0, 1.0));
	ALBEDO = col;
	ROUGHNESS = 0.8;
	SPECULAR = 0.3;
	RIM = sheen;
	RIM_TINT = 0.8;
	BACKLIGHT = col * 0.45;
}
