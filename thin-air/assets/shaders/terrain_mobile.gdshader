// THIN AIR — terrain surface, Mobile renderer path (2 height-blended layers, planar projection only,
// shorter texture range). Same geometry, masks, snow, wetness and heightfield sun shadow as terrain.gdshader.
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_opaque;

#define TERRAIN_MOBILE
#include "res://assets/shaders/terrain_common.gdshaderinc"
#include "res://assets/shaders/terrain_material.gdshaderinc"
#include "res://assets/shaders/terrain_surface.gdshaderinc"
