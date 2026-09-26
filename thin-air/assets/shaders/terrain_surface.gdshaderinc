// THIN AIR — terrain surface stage functions shared by terrain.gdshader / terrain_mobile.gdshader and their
// *_holes variants (which define TERRAIN_HOLES and discard inside the heightfield cut-outs; used only by the
// innermost clipmap level while a cut-out is near, so the common case keeps opaque early-z rendering).
#ifdef TERRAIN_HOLES
uniform vec4 holes[4];                 // x, z, radius, 0
uniform int hole_count = 0;
#endif

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
#ifdef TERRAIN_HOLES
	// cut-outs (mine adit, ice cave mouth): no surface inside the discs, the structures below show through
	for (int i = 0; i < 4; i++) {
		if (i < hole_count && distance(v_world.xz, holes[i].xy) < holes[i].z) {
			discard;
		}
	}
#endif
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
