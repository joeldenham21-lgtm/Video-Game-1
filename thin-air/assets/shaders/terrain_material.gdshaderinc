// THIN AIR — terrain surface material (fragment + light). Included after terrain_common.gdshaderinc.
// Define TERRAIN_MOBILE for the cheaper path (2 blended layers, single-projection cliffs, shorter detail range).
//
// Layers (assets/textures/terrain/layers.json): 0 snow, 1 rock, 2 cliff, 3 scree, 4 gravel, 5 grass,
// 6 forest, 7 dirt, 8 ice. Base material = best layers by (mask weight + texture height) — height blending, so
// scree fills between rocks and grass grows between stones instead of a linear cross-fade. Snow is an overlay that
// fills low spots first. Beyond `detail_far` no textures are fetched: layer average colours + macro variation, so
// no tiling is visible from kilometres away. Sun light is attenuated by the heightfield sun-shadow texture
// (terrain_shadow_tex) so whole faces fall into shadow at golden hour beyond the shadow-map distance.

uniform sampler2DArray layer_ah : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray layer_nr : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D macro_noise : filter_linear_mipmap, repeat_enable;
uniform sampler2D detail_tex : filter_linear_mipmap, repeat_disable;
global uniform sampler2D terrain_normal_tex : filter_linear_mipmap, repeat_disable;
global uniform sampler2D terrain_mask_tex : filter_linear_mipmap, repeat_disable;
global uniform sampler2D terrain_mask2_tex : filter_linear_mipmap, repeat_disable;
global uniform sampler2D terrain_shadow_tex : filter_linear, repeat_disable;
global uniform vec4 terrain_shadow_params;
global uniform float snow_cover;
global uniform float wetness;

uniform vec3 layer_avg[9];
uniform float layer_rough[9];
uniform float layer_tiling[9];
uniform float shadow_distance = 110.0;
uniform float detail_far = 360.0;
uniform float fog_density = 0.0;
uniform vec3 fog_col = vec3(0.6, 0.65, 0.72);
uniform int debug_view = 0;             // dev: 1 masks, 2 normal, 3 lod weights, 4 masks2

const float PI_T = 3.14159265;

vec2 layer_uv(vec2 p, int i) {
	// per-layer rotation + offset so layer seams never line up
	float a = float(i) * 1.1 + 0.4;
	mat2 r = mat2(vec2(cos(a), sin(a)), vec2(-sin(a), cos(a)));
	return r * p / layer_tiling[i] + vec2(float(i) * 0.37, float(i) * 0.61);
}

// whiteout-blended tangent normal (OpenGL Y+) from a planar projection
vec3 unpack_n(vec4 nr) {
	vec3 n = nr.rgb * 2.0 - 1.0;
	n.z = sqrt(max(1.0 - dot(n.xy, n.xy), 0.0));
	return n;
}

struct Samp {
	vec3 albedo;
	float height;
	vec3 nrm;        // world
	float rough;
};

// Biplanar projection on steep ground (X and Z planes, image-up = world-up), so cliff strata, snow and scree
// are never smeared down a face. Height-aware weights: where both projections overlap (faces at ~45 deg to
// the axes) the taller texel wins instead of a ghosted double image.
Samp sample_side(int i, vec3 wp, vec3 N, float tiling, vec2 ofs, float nstr) {
	Samp s;
	vec3 an = abs(N);
	vec2 uvx = vec2(wp.z, -wp.y) / tiling + vec2(0.31, 0.17) + ofs;
	vec2 uvz = vec2(wp.x, -wp.y) / tiling + ofs;
	vec4 ax = texture(layer_ah, vec3(uvx, float(i)));
	vec4 az = texture(layer_ah, vec3(uvz, float(i)));
	vec4 nx = texture(layer_nr, vec3(uvx, float(i)));
	vec4 nz = texture(layer_nr, vec3(uvz, float(i)));
	vec2 wgt = pow(an.xz, vec2(4.0)) * (vec2(ax.a, az.a) + 0.3);
	wgt /= max(wgt.x + wgt.y, 1e-4);
	wgt = wgt * wgt;
	wgt /= max(wgt.x + wgt.y, 1e-4);
	vec3 tx = unpack_n(nx);
	vec3 tz = unpack_n(nz);
	tx.xy *= nstr;
	tz.xy *= nstr;
	vec3 wx = vec3(abs(tx.z) * N.x, tx.y + N.y, tx.x + N.z);
	vec3 wz = vec3(tz.x + N.x, tz.y + N.y, abs(tz.z) * N.z);
	s.albedo = ax.rgb * wgt.x + az.rgb * wgt.y;
	s.height = ax.a * wgt.x + az.a * wgt.y;
	s.nrm = normalize(wx * wgt.x + wz * wgt.y);
	s.rough = nx.a * wgt.x + nz.a * wgt.y;
	return s;
}

