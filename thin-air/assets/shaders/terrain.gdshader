// THIN AIR — terrain surface, desktop / Forward+ quality (3 height-blended layers, biplanar cliffs,
// anti-tiling, 360 m texture range). See terrain_common.gdshaderinc and terrain_material.gdshaderinc.
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_opaque;

#include "res://assets/shaders/terrain_common.gdshaderinc"
#include "res://assets/shaders/terrain_material.gdshaderinc"

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
	vec3 alb;
	vec3 nv;
	float r;
	float ao;
	vec3 em;
	float sp;
	float ssh;
	float ssc;
	terrain_fragment(VERTEX, VIEW_MATRIX, v_world, v_vnormal, v_true_dist, alb, nv, r, ao, em, sp, ssh, ssc);
	v_sunshadow = ssh;
	v_spec_scale = ssc;
	ALBEDO = alb;
	NORMAL = nv;
	ROUGHNESS = r;
	METALLIC = 0.0;
	SPECULAR = sp;
	AO = ao;
	AO_LIGHT_AFFECT = 0.0;
	EMISSION = em;
}

void light() {
	terrain_light(NORMAL, LIGHT, VIEW, LIGHT_COLOR, ATTENUATION, LIGHT_IS_DIRECTIONAL, ROUGHNESS, v_sunshadow,
		v_spec_scale, DIFFUSE_LIGHT, SPECULAR_LIGHT);
}
