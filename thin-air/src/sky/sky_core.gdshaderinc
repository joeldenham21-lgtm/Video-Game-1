// THIN AIR — sky core (included by assets/shaders/sky.gdshader and sky_mobile.gdshader).
// Physically based atmosphere from a precomputed spectral LUT (Rayleigh + Mie + ozone + multiple
// scattering, 4 camera altitudes), sun disk with limb darkening and refraction flattening, Lommel–Seeliger
// moon with phase/earthshine, real star field + Milky Way rotating with sidereal time, airglow, aurora,
// cumulus/stratus deck with directional lighting and silver lining, cirrus, ice halos and sundogs,
// overcast/blizzard flattening, and a lower hemisphere that continues the horizon haze into ground bounce.
// All uniforms are driven by src/sky/sky_controller.gd. Units: radiance per game-unit irradiance.

#define PI 3.14159265359

uniform sampler3D atmosphere_lut : filter_linear, repeat_disable;
uniform sampler2D cloud_noise : filter_linear_mipmap, repeat_enable;
uniform sampler2D moon_albedo : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D star_map : filter_nearest, repeat_enable;
uniform sampler2D milky_way : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D blue_noise : filter_nearest, repeat_enable;

// --- atmosphere
uniform vec3 sun_dir = vec3(0.0, 0.5, -0.8);
uniform vec3 moon_dir = vec3(0.0, -1.0, 0.0);
uniform float sun_irradiance = 3.0;
uniform float moon_irradiance = 0.0;
uniform float alt_index = 0.0;
uniform float zenith_luminance = 0.05;
uniform vec3 white_balance = vec3(1.0);
uniform vec3 ground_radiance = vec3(0.05);
uniform float airglow = 0.0;
uniform vec3 haze_color = vec3(0.5);
uniform float horizon_haze = 0.0;
uniform float precip_veil = 0.0;
uniform vec3 veil_zenith = vec3(0.5);
uniform vec3 veil_horizon = vec3(0.5);

// --- sun / moon discs
uniform float sun_disk_radiance = 60.0;
uniform float sun_angular_radius = 0.00465;
uniform vec3 sun_transmittance = vec3(1.0);
uniform vec3 moon_right = vec3(1.0, 0.0, 0.0);
uniform vec3 moon_up = vec3(0.0, 1.0, 0.0);
uniform float moon_angular_radius = 0.00452;
uniform float moon_disk_radiance = 0.05;
uniform vec3 moon_transmittance = vec3(1.0);
uniform float earthshine = 0.0;

// --- night sky
uniform mat3 world_to_eq = mat3(1.0);
uniform float star_brightness = 0.0;
uniform float milky_way_brightness = 0.0;
uniform float pixel_angle = 0.0012;
uniform float twinkle_time = 0.0;
uniform float star_extinction = 0.25;

// --- clouds
uniform float cloud_cover = 0.3;
uniform float cloud_density = 0.5;
uniform float cloud_height = 2500.0;
uniform float cloud_thickness = 1000.0;
uniform vec2 cloud_offset = vec2(0.0);
uniform float cloud_scale = 0.00009;
uniform vec3 cloud_sun_color = vec3(1.0);
uniform vec3 cloud_moon_color = vec3(0.0);
uniform vec3 cloud_ambient_top = vec3(0.1);
uniform vec3 cloud_ambient_bottom = vec3(0.05);
uniform float cirrus_cover = 0.2;
uniform float cirrus_height = 6000.0;
uniform vec2 cirrus_offset = vec2(0.0);
uniform vec2 cirrus_axis = vec2(1.0, 0.0);
uniform vec3 cirrus_sun_color = vec3(1.0);
uniform float overcast = 0.0;
uniform vec3 overcast_zenith = vec3(0.3);
uniform vec3 overcast_horizon = vec3(0.25);
uniform float halo_strength = 0.0;

// --- aurora
uniform float aurora_intensity = 0.0;
uniform float aurora_time = 0.0;
uniform float aurora_distance = 600000.0;

uniform int quality = 2;

const float R_GROUND = 6360000.0;
const float MIE_G = 0.8;

// ------------------------------------------------------------------------------------------ helpers
float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float phase_mie(float c) {
	float g = MIE_G;
	float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
	return k * (1.0 + c * c) / pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5);
}

