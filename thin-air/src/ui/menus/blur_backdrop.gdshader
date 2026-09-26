shader_type canvas_item;
// Frosted, dimmed copy of the world behind in-game screens (pause, journal, map, death).
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform float fade : hint_range(0.0, 1.0) = 1.0;
uniform float blur_lod = 3.0;
uniform float dim : hint_range(0.0, 1.0) = 0.55;
uniform float desat : hint_range(0.0, 1.0) = 0.35;
uniform vec3 tint = vec3(0.03, 0.035, 0.045);

void fragment() {
	vec3 c = textureLod(screen_tex, SCREEN_UV, blur_lod * fade).rgb;
	float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
	c = mix(c, vec3(y), desat * fade);
	vec2 p = SCREEN_UV - 0.5;
	float vig = 1.0 - dot(p, p) * 0.9;
	c = mix(c, tint, dim * fade) * mix(1.0, vig, fade);
	COLOR = vec4(c, 1.0);
}
