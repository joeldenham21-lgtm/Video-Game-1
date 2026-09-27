shader_type spatial;
// THIN AIR fauna: ambient bird (raven / golden eagle). Static mesh; the wings flap in the vertex shader:
// vertices beyond the shoulder (|x| > body_half) rotate about the shoulder line, more toward the tips
// (flex), with a phase lag along the span. flap = 0 glides (wings held at a slight dihedral).
render_mode diffuse_burley, specular_schlick_ggx, cull_disabled;

uniform vec3 color_body : source_color = vec3(0.03, 0.03, 0.035);
uniform vec3 color_wing : source_color = vec3(0.02, 0.02, 0.025);
uniform vec3 color_head : source_color = vec3(0.03, 0.03, 0.035);
uniform float head_z = -0.2;          // model z in front of which the head colour applies
uniform float body_half = 0.06;
uniform float span_half = 0.6;
uniform float gloss = 0.35;
uniform float dihedral = 0.12;
instance uniform float flap = 0.0;
instance uniform float flap_phase = 0.0;
instance uniform float flap_rate = 5.0;

varying float v_span;
varying float v_head;

void vertex() {
	float ax = abs(VERTEX.x);
	float sgn = sign(VERTEX.x);
	float s = clamp((ax - body_half) / max(span_half - body_half, 0.01), 0.0, 1.0);
	v_span = s;
	v_head = smoothstep(head_z + 0.03, head_z - 0.03, VERTEX.z) * (1.0 - s);
	float ph = TIME * flap_rate * 6.2831853 + flap_phase;
	float ang = flap * (0.75 * sin(ph) + 0.1) + dihedral * (1.0 - flap);
	float a = ang * (0.55 + 0.45 * s) + flap * 0.35 * s * sin(ph - 0.9);
	if (ax > body_half) {
		float r = ax - body_half;
		VERTEX.x = sgn * (body_half + r * cos(a));
		VERTEX.y += r * sin(a);
		VERTEX.z += flap * 0.03 * s * cos(ph);
	}
}

void fragment() {
	vec3 col = mix(color_body, color_wing, smoothstep(0.3, 0.75, v_span));
	col = mix(col, color_head, v_head);
	ALBEDO = col;
	ROUGHNESS = 1.0 - gloss;
	SPECULAR = 0.5;
	RIM = 0.25;
	RIM_TINT = 0.5;
}
