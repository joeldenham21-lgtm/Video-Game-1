// THIN AIR — valley fog "sea" seen from above (radiation / inversion fog filling the valley at dawn).
// A single horizontal plane at the fog top. Opacity is the optical depth of the fog actually crossed by the
// view ray: from the plane down to the terrain behind it (depth buffer), so the fog hugs the valley floor,
// thins to nothing where slopes rise out of it and is opaque over deep valleys. The top is lit like a cloud
// top (sun + sky, soft billows, forward-scatter glow toward a low sun) and drifts slowly with the wind.
// Works in Forward+ and Mobile (one draw call, one depth read). Hidden while the camera is inside the fog —
// the environment fog carries the murk there.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_back, shadows_disabled;

uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
uniform sampler2D cloud_noise : filter_linear_mipmap, repeat_enable;
uniform float extinction = 0.03;          // 1/m inside the fog (≈ 130 m visibility)
uniform float intensity = 1.0;            // Climate.valley_fog
uniform vec2 drift = vec2(0.0);           // world-space noise offset (m), moves with the wind
uniform vec3 light_ambient = vec3(0.3);   // radiance of a white diffuser under the sky (from the sky controller)
uniform vec3 light_sun = vec3(0.8);       // ... facing the sun
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform float fade_start = 9000.0;
uniform float fade_end = 14000.0;

varying vec3 w_pos;

void vertex() {
	w_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float depth = textureLod(depth_tex, SCREEN_UV, 0.0).r;
	vec4 v = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
	float scene_dist = length(v.xyz / v.w);
	float surf_dist = length(VERTEX);
	float path = max(scene_dist - surf_dist, 0.0);
	// Billowy top: two octaves of the cloud noise (hundreds of metres across) modulate density, and their
	// gradient acts as a normal so low sunlight rakes across the billows.
	vec2 p = w_pos.xz + drift;
	vec2 u1 = p * 0.0011;
	vec2 u2 = p * 0.0047 + vec2(0.37, 0.11);
	float n1 = texture(cloud_noise, u1).r;
	float n2 = texture(cloud_noise, u2).g;
	float billow = n1 * 0.6 + n2 * 0.4;
	float e = 0.004;
	float gx = (texture(cloud_noise, u1 + vec2(e, 0.0)).r - n1) * 0.6 + (texture(cloud_noise, u2 + vec2(e * 4.3, 0.0)).g - n2) * 0.4 * 4.3;
	float gz = (texture(cloud_noise, u1 + vec2(0.0, e)).r - n1) * 0.6 + (texture(cloud_noise, u2 + vec2(0.0, e * 4.3)).g - n2) * 0.4 * 4.3;
	vec3 nrm = normalize(vec3(-gx * 9.0, 1.0, -gz * 9.0));
	// Density grows below the top: the first metres of the ray are the thin, ragged upper edge.
	float od = extinction * intensity * path * mix(0.35, 1.25, billow) * smoothstep(0.0, 25.0, path);
	float alpha = 1.0 - exp(-od);
	// Fade the far rim of the plane (the environment fog has taken over by then).
	float hd = length(w_pos.xz - CAMERA_POSITION_WORLD.xz);
	alpha *= 1.0 - smoothstep(fade_start, fade_end, hd);
	// Cloud-top lighting: sky from above (troughs see less of it), sun raking across the billows, and a
	// forward-scattering glow toward a low sun.
	vec3 view_dir = normalize(w_pos - CAMERA_POSITION_WORLD);
	float fwd = pow(max(dot(view_dir, sun_dir), 0.0), 8.0);
	vec3 sd = normalize(sun_dir + vec3(0.0, 0.03, 0.0));
	float lit = clamp(dot(nrm, sd) * 1.4 + 0.15, 0.0, 1.0) * smoothstep(-0.03, 0.02, sun_dir.y);
	vec3 col = light_ambient * (0.9 + 0.5 * billow) + light_sun * (0.9 * lit + 1.6 * fwd);
	ALBEDO = col;
	ALPHA = clamp(alpha, 0.0, 1.0);
}
