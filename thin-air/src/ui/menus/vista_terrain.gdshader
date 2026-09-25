// Main-menu / loading vista terrain: a grid displaced on the GPU from an RF heightfield (TerrainData's
// height/mid/far fields, or the vista's own procedural fallback), shaded with the in-house PBR layers
// (triplanar rock/cliff, snow, scree, autumn meadow, conifer forest floor, glacier ice) from the terrain
// masks when they exist, from altitude/slope/aspect rules otherwise. Not the in-game terrain renderer.
shader_type spatial;
render_mode cull_back, depth_draw_opaque, world_vertex_coords;

uniform sampler2D height_tex : filter_nearest;
uniform vec4 hparams = vec4(-1536.0, -1536.0, 1.5, 2049.0);   // origin x, origin z, cell (m), size (texels)
uniform float normal_step = 8.0;                               // finite-difference step for normals (m)
uniform vec4 hole = vec4(0.0);                                 // centre x, centre z, half size, sink depth (hide under a finer mesh)
uniform bool has_masks = false;
uniform sampler2D mask_tex : filter_linear_mipmap, hint_default_black;    // R snow, G rock, B grass, A forest
uniform sampler2D mask2_tex : filter_linear_mipmap, hint_default_black;   // R scree, G gravel, B ice, A wet
uniform bool has_mask2 = false;
uniform vec4 mparams = vec4(-1536.0, -1536.0, 3072.0, 0.0);   // mask origin x, z, world size
uniform float snowline = 1850.0;
uniform float treeline = 2150.0;
uniform float valley_floor = 1400.0;

uniform sampler2D rock_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D cliff_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D snow_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D snow_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D forest_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D scree_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D ice_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;

varying vec3 wpos;
varying vec3 wnrm;

float h_at(vec2 xz) {
	vec2 t = (xz - hparams.xy) / hparams.z;
	t = clamp(t, vec2(0.0), vec2(hparams.w - 1.001));
	ivec2 i = ivec2(floor(t));
	vec2 f = t - vec2(i);
	float a = texelFetch(height_tex, i, 0).r;
	float b = texelFetch(height_tex, i + ivec2(1, 0), 0).r;
	float c = texelFetch(height_tex, i + ivec2(0, 1), 0).r;
	float d = texelFetch(height_tex, i + ivec2(1, 1), 0).r;
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		s += a * vnoise(p);
		p *= 2.07;
		a *= 0.5;
	}
	return s;
}

void vertex() {
	vec3 w = VERTEX;
	float h = h_at(w.xz);
	float e = normal_step;
	float hx = h_at(w.xz + vec2(e, 0.0)) - h_at(w.xz - vec2(e, 0.0));
	float hz = h_at(w.xz + vec2(0.0, e)) - h_at(w.xz - vec2(0.0, e));
	wnrm = normalize(vec3(-hx, 2.0 * e, -hz));
	if (hole.z > 0.0 && max(abs(w.x - hole.x), abs(w.z - hole.y)) < hole.z) {
		h -= hole.w;
	}
	w.y = h;
	wpos = w;
	VERTEX = w;
	NORMAL = wnrm;
}

vec3 tri(sampler2D tex, vec3 p, vec3 bw, float scale) {
	return texture(tex, p.zy * scale).rgb * bw.x + texture(tex, p.xz * scale).rgb * bw.y + texture(tex, p.xy * scale).rgb * bw.z;
}

