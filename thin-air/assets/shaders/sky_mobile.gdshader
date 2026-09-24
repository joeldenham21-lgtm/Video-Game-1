// THIN AIR — physically based sky, mobile path (Mobile renderer / Settings.sky_quality 0).
// One half-res pass: atmosphere (single altitude slice), Milky Way, cheap aurora, cirrus, cloud deck without
// light marching, overcast/blizzard veil. Full-res: stars, sun and moon discs. Same look, ~1/3 the ALU.
shader_type sky;
render_mode use_half_res_pass;

#define SKY_MOBILE
#include "res://src/sky/sky_core.gdshaderinc"

uniform vec2 noise_tiles = vec2(20.0, 11.25);

void sky() {
	vec3 dir = EYEDIR;
	if (AT_HALF_RES_PASS) {
		vec3 clear_bg = clear_sky(dir);
		vec3 col = clear_bg;
		bool cube = AT_CUBEMAP_PASS;
		if (milky_way_brightness > 0.0 && dir.y > -0.05) {
			col += milky_way_light(dir) * smoothstep(-0.05, 0.08, dir.y);
		}
		if (!cube) {
			col += aurora(dir, 7);
		}
		vec4 ci = cirrus_layer(dir);
		col = col * ci.a + ci.rgb;
		vec4 cl = cloud_layer(dir, clear_bg, true);
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
