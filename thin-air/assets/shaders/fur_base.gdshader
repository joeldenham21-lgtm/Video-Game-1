shader_type spatial;
// THIN AIR fauna: base coat of a skinned animal (surface 0). The coat texture is baked by
// tools/blender/fauna (RGB = coat colour, A = local fur length 0..1). Fur look without shells: strand-level
// albedo variation, under-coat darkening where the fur is long, strand-grain normal perturbation, and the
// soft rim/back-light scattering of a furry silhouette. Shells (fur_shell.gdshader) add the volume near the camera.
render_mode diffuse_burley, specular_schlick_ggx, cull_back;

uniform sampler2D coat_tex : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D strand_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float strand_scale = 8.0;
uniform vec3 tint : source_color = vec3(1.0);
uniform float roughness = 0.84;
uniform float under_shadow = 0.3;
uniform float sheen = 0.18;
uniform float grain = 0.6;
uniform float wet_response = 1.0;
uniform float snow_catch = 0.0;      // snow dusting on the back (animals out in snowfall)
global uniform float wetness;

varying float v_up;

void vertex() {
	v_up = (MODEL_MATRIX * vec4(NORMAL, 0.0)).y;
}

void fragment() {
	vec4 c = texture(coat_tex, UV);
	vec2 suv = UV * strand_scale;
	vec3 s = texture(strand_tex, suv).rgb;
	float fl = c.a;
	vec3 col = c.rgb * tint;
	col *= mix(0.8, 1.08, s.r) * mix(1.0, 1.0 - under_shadow, fl * (0.5 + 0.5 * s.g));
	float w = clamp(wetness * wet_response, 0.0, 1.0);
	col *= mix(1.0, 0.62, w);
	float snow = snow_catch * smoothstep(0.35, 0.9, v_up) * smoothstep(0.35, 0.7, s.b);
	col = mix(col, vec3(0.86, 0.88, 0.9), snow);
	ALBEDO = col;
	ROUGHNESS = mix(roughness, 0.5, w);
	SPECULAR = 0.32;
	RIM = sheen * (0.35 + 0.65 * fl);
	RIM_TINT = 0.7;
	BACKLIGHT = col * 0.12 * fl;
	// strand grain: finite-difference bump of the strand map (tangent space)
	float e = 1.0 / 512.0;
	float h0 = texture(strand_tex, suv).g;
	float hx = texture(strand_tex, suv + vec2(e, 0.0)).g;
	float hy = texture(strand_tex, suv + vec2(0.0, e)).g;
	NORMAL_MAP = normalize(vec3((h0 - hx) * grain * 4.0, (h0 - hy) * grain * 4.0, 1.0)) * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 0.35 + 0.65 * fl;
}
