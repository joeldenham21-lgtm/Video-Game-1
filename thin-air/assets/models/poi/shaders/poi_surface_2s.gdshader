shader_type spatial;
// Two-sided variant (thin sheets: tarps, torn skins, paper, flags, tent flies).
render_mode blend_mix, depth_draw_opaque, cull_disabled, diffuse_burley, specular_schlick_ggx;
#include "res://assets/models/poi/shaders/poi_common.gdshaderinc"

void vertex() {
	POI_VERTEX
}

void fragment() {
	vec3 alb; float r; float m; float ao; vec3 nt; vec3 em;
	poi_surface(UV, COLOR, alb, r, m, ao, nt, em);
	ALBEDO = alb;
	ROUGHNESS = r;
	METALLIC = m;
	AO = ao;
	AO_LIGHT_AFFECT = 0.25;
	NORMAL_MAP = nt;
	EMISSION = em;
	BACKLIGHT = alb * 0.35;
}
