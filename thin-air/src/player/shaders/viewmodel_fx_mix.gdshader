shader_type spatial;
// Lit alpha-blended billboard particles (smoke) drawn with the viewmodel projection.
render_mode blend_mix, depth_draw_never, cull_disabled, diffuse_lambert, specular_disabled, shadows_disabled;

#include "res://src/player/shaders/viewmodel_common.gdshaderinc"

uniform sampler2D tex : source_color, filter_linear_mipmap, hint_default_white;
uniform vec4 tint : source_color = vec4(0.55, 0.55, 0.55, 1.0);

void vertex() {
	mat4 mv = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	float sc = length(MODEL_MATRIX[0].xyz);
	POSITION = vm_project(PROJECTION_MATRIX, mv * vec4(VERTEX * sc, 1.0));
}

void fragment() {
	vec4 t = texture(tex, UV);
	ALBEDO = t.rgb * tint.rgb * COLOR.rgb;
	ALPHA = t.a * COLOR.a * tint.a;
	NORMAL = vec3(0.0, 0.0, 1.0);
	ROUGHNESS = 1.0;
}