float phase_hg(float c, float g) {
	return (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5));
}

float lum(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// ------------------------------------------------------------------------------------------ atmosphere LUT
// Texture layout: x = 32 azimuth (Rayleigh+MS) | 32 azimuth (Mie, no phase); y = view elevation (90°·v²);
// z = 4 altitudes × 64 sun elevations (−20° + 110°·t²).
vec3 lut_fetch(float u_az, float v_el, float t_sun, float slice, bool mie) {
	float x = ((mie ? 32.0 : 0.0) + u_az * 31.0 + 0.5) / 64.0;
	float y = (v_el * 63.0 + 0.5) / 64.0;
	float z = (slice * 64.0 + t_sun * 63.0 + 0.5) / 256.0;
	return texture(atmosphere_lut, vec3(x, y, z)).rgb;
}

vec3 atmosphere(vec3 dir, vec3 light, float irradiance) {
	if (irradiance <= 0.0 || light.y < -0.34) {
		return vec3(0.0);
	}
	float el = asin(clamp(dir.y, 0.0, 1.0));
	float v = sqrt(el / (0.5 * PI));
	float el_s = degrees(asin(clamp(light.y, -1.0, 1.0)));
	float t = sqrt(clamp((el_s + 20.0) / 110.0, 0.0, 1.0));
	vec2 dh = dir.xz;
	vec2 lh = light.xz;
	float dl = length(dh) * length(lh);
	float ca = dl > 1e-5 ? clamp(dot(dh, lh) / dl, -1.0, 1.0) : 1.0;
	float u = acos(ca) / PI;
	float s0 = floor(alt_index);
	float fs = alt_index - s0;
	float s1 = min(s0 + 1.0, 3.0);
	vec3 ray = lut_fetch(u, v, t, s0, false);
	vec3 mie = lut_fetch(u, v, t, s0, true);
#ifndef SKY_MOBILE
	if (fs > 0.001) {
		ray = mix(ray, lut_fetch(u, v, t, s1, false), fs);
		mie = mix(mie, lut_fetch(u, v, t, s1, true), fs);
	}
#endif
	float cos_t = dot(dir, light);
	return (ray + mie * phase_mie(cos_t)) * irradiance;
}

// Sky radiance (no clouds / discs) including the lower hemisphere continuation.
vec3 clear_sky(vec3 dir) {
	vec3 d = dir;
	float below = 0.0;
	if (d.y < 0.0) {
		below = d.y;
		d = normalize(vec3(d.x, 0.0, d.z) + vec3(0.0, 1e-4, 0.0));
	}
	vec3 c = atmosphere(d, sun_dir, sun_irradiance);
	c += atmosphere(d, moon_dir, moon_irradiance);
	// Airglow / natural night-sky background, brighter toward the horizon (van Rhijn).
	float el = max(d.y, 0.0);
	c += airglow * vec3(0.78, 0.86, 0.80) * (1.0 + 2.2 * pow(1.0 - el, 5.0));
	// Weather haze whitens the lower sky toward the fog colour.
	float hz = horizon_haze * exp(-el * 9.0);
	c = mix(c, haze_color, clamp(hz, 0.0, 1.0));
	if (below < 0.0) {
		c = mix(ground_radiance, c, exp(below * 40.0));
	}
	return c;
}

// Radiance-cubemap only: in a mountain valley the terrain hides the lowest sky, so the intense
// sunrise/sunset glow must not flood the ambient light. Clamp low-sky luminance relative to the zenith.
vec3 ambient_horizon_clamp(vec3 c, vec3 dir) {
	float lim = zenith_luminance * mix(8.0, 40.0, smoothstep(0.0, 0.35, dir.y));
	float l = lum(c);
	return l > lim ? c * (lim / l) : c;
}

// ------------------------------------------------------------------------------------------ night sky
vec2 eq_uv(vec3 eq) {
	float ra = atan(eq.y, eq.x);
	if (ra < 0.0) ra += 2.0 * PI;
	float dec = asin(clamp(eq.z, -1.0, 1.0));
	return vec2(ra / (2.0 * PI), (0.5 * PI - dec) / PI);
}

vec3 bv_color(float bv) {
	vec3 c = mix(vec3(0.66, 0.77, 1.0), vec3(0.86, 0.9, 1.0), smoothstep(-0.35, 0.0, bv));
	c = mix(c, vec3(1.0, 0.96, 0.9), smoothstep(0.0, 0.6, bv));
	c = mix(c, vec3(1.0, 0.83, 0.64), smoothstep(0.6, 1.25, bv));
	c = mix(c, vec3(1.0, 0.71, 0.46), smoothstep(1.25, 1.9, bv));
	return mix(vec3(lum(c)), c, 0.75);
}

vec3 stars(vec3 dir, float vis) {
	vec3 eq = world_to_eq * dir;
	vec2 uv = eq_uv(eq);
	ivec2 size = textureSize(star_map, 0);
	ivec2 tc = ivec2(uv * vec2(size));
	tc.x = tc.x % size.x;
	tc.y = clamp(tc.y, 0, size.y - 1);
	vec4 s = texelFetch(star_map, tc, 0);
	if (s.b < 0.5 / 255.0) {
		return vec3(0.0);
	}
	float ra_c = (float(tc.x) + 0.5) / float(size.x) * 2.0 * PI;
	float dec_c = 0.5 * PI - (float(tc.y) + 0.5) / float(size.y) * PI;
	vec3 cvec = vec3(cos(dec_c) * cos(ra_c), cos(dec_c) * sin(ra_c), sin(dec_c));
	vec3 east = vec3(-sin(ra_c), cos(ra_c), 0.0);
	vec3 north = vec3(-sin(dec_c) * cos(ra_c), -sin(dec_c) * sin(ra_c), cos(dec_c));
	float reach = radians(0.25);
	vec2 off = (s.rg * 2.0 - 1.0) * reach;
	vec3 svec = normalize(cvec + east * off.x + north * off.y);
	vec3 dv = eq - svec;
	float d2 = dot(dv, dv);
	float mag = (s.b * 255.0 - 1.0) / 25.0 - 2.0;
	float bv = s.a * 2.4 - 0.4;
	// PSF: at least ~0.7 px, energy conserving; faint stars fade smoothly at the limit of vision.
	float sigma = max(pixel_angle * 0.62, 0.00018);
	float flux = pow(10.0, -0.4 * mag);
	float airmass = 1.0 / max(dir.y + 0.025, 0.025);
	float ext = exp(-star_extinction * (airmass - 1.0));
	// Scintillation: stronger and more colourful near the horizon.
	float tw = 1.0;
	if (quality >= 2) {
		float seed = hash12(vec2(tc));
		float amp = clamp(0.05 + 0.03 * airmass, 0.0, 0.5);
		tw = 1.0 + amp * (sin(twinkle_time * (9.0 + 7.0 * seed) + seed * 40.0) + 0.6 * sin(twinkle_time * (23.0 + 11.0 * seed) + seed * 17.0));
	}
	float peak = flux;   // screen-space point source: same look at any render scale
	float g = exp(-0.5 * d2 / (sigma * sigma));
	vec3 col = bv_color(bv) * vec3(1.0, 0.96 + 0.04 * ext, 0.9 + 0.1 * ext);
	return col * peak * g * ext * tw * star_brightness * vis;
}

vec3 milky_way_light(vec3 dir) {
	vec3 eq = world_to_eq * dir;
	vec2 uv = eq_uv(eq);
	float texel = 2.0 * PI / 2048.0;
	float lod = max(log2(max(pixel_angle * 2.0, 1e-6) / texel), 0.0);
	vec3 mw = textureLod(milky_way, uv, lod).rgb;
	float airmass = 1.0 / max(dir.y + 0.03, 0.03);
	return mw * milky_way_brightness * exp(-star_extinction * 1.4 * (airmass - 1.0));
}

// ------------------------------------------------------------------------------------------ aurora
float vnoise1(float x) {
	float i = floor(x);
	float f = fract(x);
	float a = hash12(vec2(i, 17.0));
	float b = hash12(vec2(i + 1.0, 17.0));
	return mix(a, b, f * f * (3.0 - 2.0 * f));
}

// Horizontal fold of a curtain (km north of its mean line) as a function of east distance x (km).
float aurora_fold(float x, float t, float ph) {
	return 42.0 * sin(x * 0.0023 + ph + t * 0.05) + 19.0 * sin(x * 0.0071 - t * 0.13 + ph * 2.3)
		+ 6.0 * sin(x * 0.021 + t * 0.4 + ph * 5.1);
}

// Aurora: up to three east–west curtains (vertical sheets along the geomagnetic field) north of the
// observer. The view ray is intersected analytically with each folded sheet (no ray-march aliasing);
// emission follows the real altitude profile: sharp lower border ~100 km, green 557.7 nm peak ~110–130 km,
// red 630 nm above ~200 km, a pink N2 fringe at the bottom in strong displays. Rays are vertical
// striations that shimmer; brightness grows where a sheet is seen edge-on.
vec3 aurora(vec3 dir, int quality_steps) {
	if (aurora_intensity <= 0.001 || dir.y < -0.02) {
		return vec3(0.0);
	}
	float hl = length(dir.xz);
	if (hl < 1e-4) {
		return vec3(0.0);
	}
	vec2 u = dir.xz / hl;
	float de = u.x;
	float dn = -u.y;
	if (dn < 0.03) {
		return vec3(0.0);
	}
	float tan_el = max(dir.y, 0.0) / hl;
	float cos_el = hl;
	vec3 acc = vec3(0.0);
	float t = aurora_time;
	int n = quality_steps >= 12 ? 3 : 2;
	for (int k = 0; k < 3; k++) {
		if (k >= n) {
			break;
		}
		float fk = float(k);
		float D = aurora_distance / 1000.0 + fk * fk * 32.0 + fk * 23.0;
		float ph = fk * 2.17;
		float s = D / dn;
		for (int it = 0; it < 3; it++) {
			s = (D + aurora_fold(s * de, t, ph)) / dn;
		}
		if (s <= 0.0 || s > 2500.0) {
			continue;
		}
		float x = s * de;
		float h = s * tan_el + s * s / (2.0 * 6371.0);
		// Vertical rays and the ragged top of each ray.
		float rx = x + t * 1.6;
		float rays = 0.22 + 0.78 * pow(vnoise1(rx * 0.24), 2.0) * (0.5 + 0.5 * vnoise1(rx * 1.1 + 7.0));
		float top = 170.0 + 140.0 * vnoise1(x * 0.21 + 3.0 + fk * 11.0);
		float patchy = smoothstep(0.15, 0.7, vnoise1(x * 0.006 + t * 0.015 + fk * 5.0));
		float base = 100.0 - 6.0 * aurora_intensity + 4.0 * vnoise1(x * 0.05 + 9.0);
		float lower = smoothstep(base - 3.0, base + 2.5, h);
		// Green 557.7 nm: a bright band just above the sharp lower border (the arc), plus the fainter ray
		// columns that climb out of it; red 630 nm glows only at the ragged tops.
		float fade_top = 1.0 - smoothstep(top - 40.0, top, h);
		float band = lower * exp(-max(h - base - 6.0, 0.0) / 20.0);
		float column = lower * exp(-max(h - base - 12.0, 0.0) / 65.0) * fade_top;
		float red = 0.22 * smoothstep(175.0, 235.0, h) * exp(-max(h - 235.0, 0.0) / 110.0) * (1.0 - smoothstep(380.0, 420.0, h));
		float pink = 0.45 * aurora_intensity * exp(-pow((h - base + 1.5) / 3.5, 2.0));
		float green = band * (0.5 + 0.5 * rays) + column * rays * 0.75;
		vec3 e = vec3(0.36, 1.0, 0.42) * green + vec3(1.0, 0.18, 0.30) * red * rays + vec3(0.9, 0.25, 0.55) * pink;
		// Path through an 8 km-thick sheet: bright where seen edge-on.
		float slope = (aurora_fold(x + 1.0, t, ph) - aurora_fold(x - 1.0, t, ph)) * 0.5;
		vec2 nrm = normalize(vec2(-slope, 1.0));
		float cos_inc = abs(dot(vec2(de, dn), nrm)) * cos_el;
		float path = 8.0 / max(cos_inc, 0.12);
		// Curtains fade out toward east/west instead of ending at the edge of the modelled sheet.
		float strength = 1.0 / (1.0 + fk * 1.2) * smoothstep(0.03, 0.3, dn) * (1.0 - smoothstep(1100.0, 2400.0, s));
		acc += e * patchy * path * strength;
	}
	float airmass = 1.0 / max(dir.y + 0.05, 0.05);
	return acc * aurora_intensity * 2.2e-3 * exp(-0.12 * (airmass - 1.0)) * smoothstep(-0.02, 0.05, dir.y);
}

// ------------------------------------------------------------------------------------------ clouds
float layer_distance(float dy, float h) {
	// Distance to a shell h above the observer on a curved Earth; stable for small h.
	float r = R_GROUND + 1500.0;
	float b = r * dy;
	return h * (2.0 * r + h) / (b + sqrt(b * b + h * (2.0 * r + h)));
}

float cloud_shape(vec2 uv, float cover) {
	float base = texture(cloud_noise, uv).r;
	float billow = texture(cloud_noise, uv * 2.3 + vec2(0.31, 0.77)).g;
	float n = base * 0.64 + billow * 0.36;
#ifndef SKY_MOBILE
	if (quality >= 1) {
		n = n * 0.9 + texture(cloud_noise, uv * 8.7 + vec2(0.13, 0.41)).b * 0.1;
	}
#endif
	float thr = mix(0.80, 0.18, cover);
#ifdef SKY_MOBILE
	// No detail octave on mobile: a softer edge keeps the cumulus from looking cut out.
	return smoothstep(thr - 0.05, thr + 0.22, n);
#else
	return smoothstep(thr - 0.02, thr + 0.16, n);
#endif
}

// Returns vec4(radiance, transmittance).
vec4 cloud_layer(vec3 dir, vec3 sky_here, bool cheap) {
	if (dir.y <= 0.004 || (cloud_cover <= 0.01 && overcast <= 0.01)) {
		return vec4(0.0, 0.0, 0.0, 1.0);
	}
	float t = layer_distance(dir.y, cloud_height);
	vec2 pos = dir.xz * t;
	vec2 uv = pos * cloud_scale + cloud_offset;
	float d = cloud_shape(uv, cloud_cover);
	d = max(d, overcast);
	if (d <= 0.001) {
		return vec4(0.0, 0.0, 0.0, 1.0);
	}
	// Optical depth through the layer: thicker toward the horizon (slant path), capped.
	float slant = min(1.0 / max(dir.y, 0.06), 9.0);
	float tau = d * (2.0 + 16.0 * cloud_density) * mix(1.0, slant, 0.35);
	float trans = exp(-tau);
	// Light toward the sun (or moon): march the density field along the sun's horizontal direction.
	vec3 L = sun_dir.y > -0.1 ? sun_dir : moon_dir;
	vec3 lc = sun_dir.y > -0.1 ? cloud_sun_color : cloud_moon_color;
	float tau_l = d * (1.5 + 6.0 * cloud_density);
	if (!cheap) {
		vec2 step_uv = normalize(L.xz + vec2(1e-4)) * cloud_thickness / max(L.y, 0.08) * cloud_scale * 0.35;
		step_uv = clamp(step_uv, vec2(-0.02), vec2(0.02));
		float acc = 0.0;
		acc += cloud_shape(uv + step_uv * 0.5, cloud_cover);
		acc += cloud_shape(uv + step_uv * 1.3, cloud_cover);
		if (quality >= 2) {
			acc += 0.6 * cloud_shape(uv + step_uv * 2.6, cloud_cover);
		}
		tau_l += acc * (1.2 + 7.0 * cloud_density);
	} else {
		// One density probe toward the light: shaded bases and lit tops at a quarter of the cost.
		vec2 step_uv = normalize(L.xz + vec2(1e-4)) * cloud_thickness / max(L.y, 0.08) * cloud_scale * 0.35;
		step_uv = clamp(step_uv, vec2(-0.02), vec2(0.02));
		tau_l += cloud_shape(uv + step_uv * 0.9, cloud_cover) * (2.0 + 9.0 * cloud_density);
	}
	tau_l += overcast * 12.0;
	float cos_t = dot(dir, L);
	// Octave multiple-scattering approximation (Wrenninge): bright silver edges, dark thick bases.
	float ms = 0.0;
	float a = 1.0;
	float b = 1.0;
	float c = 1.0;
	for (int i = 0; i < 3; i++) {
		float ph = mix(phase_hg(cos_t, 0.72 * c), phase_hg(cos_t, -0.22 * c), 0.28);
		ms += a * exp(-tau_l * b) * ph;
		a *= 0.55;
		b *= 0.42;
		c *= 0.5;
	}
	float powder = 1.0 - exp(-tau * 1.6);
	vec3 sun_part = lc * ms * 4.0 * PI * mix(0.55, 1.0, powder) * 0.9;
	// Ambient: sky from above (through the cloud) and snow/ground bounce from below.
	float thick = clamp(tau / 18.0, 0.0, 1.0);
	vec3 amb = mix(cloud_ambient_top, cloud_ambient_bottom, 0.35 + 0.45 * thick) * mix(1.05, 0.55, thick);
	vec3 rad = (sun_part + amb) * (1.0 - trans);
	// Aerial perspective toward distant clouds.
	float fade = exp(-t / 60000.0);
	rad = mix(sky_here * (1.0 - trans), rad, fade);
	return vec4(rad, trans);
}

vec4 cirrus_layer(vec3 dir) {
	if (cirrus_cover <= 0.01 || dir.y <= 0.01) {
		return vec4(0.0, 0.0, 0.0, 1.0);
	}
	float t = layer_distance(dir.y, cirrus_height);
	vec2 pos = dir.xz * t;
	vec2 q = vec2(dot(pos, cirrus_axis), dot(pos, vec2(-cirrus_axis.y, cirrus_axis.x)));
	vec2 uv = q * 0.000032 + cirrus_offset;
	float c = texture(cloud_noise, uv).a;
	// Fibrous fall streaks: the same field sampled finely across the jet axis, coarsely along it.
	float fib = texture(cloud_noise, uv * vec2(2.3, 9.0) + vec2(0.21, 0.63)).a;
	c *= 0.45 + 0.9 * fib;
	// Coverage: sparse tufts at low cover, merging into a cirrostratus veil as cover rises.
	float veil = smoothstep(0.55, 1.0, cirrus_cover) * 0.35 * texture(cloud_noise, uv * 0.31 + vec2(0.5)).r;
	c = clamp(c * (0.3 + 1.3 * cirrus_cover) + veil, 0.0, 1.0);
	float tau = c * 0.5 * min(1.0 / max(dir.y, 0.08), 6.0);
	float trans = exp(-tau);
	float cos_t = dot(dir, sun_dir);
	// Thin ice cloud: mostly single scattering (phase normalised per steradian), strong forward peak.
	float ph = mix(phase_hg(cos_t, 0.8), 1.0 / (4.0 * PI), 0.55) * 4.0 * PI;
	vec3 rad = (cirrus_sun_color * ph * 0.17 + cloud_ambient_top * 0.55) * (1.0 - trans);
	float fade = exp(-t / 90000.0);
	return vec4(rad * fade, mix(1.0, trans, fade));
}

// 22° halo and parhelia (sundogs) in ice-crystal cirrostratus.
vec3 ice_halos(vec3 dir) {
	if (halo_strength <= 0.001 || sun_dir.y < -0.01) {
		return vec3(0.0);
	}
	float th = degrees(acos(clamp(dot(dir, sun_dir), -1.0, 1.0)));
	vec3 ring = vec3(exp(-pow((th - 21.7) / 0.7, 2.0)), exp(-pow((th - 22.1) / 0.8, 2.0)), exp(-pow((th - 22.6) / 1.1, 2.0)));
	ring += 0.25 * exp(-max(th - 22.0, 0.0) / 6.0) * step(22.0, th);
	ring *= step(18.0, th);
	float el_s = asin(clamp(sun_dir.y, -1.0, 1.0));
	float el = asin(clamp(dir.y, -1.0, 1.0));
	vec3 dogs = vec3(0.0);
	if (el_s < radians(40.0)) {
		float cs = cos(el_s);
		float daz = acos(clamp((cos(radians(22.0)) - sin(el_s) * sin(el_s)) / (cs * cs), -1.0, 1.0));
		float az_s = atan(sun_dir.x, -sun_dir.z);
		float az = atan(dir.x, -dir.z);
		for (int k = -1; k <= 1; k += 2) {
			float dz = degrees(mod(az - (az_s + float(k) * daz) + PI, 2.0 * PI) - PI) * float(k);
			float de = degrees(el - el_s);
			float v = exp(-pow(de / 1.4, 2.0));
			dogs += v * vec3(exp(-pow((dz + 0.4) / 0.55, 2.0)), exp(-pow(dz / 0.7, 2.0)), exp(-pow((dz - 0.5) / 1.1, 2.0)) + 0.35 * exp(-max(dz, 0.0) / 5.0) * step(0.0, dz));
		}
	}
	return (ring * 0.35 + dogs * 1.2) * halo_strength * cloud_sun_color * 0.06;
}

// ------------------------------------------------------------------------------------------ discs
vec3 sun_disk(vec3 dir) {
	float c = dot(dir, sun_dir);
	float r = sun_angular_radius;
	if (c < cos(r * 1.6)) {
		return vec3(0.0);
	}
	// Tangent-plane offset with atmospheric refraction flattening near the horizon.
	vec3 right = normalize(cross(sun_dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
	vec3 up = cross(right, sun_dir);
	vec2 o = vec2(dot(dir, right), dot(dir, up));
	float el = degrees(asin(clamp(sun_dir.y, -1.0, 1.0)));
	float flat_k = 1.0 - 0.17 * exp(-max(el + 0.6, 0.0) / 0.9);
	o.y /= flat_k;
	float x = length(o) / r;
	float aa = pixel_angle / r;
	float edge = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, x);
	float mu = sqrt(max(1.0 - x * x, 0.0));
	vec3 limb = vec3(1.0) - vec3(0.42, 0.56, 0.72) * (1.0 - mu);
	return sun_disk_radiance * sun_transmittance * limb * edge;
}

vec3 moon_disk(vec3 dir) {
	float c = dot(dir, moon_dir);
	float r = moon_angular_radius;
	if (c < cos(r * 1.3) || moon_disk_radiance <= 0.0) {
		return vec3(0.0);
	}
	vec2 o = vec2(dot(dir, moon_right), dot(dir, moon_up)) / r;
	float x2 = dot(o, o);
	float aa = pixel_angle / r;
	float edge = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, sqrt(x2));
	if (edge <= 0.0) {
		return vec3(0.0);
	}
	float z = sqrt(max(1.0 - x2, 0.0));
	vec3 n = o.x * moon_right + o.y * moon_up - z * moon_dir;
	vec3 alb = textureLod(moon_albedo, o * vec2(0.5, -0.5) + 0.5, 0.0).rgb;
	float mu0 = dot(n, sun_dir);
	float mu = max(z, 0.02);
	float lit = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu) : 0.0;
	// Soft terminator (topography) and earthshine on the dark side.
	lit *= smoothstep(-0.02, 0.06, mu0);
	float es = earthshine * (0.6 + 0.4 * z);
	return moon_disk_radiance * moon_transmittance * alb * (lit + es) * edge;
}

