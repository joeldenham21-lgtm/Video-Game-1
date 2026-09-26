// THIN AIR — lake surface (Loon Lake + tarns). Included by water_lake.gdshader (Forward+: adds screen-space
// reflections of the range from the colour/depth buffers) and water_lake_mobile.gdshader (no screen or depth
// texture at all: sky radiance + a heightfield-marched reflection of the surrounding slopes).
// Mesh: flat polygons at the lake level, a little beyond the shoreline; the terrain's depth test cuts the
// true shore. COLOR.r = coldness of the lake's altitude (0 valley .. 1 alpine tarn).

render_mode blend_premul_alpha, cull_disabled, depth_draw_never, specular_schlick_ggx, shadows_disabled;

#include "res://assets/shaders/water_common.gdshaderinc"

uniform float ice_amount = 0.3;               // 0..1 skim-ice growth (air temperature, season), from water.gd
uniform float cold_bias = 0.0;                // extra coldness at altitude (from water.gd)

#ifdef WATER_SSR
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap, repeat_disable;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest, repeat_disable;
uniform int ssr_steps = 20;
#endif

varying vec3 v_world;
varying float v_cold;

void vertex() {
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_cold = COLOR.r;
}

#ifdef WATER_SSR
float linear_depth(vec2 uv, mat4 inv_proj) {
	float d = texture(depth_tex, uv).r;
	vec4 v = inv_proj * vec4(uv * 2.0 - 1.0, d, 1.0);
	return -v.z / v.w;
}

// March the reflected ray in view space against the depth buffer. rgb + a = confidence.
vec4 ssr(vec3 vpos, vec3 vref, mat4 proj, mat4 inv_proj) {
	float t = 1.5;
	float prev_t = 0.0;
	for (int k = 0; k < ssr_steps; k++) {
		vec3 p = vpos + vref * t;
		if (p.z > -0.05) {
			break;
		}
		vec4 c = proj * vec4(p, 1.0);
		vec2 uv = c.xy / c.w * 0.5 + 0.5;
		if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
			break;
		}
		float scene = linear_depth(uv, inv_proj);
		float ray = -p.z;
		if (ray > scene && ray - scene < max(t * 0.35, 4.0)) {
			// refine between prev_t and t
			float a = prev_t;
			float b = t;
			for (int j = 0; j < 5; j++) {
				float m = (a + b) * 0.5;
				vec3 pm = vpos + vref * m;
				vec4 cm = proj * vec4(pm, 1.0);
				vec2 um = cm.xy / cm.w * 0.5 + 0.5;
				if (-pm.z > linear_depth(um, inv_proj)) {
					b = m;
				} else {
					a = m;
				}
			}
			vec3 ph = vpos + vref * b;
			vec4 ch = proj * vec4(ph, 1.0);
			vec2 uh = ch.xy / ch.w * 0.5 + 0.5;
			vec2 edge = smoothstep(vec2(0.0), vec2(0.08), uh) * smoothstep(vec2(1.0), vec2(0.92), uh);
			return vec4(textureLod(screen_tex, uh, 0.0).rgb, edge.x * edge.y);
		}
		prev_t = t;
		t *= 1.38;
	}
	return vec4(0.0);
}
#endif