void fragment() {
	vec3 n = normalize(wnrm);
	float slope = 1.0 - n.y;
	float dist = length(wpos - CAMERA_POSITION_WORLD);
	float big = fbm(wpos.xz * 0.0011);
	float mid = fbm(wpos.xz * 0.009);
	float fine = vnoise(wpos.xz * 0.11);
	vec3 bw = pow(abs(n), vec3(4.0));
	bw /= (bw.x + bw.y + bw.z);
	float alt = wpos.y;

	// ---- layer weights
	float snow_w;
	float rock_w;
	float grass_w;
	float forest_w;
	float scree_w = 0.0;
	float ice_w = 0.0;
	if (has_masks) {
		vec2 muv = (wpos.xz - mparams.xy) / mparams.z;
		vec4 m = texture(mask_tex, muv);
		float inside = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
		snow_w = m.r; rock_w = m.g; grass_w = m.b; forest_w = m.a;
		if (has_mask2) {
			vec4 m2 = texture(mask2_tex, muv);
			scree_w = m2.r * inside;
			ice_w = m2.b * inside;
		}
		if (inside < 0.5) {
			snow_w = -1.0;   // outside the mapped world: fall through to the rules below
		}
	} else {
		snow_w = -1.0;
		rock_w = 0.0; grass_w = 0.0; forest_w = 0.0;
	}
	if (snow_w < 0.0) {
		// rules: snow above a noisy snowline that steep rock sheds, forest in the montane band, meadow below
		float line = snowline + 260.0 * (big - 0.5);
		float hold = 1.0 - smoothstep(0.32, 0.5, slope + 0.15 * (mid - 0.5));
		snow_w = smoothstep(line - 120.0, line + 140.0, alt) * hold;
		snow_w = max(snow_w, smoothstep(0.62, 0.9, mid + 0.25) * 0.55 * hold * step(valley_floor + 60.0, alt));   // dusting
		rock_w = smoothstep(0.28, 0.45, slope + 0.12 * (mid - 0.5));
		forest_w = (1.0 - smoothstep(treeline - 180.0, treeline + 60.0, alt + 120.0 * (big - 0.5)))
			* smoothstep(valley_floor - 40.0, valley_floor + 60.0, alt) * (1.0 - rock_w) * smoothstep(0.35, 0.55, big + 0.3 * mid);
		grass_w = 1.0;
		ice_w = smoothstep(line + 500.0, line + 700.0, alt) * (1.0 - smoothstep(0.12, 0.3, slope)) * 0.8;
	}

	// ---- albedos
	float s_rock = 1.0 / 7.0;
	vec3 rock = tri(rock_albedo, wpos, bw, s_rock);
	vec3 cliff = tri(cliff_albedo, wpos, bw, 1.0 / 19.0);
	rock = mix(rock, cliff, smoothstep(0.5, 0.75, slope)) * (0.72 + 0.5 * big) * (0.9 + 0.2 * mid);
	vec3 snow = texture(snow_albedo, wpos.xz / 5.0).rgb * vec3(0.97, 0.985, 1.0);
	vec3 grass = texture(grass_albedo, wpos.xz / 6.0).rgb;
	// late-October meadows: cured, tawny
	grass = mix(grass, vec3(0.30, 0.24, 0.13), 0.45) * (0.8 + 0.35 * mid);
	vec3 forest = texture(forest_albedo, wpos.xz / 6.0).rgb * 0.55;
	// canopy seen from afar: very dark blue-green, broken by snow-dusted crowns and larch gold at the top of the band
	float larch = smoothstep(treeline - 380.0, treeline - 120.0, alt) * smoothstep(0.55, 0.75, fbm(wpos.xz * 0.02));
	vec3 canopy = mix(vec3(0.035, 0.05, 0.04), vec3(0.06, 0.075, 0.05), fine);
	canopy = mix(canopy, vec3(0.42, 0.27, 0.07), larch * 0.75);
	forest = mix(forest, canopy, smoothstep(40.0, 400.0, dist) * 0.85 + 0.15);
	vec3 scree = texture(scree_albedo, wpos.xz / 6.0).rgb;
	vec3 ice = texture(ice_albedo, wpos.xz / 12.0).rgb * vec3(0.9, 0.97, 1.05);

	vec3 base = grass;
	base = mix(base, forest, clamp(forest_w, 0.0, 1.0));
	base = mix(base, scree, clamp(scree_w, 0.0, 1.0));
	base = mix(base, rock, clamp(rock_w, 0.0, 1.0));
	base = mix(base, ice, clamp(ice_w, 0.0, 1.0));
	float sw = clamp(snow_w + (fine - 0.5) * 0.15, 0.0, 1.0);
	base = mix(base, snow, sw);
	// distant forest reads as a dark texture of trees, even under a dusting
	ALBEDO = base;
	ROUGHNESS = mix(0.9, 0.55, sw);
	SPECULAR = 0.35 + 0.15 * sw;

	// ---- detail normal (near only)
	float near = 1.0 - smoothstep(250.0, 900.0, dist);
	if (near > 0.0) {
		vec3 nm_r = texture(rock_normal, (bw.x > bw.z ? wpos.zy : wpos.xy) * s_rock).rgb;
		vec3 nm_s = texture(snow_normal, wpos.xz / 5.0).rgb;
		vec3 nm = mix(nm_r, nm_s, sw);
		NORMAL_MAP = mix(vec3(0.5, 0.5, 1.0), nm, near);
	}
}
