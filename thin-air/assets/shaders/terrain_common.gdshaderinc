// THIN AIR — terrain clipmap shader core (included by terrain.gdshader / terrain_mobile.gdshader /
// terrain_shadowcaster.gdshader). Owned by the terrain stream (src/world/terrain.gd).
//
// Geometry: nested clipmap levels of flat grid meshes placed by terrain.gd (MODEL_MATRIX = translation to the
// level's snapped grid + scale by the level spacing). The vertex stage fetches heights (map 1.5 m / MID 6 m /
// FAR 48 m / procedural distant ranges), geomorphs odd vertices toward the coarser level near the level's outer
// edge (crack- and pop-free), and compresses geometry beyond the camera far plane radially toward the camera so
// the whole range (to ~50 km) renders whatever view distance the camera uses; the missing fog of compressed
// fragments is added back in fragment().

uniform sampler2D map_height_tex : filter_nearest, repeat_disable;
global uniform vec4 terrain_params;
uniform sampler2D mid_height_tex : filter_nearest, repeat_disable;
uniform sampler2D far_height_tex : filter_nearest, repeat_disable;

uniform float lvl_scale = 1.5;          // grid spacing of this level (m)
uniform vec4 lvl_hole = vec4(-1e9, -1e9, 1e9, 1e9);   // x0,z0,x1,z1 of the next coarser level's hole (morph edge)
uniform float lvl_morph = 20.0;         // morph band width (m)
uniform vec3 main_cam_pos;              // main camera (compression centre; also valid in shadow passes)
uniform vec4 compress = vec4(1e9, 1e9, 1e9, 1.0);    // start, end, dmax, k

varying vec3 v_world;                   // true (uncompressed) world position
varying vec3 v_vnormal;                 // vertex normal (used outside the map where there is no normal texture)
varying float v_true_dist;
varying float v_sunshadow;              // fragment -> light: heightfield sun visibility
varying float v_spec_scale;             // fragment -> light: fog compensation for compressed geometry

float tfetch(sampler2D t, ivec2 i, int n) {
	return texelFetch(t, clamp(i, ivec2(0), ivec2(n - 1)), 0).r;
}

float bilin_h(sampler2D t, int n, float origin, float cell, vec2 p) {
	vec2 g = clamp((p - vec2(origin)) / cell, vec2(0.0), vec2(float(n) - 1.001));
	ivec2 i = ivec2(floor(g));
	vec2 f = g - vec2(i);
	float a = tfetch(t, i, n);
	float b = tfetch(t, i + ivec2(1, 0), n);
	float c = tfetch(t, i + ivec2(0, 1), n);
	float d = tfetch(t, i + ivec2(1, 1), n);
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// cheap value noise for the procedural distant ranges beyond the FAR data
float vhash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(vhash(i), vhash(i + vec2(1, 0)), u.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), u.x), u.y);
}
float distant_ranges(vec2 p) {
	float h = 0.0;
	float a = 1.0;
	vec2 q = p / 5200.0;
	for (int i = 0; i < 5; i++) {
		float n = 1.0 - abs(vnoise(q) * 2.0 - 1.0);
		h += n * n * a;
		a *= 0.5;
		q = mat2(vec2(1.6, 1.2), vec2(-1.2, 1.6)) * q;
	}
	return 350.0 + h * 1650.0;
}

float terrain_h(vec2 p) {
	float m = max(abs(p.x), abs(p.y));
	if (m <= 1536.0) {
		return bilin_h(map_height_tex, 2049, -1536.0, 1.5, p);
	}
	if (m <= 3072.0) {
		return bilin_h(mid_height_tex, 1025, -3072.0, 6.0, p);
	}
	float hf = bilin_h(far_height_tex, 1025, -24576.0, 48.0, p);
	float t = smoothstep(21000.0, 24500.0, m);
	return mix(hf, distant_ranges(p), t);
}

void terrain_vertex(inout vec3 vtx, inout vec3 nrm, out vec3 world, out vec3 vnormal, out float true_dist) {
	vec2 p = vtx.xz;
	float s = lvl_scale;
	vec2 g = round(p / s);
	p = g * s;                                   // exact grid position
	vec2 odd = mod(g, 2.0);
	float zf = terrain_h(p);
	float zc = zf;
	if (odd.x > 0.5 && odd.y > 0.5) {
		zc = 0.5 * (terrain_h(p - vec2(s)) + terrain_h(p + vec2(s)));
	} else if (odd.x > 0.5) {
		zc = 0.5 * (terrain_h(p - vec2(s, 0.0)) + terrain_h(p + vec2(s, 0.0)));
	} else if (odd.y > 0.5) {
		zc = 0.5 * (terrain_h(p - vec2(0.0, s)) + terrain_h(p + vec2(0.0, s)));
	}
	float edge = min(min(p.x - lvl_hole.x, lvl_hole.z - p.x), min(p.y - lvl_hole.y, lvl_hole.w - p.y));
	float a = 1.0 - smoothstep(0.0, lvl_morph, edge);
	float h = mix(zf, zc, a);
	vec3 wp = vec3(p.x, h, p.y);
	world = wp;
	// vertex normal from central differences — only needed outside the map (the map has a normal texture)
	float m = max(abs(p.x), abs(p.y));
	vnormal = vec3(0.0, 1.0, 0.0);
	if (m > 1500.0) {
		float e = max(s, m > 3072.0 ? 48.0 : 6.0);
		float hl = terrain_h(p - vec2(e, 0.0));
		float hr = terrain_h(p + vec2(e, 0.0));
		float hd = terrain_h(p - vec2(0.0, e));
		float hu = terrain_h(p + vec2(0.0, e));
		vnormal = normalize(vec3(hl - hr, 2.0 * e, hd - hu));
	}
	nrm = vnormal;
	vec3 dv = wp - main_cam_pos;
	float d = length(dv);
	true_dist = d;
	if (d > compress.x) {
		float u = min((d - compress.x) / (compress.z - compress.x), 1.0);
		float dd = compress.x + (compress.y - compress.x) * log(1.0 + compress.w * u) / log(1.0 + compress.w);
		wp = main_cam_pos + dv * (dd / d);
	}
	vtx = wp;
}