// anti: 0..1 weight of a second, rotated fetch at 3.7x the tile size (breaks the repeat; driven by distance
// and by macro noise so near patches alternate too). Its tangent normal is rotated back into the first frame.
Samp sample_layer(int i, vec3 wp, vec3 N, float far_w, bool side, float anti) {
	Samp s;
	if (side) {
		return sample_side(i, wp, N, layer_tiling[i], vec2(0.0), mix(1.0, 0.45, far_w));
	}
	vec2 uv = layer_uv(vec2(wp.x, -wp.z), i);
	vec4 ah = texture(layer_ah, vec3(uv, float(i)));
	vec4 nr = texture(layer_nr, vec3(uv, float(i)));
	vec3 t = unpack_n(nr);
#ifndef TERRAIN_MOBILE
	if (anti > 0.02) {
		mat2 rot = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8));
		vec2 uv2 = rot * uv / 3.7 + vec2(0.37, 0.71);
		vec4 ah2 = texture(layer_ah, vec3(uv2, float(i)));
		vec4 nr2 = texture(layer_nr, vec3(uv2, float(i)));
		vec3 t2 = unpack_n(nr2);
		t2.xy = transpose(rot) * t2.xy;
		ah = mix(ah, ah2, anti);
		nr.a = mix(nr.a, nr2.a, anti);
		t = normalize(mix(t, t2, anti));
	}
#endif
	t.xy *= mix(1.0, 0.45, far_w);
	// undo layer_uv's rotation: texture u-axis / image-up expressed in p = (x, -z) space
	float a = float(i) * 1.1 + 0.4;
	float ca = cos(a);
	float sa = sin(a);
	vec2 q = vec2(ca * t.x - sa * t.y, -sa * t.x - ca * t.y);
	vec3 w = vec3(q.x + N.x, abs(t.z) * N.y, -q.y + N.z);
	s.albedo = ah.rgb;
	s.height = ah.a;
	s.nrm = normalize(w);
	s.rough = nr.a;
	return s;
}

