// THIN AIR — shared water shading (included by water_lake*.gdshader / water_river.gdshader). Water stream.
//
// Lighting model (render_mode blend_premul_alpha): the surface pixel is
//     F·reflection + (1−F)·[T·background + (1−T)·in-scattered body colour]
// Godot adds the specular (sky radiance + sun/moon glints, SPECULAR tuned to water's F0 = 0.02) unscaled,
// the diffuse "body" term is pre-weighted into ALBEDO by (1−F)(1−T), and the blend keeps (1−ALPHA) of
// what is behind, with ALPHA = 1 − (1−F)·T. Depth comes from the terrain heightfield global (no depth
// texture needed, so the Mobile renderer gets the same look); T is the transmittance along the view path.

global uniform sampler2D terrain_height_tex : filter_nearest, repeat_disable;
global uniform sampler2D terrain_normal_tex : filter_linear_mipmap, repeat_disable;
global uniform sampler2D terrain_mask_tex : filter_linear_mipmap, repeat_disable;
global uniform vec4 terrain_params;          // origin x, origin z, world size, cell
global uniform vec3 wind_direction;
global uniform float wind_strength;
global uniform vec3 sun_direction;
global uniform vec4 fog_color;

uniform sampler2D ripple_a : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D ripple_b : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D foam_tex : hint_default_black, filter_linear_mipmap, repeat_enable;

// water optics (per metre): milky glacial "rock flour" water — red dies in a metre, green/blue carry a few
uniform vec3 extinction = vec3(0.6, 0.24, 0.23);
uniform vec3 body_albedo : source_color = vec3(0.05, 0.31, 0.29);  // diffuse reflectance of deep water
// light for the heightfield "reflection" of the surrounding range (set every frame by water.gd)
uniform vec3 refl_sun = vec3(1.0);            // sun/moon colour × energy
uniform vec3 refl_amb = vec3(0.3, 0.35, 0.4); // sky ambient
uniform float refl_terrain = 1.0;             // 0 disables the heightfield reflection march
uniform float night = 0.0;                    // 0 day .. 1 night (star glints)
uniform float star_glint = 0.05;

const float WATER_SPEC = 0.354;               // Godot F0 = 0.16·s² → 0.02 (water)

