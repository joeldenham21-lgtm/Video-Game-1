shader_type spatial;
// THIN AIR — rivers, creeks, cascades and waterfalls (one shader for Forward+ and Mobile: no screen/depth
// texture). Water stream.
// Mesh (built by src/world/water_builder.gd): ribbons along the layout polylines at the data surface height.
//   UV.x = across (−1 left bank .. +1 right bank), UV.y = distance along the river (m)
//   UV2.x = flow speed (m/s), UV2.y = slope (rise/run) of the reach
//   NORMAL = surface normal of the (possibly steep) ribbon, TANGENT = across direction
//   COLOR.r = whitewater bias (braids/rapids), COLOR.g = braided-gravel flag, COLOR.b = end fade (0 at ends)
// Flow mapping: two half-period phases of the ripple/foam textures dragged along the flow and cross-faded,
// so speed can vary along the river without the texture stretching.

render_mode blend_premul_alpha, cull_disabled, depth_draw_never, specular_schlick_ggx, shadows_disabled;

#include "res://assets/shaders/water_common.gdshaderinc"

uniform float fall_slope = 1.0;               // slope above which a reach renders as a falling sheet

varying vec3 v_world;
varying vec3 v_n;
varying vec3 v_t;
varying vec2 v_flow;                          // speed, slope
varying vec3 v_col;

void vertex() {
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	v_t = normalize((MODEL_MATRIX * vec4(TANGENT.xyz, 0.0)).xyz);
	v_flow = UV2;
	v_col = COLOR.rgb;
}

vec2 flow_phase(float t) {
	return vec2(fract(t), fract(t + 0.5));
}

