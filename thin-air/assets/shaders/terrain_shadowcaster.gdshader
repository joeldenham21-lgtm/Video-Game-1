// THIN AIR — terrain shadow caster (the near clipmap rings drawn only into the directional shadow maps, one
// merged mesh per level so shadows cost a few draw calls). Same displacement + geomorph as the visible terrain.
shader_type spatial;
render_mode world_vertex_coords, cull_disabled, unshaded;

#include "res://assets/shaders/terrain_common.gdshaderinc"

void vertex() {
	vec3 w;
	vec3 vn;
	float d;
	terrain_vertex(VERTEX, NORMAL, w, vn, d);
	v_world = w;
	v_vnormal = vn;
	v_true_dist = d;
}

void fragment() {
	ALBEDO = vec3(0.2);
}
