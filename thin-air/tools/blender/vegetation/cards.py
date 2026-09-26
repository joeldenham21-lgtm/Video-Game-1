"""Foliage card atlases: models real branchlets (twigs + individual needles/leaves/blades) in Blender and
renders them orthographically with Cycles into albedo(+alpha) and tangent-space normal atlases.

Run:  blender -b -P thin-air/tools/blender/vegetation/cards.py -- [--only=spruce,fir] [--res=1024] [--spp=24]
Out:  assets/textures/foliage/<set>_albedo.png  (sRGB RGB + coverage alpha, colour dilated into the gaps)
      assets/textures/foliage/<set>_normal.png  (OpenGL/Y+ tangent normal: +U = image right, +V = image up)
      assets/textures/foliage/cards.json         (card regions: uv rect, metric size, stem attach point)

Atlas layout (every set, image space, origin top-left, 1 atlas = 1 m x 1 m of modelled foliage):
  "long"  : u 0.0-0.5, v 0.0-1.0  -> 0.5 m x 1.0 m spray, stem enters at the bottom centre, tip at the top
  "short" : u 0.5-1.0, v 0.0-0.5  -> 0.5 m x 0.5 m spray (stem bottom centre)
  "tip"   : u 0.5-1.0, v 0.5-1.0  -> 0.5 m x 0.5 m second variant (leader / tuft / side view)
Grass-like sets (grass, sedge) are rendered from the SIDE: blades stand up along +V, roots at the bottom edge.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vegcommon as vc  # noqa: E402

# ------------------------------------------------------------------------------------------------ geometry kit


class Geo:
	"""Vectorised triangle soup with per-vertex linear RGB colour."""

	def __init__(self):
		self.v: list[np.ndarray] = []
		self.f: list[np.ndarray] = []
		self.c: list[np.ndarray] = []
		self.n = 0

	def add(self, verts: np.ndarray, faces: np.ndarray, cols: np.ndarray) -> None:
		self.v.append(verts.reshape(-1, 3))
		self.f.append(faces.reshape(-1, 3) + self.n)
		self.c.append(np.broadcast_to(cols, (verts.reshape(-1, 3).shape[0], 3)).copy())
		self.n += verts.reshape(-1, 3).shape[0]

	def build(self, name: str, mat) -> bpy.types.Object:
		V = np.concatenate(self.v).astype(np.float32)
		F = np.concatenate(self.f).astype(np.int32)
		C = np.concatenate(self.c).astype(np.float32)
		me = bpy.data.meshes.new(name)
		me.vertices.add(len(V))
		me.vertices.foreach_set("co", V.ravel())
		me.loops.add(len(F) * 3)
		me.loops.foreach_set("vertex_index", F.ravel())
		me.polygons.add(len(F))
		me.polygons.foreach_set("loop_start", np.arange(0, len(F) * 3, 3, dtype=np.int32))
		me.polygons.foreach_set("loop_total", np.full(len(F), 3, dtype=np.int32))
		me.update(calc_edges=True)
		me.polygons.foreach_set("use_smooth", np.ones(len(F), dtype=bool))
		ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
		ca.data.foreach_set("color", np.concatenate([C, np.ones((len(C), 1), np.float32)], 1).ravel())
		me.materials.append(mat)
		ob = bpy.data.objects.new(name, me)
		vc.link(ob)
		return ob


def _frame(d: np.ndarray, up_hint: np.ndarray):
	"""Orthonormal frames (N,3,3): x = d, y = side, z = up-ish."""
	d = vc.normalize(d)
	s = np.cross(up_hint, d)
	bad = np.linalg.norm(s, axis=-1) < 1e-6
	if np.any(bad):
		s[bad] = np.cross(np.array([1.0, 0.0, 0.0]), d[bad])
	s = vc.normalize(s)
	u = np.cross(d, s)
	return d, s, u


def needles(geo: Geo, base: np.ndarray, d: np.ndarray, length: np.ndarray, width: np.ndarray,
		thick: np.ndarray, cols: np.ndarray, up_hint=None, bend: np.ndarray | None = None,
		sides: int = 4, segs: int = 3, blunt: float = 0.25, top_col: np.ndarray | None = None) -> None:
	"""Instances tapered needles. base/d (N,3); length/width/thick (N,). bend (N,3) = tip displacement
	direction*amount (quadratic along the needle). top_col (N,3): colour of the +up face (stomatal stripe)."""
	N = base.shape[0]
	if N == 0:
		return
	if up_hint is None:
		up_hint = np.tile(np.array([0.0, 0.0, 1.0]), (N, 1))
	x, y, z = _frame(d, up_hint)
	t = np.linspace(0.0, 1.0, segs + 1)
	prof = np.where(t < 0.12, 0.55 + t / 0.12 * 0.45, 1.0 - (1.0 - blunt) * np.clip((t - 0.55) / 0.45, 0, 1) ** 1.3)
	prof[-1] = 0.05
	ang = np.arange(sides) / sides * 2 * math.pi + math.pi / sides
	ca, sa = np.cos(ang), np.sin(ang)
	# template (segs+1, sides, 3) in needle space: along x, cross-section in (y, z)
	tx = np.repeat(t[:, None], sides, 1)
	ty = prof[:, None] * ca[None, :] * 0.5
	tz = prof[:, None] * sa[None, :] * 0.5
	L = length[:, None, None]
	P = (base[:, None, None, :]
		+ (tx[None] * L)[..., None] * x[:, None, None, :]
		+ (ty[None] * width[:, None, None])[..., None] * y[:, None, None, :]
		+ (tz[None] * thick[:, None, None])[..., None] * z[:, None, None, :])
	if bend is not None:
		P = P + (tx[None] ** 2)[..., None] * bend[:, None, None, :]
	verts = P.reshape(N, -1, 3)
	# faces of one needle
	fl = []
	for i in range(segs):
		for j in range(sides):
			a = i * sides + j
			b = i * sides + (j + 1) % sides
			c = (i + 1) * sides + (j + 1) % sides
			e = (i + 1) * sides + j
			fl += [(a, b, c), (a, c, e)]
	fl = np.array(fl, dtype=np.int64)
	nv = (segs + 1) * sides
	faces = fl[None] + (np.arange(N) * nv)[:, None, None]
	C = np.repeat(cols[:, None, :], nv, 1)
	if top_col is not None:
		topmask = (sa > 0.3)[None, None, :] & np.ones((1, segs + 1, 1), bool)
		topmask = topmask.reshape(1, nv)
		C = np.where(topmask[..., None], np.repeat(top_col[:, None, :], nv, 1), C)
	geo.add(verts.reshape(-1, 3), faces.reshape(-1, 3), C.reshape(-1, 3))


def tube(geo: Geo, pts: np.ndarray, radii: np.ndarray, col, sides: int = 6) -> None:
	pts = np.asarray(pts, dtype=np.float64)
	n = len(pts)
	if n < 2:
		return
	tang = np.gradient(pts, axis=0)
	tang = vc.normalize(tang)
	up = np.tile(np.array([0.0, 0.0, 1.0]), (n, 1))
	_, s, u = _frame(tang, up)
	ang = np.arange(sides) / sides * 2 * math.pi
	ring = (np.cos(ang)[None, :, None] * s[:, None, :] + np.sin(ang)[None, :, None] * u[:, None, :])
	V = pts[:, None, :] + ring * np.asarray(radii)[:, None, None]
	fl = []
	for i in range(n - 1):
		for j in range(sides):
			a = i * sides + j
			b = i * sides + (j + 1) % sides
			fl += [(a, b, b + sides), (a, b + sides, a + sides)]
	col = np.asarray(col, dtype=np.float64)
	geo.add(V.reshape(-1, 3), np.array(fl), np.broadcast_to(col, (n * sides, 3)))


def curve_pts(p0, d0, length, n, bend_vec=(0, 0, 0), wobble=0.0, rs=None):
	"""Polyline from p0 along d0 with quadratic bending (bend_vec * s^2) and small wobble."""
	s = np.linspace(0, 1, n)
	d0 = vc.normalize(np.asarray(d0, dtype=np.float64))
	P = np.asarray(p0, dtype=np.float64)[None] + np.outer(s * length, d0) + np.outer(s ** 2 * length, bend_vec)
	if wobble > 0 and rs is not None:
		P += rs.normal(0, wobble * length, (n, 3)) * np.sin(s * math.pi)[:, None]
	return P


def resample(P: np.ndarray, step: float):
	"""Points along polyline P every `step` metres: returns positions, tangents, arc-length fraction."""
	seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
	cum = np.concatenate([[0], np.cumsum(seg)])
	total = cum[-1]
	if total < 1e-6:
		return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0)
	s = np.arange(step * 0.5, total, step)
	idx = np.clip(np.searchsorted(cum, s) - 1, 0, len(seg) - 1)
	f = ((s - cum[idx]) / np.maximum(seg[idx], 1e-9))[:, None]
	pos = P[idx] * (1 - f) + P[idx + 1] * f
	tan = vc.normalize(P[idx + 1] - P[idx])
	return pos, tan, s / total


def jitter_col(rs, base, n, amt=0.12, hue=0.05):
	base = np.asarray(base, dtype=np.float64)
	k = np.exp(rs.normal(0, amt, (n, 1)))
	h = rs.normal(0, hue, (n, 3))
	return np.clip(base[None] * k * (1 + h), 0, 1)


# ------------------------------------------------------------------------------------------------ twig systems

def pinnate_system(rs, root, axis_dir, length, side_angle_deg, side_len_fn, side_spacing, plane_up,
		droop=0.0, tertiary=False, wobble=0.02):
	"""Returns list of (polyline, radius_base, radius_tip, order) for a planar-ish branched spray."""
	out = []
	axis_dir = vc.normalize(np.asarray(axis_dir, dtype=np.float64))
	plane_up = vc.normalize(np.asarray(plane_up, dtype=np.float64))
	side = vc.normalize(np.cross(plane_up, axis_dir))
	main = curve_pts(root, axis_dir, length, 24, bend_vec=-plane_up * droop, wobble=wobble, rs=rs)
	out.append((main, 0.0026, 0.0010, 0))
	pos, tan, sf = resample(main, side_spacing)
	flip = 1.0
	for p, t, f in zip(pos, tan, sf):
		if f < 0.04 or f > 0.93:
			continue
		flip = -flip
		L = side_len_fn(f) * rs.uniform(0.75, 1.15)
		if L < 0.015:
			continue
		sside = vc.normalize(np.cross(plane_up, t))
		a = math.radians(side_angle_deg + rs.uniform(-8, 8))
		d = vc.normalize(t * math.cos(a) + flip * sside * math.sin(a) + plane_up * rs.uniform(-0.12, 0.12))
		pl = curve_pts(p, d, L, 10, bend_vec=t * 0.12 - plane_up * droop * 0.5, wobble=wobble, rs=rs)
		out.append((pl, 0.0013, 0.0007, 1))
		if tertiary and L > 0.06:
			p2, t2, f2 = resample(pl, max(side_spacing * 0.9, 0.014))
			fl2 = flip
			for q, tt, ff in zip(p2, t2, f2):
				if ff < 0.15 or ff > 0.85:
					continue
				fl2 = -fl2
				L2 = L * 0.45 * (1 - ff) ** 0.8 * rs.uniform(0.7, 1.2)
				if L2 < 0.02:
					continue
				ss = vc.normalize(np.cross(plane_up, tt))
				d2 = vc.normalize(tt * 0.7 + fl2 * ss * 0.7)
				out.append((curve_pts(q, d2, L2, 6, bend_vec=tt * 0.05), 0.0012, 0.0007, 2))
	return out


def twig_meshes(geo: Geo, twigs, col, sides=5):
	for pl, r0, r1, order in twigs:
		n = len(pl)
		tube(geo, pl, np.linspace(r0, r1, n), col, sides=sides if order == 0 else 4)


def needles_on_twigs(geo, rs, twigs, *, density, length, width, thick, fwd_deg, col, col_amt=0.14,
		az_mode="all", upturn=0.0, curve=0.0, top_col=None, tip_bias=0.0, plane_up=(0, 0, 1),
		min_order=0, sides=4, blunt=0.25, length_tip_scale=0.7):
	"""Needles all along twigs. az_mode: 'all' (spruce), 'two_rank' (fir), 'upper' (upturned brush)."""
	plane_up = vc.normalize(np.asarray(plane_up, dtype=np.float64))
	for pl, r0, r1, order in twigs:
		if order < min_order:
			continue
		pos, tan, sf = resample(pl, 1.0 / density)
		n = len(pos)
		if n == 0:
			continue
		keep = rs.random(n) < (1.0 - tip_bias * (1 - sf))
		pos, tan, sf = pos[keep], tan[keep], sf[keep]
		n = len(pos)
		if n == 0:
			continue
		side = vc.normalize(np.cross(plane_up[None], tan))
		up = vc.normalize(np.cross(tan, side))
		if az_mode == "all":
			az = rs.uniform(0, 2 * math.pi, n)
		elif az_mode == "two_rank":
			az = np.where(rs.random(n) < 0.5, 0.0, math.pi) + rs.normal(0, 0.45, n) + upturn * np.where(rs.random(n) < 0.5, 1, 1)
			# rotate toward the upper side (needles of subalpine fir turn upward)
			az = np.where(np.cos(az) > 0, az - upturn, az + upturn)
		else:  # upper hemisphere brush
			az = rs.uniform(0.15, math.pi - 0.15, n)
		radial = np.cos(az)[:, None] * side + np.sin(az)[:, None] * up
		fa = np.radians(fwd_deg + rs.normal(0, 9, n))[:, None]
		d = vc.normalize(tan * np.cos(fa) + radial * np.sin(fa))
		L = length * rs.uniform(0.8, 1.15, n) * (1 - (1 - length_tip_scale) * sf ** 3)
		bend = (tan * curve + up * curve * 0.5) * L[:, None]
		c = jitter_col(rs, col, n, col_amt)
		# older needles (towards the base) slightly darker
		c *= (0.85 + 0.25 * sf)[:, None]
		tc = None
		if top_col is not None:
			tc = jitter_col(rs, top_col, n, col_amt * 0.6)
		needles(geo, pos + radial * r0, d, L, np.full(n, width) * rs.uniform(0.85, 1.1, n),
			np.full(n, thick), c, up_hint=np.tile(plane_up, (n, 1)), bend=bend, sides=sides, top_col=tc, blunt=blunt)


def fascicles(geo, rs, twigs, *, spacing, per, length, width, fwd_deg, col, zone=(0.35, 1.0), spread_deg=12,
		curve=0.15, plane_up=(0, 0, 1), min_order=0, tip_tuft=True):
	"""Pine needles in bundles (per = 2 lodgepole, 5 whitebark) along the outer part of twigs."""
	plane_up = vc.normalize(np.asarray(plane_up, dtype=np.float64))
	for pl, r0, r1, order in twigs:
		if order < min_order:
			continue
		pos, tan, sf = resample(pl, spacing)
		m = (sf >= zone[0]) & (sf <= zone[1])
		pos, tan, sf = pos[m], tan[m], sf[m]
		if tip_tuft and len(pl) > 1:
			tipp = pl[-1]
			tipt = vc.normalize(pl[-1] - pl[-2])
			k = 10
			pos = np.concatenate([pos, np.repeat(tipp[None], k, 0)])
			tan = np.concatenate([tan, np.repeat(tipt[None], k, 0)])
			sf = np.concatenate([sf, np.ones(k)])
		n = len(pos)
		if n == 0:
			continue
		side = vc.normalize(np.cross(plane_up[None], tan))
		up = vc.normalize(np.cross(tan, side))
		az = rs.uniform(0, 2 * math.pi, n)
		radial = np.cos(az)[:, None] * side + np.sin(az)[:, None] * up
		fa = np.radians(fwd_deg * (1.1 - 0.5 * sf) + rs.normal(0, 8, n))[:, None]
		d0 = vc.normalize(tan * np.cos(fa) + radial * np.sin(fa))
		B = []
		D = []
		for k in range(per):
			ang = math.radians(spread_deg) * rs.uniform(0.4, 1.0, n)
			az2 = rs.uniform(0, 2 * math.pi, n)
			pp = vc.normalize(np.cross(d0, radial))
			off = np.cos(az2)[:, None] * pp + np.sin(az2)[:, None] * radial
			D.append(vc.normalize(d0 * np.cos(ang)[:, None] + off * np.sin(ang)[:, None]))
			B.append(pos + radial * r0)
		D = np.concatenate(D)
		B = np.concatenate(B)
		N = len(D)
		L = length * rs.uniform(0.8, 1.12, N)
		c = jitter_col(rs, col, N, 0.12)
		bend = -np.tile(plane_up, (N, 1)) * curve * L[:, None] * rs.uniform(0.2, 1.0, (N, 1))
		needles(geo, B, D, L, np.full(N, width), np.full(N, width * 0.8), c, bend=bend, sides=3, blunt=0.1)


def spur_tufts(geo, rs, twigs, *, spacing, per, length, width, col, plane_up=(0, 0, 1), cone_deg=55, drop=0.0,
		knob_col=(0.05, 0.035, 0.025)):
	"""Larch: tufts of soft needles on short spur shoots along twigs."""
	plane_up = vc.normalize(np.asarray(plane_up, dtype=np.float64))
	for pl, r0, r1, order in twigs:
		pos, tan, sf = resample(pl, spacing)
		n = len(pos)
		if n == 0:
			continue
		keep = rs.random(n) > drop
		pos, tan, sf = pos[keep], tan[keep], sf[keep]
		n = len(pos)
		if n == 0:
			continue
		side = vc.normalize(np.cross(plane_up[None], tan))
		up = vc.normalize(np.cross(tan, side))
		az = rs.uniform(0, 2 * math.pi, n)
		radial = np.cos(az)[:, None] * side + np.sin(az)[:, None] * up
		# spur axis: mostly radial, biased up (tufts face the light)
		axis = vc.normalize(radial * 0.6 + up * 0.7 + tan * 0.2)
		spur_base = pos + radial * r0
		spur_tip = spur_base + axis * 0.004
		# knob
		needles(geo, spur_base, axis, np.full(n, 0.005), np.full(n, 0.0028), np.full(n, 0.0028),
			np.tile(np.asarray(knob_col, dtype=np.float64), (n, 1)), sides=5, blunt=0.9)
		B, D = [], []
		for k in range(per):
			phi = rs.uniform(0, 2 * math.pi, n)
			th = np.radians(rs.uniform(cone_deg * 0.35, cone_deg, n))
			a2 = vc.normalize(np.cross(axis, side))
			off = np.cos(phi)[:, None] * side + np.sin(phi)[:, None] * a2
			D.append(vc.normalize(axis * np.cos(th)[:, None] + off * np.sin(th)[:, None]))
			B.append(spur_tip)
		D = np.concatenate(D)
		B = np.concatenate(B)
		N = len(D)
		L = length * rs.uniform(0.65, 1.1, N)
		c = jitter_col(rs, col, N, 0.16, hue=0.07)
		bend = -np.tile(plane_up, (N, 1)) * 0.25 * L[:, None]
		needles(geo, B, D, L, np.full(N, width), np.full(N, width * 0.55), c, bend=bend, sides=3, blunt=0.3)


def leaf_mesh(geo, rs, base, d, normal, length, width, col, curl=0.15, fold=0.2, serr=0.0, segs=6):
	"""Flat-ish elliptic leaves (N instances). base/d/normal (N,3)."""
	N = len(base)
	if N == 0:
		return
	d = vc.normalize(d)
	s = vc.normalize(np.cross(normal, d))
	nn = vc.normalize(np.cross(d, s))
	t = np.linspace(0, 1, segs + 1)
	wprof = np.sin(np.clip(t, 0, 1) * math.pi) ** 0.8 * 0.5
	wprof[0] = 0.04
	wprof[-1] = 0.0
	cols_across = np.array([-1.0, 0.0, 1.0])
	# template (segs+1, 3, 3)
	TX = np.repeat(t[:, None], 3, 1)
	TY = wprof[:, None] * cols_across[None, :]
	TZ = np.abs(cols_across)[None, :] * fold * wprof[:, None] * 0.5 + curl * t[:, None] ** 2 * np.ones((1, 3))
	L = length[:, None, None]
	W = width[:, None, None]
	P = (base[:, None, None, :] + (TX[None] * L)[..., None] * d[:, None, None, :]
		+ (TY[None] * W)[..., None] * s[:, None, None, :] + (TZ[None] * L)[..., None] * nn[:, None, None, :])
	fl = []
	for i in range(segs):
		for j in range(2):
			a = i * 3 + j
			fl += [(a, a + 1, a + 4), (a, a + 4, a + 3)]
	fl = np.array(fl)
	nv = (segs + 1) * 3
	faces = fl[None] + (np.arange(N) * nv)[:, None, None]
	C = np.repeat(col[:, None, :], nv, 1)
	# midrib lighter/darker, margins browner
	C[:, 1::3] *= 1.08
	geo.add(P.reshape(-1, 3), faces.reshape(-1, 3), C.reshape(-1, 3))


def blades(geo, rs, base, d, length, width, col, col_tip, bend, twist=0.0, segs=5):
	"""Grass blades as tapered 2-sided strips. base/d/bend (N,3)."""
	N = len(base)
	if N == 0:
		return
	t = np.linspace(0, 1, segs + 1)
	w = (1 - t ** 1.6) * 0.5 + 0.02
	side = vc.normalize(np.cross(d, np.array([0.0, 0.0, 1.0])[None] + 1e-3))
	# twist the side vector a bit
	P = []
	C = []
	for i, tt in enumerate(t):
		c = base + d * (length[:, None] * tt) + bend * (tt ** 2)
		ww = (w[i] * width)[:, None]
		P.append(np.stack([c - side * ww, c + side * ww], 1))
		cc = col * (1 - tt) + col_tip * tt
		C.append(np.stack([cc, cc], 1))
	P = np.stack(P, 1)  # N, segs+1, 2, 3
	C = np.stack(C, 1)
	fl = []
	for i in range(segs):
		a = i * 2
		fl += [(a, a + 1, a + 3), (a, a + 3, a + 2)]
	fl = np.array(fl)
	nv = (segs + 1) * 2
	faces = fl[None] + (np.arange(N) * nv)[:, None, None]
	geo.add(P.reshape(-1, 3), faces.reshape(-1, 3), C.reshape(-1, 3))


# ------------------------------------------------------------------------------------------------ species
# Every builder fills the three atlas regions. Region origins (Blender XY, metres, camera looks down -Z):
#   long : x in [-0.5, 0], y in [-0.5, 0.5]  stem base at (-0.25, -0.49)
#   short: x in [0, 0.5],  y in [0, 0.5]     stem base at ( 0.25,  0.01)
#   tip  : x in [0, 0.5],  y in [-0.5, 0]    stem base at ( 0.25, -0.49)
BASES = {"long": (np.array([-0.25, -0.49, 0.0]), 0.96), "short": (np.array([0.25, 0.01, 0.0]), 0.47),
	"tip": (np.array([0.25, -0.49, 0.0]), 0.47)}
UP = np.array([0.0, 0.0, 1.0])
Y = np.array([0.0, 1.0, 0.0])

# linear albedo (Cycles DiffCol), measured-ish conifer foliage values brightened ~1.3x for readability
COL = {
	"spruce": (0.034, 0.058, 0.056), "spruce_top": (0.060, 0.082, 0.085),
	"fir": (0.020, 0.043, 0.026), "fir_top": (0.028, 0.055, 0.035),
	"lodgepole": (0.060, 0.080, 0.024), "whitebark": (0.052, 0.074, 0.034),
	"larch": (0.42, 0.23, 0.030), "larch_old": (0.30, 0.18, 0.035),
	"juniper": (0.040, 0.056, 0.050), "juniper_stripe": (0.085, 0.10, 0.095),
	"twig_spruce": (0.085, 0.048, 0.028), "twig_fir": (0.075, 0.062, 0.050), "twig_pine": (0.12, 0.07, 0.035),
	"twig_larch": (0.05, 0.035, 0.028), "twig_dead": (0.20, 0.19, 0.17), "twig_willow": (0.16, 0.06, 0.03),
	"twig_alder": (0.09, 0.075, 0.06), "twig_huck": (0.10, 0.09, 0.03),
}


def spruce(geo_n, geo_t, rs):
	# Engelmann spruce: stiff 4-angled needles all round the twig, curving forward; dense pendulous sprays.
	for reg, (b, L) in BASES.items():
		k = L / 0.96
		tw = pinnate_system(rs, b, Y, L, 50, lambda f: (0.2 * (1 - f) ** 0.65 + 0.03) * (0.7 + 0.3 * k),
			0.017 * max(k, 0.75), UP, droop=0.0, tertiary=True, wobble=0.012)
		twig_meshes(geo_t, tw, COL["twig_spruce"])
		needles_on_twigs(geo_n, rs, tw, density=780, length=0.026, width=0.0021,
			thick=0.0019, fwd_deg=50, col=COL["spruce"], curve=0.18, top_col=None, length_tip_scale=0.75)


def fir(geo_n, geo_t, rs):
	# Subalpine fir: flat blunt needles, 2-ranked but turned upward -> dense dark flat sprays.
	for reg, (b, L) in BASES.items():
		k = L / 0.96
		tw = pinnate_system(rs, b, Y, L, 56, lambda f: (0.19 * (1 - f) ** 0.55 + 0.03) * (0.7 + 0.3 * k),
			0.016 * max(k, 0.75), UP, tertiary=True, wobble=0.01)
		twig_meshes(geo_t, tw, COL["twig_fir"])
		needles_on_twigs(geo_n, rs, tw, density=760, length=0.027, width=0.0026, thick=0.0011, fwd_deg=66,
			col=COL["fir"], az_mode="two_rank", upturn=0.75, curve=0.08, top_col=None, sides=4, blunt=0.6,
			length_tip_scale=0.8)


def lodgepole(geo_n, geo_t, rs):
	# Lodgepole: 2-needle fascicles, 4-7 cm, twisted, crowded toward branch ends -> yellow-green bottle brushes.
	for reg, (b, L) in BASES.items():
		if reg == "long":
			tw = pinnate_system(rs, b, Y, L, 40, lambda f: 0.22 * (1 - f) ** 0.5 if f > 0.1 else 0.0,
				0.05, UP, wobble=0.006)
		else:
			tw = pinnate_system(rs, b, Y, L, 38, lambda f: 0.16 * (1 - f) ** 0.7 if f > 0.15 else 0.0, 0.05, UP,
				wobble=0.006)
		twig_meshes(geo_t, [(p, r0 * 2.0, r1 * 2.4, o) for p, r0, r1, o in tw], COL["twig_pine"], sides=6)
		fascicles(geo_n, rs, tw, spacing=0.0028, per=2, length=0.06, width=0.0021, fwd_deg=50,
			col=COL["lodgepole"], zone=(0.12, 1.0), spread_deg=16, curve=0.22)


def whitebark(geo_n, geo_t, rs):
	# Whitebark pine: 5-needle bundles clustered at twig ends, stiff, yellow-green with pale inner faces.
	for reg, (b, L) in BASES.items():
		if reg == "long":
			tw = pinnate_system(rs, b, Y, L, 44, lambda f: 0.2 * (1 - f) ** 0.6 if f > 0.12 else 0.0, 0.055, UP,
				wobble=0.008)
		else:
			tw = pinnate_system(rs, b, Y, L, 42, lambda f: 0.14 * (1 - f) if f > 0.2 else 0.0, 0.05, UP, wobble=0.008)
		twig_meshes(geo_t, [(p, r0 * 2.3, r1 * 2.6, o) for p, r0, r1, o in tw], COL["twig_pine"], sides=6)
		fascicles(geo_n, rs, tw, spacing=0.0034, per=5, length=0.054, width=0.0016, fwd_deg=40,
			col=COL["whitebark"], zone=(0.18, 1.0), spread_deg=20, curve=0.1)


def larch(geo_n, geo_t, rs):
	# Subalpine larch in October: golden tufts on dark knobby spur shoots; a few needles already dropped.
	for reg, (b, L) in BASES.items():
		k = L / 0.96
		tw = pinnate_system(rs, b, Y, L, 50, lambda f: (0.21 * (1 - f) ** 0.6 + 0.03) * (0.65 + 0.35 * k),
			0.03, UP, droop=0.03, tertiary=True, wobble=0.02)
		twig_meshes(geo_t, [(p, r0 * 1.3, r1 * 1.3, o) for p, r0, r1, o in tw], COL["twig_larch"])
		col = np.array(COL["larch"])
		spur_tufts(geo_n, rs, tw, spacing=0.011, per=26, length=0.028, width=0.0015,
			col=col if reg != "tip" else np.array(COL["larch_old"]), cone_deg=60, drop=0.12)


def juniper(geo_n, geo_t, rs):
	# Common juniper: whorls of 3 sharp awl needles spreading ~70 deg, white stomatal band on top.
	for reg, (b, L) in BASES.items():
		tw = pinnate_system(rs, b, Y, L, 45, lambda f: 0.17 * (1 - f) ** 0.8 + 0.02, 0.05, UP, tertiary=True,
			wobble=0.03)
		twig_meshes(geo_t, tw, COL["twig_spruce"])
		needles_on_twigs(geo_n, rs, tw, density=950, length=0.015, width=0.0019, thick=0.0013, fwd_deg=64,
			col=COL["juniper"], top_col=COL["juniper_stripe"], curve=0.0, sides=4, blunt=0.05)


def deadtwig(geo_n, geo_t, rs):
	# Bare dead twigs (snags, dead lower branches of spruce): silvered, brittle, some broken.
	for reg, (b, L) in BASES.items():
		tw = pinnate_system(rs, b, Y, L * rs.uniform(0.8, 1.0), 55, lambda f: 0.2 * (1 - f) ** 0.7 * rs.uniform(0.3, 1.0),
			0.05, UP, tertiary=True, wobble=0.05)
		twig_meshes(geo_t, [(p, r0 * 1.2, r1 * 1.1, o) for p, r0, r1, o in tw], COL["twig_dead"])
		# a few old brown needles clinging near tips
		needles_on_twigs(geo_n, rs, tw[:3], density=25, length=0.016, width=0.0012, thick=0.001, fwd_deg=55,
			col=(0.16, 0.08, 0.035), min_order=1)


def willow(geo_n, geo_t, rs):
	# Late-October willow: straight reddish wands, a few yellow and brown leaves left, silvery catkin buds.
	for reg, (b, L) in BASES.items():
		tw = pinnate_system(rs, b, Y, L, 28, lambda f: 0.3 * (1 - f) if f > 0.1 else 0.0, 0.11, UP, wobble=0.015)
		twig_meshes(geo_t, [(p, r0 * 1.5, r1 * 1.2, o) for p, r0, r1, o in tw], COL["twig_willow"])
		for pl, r0, r1, order in tw:
			pos, tan, sf = resample(pl, 0.028)
			n = len(pos)
			keep = rs.random(n) < 0.42
			pos, tan = pos[keep], tan[keep]
			n = len(pos)
			if n == 0:
				continue
			sd = vc.normalize(np.cross(UP[None], tan))
			fl = np.where(rs.random(n) < 0.5, 1.0, -1.0)[:, None]
			d = vc.normalize(tan * 0.8 + sd * fl * 0.6)
			hue = rs.random(n)
			c = np.where((hue < 0.55)[:, None], np.array([[0.46, 0.33, 0.04]]), np.where((hue < 0.85)[:, None],
				np.array([[0.22, 0.15, 0.05]]), np.array([[0.25, 0.27, 0.08]])))
			c = jitter_col(rs, [1, 1, 1], n, 0.15) * c
			leaf_mesh(geo_n, rs, pos, d, np.tile(UP, (n, 1)) + rs.normal(0, 0.25, (n, 3)),
				rs.uniform(0.045, 0.075, n), rs.uniform(0.010, 0.016, n), c, curl=0.25, fold=0.35)
			# buds
			needles(geo_n, pos, tan, np.full(n, 0.006), np.full(n, 0.003), np.full(n, 0.003),
				np.tile(np.array([0.3, 0.2, 0.1]), (n, 1)), sides=5, blunt=0.6)


def alder(geo_n, geo_t, rs):
	# Sitka alder: grey-brown twigs, late leaves dull green-brown, woody cone-like catkins (strobiles).
	for reg, (b, L) in BASES.items():
		tw = pinnate_system(rs, b, Y, L, 40, lambda f: 0.22 * (1 - f) ** 0.7 if f > 0.1 else 0.0, 0.09, UP,
			tertiary=True, wobble=0.03)
		twig_meshes(geo_t, [(p, r0 * 1.6, r1 * 1.2, o) for p, r0, r1, o in tw], COL["twig_alder"])
		for pl, r0, r1, order in tw:
			pos, tan, sf = resample(pl, 0.045)
			n = len(pos)
			keep = rs.random(n) < 0.55
			pos, tan = pos[keep], tan[keep]
			n = len(pos)
			if n == 0:
				continue
			sd = vc.normalize(np.cross(UP[None], tan))
			fl = np.where(rs.random(n) < 0.5, 1.0, -1.0)[:, None]
			d = vc.normalize(tan * 0.5 + sd * fl * 0.85)
			hue = rs.random(n)
			c = np.where((hue < 0.5)[:, None], np.array([[0.07, 0.075, 0.025]]), np.array([[0.14, 0.09, 0.03]]))
			c = jitter_col(rs, [1, 1, 1], n, 0.15) * c
			leaf_mesh(geo_n, rs, pos, d, np.tile(UP, (n, 1)) + rs.normal(0, 0.3, (n, 3)),
				rs.uniform(0.05, 0.08, n), rs.uniform(0.035, 0.05, n), c, curl=0.12, fold=0.15)
			# strobiles on some tips
			if order == 1 and rs.random() < 0.6:
				tip = pl[-1]
				m = 3
				needles(geo_n, np.repeat(tip[None], m, 0), vc.normalize(np.repeat((pl[-1] - pl[-2])[None], m, 0)
					+ rs.normal(0, 0.5, (m, 3))), np.full(m, 0.016), np.full(m, 0.009), np.full(m, 0.009),
					np.tile(np.array([0.05, 0.035, 0.022]), (m, 1)), sides=6, blunt=0.7)


def huckleberry(geo_n, geo_t, rs):
	# Black huckleberry in autumn: crimson-orange elliptic leaves, angled green-brown twigs, a few dark berries.
	for reg, (b, L) in BASES.items():
		tw = pinnate_system(rs, b, Y, L, 40, lambda f: 0.2 * (1 - f) ** 0.6, 0.07, UP, tertiary=False, wobble=0.04)
		twig_meshes(geo_t, [(p, r0 * 1.4, r1 * 1.2, o) for p, r0, r1, o in tw], COL["twig_huck"])
		for pl, r0, r1, order in tw:
			pos, tan, sf = resample(pl, 0.03)
			n = len(pos)
			keep = rs.random(n) < 0.8
			pos, tan = pos[keep], tan[keep]
			n = len(pos)
			if n == 0:
				continue
			sd = vc.normalize(np.cross(UP[None], tan))
			fl = np.where(rs.random(n) < 0.5, 1.0, -1.0)[:, None]
			d = vc.normalize(tan * 0.55 + sd * fl * 0.8)
			hue = rs.random(n)
			c = np.where((hue < 0.5)[:, None], np.array([[0.36, 0.035, 0.02]]), np.where((hue < 0.8)[:, None],
				np.array([[0.45, 0.12, 0.02]]), np.array([[0.20, 0.03, 0.03]])))
			c = jitter_col(rs, [1, 1, 1], n, 0.18) * c
			leaf_mesh(geo_n, rs, pos, d, np.tile(UP, (n, 1)) + rs.normal(0, 0.3, (n, 3)),
				rs.uniform(0.035, 0.05, n), rs.uniform(0.016, 0.022, n), c, curl=0.1, fold=0.25)
			# berries: a few, dark purple with bloom
			nb = int(rs.integers(0, 3))
			if nb:
				idx = rs.choice(n, size=min(nb, n), replace=False)
				bp = pos[idx] - UP * 0.004
				for j in range(len(bp)):
					sph = rs.normal(0, 1, (1, 3))
					needles(geo_n, bp[j:j + 1], vc.normalize(sph), np.array([0.009]), np.array([0.009]),
						np.array([0.009]), np.array([[0.035, 0.02, 0.05]]), sides=8, segs=4, blunt=0.9)


def grass(geo_n, geo_t, rs, sedge=False):
	# SIDE VIEW: camera still looks down -Z, blades grow along +Y (image up), card plane = XY.
	for reg, (b, L) in BASES.items():
		n = 170 if reg == "long" else 95
		base = b + np.stack([rs.normal(0, 0.035 if reg == "long" else 0.03, n), np.zeros(n), rs.normal(0, 0.03, n)], 1)
		lean = rs.normal(0, 0.28 if not sedge else 0.4, n)
		d = vc.normalize(np.stack([lean, np.ones(n), rs.normal(0, 0.25, n)], 1))
		Lb = (L * rs.uniform(0.35, 0.98, n)) * (0.9 if reg == "long" else 0.95)
		bend = np.stack([np.sign(lean) * rs.uniform(0.02, 0.2, n) * Lb, -rs.uniform(0.0, 0.18, n) * Lb * (2 if sedge else 1),
			np.zeros(n)], 1)
		dry = rs.random(n)
		if sedge:
			c0 = np.where((dry < 0.5)[:, None], np.array([[0.12, 0.10, 0.04]]), np.array([[0.09, 0.10, 0.045]]))
			c1 = np.where((dry < 0.7)[:, None], np.array([[0.30, 0.20, 0.08]]), np.array([[0.20, 0.16, 0.07]]))
			w = rs.uniform(0.004, 0.0065, n)
		else:
			c0 = np.where((dry < 0.25)[:, None], np.array([[0.10, 0.12, 0.04]]), np.array([[0.22, 0.17, 0.08]]))
			c1 = np.where((dry < 0.8)[:, None], np.array([[0.48, 0.38, 0.19]]), np.array([[0.36, 0.30, 0.16]]))
			w = rs.uniform(0.0025, 0.0045, n)
		c0 = c0 * jitter_col(rs, [1, 1, 1], n, 0.12)
		c1 = c1 * jitter_col(rs, [1, 1, 1], n, 0.12)
		blades(geo_n, rs, base, d, Lb, w, c0, c1, bend)
		if not sedge:
			# a few seed heads
			m = 12 if reg == "long" else 6
			idx = rs.choice(n, m, replace=False)
			tips = base[idx] + d[idx] * Lb[idx, None] + bend[idx]
			needles(geo_n, tips - d[idx] * 0.05, d[idx], np.full(m, 0.06), np.full(m, 0.006), np.full(m, 0.004),
				np.tile(np.array([0.45, 0.36, 0.2]), (m, 1)), sides=5, blunt=0.3)


def sedge(geo_n, geo_t, rs):
	grass(geo_n, geo_t, rs, sedge=True)


def fern(geo_n, geo_t, rs):
	# Dead lady-fern / bracken fronds in October: rust-brown, pinnate, slightly curled and broken.
	for reg, (b, L) in BASES.items():
		tw = pinnate_system(rs, b, Y, L * 0.97, 72, lambda f: 0.2 * np.sin(min(f * 1.15, 1.0) * math.pi) ** 0.8 + 0.01,
			0.028, UP, tertiary=False, wobble=0.02)
		twig_meshes(geo_t, [(p, r0 * (1.4 if o == 0 else 0.7), r1 * 0.8, o) for p, r0, r1, o in tw], (0.14, 0.07, 0.03))
		for pl, r0, r1, order in tw:
			if order == 0:
				continue
			pos, tan, sf = resample(pl, 0.011)
			n = len(pos)
			if n == 0:
				continue
			sd = vc.normalize(np.cross(UP[None], tan))
			B = np.concatenate([pos, pos])
			D = np.concatenate([vc.normalize(tan * 0.45 + sd * 0.9), vc.normalize(tan * 0.45 - sd * 0.9)])
			m = len(B)
			keep = rs.random(m) < 0.85
			B, D = B[keep], D[keep]
			m = len(B)
			c = jitter_col(rs, [0.26, 0.11, 0.035], m, 0.2, hue=0.08)
			ln = np.concatenate([0.018 * (1 - sf) + 0.004, 0.018 * (1 - sf) + 0.004])[keep]
			leaf_mesh(geo_n, rs, B, D, np.tile(UP, (m, 1)) + rs.normal(0, 0.25, (m, 3)), ln, ln * 0.45, c,
				curl=-0.3, fold=0.3, segs=3)


SETS = {
	"spruce": spruce, "fir": fir, "lodgepole": lodgepole, "whitebark": whitebark, "larch": larch,
	"juniper": juniper, "deadtwig": deadtwig, "willow": willow, "alder": alder, "huckleberry": huckleberry,
	"grass": grass, "sedge": sedge, "fern": fern,
}
SIDE_VIEW = {"grass", "sedge"}


# ------------------------------------------------------------------------------------------------ render

def vcol_material(name: str) -> bpy.types.Material:
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	nt = m.node_tree
	bsdf = nt.nodes["Principled BSDF"]
	attr = nt.nodes.new("ShaderNodeVertexColor")
	attr.layer_name = "Col"
	nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
	bsdf.inputs["Roughness"].default_value = 0.6
	return m


def setup_render(res: int, spp: int, out_dir: str, tag: str):
	sc = bpy.context.scene
	sc.render.engine = "CYCLES"
	sc.cycles.device = "CPU"
	sc.cycles.samples = spp
	sc.cycles.use_adaptive_sampling = False
	sc.cycles.use_denoising = False
	sc.cycles.max_bounces = 0
	sc.cycles.diffuse_bounces = 0
	sc.cycles.glossy_bounces = 0
	sc.cycles.transparent_max_bounces = 8
	sc.cycles.pixel_filter_type = "BLACKMAN_HARRIS"
	sc.cycles.filter_width = 1.2
	sc.render.film_transparent = True
	sc.render.resolution_x = res
	sc.render.resolution_y = res
	sc.render.resolution_percentage = 100
	sc.render.threads_mode = "FIXED"
	sc.render.threads = max(1, min(4, os.cpu_count() or 1))
	world = bpy.data.worlds.new("W")
	world.light_settings.distance = 0.012
	sc.world = world
	vl = sc.view_layers[0]
	vl.use_pass_diffuse_color = True
	vl.use_pass_normal = True
	vl.use_pass_ambient_occlusion = True
	vl.use_pass_z = True
	cam_data = bpy.data.cameras.new("Cam")
	cam_data.type = "ORTHO"
	cam_data.ortho_scale = 1.0
	cam_data.clip_start = 0.01
	cam_data.clip_end = 20.0
	cam = bpy.data.objects.new("Cam", cam_data)
	cam.location = (0, 0, 5)
	vc.link(cam)
	sc.camera = cam
	sc.use_nodes = True
	nt = sc.node_tree
	for n in list(nt.nodes):
		nt.nodes.remove(n)
	rl = nt.nodes.new("CompositorNodeRLayers")
	fo = nt.nodes.new("CompositorNodeOutputFile")
	fo.base_path = out_dir
	fo.format.file_format = "OPEN_EXR_MULTILAYER"
	fo.format.color_depth = "32"
	fo.format.exr_codec = "ZIP"
	fo.file_slots.clear()
	for name in ["Image", "DiffCol", "Normal", "AO", "Depth"]:
		fo.file_slots.new(name)
		src = rl.outputs.get(name) or (rl.outputs.get("Z") if name == "Depth" else None)
		nt.links.new(src, fo.inputs[name])
	fo.format.color_mode = "RGBA"
	return fo


def render_set(name: str, res: int, spp: int) -> dict:
	vc.reset_scene()
	rs = vc.rng("cards", name)
	mat = vcol_material("m_" + name)
	geo_n, geo_t = Geo(), Geo()
	t0 = time.time()
	SETS[name](geo_n, geo_t, rs)
	objs = []
	if geo_n.n:
		objs.append(geo_n.build(name + "_needles", mat))
	if geo_t.n:
		objs.append(geo_t.build(name + "_twigs", mat))
	tris = sum(len(o.data.polygons) for o in objs)
	out_dir = vc.ensure_dir(os.path.join(vc.CACHE, "cards"))
	# single-layer EXRs per pass (simpler to read back than multilayer in background mode)
	sc = bpy.context.scene
	setup_render(res, spp, out_dir, name)
	nt = sc.node_tree
	fo = [n for n in nt.nodes if n.bl_idname == "CompositorNodeOutputFile"][0]
	fo.format.file_format = "OPEN_EXR"
	fo.format.color_mode = "RGBA"
	for slot in fo.file_slots:
		slot.path = f"{name}_{slot.path}_"
	sc.frame_set(1)
	bpy.ops.render.render(write_still=False)
	t1 = time.time()
	passes = {}
	for pname in ["Image", "DiffCol", "Normal", "AO"]:
		fn = os.path.join(out_dir, f"{name}_{pname}_0001.exr")
		img = bpy.data.images.load(fn, check_existing=False)
		img.colorspace_settings.name = "Non-Color"
		a = np.empty(res * res * 4, dtype=np.float32)
		img.pixels.foreach_get(a)
		passes[pname] = a.reshape(res, res, 4)[::-1]    # top row first
		bpy.data.images.remove(img)
	print(f"[cards] {name}: {tris} tris, build {t1 - t0:.1f}s incl. render")
	return passes


# ------------------------------------------------------------------------------------------------ post

def srgb(x):
	x = np.clip(x, 0, 1)
	return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def dilate(rgb: np.ndarray, alpha: np.ndarray, iters: int = 48) -> np.ndarray:
	"""Push colour outward into transparent texels (avoids dark/bright fringes in mips)."""
	w = (alpha > 0.5).astype(np.float32)
	c = rgb * w[..., None]
	for _ in range(iters):
		if w.min() > 0:
			break
		acc = np.zeros_like(c)
		wa = np.zeros_like(w)
		for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
			acc += np.roll(np.roll(c, dy, 0), dx, 1)
			wa += np.roll(np.roll(w, dy, 0), dx, 1)
		fill = (w == 0) & (wa > 0)
		c[fill] = acc[fill] / wa[fill][:, None]
		w = np.where(fill, 1.0, w)
	# anything never reached: global mean
	if (w == 0).any():
		mean = (rgb * (alpha[..., None] > 0.5)).sum((0, 1)) / max(1, (alpha > 0.5).sum())
		c[w == 0] = mean
	return c


def save_png(path: str, rgba: np.ndarray, srgb_space: bool) -> None:
	h, w, ch = rgba.shape
	img = bpy.data.images.new(os.path.basename(path), w, h, alpha=(ch == 4), float_buffer=False)
	img.colorspace_settings.name = "sRGB" if srgb_space else "Non-Color"
	buf = np.ones((h, w, 4), dtype=np.float32)
	buf[..., :ch] = rgba
	img.pixels.foreach_set(buf[::-1].ravel())
	img.filepath_raw = path
	img.file_format = "PNG"
	img.save()
	bpy.data.images.remove(img)


def post_process(name: str, passes: dict, res: int) -> dict:
	a = np.clip(passes["Image"][..., 3], 0, 1)
	cov = np.maximum(a, 1e-4)[..., None]
	alb = passes["DiffCol"][..., :3] / cov
	ao = np.clip(passes["AO"][..., :3].mean(-1) / cov[..., 0], 0, 1)
	nrm = passes["Normal"][..., :3] / cov
	# self-occlusion inside the spray darkens albedo a little (the renderer adds the big-scale crown AO)
	alb = alb * (0.55 + 0.45 * ao)[..., None]
	alb = np.clip(alb, 0, 1)
	# normals: camera looks down -Z with image-up = +Y -> tangent space (U=+X, V=+Y, N=+Z) directly
	ln = np.linalg.norm(nrm, axis=-1, keepdims=True)
	nrm = np.where(ln > 1e-4, nrm / np.maximum(ln, 1e-6), np.array([0, 0, 1.0]))
	nrm[..., 2] = np.abs(nrm[..., 2])
	# soften toward the card normal (needle cylinders are extreme; the shader blends crown normals too)
	nrm = vc.normalize(nrm * np.array([0.8, 0.8, 1.0]))
	alpha_bin = a
	alb_d = dilate(alb, alpha_bin)
	nrm_d = dilate(nrm, alpha_bin)
	nrm_d = vc.normalize(nrm_d)
	rgba = np.concatenate([srgb(alb_d), a[..., None]], -1)
	vc.ensure_dir(vc.TEX_FOLIAGE)
	save_png(os.path.join(vc.TEX_FOLIAGE, f"{name}_albedo.png"), rgba, True)
	save_png(os.path.join(vc.TEX_FOLIAGE, f"{name}_normal.png"), nrm_d * 0.5 + 0.5, False)
	cover = float((a > 0.5).mean())
	lin_mean = (alb * (a[..., None] > 0.5)).sum((0, 1)) / max(1, (a > 0.5).sum())
	return {"coverage": round(cover, 4), "avg_albedo_linear": [round(float(x), 4) for x in lin_mean]}


def write_imports(name: str) -> None:
	for kind in ("albedo", "normal"):
		p = os.path.join(vc.TEX_FOLIAGE, f"{name}_{kind}.png")
		uid = None
		imp = p + ".import"
		if os.path.exists(imp):
			for line in open(imp):
				if line.startswith("uid="):
					uid = line.strip()
		lines = ["[remap]", "", 'importer="texture"', 'type="CompressedTexture2D"']
		if uid:
			lines.append(uid)
		lines += ["", "[params]", "", "compress/mode=2", "compress/high_quality=false", "compress/lossy_quality=0.7",
			"compress/hdr_compression=1", f"compress/normal_map={1 if kind == 'normal' else 2}", "compress/channel_pack=0",
			"mipmaps/generate=true", "mipmaps/limit=-1", "roughness/mode=1", 'roughness/src_normal=""',
			"process/fix_alpha_border=false", "process/premult_alpha=false", "process/normal_map_invert_y=false",
			"process/size_limit=0", "detect_3d/compress_to=0"]
		with open(imp, "w") as f:
			f.write("\n".join(lines) + "\n")


def main():
	a = vc.parse_args()
	res = int(a.get("res", "1024"))
	spp = int(a.get("spp", "24"))
	only = [s for s in a.get("only", "").split(",") if s] or list(SETS.keys())
	meta_path = os.path.join(vc.TEX_FOLIAGE, "cards.json")
	meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
	regions = {
		"long": {"uv": [0.0, 0.0, 0.5, 1.0], "size_m": [0.5, 1.0], "stem_uv": [0.25, 0.99]},
		"short": {"uv": [0.5, 0.0, 1.0, 0.5], "size_m": [0.5, 0.5], "stem_uv": [0.75, 0.49]},
		"tip": {"uv": [0.5, 0.5, 1.0, 1.0], "size_m": [0.5, 0.5], "stem_uv": [0.75, 0.99]},
	}
	for name in only:
		t0 = time.time()
		passes = render_set(name, res, spp)
		stats = post_process(name, passes, res)
		write_imports(name)
		meta[name] = {"albedo": f"res://assets/textures/foliage/{name}_albedo.png",
			"normal": f"res://assets/textures/foliage/{name}_normal.png",
			"side_view": name in SIDE_VIEW, "regions": regions, **stats}
		print(f"[cards] {name} done in {time.time() - t0:.1f}s  {stats}")
	json.dump(meta, open(meta_path, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
	main()
