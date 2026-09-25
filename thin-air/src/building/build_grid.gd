class_name BuildGrid
extends RefCounted
## Grid maths for log structures (pure functions — tested in tests/test_building.gd).
##
## A structure has its own frame (origin = centre of its first foundation at deck height, yaw of that
## foundation). Slots are integer half-cells: slot = Vector3i(hx, level, hz), position = (hx·1 m,
## level·LEVEL_H, hz·1 m). Parity decides what lives there:
##   cell  (hx even, hz even)  foundations, floors, roofs, stairs
##   xedge (hx even, hz odd)   walls running along X ("even" log courses)
##   zedge (hx odd,  hz even)  walls running along Z ("odd" courses: half-log sill, interleaved corners)
##   node  (hx odd,  hz odd)   pillars, stilt posts
## Constants match tools/blender/building/pieces_structure.py.

const CELL := 2.0
const LEVEL_H := 2.6
const WALL_TOP := 2.44
const ROOF_RISE := 1.35
const ROOF_SLOPE := ROOF_RISE / CELL
const DECK_R := 1.0 / 7.0
const SILL_R := 0.15
const SILL_Y := -DECK_R - SILL_R
const POST_TOP := SILL_Y - SILL_R + 0.02
const MAX_POST := 3.6               ## longest stilt (m)
const MIN_CLEARANCE := 0.5          ## deck top above the highest ground under a new foundation
const MAX_FOUNDATION_DROP := 1.25   ## ground height difference across one cell (≈ 25° over the diagonal)
const MAX_BUILD_DISTANCE := 8.0

enum Kind { CELL, XEDGE, ZEDGE, NODE }

## Rise direction per roof/stairs `dir` (0 +X, 1 +Z, 2 −X, 3 −Z), in half-cell units.
const DIRS: Array[Vector2i] = [Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(0, -1)]


static func kind_of(slot: Vector3i) -> Kind:
	var ox := absi(slot.x) % 2 == 1
	var oz := absi(slot.z) % 2 == 1
	if not ox and not oz:
		return Kind.CELL
	if not ox and oz:
		return Kind.XEDGE
	if ox and not oz:
		return Kind.ZEDGE
	return Kind.NODE


static func slot_position(slot: Vector3i) -> Vector3:
	return Vector3(float(slot.x), float(slot.y) * LEVEL_H, float(slot.z))


static func level_y(level: int) -> float:
	return float(level) * LEVEL_H


## Yaw (radians) that turns local +X into the direction `dir`.
static func dir_yaw(dir: int) -> float:
	return -float(posmod(dir, 4)) * PI * 0.5


static func dir_vec(dir: int) -> Vector2i:
	return DIRS[posmod(dir, 4)]


## Direction index closest to a local-space XZ vector.
static func dir_from_vector(v: Vector3) -> int:
	if absf(v.x) >= absf(v.z):
		return 0 if v.x >= 0.0 else 2
	return 1 if v.z >= 0.0 else 3


## Nearest cell slot to a local position.
static func nearest_cell(local: Vector3, level: int) -> Vector3i:
	return Vector3i(roundi(local.x / CELL) * 2, level, roundi(local.z / CELL) * 2)


## Nearest node (corner) slot to a local position.
static func nearest_node(local: Vector3, level: int) -> Vector3i:
	return Vector3i(roundi((local.x - 1.0) / CELL) * 2 + 1, level, roundi((local.z - 1.0) / CELL) * 2 + 1)


## Nearest wall edge slot to a local position (midpoint of the closest cell side).
static func nearest_edge(local: Vector3, level: int) -> Vector3i:
	var c := nearest_cell(local, level)
	var dx := local.x - float(c.x)
	var dz := local.z - float(c.z)
	if absf(dx) >= absf(dz):
		return Vector3i(c.x + (1 if dx >= 0.0 else -1), level, c.z)
	return Vector3i(c.x, level, c.z + (1 if dz >= 0.0 else -1))


## The four edges of a cell, the two cells beside an edge, the two nodes at an edge's ends.
static func cell_edges(cell: Vector3i) -> Array[Vector3i]:
	return [cell + Vector3i(1, 0, 0), cell + Vector3i(0, 0, 1), cell + Vector3i(-1, 0, 0), cell + Vector3i(0, 0, -1)]


