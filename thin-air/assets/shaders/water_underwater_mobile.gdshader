shader_type canvas_item;
// THIN AIR — underwater camera overlay, Mobile renderer: a translucent water-colour veil with a darkening
// vignette (no screen texture read). Water stream.
render_mode unshaded;

uniform vec3 tint : source_color = vec3(0.05, 0.22, 0.22);
uniform float depth = 0.5;          // metres below the surface (0 at the waterline)
uniform float amount = 1.0;         // 0..1 fade in/out
uniform float light = 1.0;          // daylight 0..1

float vign(vec2 uv) {
	vec2 d = uv - 0.5;
	return 1.0 - dot(d, d) * 1.6;
}

void fragment() {
	float fogk = clamp(0.72 + depth * 0.04, 0.0, 0.94);
	vec3 water = tint * (0.25 + 0.75 * light) * clamp(vign(SCREEN_UV), 0.35, 1.0);
	float caust = 0.5 + 0.5 * sin(SCREEN_UV.x * 40.0 + TIME * 1.1) * sin(SCREEN_UV.y * 33.0 - TIME * 0.9);
	water *= 0.9 + 0.2 * caust * clamp(1.0 - depth * 0.3, 0.0, 1.0);
	COLOR = vec4(water, fogk * amount);
}
