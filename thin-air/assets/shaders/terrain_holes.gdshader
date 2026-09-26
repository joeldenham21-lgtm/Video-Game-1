// THIN AIR — terrain.gdshader with heightfield cut-outs (innermost clipmap level near a mine adit / ice cave).
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_opaque;

#define TERRAIN_HOLES
#include "res://assets/shaders/terrain_common.gdshaderinc"
#include "res://assets/shaders/terrain_material.gdshaderinc"
#include "res://assets/shaders/terrain_surface.gdshaderinc"
