shader_type spatial;
// Additive billboard particles (flames, sparks, flare glow) drawn with the viewmodel projection so they
// line up with the held torch/flare and never get cut by nearby walls.
render_mode blend_add, depth_draw_never, cull_disabled, unshaded, shadows_disabled, fog_disabled;

#include "res://src/player/shaders/viewmodel_common.gdshaderinc"

uniform sampler2D tex : source_color, filter_linear_mipmap, hint_default_white;
uniform float energy = 1.0;
uniform float stretch = 0.0;   // elongate along world up (flames)

void vertex() {
	// Particle billboard: keep the particle's world position/scale, face the camera.
	mat4 mv = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	float sc = length(MODEL_MATRIX[0].xyz);
	vec3 v = VERTEX * sc;
	v.y *= 1.0 + stretch;
	POSITION = vm_project(PROJECTION_MATRIX, mv * vec4(v, 1.0));
}

void fragment() {
	vec4 t = texture(tex, UV);
	ALBEDO = t.rgb * COLOR.rgb * energy;
	ALPHA = t.a * COLOR.a;
}