void fragment() {
	vec3 cam = (INV_VIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	vec3 to_cam = cam - v_world;
	float dist = length(to_cam);
	vec3 V = to_cam / dist;
	float level = v_world.y;
	float bed = bed_height(v_world.xz);
	float depth = level - bed;
	bool above = FRONT_FACING;

	// ---- skim ice: a thin rim that grows in the cold and in shade (north-facing, enclosed shores)
	vec4 tn = texture(terrain_normal_tex, terrain_uv(v_world.xz));
	vec3 bed_n = tn.xyz * 2.0 - 1.0;
	float shade = clamp(0.5 - bed_n.z * 1.5, 0.0, 1.0) * 0.5 + (1.0 - tn.a) * 0.8;   // north aspect + enclosure
	float cold = clamp(ice_amount + v_cold * 0.6 + cold_bias, 0.0, 1.5);
	vec4 fz = texture(foam_tex, v_world.xz / 23.0);
	// metres of water depth the rim ice reaches: a few cm in the valley, decimetres at the tarns / in shade
	float ice_reach = cold * cold * (0.06 + 0.3 * shade + 0.35 * v_cold) * (0.6 + 0.8 * fz.b);
	float ice = smoothstep(ice_reach, ice_reach * 0.6, depth) * step(0.02, cold);
	float frost = smoothstep(ice_reach * 0.35, ice_reach * 0.05, depth);    // white rime at the very edge

	// ---- surface normal: wind ripples, flattened under ice and in sheltered shallows
	float calm = clamp(ice * 1.2, 0.0, 1.0) * 0.97;
	vec3 nw = wind_ripples(v_world.xz, dist, calm);
	if (!above) {
		nw = vec3(nw.x, -nw.y, nw.z);
	}
	float ndv = abs(dot(nw, V));
	float F = fresnel_water(ndv);

	// ---- transmittance along the view path through the water column (vertical depth / cos)
	float path = clamp(depth, 0.0, 60.0) / max(abs(V.y), 0.08);
	vec3 T3 = exp(-extinction * path);
	float T = dot(T3, vec3(0.2, 0.45, 0.35));

	// ---- shore: soft edge (depth fade) + lapping foam line
	float edge = smoothstep(0.0, 0.07, depth);
	float wind01 = clamp(wind_strength, 0.0, 1.0);
	vec2 wd = normalize(wind_direction.xz + vec2(1e-4, 0.0));
	float lap = 0.5 + 0.5 * sin(TIME * 1.3 - depth * 30.0 + fz.g * 6.0);
	float foam_line = smoothstep(0.22, 0.03, depth) * smoothstep(0.0, 0.03, depth);
	float foam = texture(foam_tex, v_world.xz / 3.1 + wd * TIME * 0.02).r * foam_line * (0.25 + 0.5 * wind01) * (0.5 + 0.5 * lap);
	foam *= (1.0 - ice);

	// ---- reflection of the range
	vec3 R = reflect(-V, nw);
	vec4 hr = heightfield_reflection(v_world + vec3(0.0, 0.3, 0.0), R, 3200.0);
	vec3 refl_extra = vec3(0.0);
	float occl = hr.a;
	vec3 occl_col = hr.rgb;
#ifdef WATER_SSR
	if (above) {
		vec3 vref = normalize((VIEW_MATRIX * vec4(R, 0.0)).xyz);
		vec4 s = ssr(VERTEX, vref, PROJECTION_MATRIX, INV_PROJECTION_MATRIX);
		occl_col = mix(occl_col, s.rgb, s.a);
		occl = max(occl, s.a);
	}
#endif
	if (!above) {
		occl = 0.0;
	}

	// ---- compose (premultiplied): water
	float k_sky = 1.0 - occl;                                // share of the reflection that is sky
	float spec = WATER_SPEC * sqrt(k_sky);
	vec3 emis = F * occl * occl_col;
	float alpha = 1.0 - (1.0 - F) * T;
	float body = (1.0 - F) * (1.0 - T);
	vec3 albedo = body_albedo;
	// a dark cold sheen in the shallows over wet gravel
	albedo = mix(albedo, vec3(0.06, 0.12, 0.11), smoothstep(1.5, 0.0, depth) * 0.5);
	float rough = mix(0.02, 0.06, wind01);

	// star glints on still night water
	if (night > 0.01 && R.y > 0.05) {
		vec2 cell = floor(R.xz / R.y * 260.0);
		float st = step(0.9965, w_hash(cell)) * w_hash(cell + 7.0);
		emis += vec3(0.8, 0.85, 1.0) * st * star_glint * night * F * k_sky * 20.0;
	}

	// ---- skim ice / rime
	vec3 ice_col = mix(vec3(0.04, 0.06, 0.065), vec3(0.58, 0.62, 0.64), frost * (0.5 + 0.5 * fz.r));
	float crack = smoothstep(0.55, 0.9, texture(foam_tex, v_world.xz / 1.7).r) * (1.0 - frost);
	ice_col = mix(ice_col, vec3(0.3, 0.33, 0.34), crack * 0.6);
	float ice_alpha = mix(0.3, 0.9, frost);   // black ice is clear: mostly reflection + a grey film
	albedo = mix(albedo, ice_col, ice);
	body = mix(body, ice_alpha, ice);
	alpha = mix(alpha, ice_alpha, ice);
	rough = mix(rough, mix(0.07, 0.45, frost), ice);
	spec = mix(spec, WATER_SPEC * 1.05 * sqrt(k_sky), ice);
	emis *= 1.0 - ice * 0.6;

	// ---- foam
	albedo = mix(albedo, vec3(0.85, 0.88, 0.88), foam);
	body = mix(body, 1.0, foam);
	alpha = mix(alpha, 1.0, foam);
	rough = mix(rough, 0.6, foam);

	if (!above) {
		// under the surface: total internal reflection outside Snell's window, dim teal
		float snell = smoothstep(0.62, 0.72, ndv);
		albedo = mix(body_albedo * 0.35, body_albedo, snell);
		alpha = mix(0.96, 0.55, snell);
		body = alpha;
		spec = WATER_SPEC * 0.4;
		emis = vec3(0.0);
		ice = 0.0;
	}

	alpha *= edge;
	body *= edge;
	spec *= edge;
	emis *= edge;

	// premultiplied: Godot's PREMUL_ALPHA_FACTOR scales the whole lit colour (specular too) and does not
	// compile on the Mobile renderer in 4.7, so the (1−F)(1−T) body weight goes into the albedo instead
	ALBEDO = albedo * clamp(body, 0.0, 1.0);
	ALPHA = clamp(alpha, 0.0, 1.0);
	SPECULAR = spec;
	ROUGHNESS = rough;
	METALLIC = 0.0;
	EMISSION = emis;
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
}
