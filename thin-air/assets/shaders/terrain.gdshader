// THIN AIR — terrain surface, desktop / Forward+ quality (3 height-blended layers, biplanar cliffs,
// anti-tiling, 360 m texture range). See terrain_common.gdshaderinc and terrain_material.gdshaderinc.
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_opaque;

#include "res://assets/shaders/terrain_common.gdshaderinc"
#include "res://assets/shaders/terrain_material.gdshaderinc"
#include "res://assets/shaders/terrain_surface.gdshaderinc"
