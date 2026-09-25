shader_type canvas_item;
// Topographic paper map rendered from TerrainData's heightfield on the GPU (resolution independent: crisp
// contours at every zoom). Contours every 50 m (brown on land, blue on snow and ice) with bold index contours
// every 250 m, NW hillshade, forest tint (masks.a), snow/glacier tint (masks.r), rock tint (masks.g), a 500 m
// grid, paper grain, and a neat line at the edge of the surveyed area. Water, trails and labels are vector
// overlays drawn above (MapView).

uniform sampler2D height_tex : filter_nearest;
uniform vec4 hparams = vec4(-1536.0, -1536.0, 1.5, 2049.0);   // origin x, z, cell, size (texels)
uniform bool has_masks = false;
uniform sampler2D mask_tex : filter_linear_mipmap, hint_default_black;    // R snow, G rock, B grass, A forest
uniform vec4 mparams = vec4(-1536.0, -1536.0, 3072.0, 0.0);
uniform vec2 view_center = vec2(0.0);      // world x, z at the centre of the rect
uniform float m_per_px = 3.0;              // metres per rect pixel
uniform vec2 rect_px = vec2(1024.0, 768.0);
uniform float contour = 50.0;
uniform float index_every = 5.0;
uniform float half_extent = 1536.0;
uniform float grid_m = 500.0;
uniform float h_min = 1300.0;
uniform float h_max = 3460.0;

float h_texel(ivec2 i) {
	return texelFetch(height_tex, clamp(i, ivec2(0), ivec2(int(hparams.w) - 1)), 0).r;
}

float h_at(vec2 xz) {
	vec2 t = (xz - hparams.xy) / hparams.z;
	t = clamp(t, vec2(0.0), vec2(hparams.w - 1.001));
	ivec2 i = ivec2(floor(t));
	vec2 f = t - vec2(i);
	float a = h_texel(i);
	float b = h_texel(i + ivec2(1, 0));
	float c = h_texel(i + ivec2(0, 1));
	float d = h_texel(i + ivec2(1, 1));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float hash(vec2 p) {
	p = fract(p * vec2(443.897, 441.423));
	p += dot(p, p.yx + 19.19);
	return fract((p.x + p.y) * p.x);
}

float line_aa(float d_px, float w) {
	return clamp(w * 0.5 + 0.5 - d_px, 0.0, 1.0);
}

void fragment() {
	vec2 px = UV * rect_px;
	vec2 xz = view_center + (px - rect_px * 0.5) * m_per_px;
	float inside = step(abs(xz.x), half_extent) * step(abs(xz.y), half_extent);
	float h = h_at(xz);
	float e = max(hparams.z, m_per_px);
	float hx = h_at(xz + vec2(e, 0.0)) - h_at(xz - vec2(e, 0.0));
	float hz = h_at(xz + vec2(0.0, e)) - h_at(xz - vec2(0.0, e));
	vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));
	float slope = 1.0 - n.y;

	// ---- base paper + land-cover tints
	vec3 paper = vec3(0.945, 0.925, 0.875);
	float grain = hash(floor(px)) * 0.035 + hash(floor(px * 0.25)) * 0.02;
	vec3 col = paper;
	vec4 m = vec4(0.0);
	if (has_masks) {
		m = texture(mask_tex, (xz - mparams.xy) / mparams.z);
	} else {
		// rules when no masks: snow above ~1,900 m, forest in the montane band
		m.r = smoothstep(1850.0, 2000.0, h) * (1.0 - smoothstep(0.35, 0.55, slope));
		m.a = (1.0 - smoothstep(2050.0, 2200.0, h)) * smoothstep(1380.0, 1420.0, h) * (1.0 - smoothstep(0.3, 0.5, slope));
		m.g = smoothstep(0.45, 0.65, slope);
	}
	col = mix(col, vec3(0.79, 0.86, 0.72), clamp(m.a, 0.0, 1.0) * 0.85);     // forest green
	col = mix(col, vec3(0.86, 0.84, 0.8), clamp(m.g, 0.0, 1.0) * 0.6);       // bare rock
	float snow = clamp(m.r, 0.0, 1.0);
	col = mix(col, vec3(0.975, 0.985, 1.0), snow * 0.9);                      // snow / glacier
	// ---- hillshade (light from the north-west, 45°) + a touch of altitude tint
	vec3 L = normalize(vec3(-1.0, 1.4142, -1.0));
	float shade = clamp(dot(n, L), 0.0, 1.0);
	float flat_shade = dot(vec3(0.0, 1.0, 0.0), L);
	col *= mix(1.0, 0.78 + 0.34 * (shade / flat_shade) * 0.8, 0.9);
	col *= 1.0 - 0.05 * smoothstep(h_min, h_max, h);
	// ---- contours: distance in pixels to the nearest contour level
	float fw = max(fwidth(h), 1e-4);
	float k = h / contour;
	float d = abs(fract(k + 0.5) - 0.5) * contour / fw;
	float lvl = floor(k + 0.5);
	bool is_index = mod(lvl, index_every) < 0.5;
	float w = is_index ? 1.6 : 0.8;
	float steep_fade = mix(0.25, 1.0, smoothstep(1.0, 3.5, contour / fw));   // contours merge on cliffs: fade them
	vec3 ccol = mix(vec3(0.62, 0.42, 0.26), vec3(0.3, 0.52, 0.72), step(0.5, snow));
	float ca = line_aa(d, w) * (is_index ? 0.85 : 0.55) * steep_fade;
	col = mix(col, ccol, ca * inside);
	// ---- 500 m grid
	vec2 g = abs(fract(xz / grid_m + 0.5) - 0.5) * grid_m / m_per_px;
	float gl = max(line_aa(g.x, 0.7), line_aa(g.y, 0.7));
	col = mix(col, vec3(0.42, 0.55, 0.7), gl * 0.3);
	// ---- outside the surveyed area: plain paper; neat line at the edge
	vec3 outside = paper * 0.93;
	col = mix(outside, col, inside);
	vec2 edge = abs(abs(xz) - half_extent) / m_per_px;
	float nl = max(line_aa(edge.x, 1.6) * step(abs(xz.y), half_extent + m_per_px), line_aa(edge.y, 1.6) * step(abs(xz.x), half_extent + m_per_px));
	col = mix(col, vec3(0.2, 0.2, 0.2), nl * 0.8);
	col -= grain;
	COLOR = vec4(col, 1.0);
}
