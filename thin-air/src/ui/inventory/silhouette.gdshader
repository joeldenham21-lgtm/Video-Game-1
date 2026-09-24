shader_type canvas_item;
// Locked blueprints: the item's icon as a flat, faintly rim-lit silhouette ("you don't know this yet").

uniform vec4 fill : source_color = vec4(0.13, 0.15, 0.17, 1.0);
uniform vec4 rim : source_color = vec4(0.42, 0.47, 0.52, 1.0);

void fragment() {
	float a = texture(TEXTURE, UV).a;
	vec2 o = TEXTURE_PIXEL_SIZE * 2.0;
	float inner = min(min(texture(TEXTURE, UV + vec2(o.x, 0.0)).a, texture(TEXTURE, UV - vec2(o.x, 0.0)).a),
		min(texture(TEXTURE, UV + vec2(0.0, o.y)).a, texture(TEXTURE, UV - vec2(0.0, o.y)).a));
	float edge = clamp(a - inner, 0.0, 1.0);
	COLOR = vec4(mix(fill.rgb, rim.rgb, edge), a * COLOR.a * fill.a);
}
