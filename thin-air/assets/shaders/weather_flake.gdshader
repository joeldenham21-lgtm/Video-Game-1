// THIN AIR — weather particle rendering: soft camera-facing flakes stretched along their screen-space
// velocity by a camera shutter (motion blur), with partial energy conservation (a longer streak is fainter),
// forward-scattering glow toward the sun, sun glints ("sparkle" / diamond dust) and near/far fades.
// Lighting comes from the sky controller (ambient/sun radiance of a white diffuser) so flakes always match
// the scene exposure, day or night. Flakes never shrink below ~2 px: sub-pixel flakes become soft dots
// instead of vanishing. Engine fog is replaced by a gentler in-shader fog: the whiteout murk *is* snow, and
// the nearest flakes must stay readable inside it.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, world_vertex_coords, fog_disabled;

global uniform vec4 fog_color;

uniform sampler2D flakes : filter_linear_mipmap, repeat_disable;
uniform vec3 light_ambient = vec3(0.3);
uniform vec3 light_sun = vec3(0.8);
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform vec3 tint = vec3(1.0);
uniform float opacity = 0.85;
uniform float shutter = 0.016;
uniform float sparkle = 0.0;
uniform float near_fade = 0.35;
uniform float far_fade = 16.0;
uniform float round_mix = 0.0;      // 0 = flake atlas, 1 = plain soft dot (rain/sleet/drift)
uniform float time_s = 0.0;
uniform float pixel_angle = 0.0017;   // radians per rendered pixel (set by WeatherFX)
uniform float fog_density = 0.0;      // environment extinction (1/m), applied at fog_strength
uniform float fog_strength = 0.5;
uniform float min_pixels = 3.0;       // smallest on-screen flake (render px; a display pixel spans ~6 arcmin, the eye resolves 1)
uniform int debug_mode = 0;      // 1 = solid geometry, 2 = (fade, energy, coverage) as colour

varying float v_fade;
varying vec2 v_atlas;
varying float v_energy;
varying float v_fwd;
varying float v_glint;
varying float v_px;
varying float v_fog;

void vertex() {
	// world_vertex_coords: VERTEX arrives in world space (particle position + unit quad corner).
	vec2 corner = vec2(UV.x - 0.5, 0.5 - UV.y);
	vec3 center = VERTEX - vec3(corner, 0.0);
	vec3 vel = INSTANCE_CUSTOM.xyz;
	float size = INSTANCE_CUSTOM.w;
	vec3 to_cam = CAMERA_POSITION_WORLD - center;
	float dist = length(to_cam);
	to_cam /= max(dist, 1e-4);
	vec3 vp = vel - to_cam * dot(vel, to_cam);
	float vl = length(vp);
	vec3 axis = vl > 1e-3 ? vp / vl : normalize(cross(to_cam, vec3(0.0, 0.0, 1.0)) + vec3(1e-4));
	vec3 side = normalize(cross(axis, to_cam));
	float streak = vl * shutter;
	float px = pixel_angle * max(dist, 0.05);
	float size_eff = max(size, px * min_pixels);
	// Partial energy conservation for the enlarged sub-pixel flakes (they stay visible, just softer).
	float cover = clamp(size / size_eff, 0.85, 1.0);
	VERTEX = center + side * corner.x * size_eff + axis * corner.y * (size_eff + streak);
	v_px = size / px;
	v_fade = smoothstep(near_fade * 0.4, near_fade, dist) * (1.0 - smoothstep(far_fade * 0.6, far_fade, dist)) * COLOR.a;
	// Motion blur spreads the flake over its streak; the eye still tracks bright streaks, so only a gentle falloff.
	v_energy = clamp(pow(size_eff / (size_eff + streak), 0.35), 0.3, 1.0) * cover;
	float cell = floor(COLOR.g * 15.999);
	v_atlas = vec2(mod(cell, 4.0), floor(cell / 4.0)) * 0.25;
	v_fwd = pow(max(dot(-to_cam, sun_dir), 0.0), 6.0);
	// Glints: each crystal flashes when its facets line up (tumbling), mostly toward/near the sun.
	float g = sin(time_s * (3.0 + 5.0 * COLOR.r) + COLOR.b * 60.0);
	v_glint = sparkle * pow(max(g, 0.0), 24.0) * (0.25 + 0.75 * max(dot(-to_cam, sun_dir), 0.0));
	v_fog = (1.0 - exp(-dist * fog_density)) * fog_strength;
}

void fragment() {
	// The sprite fills the central 70 % of its atlas cell; stretch that over the quad.
	vec2 uv = v_atlas + (0.15 + clamp(UV, vec2(0.0), vec2(1.0)) * 0.7) * 0.25;
	float a = min(texture(flakes, uv).a * 1.8, 1.0);
	vec2 q = UV * 2.0 - 1.0;
	// Solid core, soft rim: a few-pixel flake must still reach full coverage at its centre pixel.
	float dot_a = 1.0 - smoothstep(0.3, 1.0, length(q));
	// Tiny flakes: a soft analytic dot (the atlas detail would alias away anyway).
	float small = 1.0 - smoothstep(2.5, 5.0, v_px);
	a = mix(a, dot_a, max(small, round_mix));
	// Ice crystals scatter strongly forward and look brighter than a matte diffuser.
	vec3 col = light_ambient * 1.6 + light_sun * (0.7 + 2.2 * v_fwd);
	col += light_sun * v_glint * 14.0;
	col = mix(col * tint, fog_color.rgb, clamp(v_fog, 0.0, 1.0));
	ALBEDO = col;
	ALPHA = clamp(a * opacity * v_fade * v_energy + v_glint * a * 0.5, 0.0, 1.0);
	if (debug_mode == 1) {
		ALBEDO = vec3(1.0, 0.0, 0.0);
		ALPHA = 1.0;
	} else if (debug_mode == 2) {
		ALBEDO = vec3(v_fade, v_energy, a);
		ALPHA = 1.0;
	}
}