void terrain_fragment(in vec3 vtx_view, in mat4 view_matrix, in vec3 world, in vec3 vnormal, in float true_dist,
		out vec3 albedo, out vec3 nrm_view, out float rough, out float ao, out vec3 emission, out float spec,
		out float sunshadow, out float spec_scale) {
	vec3 wp = world;
	float dist = true_dist;
	float m_edge = max(abs(wp.x), abs(wp.z));
	float in_map = 1.0 - smoothstep(1520.0, 1536.0, m_edge);
	vec2 fuv = ((wp.xz + 1536.0) / 1.5 + 0.5) / 2049.0;
	vec2 muv = ((wp.xz + 1536.0) / 3.0 + 0.5) / 1025.0;
	vec3 N = normalize(vnormal);
	vec4 m = vec4(0.0);
	vec4 m2 = vec4(0.0);
	vec4 det = vec4(0.0);
	ao = 1.0;
	float alt = wp.y;
	if (in_map > 0.0) {
		vec4 nt = texture(terrain_normal_tex, fuv);
		N = normalize(mix(N, nt.rgb * 2.0 - 1.0, in_map));
		ao = mix(1.0, nt.a, in_map);
		m = texture(terrain_mask_tex, muv);
		m2 = texture(terrain_mask2_tex, muv);
		det = texture(detail_tex, fuv);
	}
	float steep = 1.0 - N.y;
	float north = clamp(-N.z / max(length(N.xz), 1e-3), -1.0, 1.0) * clamp(length(N.xz) * 3.0, 0.0, 1.0);
	vec3 mn = texture(macro_noise, wp.xz / 256.0).rgb;
	vec3 mnf = texture(macro_noise, wp.xz / 2300.0 + vec2(0.37, 0.11)).rgb;
	if (in_map < 1.0) {
		// procedural masks for the surrounding range (same rules the generator used)
		float line = 1800.0 - 150.0 * north + 120.0 * (mnf.r - 0.5);
		float sn = smoothstep(line - 120.0, line + 200.0, alt) * (1.0 - smoothstep(0.42, 0.62, steep));
		float rk = smoothstep(0.22, 0.42, steep) + smoothstep(2500.0, 2900.0, alt) * 0.3;
		float fo = (1.0 - smoothstep(1950.0, 2150.0, alt - 60.0 * north)) * (1.0 - smoothstep(0.18, 0.3, steep)) *
			smoothstep(0.35, 0.55, mn.g);
		float gr = (1.0 - smoothstep(2300.0, 2500.0, alt)) * (1.0 - fo) * (1.0 - smoothstep(0.2, 0.35, steep));
		float sc = smoothstep(2150.0, 2450.0, alt) * (1.0 - rk) * (1.0 - sn);
		vec4 pm = vec4(clamp(sn, 0.0, 1.0), clamp(rk, 0.0, 1.0), clamp(gr, 0.0, 1.0), clamp(fo, 0.0, 1.0));
		vec4 pm2 = vec4(clamp(sc, 0.0, 1.0), 0.0, 0.0, 0.0);
		m = mix(pm, m, in_map);
		m2 = mix(pm2, m2, in_map);
	}
	// face-scale steepness (normal map ~4 mips down = ~12-24 m): a ledge on a cliff is still part of a face
	vec3 Nc = N;
	if (in_map > 0.0) {
		Nc = normalize(mix(N, textureLod(terrain_normal_tex, fuv, 3.5).rgb * 2.0 - 1.0, in_map));
	}
	float face = smoothstep(0.24, 0.42, 1.0 - Nc.y);
	// fine macro noise (19 m / 7 m): anti-tiling weights, snow-edge and ledge-dusting breakup
	vec3 mh = texture(macro_noise, wp.xz / 19.0 + vec2(0.13, 0.57)).rgb;
	// fresh snow dusting from the weather (upward-facing, thinner in the valley); on faces it only sticks in
	// broken patches on ledges, never as a continuous band along every stratum
	float dust = snow_cover * smoothstep(0.6, 0.9, N.y) * mix(0.55, 1.0, smoothstep(1350.0, 1700.0, alt)) *
		(1.0 - m.a * 0.35) * (1.0 - m2.a * 0.9);
	dust *= mix(1.0, smoothstep(0.42, 0.62, mh.g * 0.7 + mn.r * 0.3), face);
	float snow_w = clamp(max(m.r, dust) + (mn.b - 0.5) * 0.12, 0.0, 1.0);

	float w[9];
	float sl = smoothstep(0.30, 0.52, steep);
	w[0] = 0.0;
	w[1] = m.g * (1.0 - sl);
	w[2] = m.g * sl + smoothstep(0.55, 0.75, steep) * 0.6 * (1.0 - m2.b);   // steep glacier ice stays ice (icefall)
	w[3] = m2.r;
	w[4] = m2.g;
	w[5] = m.b;
	w[6] = m.a;
	w[7] = det.r * 1.3 + 0.04;
	w[8] = m2.b;
	// far colour: every layer's average (no texture fetch)
	float wsum = 0.0;
	vec3 far_alb = vec3(0.0);
	float far_r = 0.0;
	for (int i = 1; i < 9; i++) {
		wsum += w[i];
		far_alb += layer_avg[i] * w[i];
		far_r += layer_rough[i] * w[i];
	}
	far_alb /= max(wsum, 1e-4);
	far_r /= max(wsum, 1e-4);
	float base_h = 0.35;
	vec3 base_alb = far_alb;
	float base_r = far_r;
	vec3 Nd = N;
	float tex_w = 1.0 - smoothstep(detail_far * 0.6, detail_far, dist);
	float far_w = smoothstep(12.0, 70.0, dist);
	// second-fetch weight: distance (the documented 1/3.7 rotated fetch) + macro-noise patches near the camera
	float anti = clamp(far_w * 0.4 + smoothstep(0.35, 0.75, mh.r) * 0.45, 0.0, 0.8);
	bool side = steep > 0.28;
	if (tex_w > 0.001) {
		// pick the strongest layers
		int i0 = 1;
		int i1 = 1;
		int i2 = 1;
		float b0 = -1.0;
		float b1 = -1.0;
		float b2 = -1.0;
		for (int i = 1; i < 9; i++) {
			float v = w[i];
			if (v > b0) {
				b2 = b1; i2 = i1; b1 = b0; i1 = i0; b0 = v; i0 = i;
			} else if (v > b1) {
				b2 = b1; i2 = i1; b1 = v; i1 = i;
			} else if (v > b2) {
				b2 = v; i2 = i;
			}
		}
#ifdef TERRAIN_MOBILE
		b2 = -1.0;
		// mobile: biplanar only for the rock layers (the ones that cover real faces)
		Samp s0 = sample_layer(i0, wp, N, far_w, side && (i0 == 1 || i0 == 2), 0.0);
		Samp s1 = s0;
		Samp s2 = s0;
		if (b1 > 0.02) {
			s1 = sample_layer(i1, wp, N, far_w, side && (i1 == 1 || i1 == 2), 0.0);
		}
#else
		// desktop: every layer is biplanar on steep ground (no stretched scree / grass / dirt on 40-60 deg)
		Samp s0 = sample_layer(i0, wp, N, far_w, side, anti);
		Samp s1 = s0;
		Samp s2 = s0;
		if (b1 > 0.02) {
			s1 = sample_layer(i1, wp, N, far_w, side, anti);
		}
		if (b2 > 0.02) {
			s2 = sample_layer(i2, wp, N, far_w, side, anti);
		}
#endif
		// height-based blend: the layer whose texture stands higher wins (grass between stones, scree
		// filling cracks) - a narrow transition band keeps the boundary crisp at any distance
		float depth = 0.12;
		float h0 = s0.height * 0.6 + b0;
		float h1 = b1 > 0.02 ? s1.height * 0.6 + b1 : -9.0;
		float h2 = b2 > 0.02 ? s2.height * 0.6 + b2 : -9.0;
		float hm = max(h0, max(h1, h2));
		float c0 = max(h0 - hm + depth, 0.0);
		float c1 = max(h1 - hm + depth, 0.0);
		float c2 = max(h2 - hm + depth, 0.0);
		float cs = max(c0 + c1 + c2, 1e-4);
		c0 /= cs;
		c1 /= cs;
		c2 /= cs;
		vec3 ta = s0.albedo * c0 + s1.albedo * c1 + s2.albedo * c2;
		float th = s0.height * c0 + s1.height * c1 + s2.height * c2;
		vec3 tn = normalize(s0.nrm * c0 + s1.nrm * c1 + s2.nrm * c2);
		float tr = s0.rough * c0 + s1.rough * c1 + s2.rough * c2;
		base_alb = mix(far_alb, ta, tex_w);
		base_h = mix(0.35, th, tex_w);
		Nd = normalize(mix(N, tn, tex_w));
		base_r = mix(far_r, tr, tex_w);
	}
	// rock colour: strata bands and a little warmth/greyness variation (lichen, oxidation)
	float rockness = clamp((w[1] + w[2]) / max(wsum, 1e-4), 0.0, 1.0);
	vec3 band = mix(vec3(0.9, 0.9, 0.92), vec3(1.1, 1.04, 0.95), det.g);
	base_alb *= mix(vec3(1.0), band, rockness * in_map);
	// macro rock: the cliff layer re-projected (biplanar) at ~37 m and ~150 m - joints, blocks, buttress-scale
	// light/dark and a macro normal - so faces stay rocky and crisp from 30 m to kilometres (beyond the
	// texture range too, where the base is only a flat average colour)
	float mr_w = max(rockness, face * 0.7) * smoothstep(10.0, 45.0, dist) * (1.0 - smoothstep(3000.0, 5000.0, dist));
	float mr_h = 0.5;
	if (mr_w > 0.01) {
		float t1 = layer_tiling[2] * 4.6;
		float lum_avg = max(dot(layer_avg[2], vec3(0.3, 0.59, 0.11)), 1e-3);
#ifdef TERRAIN_MOBILE
		Samp mr = sample_side(2, wp, N, t1, vec2(0.53, 0.29), 1.8);
		float lum = dot(mr.albedo, vec3(0.3, 0.59, 0.11)) / lum_avg;
#else
		Samp mr = sample_side(2, wp, N, t1, vec2(0.53, 0.29), 1.8);
		Samp mr2 = sample_side(2, wp, N, t1 * 4.1, vec2(0.21, 0.83), 1.4);
		float lum = dot(mr.albedo, vec3(0.3, 0.59, 0.11)) / lum_avg;
		lum *= mix(1.0, dot(mr2.albedo, vec3(0.3, 0.59, 0.11)) / lum_avg, 0.5 * smoothstep(80.0, 400.0, dist));
		mr.nrm = normalize(mix(mr.nrm, mr2.nrm, 0.4 * smoothstep(100.0, 600.0, dist)));
#endif
		mr_h = mr.height;
		base_alb *= mix(1.0, clamp(pow(lum, 1.25), 0.4, 2.0), mr_w * 0.85);
		Nd = normalize(mix(Nd, normalize(Nd + (mr.nrm - N) * 1.2), mr_w * 0.8));
	}
	// rock faces: dark water / lichen streaks running down the fall line, weathering patches (warm iron
	// stains, grey-green lichen), so walls read as rock at any distance instead of plaster
	if (rockness > 0.01) {
		vec2 hz = N.xz;
		float hl = length(hz);
		vec2 along = hl > 1e-3 ? vec2(-hz.y, hz.x) / hl : vec2(1.0, 0.0);
		float u_face = dot(wp.xz, along);
		vec3 sn1 = texture(macro_noise, vec2(u_face / 23.0, wp.y / 260.0)).rgb;
		vec3 sn2 = texture(macro_noise, vec2(u_face / 7.0 + 0.31, wp.y / 90.0)).rgb;
		float streak = smoothstep(0.45, 0.8, sn1.r) * 0.55 + smoothstep(0.5, 0.85, sn2.g) * 0.3;
		float facek = smoothstep(0.35, 0.6, steep);
		vec3 stain = mix(vec3(1.0), vec3(1.08, 0.97, 0.86), smoothstep(0.55, 0.8, mnf.g));
		vec3 lichen = mix(vec3(1.0), vec3(0.9, 0.95, 0.88), smoothstep(0.5, 0.75, mn.r));
		vec3 rock_mod = (1.0 - streak * facek * 0.55) * stain * lichen * mix(1.0, 0.82, facek);
		base_alb *= mix(vec3(1.0), rock_mod, rockness);
	}
	// macro variation: breaks up any remaining repetition near and far
	float v_near = dot(mn - 0.5, vec3(0.5, 0.3, 0.2)) * 2.0;
	float v_far = dot(mnf - 0.5, vec3(0.6, 0.3, 0.1)) * 2.0;
	base_alb *= 1.0 + v_near * 0.28 + v_far * 0.22 + (mh.b - 0.5) * 0.12;
	// crevasses: deep blue-grey shade in the cracks
	base_alb = mix(base_alb, vec3(0.10, 0.20, 0.26), clamp(det.b * 0.85, 0.0, 1.0) * in_map);
	// under a mostly-snowy cover the ground texture must not print through as a tiled pattern (grass tufts
	// read as dark stars on white): flatten its height relief and pull its colour toward the layer mix average
	float snowy = smoothstep(0.2, 0.7, snow_w) * (1.0 - rockness * 0.6);
	base_h = mix(base_h, 0.35 + (base_h - 0.35) * 0.15, snowy);
	base_alb = mix(base_alb, far_alb * (1.0 + v_near * 0.25), snowy * 0.8);

	// snow overlay: fills hollows first, thin on bumps; on rock faces it lodges in the low parts of the
	// macro rock (cracks, ledges) with a noisy, non-repeating edge
	vec3 snow_alb = layer_avg[0];
	float snow_r = layer_rough[0];
	vec3 snow_n = N;
	if (snow_w > 0.01 && tex_w > 0.001) {
#ifdef TERRAIN_MOBILE
		Samp ss = sample_layer(0, wp, N, far_w, side, 0.0);
#else
		Samp ss = sample_layer(0, wp, N, far_w, side, anti);
#endif
		snow_alb = mix(snow_alb, ss.albedo, tex_w);
		snow_r = mix(snow_r, ss.rough, tex_w);
		snow_n = normalize(mix(N, ss.nrm, tex_w * 0.8));
	}
	float edge_n = (mh.g - 0.5) * 0.22 + (texture(macro_noise, wp.xz / 4.3 + vec2(0.7, 0.2)).r - 0.5) * 0.18;
	float cover = clamp((snow_w * 1.35 - base_h * 0.45 - 0.1 + edge_n - (mr_h - 0.5) * 0.6 * face) * 3.5, 0.0, 1.0);
	cover = mix(cover, snow_w, 1.0 - tex_w);       // far: plain coverage
	albedo = mix(base_alb, snow_alb * (1.0 + v_far * 0.05), cover);
	rough = mix(base_r, snow_r, cover);
	vec3 Nw = normalize(mix(Nd, snow_n, cover));

	// wetness: shores, seeps, rain
	float wet = clamp(max(m2.a * (1.0 - cover), wetness * (1.0 - cover) * 0.8), 0.0, 1.0);
	albedo *= mix(1.0, 0.55, wet);
	rough = mix(rough, 0.18, wet * 0.8);

	// heightfield sun shadow (beyond the shadow-map range: the far terms, near: only far occluders)
	float sh = 1.0;
	if (terrain_shadow_params.w > 0.5) {
		vec2 suv = (wp.xz - terrain_shadow_params.xy) / terrain_shadow_params.z;
		if (suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0) {
			vec2 t = texture(terrain_shadow_tex, suv).rg;
			float fade = smoothstep(shadow_distance * 0.55, shadow_distance * 0.95, dist);
			sh = mix(t.g, t.r, fade);
		}
	}
	sunshadow = sh;

	// fog missing from compressed (beyond camera far) geometry
	float d_comp = length(vtx_view);
	float e = 1.0 - exp(-fog_density * max(dist - d_comp, 0.0));
	albedo *= 1.0 - e;
	emission = fog_col * e;
	spec_scale = 1.0 - e;
	spec = 0.5 * (1.0 - e);
	nrm_view = normalize((view_matrix * vec4(Nw, 0.0)).xyz);
	if (debug_view == 1) {
		albedo = m.rgb;
	} else if (debug_view == 2) {
		albedo = N * 0.5 + 0.5;
	} else if (debug_view == 3) {
		albedo = vec3(tex_w, far_w, in_map);
	} else if (debug_view == 4) {
		albedo = m2.rgb;
	} else if (debug_view == 5) {
		albedo = vec3(fract(wp.y / 500.0), fract(wp.y / 100.0) * 0.3, step(1536.0, m_edge));
	}
}