// ------------------------------------------------------------------------------------------ composition
vec3 apply_veil(vec3 col, vec3 dir) {
	if (precip_veil <= 0.0) {
		return col;
	}
	float el = max(dir.y, 0.0);
	vec3 v = mix(veil_horizon, veil_zenith, sqrt(el));
	return mix(col, v, precip_veil);
}

vec3 overcast_sky(vec3 dir, vec3 base) {
	if (overcast <= 0.001) {
		return base;
	}
	float el = clamp(dir.y, 0.0, 1.0);
	// CIE overcast luminance distribution: zenith ≈ 3× horizon, with subtle stratus undulation.
	vec3 oc = mix(overcast_horizon, overcast_zenith, (1.0 + 2.0 * el) / 3.0 * 1.5 - 0.5);
	if (dir.y > 0.0) {
		float t = layer_distance(dir.y, cloud_height);
		vec2 uv = dir.xz * t * cloud_scale * 0.6 + cloud_offset * 0.6;
		float n = texture(cloud_noise, uv).r * 0.7 + texture(cloud_noise, uv * 4.1).b * 0.3;
		oc *= 0.86 + 0.28 * n;
	}
	float below = min(dir.y, 0.0);
	oc = mix(ground_radiance, oc, exp(below * 40.0));
	return mix(base, oc, overcast);
}

vec3 finish(vec3 col, vec2 screen_uv) {
	float bn = texture(blue_noise, screen_uv).r;
	col *= 1.0 + (bn - 0.5) * 0.018;
	return max(col * white_balance, vec3(0.0));
}
