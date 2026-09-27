// THIN AIR — shared surface code for story-location architecture (assets/models/poi, tools/blender/poi/plib.py).
// Mesh: UV in metres (x uv_scale = 1 / texture tile), COLOR.rgb = paint tint x baked AO x grime (linear),
// COLOR.a = sky exposure (0 indoors / under roofs .. 1 open sky) -> snow settles on exposed up-facing surfaces
// (global snow_cover + altitude snow line), rain darkens. Library textures: albedo / ORM (R ao, G rough,
// B metal) / OpenGL normal. Terrain layer sets bind their roughness map as `orm_tex` with orm_is_rough.

global uniform float snow_cover;
global uniform float wetness;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D orm_tex : filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform vec2 uv_scale = vec2(1.0);
uniform vec3 tint : source_color = vec3(1.0);
uniform float desaturate : hint_range(0.0, 1.0) = 0.0;
uniform float lum_norm = 1.0;           // after desaturation: brightness gain (repaint a coloured texture)
uniform float rough_mul = 1.0;
uniform float rough_add = 0.0;
uniform float metal_mul = 1.0;
uniform float normal_strength = 1.0;
uniform bool orm_is_rough = false;      // orm_tex is a plain roughness map (terrain layer sets)
uniform float snow_accept = 1.0;        // 0 for surfaces snow never sticks to (glass, hot metal)
uniform float snow_line_low = 1720.0;
uniform float snow_line_high = 2150.0;
uniform float wet_accept = 1.0;
uniform vec3 emission_color : source_color = vec3(0.0);
uniform float emission_energy = 0.0;
uniform float lit = 1.0;                // emissive parts switch with the site's interior lights

varying vec3 v_wpos;
varying vec3 v_wn;

// Varyings can only be written in vertex() itself: every POI shader expands this macro there.
#define POI_VERTEX v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);

// Same response as the vegetation / rock shaders (src/vegetation/shaders/veg_common.gdshaderinc veg_snow) so a
// roof, a boulder and a spruce at the same altitude carry the same snow.
float poi_snow(float exposure, float n) {
	float amount = clamp(smoothstep(snow_line_low, snow_line_high, v_wpos.y) * 0.85 + snow_cover * 0.75, 0.0, 1.0);
	float up = smoothstep(0.15, 0.75, v_wn.y);
	float s = amount * up * exposure * snow_accept;
	return smoothstep(0.25, 0.65, s + (n - 0.5) * 0.45) * step(0.001, s);
}

void poi_surface(vec2 uv_m, vec4 vcol, out vec3 albedo, out float rough, out float metal, out float ao,
		out vec3 nrm_ts, out vec3 emission) {
	vec2 uv = uv_m * uv_scale;
	vec3 a = texture(albedo_tex, uv).rgb;
	float l = dot(a, vec3(0.2126, 0.7152, 0.0722));
	a = mix(a, vec3(l * lum_norm), desaturate);
	albedo = a * tint * vcol.rgb;
	vec3 orm = texture(orm_tex, uv).rgb;
	if (orm_is_rough) {
		rough = orm.r;
		ao = 1.0;
		metal = 0.0;
	} else {
		rough = orm.g;
		ao = orm.r;
		metal = orm.b * metal_mul;
	}
	rough = clamp(rough * rough_mul + rough_add, 0.03, 1.0);
	vec3 nt = texture(normal_tex, uv).rgb;
	nrm_ts = mix(vec3(0.5, 0.5, 1.0), nt, normal_strength);
	float n = texture(noise_tex, v_wpos.xz * 0.19 + v_wpos.y * 0.043).r * 0.7
		+ texture(noise_tex, v_wpos.xz * 1.37 + v_wpos.y * 0.21).r * 0.3;
	// rain / melt: exposed surfaces darken and turn glossy
	float wet = clamp(wetness * wet_accept, 0.0, 1.0) * clamp(vcol.a * 1.5, 0.0, 1.0);
	albedo *= 1.0 - 0.3 * wet * (1.0 - metal);
	rough = mix(rough, rough * 0.45, wet);
	float snow = poi_snow(vcol.a, n);
	vec3 snow_col = vec3(0.82, 0.86, 0.91) * (0.93 + 0.07 * n);
	albedo = mix(albedo, snow_col, snow);
	rough = mix(rough, 0.6, snow);
	metal = mix(metal, 0.0, snow);
	ao = mix(ao, 1.0, snow * 0.6);
	nrm_ts = mix(nrm_ts, vec3(0.5, 0.5, 1.0), snow * 0.85);
	emission = emission_color * emission_energy * lit;
}