void terrain_light(vec3 N, vec3 L, vec3 V, vec3 light_color, float attenuation, bool directional, float roughness,
		float sunshadow, float spec_scale, inout vec3 diffuse_light, inout vec3 specular_light) {
	float att = attenuation;
	if (directional) {
		att *= sunshadow;
	}
	float ndl = clamp(dot(N, L), 0.0, 1.0);
	if (ndl <= 0.0 || att <= 0.0) {
		return;
	}
	vec3 H = normalize(V + L);
	float ndv = max(dot(N, V), 1e-4);
	float ldh = clamp(dot(L, H), 0.0, 1.0);
	float ndh = clamp(dot(N, H), 0.0, 1.0);
	float r = clamp(roughness, 0.05, 1.0);
	float fd90 = 0.5 + 2.0 * ldh * ldh * r;
	float fl = 1.0 + (fd90 - 1.0) * pow(1.0 - ndl, 5.0);
	float fv = 1.0 + (fd90 - 1.0) * pow(1.0 - ndv, 5.0);
	diffuse_light += light_color * att * (fl * fv * ndl / PI_T);
	float a = r * r;
	float a2 = a * a;
	float dd = ndh * ndh * (a2 - 1.0) + 1.0;
	float D = a2 / (PI_T * dd * dd);
	float k = a * 0.5;
	float vis = 0.25 / ((ndl * (1.0 - k) + k) * (ndv * (1.0 - k) + k));
	float F = 0.04 + 0.96 * pow(1.0 - ldh, 5.0);
	specular_light += light_color * att * ndl * D * vis * F * spec_scale;
}
