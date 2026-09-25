// Sawn / split boards: roof shakes, sheathing, floor boards, door planks, frames. COLOR.b = weathering
// (0 fresh-split, 1 silver-grey), end faces (flag .5) darker and rougher.
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

#include "res://src/building/shaders/building.gdshaderinc"

uniform sampler2D planks_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D planks_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D planks_orm : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec2 planks_scale = vec2(0.5, 0.5);
uniform vec3 fresh_tint : source_color = vec3(1.08, 0.98, 0.86);
uniform vec3 grey_tint : source_color = vec3(0.62, 0.61, 0.6);

void vertex() {
	BUILDING_VERTEX
}

void fragment() {
#ifdef FRAME
	frame_clip();
#endif
	vec2 seed = UV2 + vec2(v_seed * 23.0, v_seed * 57.0);
	vec2 puv = (UV + seed) * planks_scale;
	vec3 alb = texture(planks_albedo, puv).rgb;
	vec3 nrm = texture(planks_normal, puv).rgb;
	vec3 orm = texture(planks_orm, puv).rgb;
	float n = texture(noise_tex, (UV + seed) * vec2(0.6, 0.2)).r;
	float weather = clamp(COLOR.b + (n - 0.5) * 0.25, 0.0, 1.0);
	float lum = dot(alb, vec3(0.3, 0.55, 0.15));
	vec3 fresh = alb * fresh_tint;
	vec3 grey = vec3(lum) * grey_tint * 1.35;
	alb = mix(fresh, grey, smoothstep(0.2, 0.95, weather));
	if (COLOR.a > 0.25) {
		alb *= 0.62;
		orm.g = min(1.0, orm.g + 0.1);
	}
	float rough = orm.g;
	vec3 nts = nrm;
	apply_weather(alb, rough, nts, n);
	ALBEDO = alb;
	ROUGHNESS = rough;
	METALLIC = 0.0;
	NORMAL_MAP = nts;
	AO = orm.r * mix(1.0, COLOR.r, 0.8);
	AO_LIGHT_AFFECT = 0.25;
	SPECULAR = 0.4;
}