static func edge_cells(edge: Vector3i) -> Array[Vector3i]:
	if kind_of(edge) == Kind.XEDGE:
		return [edge + Vector3i(0, 0, -1), edge + Vector3i(0, 0, 1)]
	return [edge + Vector3i(-1, 0, 0), edge + Vector3i(1, 0, 0)]


static func edge_nodes(edge: Vector3i) -> Array[Vector3i]:
	if kind_of(edge) == Kind.XEDGE:
		return [edge + Vector3i(-1, 0, 0), edge + Vector3i(1, 0, 0)]
	return [edge + Vector3i(0, 0, -1), edge + Vector3i(0, 0, 1)]


static func cell_nodes(cell: Vector3i) -> Array[Vector3i]:
	return [cell + Vector3i(1, 0, 1), cell + Vector3i(-1, 0, 1), cell + Vector3i(-1, 0, -1), cell + Vector3i(1, 0, -1)]


static func node_cells(node: Vector3i) -> Array[Vector3i]:
	return [node + Vector3i(1, 0, 1), node + Vector3i(-1, 0, 1), node + Vector3i(-1, 0, -1), node + Vector3i(1, 0, -1)]


## Edge continuing `edge` straight on past `node` (same orientation).
static func collinear_edge(edge: Vector3i, node: Vector3i) -> Vector3i:
	return node + (node - edge)


## Edges meeting at a node (4, two per axis).
static func node_edges(node: Vector3i) -> Array[Vector3i]:
	return [node + Vector3i(1, 0, 0), node + Vector3i(-1, 0, 0), node + Vector3i(0, 0, 1), node + Vector3i(0, 0, -1)]


## Yaw of a wall on this edge (local +X along the edge).
static func edge_yaw(edge: Vector3i) -> float:
	return 0.0 if kind_of(edge) == Kind.XEDGE else -PI * 0.5


static func edge_parity(edge: Vector3i) -> String:
	return "even" if kind_of(edge) == Kind.XEDGE else "odd"


## Cell a roof/stairs neighbour lies in, `steps` cells along `dir`.
static func cell_step(cell: Vector3i, dir: int, steps := 1) -> Vector3i:
	var d := dir_vec(dir)
	return cell + Vector3i(d.x * 2 * steps, 0, d.y * 2 * steps)


## The edge of `cell` on the `dir` side.
static func cell_side_edge(cell: Vector3i, dir: int) -> Vector3i:
	var d := dir_vec(dir)
	return cell + Vector3i(d.x, 0, d.y)


## Roof side edges (the two edges parallel to its rise direction).
static func roof_side_edges(cell: Vector3i, dir: int) -> Array[Vector3i]:
	return [cell_side_edge(cell, dir + 1), cell_side_edge(cell, dir + 3)]


## Post length (m) from the sill underside of a deck at `deck_y` down to ground at `ground_y` (+ embed).
static func post_length(deck_y: float, ground_y: float) -> float:
	return (deck_y + POST_TOP) - ground_y + 0.08


## Deck height for a first foundation given ground heights sampled under it.
static func foundation_height(ground: PackedFloat32Array) -> float:
	var hi := -INF
	for g in ground:
		hi = maxf(hi, g)
	return hi + MIN_CLEARANCE


## "" if a foundation at deck height `deck_y` over these ground samples is acceptable, else the reason.
static func foundation_ground_check(deck_y: float, ground: PackedFloat32Array, new_structure: bool) -> String:
	var lo := INF
	var hi := -INF
	for g in ground:
		lo = minf(lo, g)
		hi = maxf(hi, g)
	if new_structure and hi - lo > MAX_FOUNDATION_DROP:
		return "Too steep"
	if hi > deck_y + POST_TOP + 0.12:
		return "Ground too high"
	if post_length(deck_y, lo) > MAX_POST:
		return "Too high above the ground"
	return ""


## Shelter factor of a room from roof coverage (0..1) and summed openness of its perimeter
## (Σ(1 − closure) over perimeter edges: 1 per missing wall, 0.2 per window, 0.55 per open door…).
static func shelter_factor(roof_cover: float, openness: float) -> float:
	var enclosure := clampf(1.0 - 0.33 * openness, 0.0, 1.0)
	return clampf(roof_cover * (0.3 + 0.7 * enclosure) + (1.0 - roof_cover) * 0.2 * enclosure, 0.0, 1.0)
