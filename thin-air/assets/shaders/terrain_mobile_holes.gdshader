// THIN AIR — terrain_mobile.gdshader with heightfield cut-outs (innermost clipmap level near a cut-out).
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_opaque;

#define TERRAIN_MOBILE
#define TERRAIN_HOLES
#include "res://assets/shaders/terrain_common.gdshaderinc"
#include "res://assets/shaders/terrain_material.gdshaderinc"
#include "res://assets/shaders/terrain_surface.gdshaderinc"
