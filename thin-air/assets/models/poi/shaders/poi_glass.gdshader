shader_type spatial;
// Window glass: thin, slightly green, grimy (glass_grime alpha), Fresnel reflection; when the site's interior
// lights are on (`lit`) the pane glows warm from the room behind it (reads as a lit window from far away).
render_mode blend_mix, depth_draw_opaque, cull_disabled, diffuse_burley, specular_schlick_ggx;
uniform sampler2D grime_tex : source_color, filter_linear_mipmap, repeat_enable, hint_default_white;
uniform vec2 uv_scale = vec2(1.0);
uniform vec3 glass_tint : source_color = vec3(0.10, 0.13, 0.12);
uniform float grime = 1.0;
uniform float frost = 0.0;
uniform vec3 glow_color : source_color = vec3(1.0, 0.72, 0.42);
uniform float glow_energy = 0.0;
uniform float lit = 0.0;

void fragment() {
	vec4 g = texture(grime_tex, UV * uv_scale);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
	float dirt = g.a * grime;
	ALBEDO = mix(glass_tint, g.rgb * 0.8, dirt) * COLOR.rgb;
	ROUGHNESS = mix(0.06, 0.55, max(dirt, frost));
	METALLIC = 0.0;
	SPECULAR = 0.5;
	ALPHA = clamp(0.16 + dirt * 0.55 + frost * 0.6 + fres * 0.5, 0.0, 0.96);
	EMISSION = glow_color * glow_energy * lit * (1.0 - dirt * 0.5);
}
