shader_type canvas_item;
render_mode unshaded;
// Full-screen survival effects over the 3D view (HUD "ScreenFX" rect; only enabled while something is active).
//  frost      warmth dropping: ice crystals creep in from the screen edges, the view behind them frosts over
//  hypoxia    low oxygen: tunnel vision (edge blur + darkening), desaturation, a slow pulsing dim
//  wet        droplets on the eye/face refract the scene, revealed progressively with wetness
//  low_health desaturation + red-brown vignette that throbs with the heartbeat (pulse)
//  damage     brief red vignette flash on a hit
//  blackout   extra darkening (hypoxic blackout / fainting)

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform sampler2D frost_tex : filter_linear_mipmap, repeat_enable;
uniform sampler2D drops_tex : filter_linear_mipmap, repeat_enable;
uniform float frost : hint_range(0.0, 1.0) = 0.0;
uniform float hypoxia : hint_range(0.0, 1.0) = 0.0;
uniform float wet : hint_range(0.0, 1.0) = 0.0;
uniform float low_health : hint_range(0.0, 1.0) = 0.0;
uniform float damage : hint_range(0.0, 1.0) = 0.0;
uniform float pulse : hint_range(0.0, 1.0) = 0.0;
uniform float blackout : hint_range(0.0, 1.0) = 0.0;
uniform float aspect = 1.7778;
uniform float t = 0.0;
uniform bool high_quality = true;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
	float r = length(p) / (0.5 * sqrt(aspect * aspect + 1.0));   // 0 centre .. 1 corner
	// distance to the nearest screen edge in screen-height units
	float d_edge = min(min(uv.x, 1.0 - uv.x) * aspect, min(uv.y, 1.0 - uv.y));
	vec2 tuv = uv * vec2(aspect, 1.0);

	// ---- droplets (refraction)
	vec2 offs = vec2(0.0);
	float drop_m = 0.0;
	if (wet > 0.001) {
		vec4 d = texture(drops_tex, tuv * 0.9 + vec2(0.0, -t * 0.004));
		float show = smoothstep(d.a - 0.04, d.a, wet * 0.85);
		drop_m = d.b * show;
		offs = (d.rg - 0.5) * 0.045 * drop_m;
	}

	// ---- frost field
	float fm = 0.0;
	float crystal = 0.0;
	if (frost > 0.001) {
		vec3 f = texture(frost_tex, tuv * 0.55).rgb;
		// the front advances further where the coverage field is high; wobble it with crystal detail
		float reach = frost * 0.42;
		float front = d_edge - (f.r - 0.5) * 0.22 * frost - f.g * 0.03;
		fm = 1.0 - smoothstep(reach * 0.55, reach + 0.02, front);
		crystal = f.g;
		offs += (vec2(f.b, f.g) - 0.5) * 0.012 * fm;
	}

	// ---- blur amount (mip level of the screen copy)
	float tunnel = hypoxia * smoothstep(0.25 - 0.2 * hypoxia, 1.0, r);
	float lod = tunnel * 4.5 + fm * 2.5 + drop_m * 1.2 + low_health * smoothstep(0.5, 1.0, r) * 1.5;
	if (!high_quality) {
		lod = min(lod, 2.5);
	}
	vec3 col = textureLod(screen_tex, uv + offs, lod).rgb;
	// droplet highlight rim: a little brighter on the upper edge
	col += drop_m * 0.05 * max(0.0, -offs.y * 40.0);

	// ---- desaturation
	float y = luma(col);
	float desat = clamp(low_health * 0.8 + hypoxia * 0.55, 0.0, 0.92);
	col = mix(col, vec3(y), desat);

	// ---- hypoxia: darkening tunnel with a slow pulse
	float hp = 0.8 + 0.2 * sin(t * 2.1);
	col *= 1.0 - clamp(tunnel * 1.25 * hp, 0.0, 0.96);
	col *= 1.0 - hypoxia * 0.18 * (0.5 + 0.5 * sin(t * 2.1));

	// ---- low health + damage: red-brown vignette, heartbeat throb
	float vig = smoothstep(0.35, 1.05, r);
	float red = clamp(low_health * (0.55 + 0.45 * pulse) * vig + damage * smoothstep(0.15, 1.0, r) * 0.85, 0.0, 1.0);
	col = mix(col, col * vec3(0.42, 0.06, 0.05) + vec3(0.06, 0.0, 0.0), red);
	col *= 1.0 - low_health * pulse * 0.12;

	// ---- frost: pale blue-white ice with bright crystal edges over the frosted view
	if (fm > 0.0) {
		vec3 ice = mix(vec3(0.78, 0.86, 0.93), vec3(0.96, 0.98, 1.0), crystal);
		float veil = fm * (0.45 + 0.4 * crystal);
		col = mix(col, max(col, vec3(y) * 0.6 + 0.25) * vec3(0.9, 0.96, 1.05), fm * 0.35);
		col = mix(col, ice * (0.75 + 0.25 * y), veil * 0.75);
	}

	col *= 1.0 - blackout;
	COLOR = vec4(col, 1.0);
}