void fragment() {
	vec3 cam = (INV_VIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	vec3 to_cam = cam - v_world;
	float dist = length(to_cam);
	vec3 V = to_cam / dist;
	float speed = v_flow.x;
	float slope = v_flow.y;
	float fall = smoothstep(fall_slope * 0.7, fall_slope * 1.3, slope);
	vec3 N0 = normalize(v_n);
	vec3 Tx = normalize(v_t - N0 * dot(v_t, N0));
	vec3 Bf = normalize(cross(Tx, N0));        // along the flow (downstream = +UV.y)
	if (dot(Bf, vec3(0.0, -1.0, 0.0)) < -0.01 && slope > 0.05) {
		Bf = -Bf;
	}

	// depth under this point (vertical, from the heightfield)
	float depth = v_world.y - bed_height(v_world.xz);
	depth = mix(depth, max(depth, 0.35), fall);   // falls: a sheet over rock, always "water"

	// ---- flow-mapped ripples + foam
	vec2 ph = flow_phase(TIME * 0.45);
	float wA = abs(1.0 - 2.0 * ph.x);
	vec2 base = vec2(UV.x * 1.4, UV.y);
	float adv = speed / 0.45;                   // metres travelled per phase
	vec2 uv0 = base - vec2(0.0, adv * ph.x);
	vec2 uv1 = base - vec2(0.0, adv * ph.y) + vec2(0.37, 0.19);
	vec3 na = mix(nmap(ripple_a, uv1 / 3.0), nmap(ripple_a, uv0 / 3.0), wA);
	vec3 nb = mix(nmap(ripple_b, uv1 / 1.1 * vec2(1.0, 0.6)), nmap(ripple_b, uv0 / 1.1 * vec2(1.0, 0.6)), wA);
	float rough_water = clamp(0.25 + speed * 0.22, 0.0, 1.6);
	vec2 nxy = (na.xy * 0.9 + nb.xy * 0.6) * rough_water / (1.0 + dist * 0.01);
	vec3 nw = normalize(Tx * nxy.x + Bf * nxy.y + N0);
	bool above = FRONT_FACING;
	if (!above) {
		nw = -nw;
	}

	vec4 f0 = texture(foam_tex, uv0 * vec2(0.22, 0.09));
	vec4 f1 = texture(foam_tex, uv1 * vec2(0.22, 0.09));
	vec4 fm = mix(f1, f0, wA);
	vec4 fb0 = texture(foam_tex, uv0 / 2.2);
	vec4 fb1 = texture(foam_tex, uv1 / 2.2);
	float bubbles = mix(fb1.r, fb0.r, wA);
	// whitewater: steep reaches, fast shallow riffles, braids over gravel
	float riffle = smoothstep(0.35, 0.06, depth) * smoothstep(0.6, 2.5, speed);
	float ww = clamp(smoothstep(0.1, 0.55, slope) + riffle * 0.8 + v_col.r * 0.4, 0.0, 1.0);
	float foam = clamp((fm.g * 0.75 + bubbles * 0.6) * 1.25 - (1.0 - ww) * 1.05, 0.0, 1.0);
	foam = max(foam, fall * clamp(fm.g * 1.4 - 0.1 + bubbles * 0.3, 0.0, 1.0));
	float edge_u = abs(UV.x);
	// bank foam lines where the current drags along the shore
	foam = max(foam, smoothstep(0.72, 0.95, edge_u) * bubbles * 0.5 * smoothstep(0.5, 2.0, speed));

	// ---- optics
	float ndv = abs(dot(nw, V));
	float F = fresnel_water(ndv);
	float path = clamp(depth, 0.0, 20.0) / max(abs(dot(N0, V)), 0.1);
	vec3 T3 = exp(-extinction * 0.85 * path);
	float T = dot(T3, vec3(0.2, 0.45, 0.35));
	T = mix(T, 0.1, fall);
	float alpha = 1.0 - (1.0 - F) * T;
	float body = (1.0 - F) * (1.0 - T);
	vec3 albedo = body_albedo * 1.1;
	float rough = mix(0.03, 0.12, clamp(speed / 4.0, 0.0, 1.0));
	float spec = WATER_SPEC;
	vec3 emis = vec3(0.0);

	// ---- foam / aerated water (white, rough, opaque)
	vec3 foam_col = vec3(0.82, 0.86, 0.87);
	albedo = mix(albedo, foam_col, foam);
	body = mix(body, 1.0, foam);
	alpha = mix(alpha, 1.0, foam);
	rough = mix(rough, 0.55, foam);
	// falling sheet: braided white threads of aerated water racing down the rock, dark wet rock between them
	float fall_speed = 2.5 + speed;
	vec2 fu = vec2(UV.x * 0.3, UV.y * 0.035);
	float th0 = texture(foam_tex, fu - vec2(0.0, fall_speed * ph.x * 0.035)).g;
	float th1 = texture(foam_tex, fu - vec2(0.0, fall_speed * ph.y * 0.035) + vec2(0.31, 0.0)).g;
	float threads = mix(th1, th0, wA);
	float wide = texture(foam_tex, vec2(UV.x * 0.7, UV.y * 0.012) + vec2(0.5, 0.0)).b;
	// sparse bright threads (mean coverage ~35 %) so the sheet stays dark-and-white even when mipmapped far away
	float streak = smoothstep(0.52, 0.8, threads * 0.75 + wide * 0.4);
	// between the threads: a dark film of water over wet rock (what makes a fall read against snow/scree)
	vec3 fall_col = mix(vec3(0.02, 0.028, 0.03), vec3(0.8, 0.83, 0.84), streak);
	albedo = mix(albedo, fall_col, fall * (1.0 - foam * 0.5));
	alpha = mix(alpha, mix(0.75, 0.95, streak), fall);
	spec = mix(spec, WATER_SPEC * 1.6, fall * (1.0 - streak));   // the glassy wet film catches the sky
	body = mix(body, alpha, fall);
	rough = mix(rough, 0.45, fall * streak);
	// ragged edges instead of two parallel lines down the mountain
	float rag = texture(foam_tex, vec2(UV.y * 0.05, 0.3)).b;
	float fall_edge = smoothstep(1.0, 0.35 + 0.4 * rag, abs(UV.x));

	// ---- soft edges: banks, ends, very shallow water
	float edge = mix(smoothstep(1.0, 0.82, edge_u), fall_edge, fall) * smoothstep(0.0, 0.08, depth + fall) * v_col.b;
	alpha *= edge;
	body *= edge;
	spec *= edge;

	if (!above) {
		albedo = body_albedo * 0.5;
		alpha = 0.9 * edge;
		body = alpha;
	}

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
