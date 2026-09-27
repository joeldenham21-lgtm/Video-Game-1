shader_type canvas_item;
// THIN AIR — underwater camera overlay, Forward+: blurred, wobbling view through milky glacial water.
// (water_underwater_mobile.gdshader is the Mobile path: tint only, no screen texture.) Water stream.
render_mode unshaded;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap, repeat_disable;

uniform vec3 tint : source_color = vec3(0.05, 0.22, 0.22);
uniform float depth = 0.5;          // metres below the surface (0 at the waterline)
uniform float amount = 1.0;         // 0..1 fade in/out
uniform float light = 1.0;          // daylight 0..1

float vign(vec2 uv) {
	vec2 d = uv - 0.5;
	return 1.0 - dot(d, d) * 1.6;
}

void fragment() {
	vec2 uv = SCREEN_UV;
	float t = TIME;
	uv += vec2(sin(uv.y * 23.0 + t * 1.7), cos(uv.x * 19.0 + t * 1.3)) * 0.0035;
	float lod = 2.2 + clamp(depth * 0.4, 0.0, 1.8);
	vec3 c = textureLod(screen_tex, uv, lod).rgb * 0.5;
	c += textureLod(screen_tex, uv + vec2(0.006, 0.0), lod).rgb * 0.125;
	c += textureLod(screen_tex, uv - vec2(0.006, 0.0), lod).rgb * 0.125;
	c += textureLod(screen_tex, uv + vec2(0.0, 0.008), lod).rgb * 0.125;
	c += textureLod(screen_tex, uv - vec2(0.0, 0.008), lod).rgb * 0.125;
	// absorption: red goes first; scattering fogs everything toward the water colour
	vec3 absorb = exp(-vec3(0.62, 0.21, 0.19) * (1.5 + depth * 0.8));
	float fogk = clamp(0.55 + depth * 0.05, 0.0, 0.92);
	vec3 water = tint * (0.25 + 0.75 * light);
	vec3 outc = mix(c * absorb, water, fogk) * clamp(vign(SCREEN_UV), 0.35, 1.0);
	COLOR = vec4(outc, amount);
}
