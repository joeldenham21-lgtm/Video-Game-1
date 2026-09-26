shader_type spatial;
// Placement preview / unbuilt part of a blueprint frame: a faint translucent silhouette with a brighter rim,
// tinted by validity (green ok, red blocked, pale for "still to build"). Steps at or below `hide_below`
// are discarded so a partly built frame only ghosts what is still missing.
render_mode blend_mix, depth_draw_never, cull_back, unshaded, shadows_disabled, depth_prepass_alpha;

uniform vec4 tint : source_color = vec4(0.55, 0.9, 0.6, 0.22);
uniform float rim_power = 2.5;
uniform float hide_below = -1.0;
uniform float pulse = 0.0;

varying float v_step;

void vertex() {
	v_step = COLOR.g;
}

void fragment() {
	if (v_step <= hide_below + 0.0005) {
		discard;
	}
	float f = 1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
	float rim = pow(f, rim_power);
	float p = 1.0 + pulse * 0.25 * sin(TIME * 4.0);
	ALBEDO = tint.rgb * (0.7 + 0.8 * rim) * p;
	ALPHA = clamp(tint.a * (0.55 + 1.6 * rim) * p, 0.0, 0.85);
}