float w_hash(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Terrain height at a world xz — manual bilinear over the RF heightfield (no filtering on float textures on
// some mobile GPUs).
float bed_height(vec2 xz) {
	vec2 g = clamp((xz - terrain_params.xy) / terrain_params.w, vec2(0.0), vec2(textureSize(terrain_height_tex, 0)) - 1.001);
	ivec2 i = ivec2(floor(g));
	vec2 f = g - vec2(i);
	float a = texelFetch(terrain_height_tex, i, 0).r;
	float b = texelFetch(terrain_height_tex, i + ivec2(1, 0), 0).r;
	float c = texelFetch(terrain_height_tex, i + ivec2(0, 1), 0).r;
	float d = texelFetch(terrain_height_tex, i + ivec2(1, 1), 0).r;
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float bed_height_fast(vec2 xz) {
	vec2 g = clamp((xz - terrain_params.xy) / terrain_params.w, vec2(0.0), vec2(textureSize(terrain_height_tex, 0)) - 1.0);
	return texelFetch(terrain_height_tex, ivec2(g + 0.5), 0).r;
}

vec2 terrain_uv(vec2 xz) {
	return (xz - terrain_params.xy) / terrain_params.z;
}

// Tangent-space normal from an RG(B) normal map (BC5/RGTC safe: Z is rebuilt).
vec3 nmap(sampler2D t, vec2 uv) {
	vec2 xy = texture(t, uv).rg * 2.0 - 1.0;
	return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
}

// Tangent (u = +X, v = +Z) normal → world normal for a horizontal surface.
vec3 ts_to_world(vec3 n) {
	return normalize(vec3(n.x, n.z, -n.y));
}

float fresnel_water(float ndv) {
	float m = 1.0 - clamp(ndv, 0.0, 1.0);
	float m2 = m * m;
	return 0.02 + 0.98 * m2 * m2 * m;
}

// Colour of the range seen in the water: march the heightfield along the reflected ray (8 steps, nearest
// texels). Returns rgb + a = coverage (1 where the ray hits a slope/peak, 0 where it escapes to the sky).
vec4 heightfield_reflection(vec3 p, vec3 r, float max_dist) {
	if (refl_terrain <= 0.0 || r.y > 0.55) {
		return vec4(0.0);
	}
	vec2 dir = normalize(r.xz + vec2(1e-5));
	float rise = r.y / max(length(r.xz), 1e-4);
	float t = 6.0;
	for (int k = 0; k < 9; k++) {
		vec2 q = p.xz + dir * t;
		float ray_y = p.y + rise * t;
		float th = bed_height_fast(q);
		if (th > ray_y) {
			vec2 tuv = terrain_uv(q);
			vec4 m = texture(terrain_mask_tex, tuv);
			vec4 nt = texture(terrain_normal_tex, tuv);
			vec3 n = nt.xyz * 2.0 - 1.0;
			// rough albedo of the hit: forest dark green-grey, rock grey, snow white, meadow straw
			vec3 alb = mix(vec3(0.12, 0.115, 0.1), vec3(0.05, 0.07, 0.045), m.a);
			alb = mix(alb, vec3(0.22, 0.2, 0.14), m.b * (1.0 - m.a) * 0.7);
			alb = mix(alb, vec3(0.2, 0.2, 0.2), m.g * 0.6);
			alb = mix(alb, vec3(0.75, 0.78, 0.82), smoothstep(0.35, 0.8, m.r));
			float ndl = max(dot(n, sun_direction), 0.0);
			vec3 lit = alb * (refl_sun * ndl * 0.8 + refl_amb * (0.35 + 0.65 * nt.a));
			// aerial perspective toward the fog colour with distance
			float fogk = 1.0 - exp(-t / 2600.0);
			lit = mix(lit, fog_color.rgb, fogk);
			float cov = smoothstep(max_dist, max_dist * 0.7, t);
			return vec4(lit, cov);
		}
		t *= 1.9;
		if (t > max_dist) {
			break;
		}
	}
	return vec4(0.0);
}

// Scrolling two-map wind ripples; strength follows the wind. Returns a world-space normal.
vec3 wind_ripples(vec2 xz, float dist, float calm) {
	vec2 wd = normalize(wind_direction.xz + vec2(1e-4, 0.0));
	float ws = clamp(wind_strength, 0.0, 1.5);
	float drift = 0.25 + 0.5 * ws;
	vec2 uv_a = xz / 9.0 + wd * TIME * drift / 9.0;
	vec2 wd2 = vec2(wd.x * 0.77 - wd.y * 0.64, wd.x * 0.64 + wd.y * 0.77);
	vec2 uv_b = xz / 2.3 + wd2 * TIME * drift * 0.55 / 2.3;
	vec3 a = nmap(ripple_a, uv_a);
	vec3 b = nmap(ripple_b, uv_b);
	// big slow swell of wind gusts (cat's paws) across the lake
	float gust = texture(foam_tex, xz / 140.0 + wd * TIME * 0.004).b;
	float strength = mix(0.05, 0.85, clamp(ws, 0.0, 1.0)) * mix(0.55, 1.35, gust) * (1.0 - calm);
	// fade detail with distance (no shimmering; far water reads as glassy, like real lakes)
	float fade = 1.0 / (1.0 + dist * 0.012);
	vec3 n = vec3((a.xy * 0.8 + b.xy * 0.55 * fade) * strength * mix(0.35, 1.0, fade), 1.0);
	return ts_to_world(normalize(n));
}
