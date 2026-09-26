// THIN AIR — heightfield sun-shadow pass. Renders (on demand, in a SubViewport) a map of sun visibility over
// the 6,144 m MID square around the map: for every texel it marches toward the sun over the map heightfield
// (1.5 m, 3 m steps near, growing geometrically) and the MID band beyond, tracking the steepest occluder.
//   R = visibility with all occluders (use beyond the shadow-map distance)
//   G = visibility with occluders farther than `near_skip` metres (use inside the shadow-map range, where the
//       real shadow map already handles nearby casters)
// Soft penumbra from the sun's angular size plus a little atmospheric blur. Published as the global sampler
// terrain_shadow_tex (+ terrain_shadow_params = origin x, origin z, size, enabled) by src/world/terrain.gd.
shader_type canvas_item;
render_mode unshaded, blend_disabled;

uniform sampler2D map_height_tex : filter_nearest, repeat_disable;
uniform sampler2D mid_height_tex : filter_nearest, repeat_disable;
uniform vec3 sun_dir = vec3(0.3, 0.6, -0.4);
uniform float near_skip = 60.0;
uniform float max_dist = 6500.0;
uniform int steps = 96;
uniform float growth = 1.065;

float tf(sampler2D t, ivec2 i, int n) {
	return texelFetch(t, clamp(i, ivec2(0), ivec2(n - 1)), 0).r;
}
float bl(sampler2D t, int n, float origin, float cell, vec2 p) {
	vec2 g = clamp((p - vec2(origin)) / cell, vec2(0.0), vec2(float(n) - 1.001));
	ivec2 i = ivec2(floor(g));
	vec2 f = g - vec2(i);
	return mix(mix(tf(t, i, n), tf(t, i + ivec2(1, 0), n), f.x), mix(tf(t, i + ivec2(0, 1), n), tf(t, i + ivec2(1, 1), n), f.x), f.y);
}
float H(vec2 p) {
	if (max(abs(p.x), abs(p.y)) <= 1536.0) {
		return bl(map_height_tex, 2049, -1536.0, 1.5, p);
	}
	return bl(mid_height_tex, 1025, -3072.0, 6.0, p);
}

void fragment() {
	vec2 p = mix(vec2(-3072.0), vec2(3072.0), UV);
	vec3 s = normalize(sun_dir);
	if (s.y <= -0.02) {
		COLOR = vec4(0.0, 0.0, 0.0, 1.0);
	} else {
		float hz = length(s.xz);
		vec2 d = hz > 1e-4 ? s.xz / hz : vec2(1.0, 0.0);
		float tan_sun = s.y / max(hz, 1e-4);
		float h0 = H(p) + 1.0;
		float m_all = -1e3;
		float m_far = -1e3;
		float t = 3.0;
		for (int i = 0; i < steps; i++) {
			vec2 q = p + d * t;
			if (max(abs(q.x), abs(q.y)) > 3072.0) {
				break;
			}
			float v = (H(q) - h0) / t - tan_sun;
			m_all = max(m_all, v);
			if (t > near_skip) {
				m_far = max(m_far, v);
			}
			t = t * growth + 1.5;
			if (t > max_dist) {
				break;
			}
		}
		// v is a tangent difference; ~0.02 ~ 1.1 deg penumbra (sun disc + haze)
		float soft = 0.018;
		float va = 1.0 - smoothstep(-soft, soft, m_all);
		float vf = 1.0 - smoothstep(-soft, soft, m_far);
		// the whole landscape dims as the sun touches the horizon
		float low = smoothstep(-0.02, 0.03, s.y);
		COLOR = vec4(va * low, vf * low, 0.0, 1.0);
	}
}
