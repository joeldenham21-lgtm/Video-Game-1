// THIN AIR — shared code for player-built structures (building_log / building_planks).
// Mesh conventions (tools/blender/building/blib.py): UV in metres (V along the grain), UV2 = per-part random
// offset, COLOR r = baked AO, g = build step 0..1, b = bark density / weathering, a = flag (0 wood, .5 endgrain,
// 1 chinking). Snow settles on up-facing exposed surfaces (global snow_cover + altitude), rain/melt darkens.
// MultiMesh instances pass INSTANCE_CUSTOM = (seed, exposure, 0, 1); single meshes use instance uniforms.
// Defines: FRAME -> fragments of steps beyond `build_progress` are discarded (a frame being filled).

global uniform float snow_cover;
global uniform float wetness;

uniform sampler2D noise_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float snow_line_low = 1750.0;
uniform float snow_line_high = 2050.0;
instance uniform float exposure = 1.0;
#ifdef FRAME
uniform float build_progress : hint_range(0.0, 1.0) = 0.0;
#endif

varying vec3 v_world_n;
varying vec3 v_world_pos;
varying float v_seed;
varying float v_exposed;
varying float v_step;

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

float building_seed(mat4 model, vec4 custom) {
	return custom.w > 0.5 ? custom.x : hash13(floor(model[3].xyz * 4.0) + 0.5);
}

// Varyings can only be written in vertex() itself: every building shader calls this macro there.
#define BUILDING_VERTEX v_world_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz); v_world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; v_seed = building_seed(MODEL_MATRIX, INSTANCE_CUSTOM); v_exposed = INSTANCE_CUSTOM.w > 0.5 ? INSTANCE_CUSTOM.y : exposure; v_step = COLOR.g;

// Snow amount 0..1 for the current fragment (up-facing, exposed, cold enough).
float building_snow(float n) {
	float s = clamp(snow_cover * 1.3 + smoothstep(snow_line_low, snow_line_high, v_world_pos.y) * 0.6, 0.0, 1.0);
	s *= v_exposed;
	// up-facing, then patchy: light cover settles in drifts, heavy cover buries everything
	float up = smoothstep(0.45, 0.9, v_world_n.y + (n - 0.5) * 0.2);
	float wn = texture(noise_tex, v_world_pos.xz * 0.21 + v_world_pos.y * 0.05).r * 0.75 + n * 0.25;
	float th = 1.0 - s * 1.7;
	return up * smoothstep(th - 0.1, th + 0.1, wn) * smoothstep(0.0, 0.1, s);
}

void apply_weather(inout vec3 albedo, inout float rough, inout vec3 nrm_ts, float n) {
	float wet = clamp(wetness * v_exposed, 0.0, 1.0) * smoothstep(-0.3, 0.4, v_world_n.y + 0.2);
	albedo *= 1.0 - 0.32 * wet;
	rough = mix(rough, rough * 0.55, wet);
	float snow = building_snow(n);
	vec3 snow_col = vec3(0.86, 0.89, 0.93) * (0.92 + 0.08 * n);
	albedo = mix(albedo, snow_col, snow);
	rough = mix(rough, 0.62, snow);
	nrm_ts = mix(nrm_ts, vec3(0.5, 0.5, 1.0), snow * 0.8);
}

#ifdef FRAME
void frame_clip() {
	if (v_step > build_progress + 0.0005) {
		discard;
	}
}
#endif
