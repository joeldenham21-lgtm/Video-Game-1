shader_type spatial;
// Survey scanner LCD: dim teal display with a grid, a sweep line while idle, a target reticle when
// something scannable is in range, and a progress bar + percentage ticks while scanning.
render_mode depth_draw_opaque, cull_back, unshaded, shadows_disabled;

#include "res://src/player/shaders/viewmodel_common.gdshaderinc"

uniform float progress = 0.0;      // 0..1 while scanning
uniform float target_found = 0.0;  // 1 when a scannable is under the reticle
uniform float done_flash = 0.0;    // 1 → 0 after a completed scan
uniform float power = 1.0;         // 0 = screen off
uniform float brightness = 1.6;

void vertex() {
	POSITION = vm_project(PROJECTION_MATRIX, MODELVIEW_MATRIX * vec4(VERTEX, 1.0));
}

float box(vec2 p, vec2 a, vec2 b) {
	return step(a.x, p.x) * step(p.x, b.x) * step(a.y, p.y) * step(p.y, b.y);
}

void fragment() {
	vec2 uv = UV;
	vec3 base = vec3(0.015, 0.035, 0.035);
	vec3 ink = vec3(0.25, 0.95, 0.78);
	float g = 0.0;
	// Grid.
	vec2 cell = fract(uv * vec2(10.0, 7.0));
	g += (step(cell.x, 0.035) + step(cell.y, 0.05)) * 0.12;
	// Scan lines.
	g += (0.5 + 0.5 * sin(uv.y * 380.0)) * 0.04;
	// Idle sweep.
	float sweep = fract(TIME * 0.45);
	g += smoothstep(0.06, 0.0, abs(uv.x - sweep)) * 0.35 * (1.0 - progress);
	// Reticle in the viewport area.
	vec2 c = uv - vec2(0.5, 0.42);
	c.x *= 1.4;
	float r = length(c);
	float ring = smoothstep(0.012, 0.0, abs(r - 0.2 - 0.02 * sin(TIME * 4.0) * target_found));
	g += ring * (0.35 + 0.65 * target_found);
	g += smoothstep(0.01, 0.0, abs(c.x)) * step(r, 0.08) * 0.6 + smoothstep(0.01, 0.0, abs(c.y)) * step(r, 0.08) * 0.6;
	// Progress bar along the bottom.
	float bar_frame = box(uv, vec2(0.08, 0.82), vec2(0.92, 0.9)) - box(uv, vec2(0.09, 0.83), vec2(0.91, 0.89));
	float bar_fill = box(uv, vec2(0.1, 0.84), vec2(0.1 + 0.8 * progress, 0.88));
	g += bar_frame * 0.7 + bar_fill * 1.2;
	// Status blocks top-left (battery, signal).
	g += box(uv, vec2(0.06, 0.06), vec2(0.2, 0.1)) * 0.6;
	g += box(uv, vec2(0.8, 0.06), vec2(0.82, 0.1)) * 0.8 + box(uv, vec2(0.84, 0.05), vec2(0.86, 0.1)) * 0.8
		+ box(uv, vec2(0.88, 0.04), vec2(0.9, 0.1)) * 0.8 * target_found;
	vec3 col = base + ink * g;
	col = mix(col, vec3(0.8, 1.0, 0.9), done_flash * 0.6);
	col *= power;
	// Slight vignette like a real backlit LCD.
	col *= 1.0 - smoothstep(0.35, 0.75, length(uv - 0.5)) * 0.5;
	ALBEDO = col * brightness;
}
