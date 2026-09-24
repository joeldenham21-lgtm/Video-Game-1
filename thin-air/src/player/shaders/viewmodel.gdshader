shader_type spatial;
// PBR material for first-person hands and held tools. UV-mapped or object-space triplanar (for organic
// meshes without UVs), optional vertex-colour mask (COLOR.r) for honed steel edges / charring, wetness,
// and a limb bend (bow draw) done in the vertex stage.
render_mode depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

#include "res://src/player/shaders/viewmodel_common.gdshaderinc"

uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float normal_strength = 1.0;
uniform float roughness_scale = 1.0;
uniform float roughness_offset = 0.0;
uniform float metallic_scale = 1.0;
uniform float ao_strength = 0.8;
uniform vec2 uv_scale = vec2(1.0);
uniform float triplanar = 0.0;
uniform float tri_scale = 8.0;
uniform float tri_sharpness = 4.0;
uniform float mask_enabled = 0.0;
uniform vec4 mask_albedo : source_color = vec4(0.72, 0.72, 0.74, 1.0);
uniform float mask_roughness = 0.2;
uniform float mask_metallic = 1.0;
uniform vec3 emission : source_color = vec3(0.0);
uniform float emission_energy = 0.0;
uniform float wet = 0.0;
uniform float sheen = 0.0;                 // soft fabric/leather rim
// Bow limb bend: vertices with |y| > bend_start move along +z by bend * (|y| - bend_start)^2.
uniform float bend = 0.0;
uniform float bend_start = 0.08;

varying vec3 v_obj_pos;
varying vec3 v_obj_nrm;
varying vec3 v_ax;
varying vec3 v_ay;
varying vec3 v_az;

void vertex() {
	if (bend != 0.0) {
		float d = max(abs(VERTEX.y) - bend_start, 0.0);
		VERTEX.z += bend * d * d;
		VERTEX.y -= sign(VERTEX.y) * bend * d * d * d * 0.8;
	}
	v_obj_pos = VERTEX;
	v_obj_nrm = NORMAL;
	mat3 mv = mat3(MODELVIEW_MATRIX);
	v_ax = mv[0];
	v_ay = mv[1];
	v_az = mv[2];
	POSITION = vm_project(PROJECTION_MATRIX, MODELVIEW_MATRIX * vec4(VERTEX, 1.0));
}

void fragment() {
	vec3 alb;
	vec3 orm;
	if (triplanar > 0.5) {
		vec3 n = normalize(v_obj_nrm);
		vec3 w = pow(abs(n), vec3(tri_sharpness));
		w /= (w.x + w.y + w.z);
		vec3 p = v_obj_pos * tri_scale;
		vec2 uvx = p.zy;
		vec2 uvy = p.xz;
		vec2 uvz = p.xy;
		alb = texture(albedo_tex, uvx).rgb * w.x + texture(albedo_tex, uvy).rgb * w.y + texture(albedo_tex, uvz).rgb * w.z;
		orm = texture(orm_tex, uvx).rgb * w.x + texture(orm_tex, uvy).rgb * w.y + texture(orm_tex, uvz).rgb * w.z;
		vec3 tx = texture(normal_tex, uvx).rgb * 2.0 - 1.0;
		vec3 ty = texture(normal_tex, uvy).rgb * 2.0 - 1.0;
		vec3 tz = texture(normal_tex, uvz).rgb * 2.0 - 1.0;
		tx.xy *= normal_strength;
		ty.xy *= normal_strength;
		tz.xy *= normal_strength;
		vec3 s = sign(n);
		// Whiteout blend (Golus), tangent normals swizzled into object space.
		tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
		ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
		tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
		vec3 on = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
		NORMAL = normalize(v_ax * on.x + v_ay * on.y + v_az * on.z);
	} else {
		vec2 uv = UV * uv_scale;
		alb = texture(albedo_tex, uv).rgb;
		orm = texture(orm_tex, uv).rgb;
		NORMAL_MAP = texture(normal_tex, uv).rgb;
		NORMAL_MAP_DEPTH = normal_strength;
	}
	alb *= albedo.rgb;
	float rough = clamp(orm.g * roughness_scale + roughness_offset, 0.04, 1.0);
	float metal = clamp(orm.b * metallic_scale, 0.0, 1.0);
	float m = COLOR.r * mask_enabled;
	alb = mix(alb, mask_albedo.rgb * (0.85 + 0.3 * orm.g), m);
	rough = mix(rough, mask_roughness, m);
	metal = mix(metal, mask_metallic, m);
	// Wet: darker, glossier (porous materials darken more than metal).
	float porous = 1.0 - metal;
	alb *= 1.0 - wet * 0.35 * porous;
	rough = mix(rough, rough * 0.45, wet);
	ALBEDO = alb;
	ROUGHNESS = rough;
	METALLIC = metal;
	AO = mix(1.0, orm.r, ao_strength);
	AO_LIGHT_AFFECT = 0.3;
	EMISSION = emission * emission_energy;
	if (sheen > 0.0) {
		float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
		BACKLIGHT = vec3(sheen * rim) * alb;
	}
}
