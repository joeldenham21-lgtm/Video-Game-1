// THIN AIR — physically based sky, desktop path (Forward+, Settings.sky_quality >= 1).
// Quarter-res: atmosphere (sun + moon + airglow). Half-res: Milky Way, aurora, cirrus, halos, cloud deck,
// overcast/blizzard veil (alpha = transmittance). Full-res: stars, sun and moon discs, dither.
// The radiance cubemap pass skips the discs and stars (the lights provide specular) and uses cheap clouds.
shader_type sky;
render_mode use_half_res_pass, use_quarter_res_pass;

#include "res://src/sky/sky_core.gdshaderinc"

uniform vec2 noise_tiles = vec2(20.0, 11.25);

void sky() {
	vec3 dir = EYEDIR;
	if (AT_QUARTER_RES_PASS) {
		COLOR = clear_sky(dir);
		ALPHA = 1.0;
	} else if (AT_HALF_RES_PASS) {
		vec3 bg = QUARTER_RES_COLOR.rgb;
		vec3 col = bg;
		bool cube = AT_CUBEMAP_PASS;
		if (milky_way_brightness > 0.0 && dir.y > -0.05) {
			col += milky_way_light(dir) * smoothstep(-0.05, 0.08, dir.y);
		}
		col += aurora(dir, cube ? 6 : (quality >= 2 ? 18 : 12));
		vec4 ci = cirrus_layer(dir);
		col = col * ci.a + ci.rgb;
		col += ice_halos(dir) * (1.0 - ci.a) * 3.0;
		vec4 cl = cloud_layer(dir, bg, cube || quality < 1);
		col = col * cl.a + cl.rgb;
		col = overcast_sky(dir, col);
		col = apply_veil(col, dir);
		COLOR = col;
		ALPHA = ci.a * cl.a * (1.0 - overcast) * (1.0 - precip_veil);
	} else {
		vec4 h = HALF_RES_COLOR;
		vec3 col = h.rgb;
		if (!AT_CUBEMAP_PASS) {
			float T = clamp(h.a, 0.0, 1.0);
			vec3 add = sun_disk(dir) + moon_disk(dir);
			if (star_brightness > 0.0 && dir.y > -0.02) {
				add += stars(dir, smoothstep(-0.02, 0.03, dir.y));
			}
			col += add * T;
		} else {
			col = ambient_horizon_clamp(col, dir);
		}
		COLOR = finish(col, SCREEN_UV * noise_tiles);
	}
}
