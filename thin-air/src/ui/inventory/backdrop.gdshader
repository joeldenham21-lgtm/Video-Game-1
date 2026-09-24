shader_type canvas_item;
// Frosted-glass backdrop behind the inventory: blurred, dimmed world with a soft vignette and film grain.

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform float blur_lod = 3.2;
uniform float dim = 0.52;
uniform float vignette = 0.45;
uniform vec4 tint : source_color = vec4(0.03, 0.04, 0.05, 1.0);
uniform float fade = 1.0;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void fragment() {
	vec2 px = SCREEN_PIXEL_SIZE * 6.0;
	vec3 c = textureLod(screen_tex, SCREEN_UV, blur_lod).rgb * 0.4;
	c += textureLod(screen_tex, SCREEN_UV + vec2(px.x, px.y), blur_lod).rgb * 0.15;
	c += textureLod(screen_tex, SCREEN_UV + vec2(-px.x, px.y), blur_lod).rgb * 0.15;
	c += textureLod(screen_tex, SCREEN_UV + vec2(px.x, -px.y), blur_lod).rgb * 0.15;
	c += textureLod(screen_tex, SCREEN_UV + vec2(-px.x, -px.y), blur_lod).rgb * 0.15;
	float lum = dot(c, vec3(0.299, 0.587, 0.114));
	c = mix(c, vec3(lum), 0.35);
	float v = smoothstep(0.25, 0.95, distance(UV, vec2(0.5)) * 1.25);
	c = mix(c, tint.rgb, clamp(dim + v * vignette, 0.0, 1.0));
	c += (hash(UV * 913.0 + TIME) - 0.5) * 0.012;
	COLOR = vec4(c, fade);
}
