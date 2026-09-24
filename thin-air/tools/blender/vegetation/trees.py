"""Procedural conifers of the northern BC Rockies (Blender 4.0 headless). Deterministic.

Run:  blender -b -P thin-air/tools/blender/vegetation/trees.py -- [--only=spruce_a,fir_b] [--stats]
Out:  assets/models/vegetation/<variant>.glb  with mesh nodes LOD0 / LOD1 / LOD2
      (surfaces: "bark_<set>" = trunk + branches, "cards_<set>" = needle cards)
      assets/models/vegetation/vegetation.json   manifest (dimensions, trunk radius, LOD triangle counts, ...)

Modelling (real-world metres, Blender Z up):
  trunk    tapered spline from 0.4 m below ground to the top, root flare with 5 buttress lobes, bark UVs in
           metres (U around at constant tile count, V up) so the shared bark_* textures keep real scale
  branches whorls every 0.3-0.8 m (species), azimuth/elevation/droop/upturn per species and crown depth,
           branch length follows the species crown envelope, dead stubs below the live crown
  cards    needle sprays from assets/textures/foliage/<set>_albedo.png (rendered by cards.py) placed along the
           branches (alternating, angled, pitched, rolled); normals bent toward the crown surface; AO from
           crown depth; wind weights branch base 0 -> tips 1 (see vegcommon.py for the vertex layout)
  LOD0 <= 6k tris (cards follow individual branches), LOD1 ~1.5k (one card per branch), LOD2 ~0.4k (tier
  fans), impostors are rendered by impostors.py from LOD0.
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vegcommon as vc  # noqa: E402

Z = np.array([0.0, 0.0, 1.0])

# ------------------------------------------------------------------------------------------------ species

SPECIES = {
	"spruce": dict(cards="spruce", bark="bark_spruce", wood_density=620.0,
		shape="cone", shape_k=0.82, spacing=(0.34, 0.6), per_whorl=(4, 6), inter=(1, 2),
		elev=(38.0, 4.0, -26.0), droop=38.0, upturn=24.0, card_spacing=0.42, card_scale=(0.8, 1.15),
		card_angle=50.0, card_pitch=-24.0, card_roll=32.0, branch_frac=0.62, stubs=True, leader=1.3,
		trunk_wobble=0.004, taper=0.82),
	"fir": dict(cards="fir", bark="bark_spruce", wood_density=560.0,
		shape="spire", shape_k=0.95, spacing=(0.3, 0.5), per_whorl=(4, 5), inter=(1, 2),
		elev=(30.0, -2.0, -14.0), droop=16.0, upturn=8.0, card_spacing=0.36, card_scale=(0.7, 1.0),
		card_angle=54.0, card_pitch=-8.0, card_roll=22.0, branch_frac=0.55, stubs=True, leader=1.6,
		trunk_wobble=0.003, taper=0.85),
	"lodgepole": dict(cards="lodgepole", bark="bark_pine", wood_density=560.0,
		shape="round", shape_k=0.6, spacing=(0.35, 0.6), per_whorl=(4, 6), inter=(1, 2),
		elev=(48.0, 22.0, 6.0), droop=20.0, upturn=26.0, card_spacing=0.24, card_scale=(0.6, 0.95),
		card_angle=40.0, card_pitch=8.0, card_roll=60.0, branch_frac=0.8, stubs=True, leader=0.9,
		trunk_wobble=0.0025, taper=0.9, tip_cluster=True),
	"whitebark": dict(cards="whitebark", bark="bark_pine", wood_density=520.0,
		shape="flat", shape_k=0.6, spacing=(0.35, 0.6), per_whorl=(3, 4), inter=(1, 2),
		elev=(55.0, 32.0, 12.0), droop=24.0, upturn=34.0, card_spacing=0.24, card_scale=(0.6, 0.95),
		card_angle=36.0, card_pitch=10.0, card_roll=65.0, branch_frac=0.85, stubs=False, leader=0.5,
		trunk_wobble=0.03, taper=0.75, tip_cluster=True),
	"larch": dict(cards="larch", bark="bark_pine", wood_density=600.0,
		shape="cone", shape_k=0.75, spacing=(0.45, 0.85), per_whorl=(3, 5), inter=(0, 2),
		elev=(28.0, 2.0, -12.0), droop=30.0, upturn=18.0, card_spacing=0.44, card_scale=(0.75, 1.05),
		card_angle=50.0, card_pitch=-24.0, card_roll=35.0, branch_frac=0.75, stubs=True, leader=1.0,
		trunk_wobble=0.006, taper=0.8),
	"snag": dict(cards=None, bark="bark_dead", wood_density=420.0,
		shape="cone", shape_k=0.8, spacing=(0.35, 0.7), per_whorl=(3, 5), inter=(0, 0),
		elev=(10.0, -5.0, -20.0), droop=10.0, upturn=0.0, card_spacing=1.0, card_scale=(1, 1),
		card_angle=45.0, card_pitch=0.0, card_roll=0.0, branch_frac=1.0, stubs=True, leader=0.0,
		trunk_wobble=0.006, taper=0.8),
}

# H = height (m), dbh = diameter at 1.3 m, cb = live crown base as a fraction of H, rmax = max crown radius (m)
VARIANTS = {
	"spruce_a": dict(sp="spruce", H=28.0, dbh=0.50, cb=0.30, rmax=2.7, lean=0.8, branch_mul=1.35, card_mul=1.25),
	"spruce_b": dict(sp="spruce", H=20.0, dbh=0.36, cb=0.16, rmax=2.3, lean=0.5, branch_mul=1.15, card_mul=1.12),
	"spruce_c": dict(sp="spruce", H=13.0, dbh=0.27, cb=0.03, rmax=2.2, lean=0.3),
	"spruce_sapling_a": dict(sp="spruce", H=2.3, dbh=0.035, cb=0.0, rmax=0.68, lean=0.1, sapling=True),
	"spruce_sapling_b": dict(sp="spruce", H=4.4, dbh=0.075, cb=0.0, rmax=1.05, lean=0.15, sapling=True),
	"fir_a": dict(sp="fir", H=22.0, dbh=0.36, cb=0.12, rmax=1.55, lean=0.4, branch_mul=1.15, card_mul=1.1),
	"fir_b": dict(sp="fir", H=14.0, dbh=0.24, cb=0.05, rmax=1.2, lean=0.3),
	"lodgepole_a": dict(sp="lodgepole", H=24.0, dbh=0.34, cb=0.56, rmax=2.4, lean=0.6, card_mul=1.2),
	"lodgepole_b": dict(sp="lodgepole", H=17.0, dbh=0.25, cb=0.45, rmax=2.0, lean=0.5, card_mul=1.1),
	"whitebark_a": dict(sp="whitebark", H=10.0, dbh=0.30, cb=0.22, rmax=3.1, lean=0.5, stems=3, branch_mul=1.3, card_mul=1.15),
	"whitebark_b": dict(sp="whitebark", H=6.5, dbh=0.24, cb=0.12, rmax=2.4, lean=0.8, stems=2),
	"larch_a": dict(sp="larch", H=18.0, dbh=0.40, cb=0.2, rmax=3.0, lean=0.4),
	"larch_b": dict(sp="larch", H=12.0, dbh=0.28, cb=0.1, rmax=2.4, lean=0.3),
	"snag_a": dict(sp="snag", H=19.0, dbh=0.42, cb=0.35, rmax=1.3, lean=0.6, broken=0.72),
	"snag_b": dict(sp="snag", H=10.5, dbh=0.32, cb=0.2, rmax=1.6, lean=1.2, broken=0.8, twisted=True),
}

LOD0_BUDGET = 6000


def load_cards_meta() -> dict:
	p = os.path.join(vc.TEX_FOLIAGE, "cards.json")
	return json.load(open(p)) if os.path.exists(p) else {}


def load_material_meta() -> dict:
	p = os.path.join(vc.PROJECT, "assets", "materials", "materials.json")
	return json.load(open(p)) if os.path.exists(p) else {}


# ------------------------------------------------------------------------------------------------ crown envelope

def crown_reach(sp: dict, t: float) -> float:
	"""Relative horizontal reach 0..1 at crown depth t (0 = top, 1 = crown base)."""
	t = float(np.clip(t, 0.0, 1.0))
	k = sp["shape_k"]
	s = sp["shape"]
	if s == "cone":
		return t ** k
	if s == "spire":
		return (t ** k) * (0.25 + 0.75 * min(1.0, t / 0.12)) if t < 0.12 else t ** k
	if s == "round":
		return min(1.0, (t / 0.55) ** k) * (1.0 - 0.35 * max(0.0, (t - 0.55) / 0.45) ** 2)
	if s == "flat":
		return min(1.0, (t / 0.35) ** k) * (1.0 - 0.25 * max(0.0, (t - 0.35) / 0.65))
	return t


def elevation_for(sp: dict, t: float) -> float:
	e0, e1, e2 = sp["elev"]
	if t < 0.5:
		return e0 + (e1 - e0) * (t / 0.5)
	return e1 + (e2 - e1) * ((t - 0.5) / 0.5)


# ------------------------------------------------------------------------------------------------ structure

class Stem:
	def __init__(self, pts: np.ndarray, r_base: float, H: float):
		self.pts = pts            # (n,3) axis from below ground to the top
		self.r_base = r_base      # radius at 1.3 m (without flare)
		self.H = H
		seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
		self.cum = np.concatenate([[0.0], np.cumsum(seg)])
		self.length = float(self.cum[-1])

	def at(self, s: float):
		"""Point and tangent at arc length s."""
		s = float(np.clip(s, 0.0, self.length))
		i = int(np.clip(np.searchsorted(self.cum, s) - 1, 0, len(self.pts) - 2))
		f = (s - self.cum[i]) / max(self.cum[i + 1] - self.cum[i], 1e-9)
		p = self.pts[i] * (1 - f) + self.pts[i + 1] * f
		t = vc.normalize(self.pts[i + 1] - self.pts[i])
		return p, t

	def s_at_z(self, z: float) -> float:
		zs = self.pts[:, 2]
		i = int(np.clip(np.searchsorted(zs, z) - 1, 0, len(zs) - 2))
		f = (z - zs[i]) / max(zs[i + 1] - zs[i], 1e-9)
		return float(self.cum[i] + np.clip(f, 0, 1) * (self.cum[i + 1] - self.cum[i]))


class Branch:
	def __init__(self):
		self.pts = None           # (n,3)
		self.radii = None
		self.L = 0.0
		self.z0 = 0.0
		self.t = 0.0              # crown depth at attach
		self.phase = 0.0
		self.dead = False
		self.cards0 = []          # LOD0 cards
		self.reach = 0.0


class Card:
	__slots__ = ("base", "d", "w", "n", "length", "width", "region", "bend", "w_base", "w_tip", "phase", "zrel")

	def __init__(self, base, d, w, n, length, width, region, bend, w_base, w_tip, phase, zrel):
		self.base, self.d, self.w, self.n = base, d, w, n
		self.length, self.width, self.region, self.bend = length, width, region, bend
		self.w_base, self.w_tip, self.phase, self.zrel = w_base, w_tip, phase, zrel


class Tree:
	def __init__(self, name: str, var: dict):
		self.name = name
		self.var = var
		self.sp = SPECIES[var["sp"]]
		self.H = float(var["H"])
		self.rs = vc.rng("tree", name)
		self.stems: list[Stem] = []
		self.branches: list[Branch] = []
		self.top_z = self.H
		self.broken = var.get("broken")
		self.sapling = bool(var.get("sapling", False))

	# ---------------------------------------------------------------------------------- trunk
	def trunk_radius(self, stem: Stem, s: float, theta=None) -> np.ndarray | float:
		H = stem.length - 0.4
		z = s - 0.4
		taper = self.sp["taper"]
		base = stem.r_base
		zz = max(z, 0.0)
		if zz < 1.3:
			r = base * (1.0 + 0.1 * (1.3 - zz) / 1.3)
		else:
			r = base * max((H - zz) / max(H - 1.3, 0.1), 0.0) ** taper
		r = max(r, 0.006 if not self.broken else base * 0.35)
		flare = 1.0 + 0.5 * math.exp(-zz / 0.42) * (0.0 if self.sapling else 1.0)
		r *= flare
		if theta is not None:
			lob = 1.0 + (0.16 * math.exp(-zz / 0.5) if not self.sapling else 0.0) * np.cos(5 * theta + self.lobe_phase) \
				+ 0.025 * np.cos(3 * theta + 1.7 * self.lobe_phase)
			return r * lob
		return r

	def build_stems(self) -> None:
		rs = self.rs
		v = self.var
		n_stems = int(v.get("stems", 1))
		self.lobe_phase = rs.uniform(0, 6.28)
		H = self.H * (self.broken if self.broken else 1.0)
		self.top_z = H
		wob = self.sp["trunk_wobble"] * (3.0 if v.get("twisted") else 1.0)
		for k in range(n_stems):
			n = 28
			zs = np.linspace(-0.4, H, n)
			noise_x = vc.value_noise_1d(vc.seed_of(self.name, "wx", k), 16)
			noise_y = vc.value_noise_1d(vc.seed_of(self.name, "wy", k), 16)
			u = (zs + 0.4) / (H + 0.4)
			lean_dir = rs.uniform(0, 2 * math.pi)
			lean = math.radians(v.get("lean", 0.5)) * rs.uniform(0.5, 1.0)
			if n_stems > 1:
				# multi-stem: stems diverge from a common base then turn upward
				div = math.radians(rs.uniform(12, 26))
				az = 2 * math.pi * k / n_stems + rs.uniform(-0.4, 0.4)
				dirh = np.array([math.cos(az), math.sin(az), 0.0])
				spread = np.sin(np.clip(u * 3.0, 0, 1) * math.pi / 2) * math.tan(div) * np.minimum(zs + 0.4, 3.0)
				off = np.outer(spread, dirh) + np.outer(u ** 2 * H * math.tan(lean), [math.cos(lean_dir), math.sin(lean_dir), 0])
			else:
				off = np.outer(u ** 1.5 * H * math.tan(lean), [math.cos(lean_dir), math.sin(lean_dir), 0.0])
			wx = noise_x(u * 1.0) * wob * H * np.sin(np.clip(u, 0, 1) * math.pi) * 0.8
			wy = noise_y(u * 1.0) * wob * H * np.sin(np.clip(u, 0, 1) * math.pi) * 0.8
			hk = 1.0 if k == 0 else rs.uniform(0.72, 0.92)
			pts = np.stack([off[:, 0] + wx, off[:, 1] + wy, zs * hk], 1)
			r = v["dbh"] * 0.5 * (1.0 if k == 0 else rs.uniform(0.6, 0.85))
			self.stems.append(Stem(pts, r, H * hk))

	# ---------------------------------------------------------------------------------- branches
	def build_branches(self) -> None:
		rs, sp, v = self.rs, self.sp, self.var
		for si, stem in enumerate(self.stems):
			H = stem.pts[-1, 2]
			z_cb = v["cb"] * H
			z_top_branch = H - (sp["leader"] * (0.6 if self.sapling else 1.0) if not self.broken else 0.3)
			z = 0.9 if not self.sapling else 0.12
			if self.sapling:
				z = 0.12
			phase = rs.uniform(0, 2 * math.pi)
			while z < z_top_branch:
				t = (H - z) / max(H - z_cb, 0.5)
				live = z >= z_cb - 1e-6
				nper = int(rs.integers(sp["per_whorl"][0], sp["per_whorl"][1] + 1))
				if not live:
					nper = int(rs.integers(1, 4)) if sp["stubs"] else 0
					if self.sapling:
						nper = 0
				ninter = int(rs.integers(sp["inter"][0], sp["inter"][1] + 1)) if live else 0
				phase += rs.uniform(0.9, 2.4)
				items = [(phase + i * 2 * math.pi / max(nper, 1) + rs.normal(0, 0.25), 1.0, z) for i in range(nper)]
				sp_lo, sp_hi = sp["spacing"]
				spacing = rs.uniform(sp_lo, sp_hi) * (0.55 if self.sapling else 1.0) * v.get("branch_mul", 1.0)
				spacing *= 1.0 + 0.4 * (1 - min(t, 1.0))  # longer internodes near the top
				for j in range(ninter):
					zz = z + spacing * (j + 1) / (ninter + 1)
					items.append((rs.uniform(0, 2 * math.pi), rs.uniform(0.45, 0.7), zz))
				for az, lscale, zb in items:
					self._add_branch(stem, az, lscale, zb, H, z_cb, live)
				z += spacing

	def _add_branch(self, stem: Stem, az: float, lscale: float, z: float, H: float, z_cb: float, live: bool) -> None:
		rs, sp, v = self.rs, self.sp, self.var
		s_on = stem.s_at_z(z)
		p0, tan = stem.at(s_on)
		rt = float(self.trunk_radius(stem, s_on))
		t = float(np.clip((H - z) / max(H - z_cb, 0.5), 0.0, 1.5))
		b = Branch()
		b.z0 = z
		b.t = t
		b.phase = rs.random()
		if live:
			reach = v["rmax"] * crown_reach(sp, t) * rs.uniform(0.82, 1.12) * lscale
			if self.broken:
				reach *= 0.35
		else:
			b.dead = True
			reach = rs.uniform(0.15, 0.9) * (v["rmax"] * 0.45)
			if rs.random() < 0.35:
				reach *= 0.3
		reach = max(reach, 0.12)
		elev = math.radians(elevation_for(sp, min(t, 1.0)) + rs.normal(0, 7))
		if not live:
			elev = math.radians(rs.uniform(-30, 5))
		L = reach / max(math.cos(elev), 0.45)
		b.L = L
		b.reach = reach
		n = 7
		s = np.linspace(0.0, 1.0, n)
		droop = math.radians(sp["droop"]) * min(1.0, (L / 2.5) ** 0.6) * (0.3 if not live else 1.0)
		upt = math.radians(sp["upturn"]) if live else 0.0
		elevs = elev - droop * s ** 1.4 + upt * s ** 3
		azs = az + rs.normal(0, 0.05) * s + rs.normal(0, 0.05, n) * s
		dirs = np.stack([np.cos(elevs) * np.cos(azs), np.cos(elevs) * np.sin(azs), np.sin(elevs)], 1)
		start = p0 + np.array([math.cos(az), math.sin(az), 0.0]) * rt * 0.6
		seg = L / (n - 1)
		pts = [start]
		for i in range(1, n):
			pts.append(pts[-1] + dirs[i - 1] * seg)
		b.pts = np.array(pts)
		r0 = min(rt * 0.42, 0.012 + 0.018 * L) * (0.7 if not live else 1.0)
		if self.sp["cards"] is None:
			r0 = min(rt * 0.35, 0.025 + 0.03 * L)
		if self.sapling:
			r0 = min(rt * 0.5, 0.004 + 0.006 * L)
		b.radii = np.linspace(r0, max(r0 * 0.22, 0.003), n)
		self.branches.append(b)

	# ---------------------------------------------------------------------------------- cards (LOD0)
	def place_cards(self, spacing_mul: float = 1.0) -> None:
		sp = self.sp
		if sp["cards"] is None:
			return
		self.branches = [b for b in self.branches if b.pts is not None]   # drop leader cards of a previous pass
		rs = vc.rng("cards0", self.name)
		for b in self.branches:
			b.cards0 = []
			if b.dead:
				continue
			L = b.L
			sc_lo, sc_hi = sp["card_scale"]
			sc_lo *= self.var.get("card_mul", 1.0)
			sc_hi *= self.var.get("card_mul", 1.0)
			step = sp["card_spacing"] * spacing_mul * (0.6 if self.sapling else 1.0)
			s0 = max(0.14 * L, 0.18 if not self.sapling else 0.05)
			if sp.get("tip_cluster"):
				s0 = max(s0, L * 0.3)
			s = s0
			side = 1.0 if rs.random() < 0.5 else -1.0
			while s < L * 0.9:
				p, tn = self._branch_at(b, s)
				for sd in (side, -side):
					if rs.random() < 0.12:
						continue
					scale = rs.uniform(sc_lo, sc_hi) * min(1.0, 0.45 + 0.55 * (L - s) / max(L, 0.1) + 0.25)
					if self.sapling:
						scale *= 0.42
					region = "long" if scale > 0.5 else ("short" if rs.random() < 0.6 else "tip")
					length = scale * (1.0 if region == "long" else 0.5)
					width = scale * 0.5
					q = p + tn * rs.uniform(-0.3, 0.3) * step
					self._add_card(b, q, tn, sd, length, width, region, s / L, rs)
				side = -side
				s += step * (0.8 + 0.4 * rs.random())
			# a card lying along the branch covers the branch axis itself
			if L > 0.6:
				p, tn = self._branch_at(b, max(s0, L * 0.3))
				scale = rs.uniform(sc_lo, sc_hi)
				self._add_card(b, p, tn, 0.0, min(scale, L * 0.7), scale * 0.5, "long", 0.5, rs)
			# terminal spray along the branch tip
			p, tn = self._branch_at(b, L * 0.93)
			scale = rs.uniform(sc_lo, sc_hi) * (0.42 if self.sapling else 0.85)
			region = "long" if scale > 0.5 else "short"
			length = scale * (1.0 if region == "long" else 0.5)
			self._add_card(b, p - tn * length * 0.35, tn, 0.0, length, scale * 0.5, region, 0.9, rs)
			if sp.get("tip_cluster"):
				# pines: crossed tufts at the branch end
				for k in range(2):
					self._add_card(b, p - tn * 0.1, tn, rs.choice([-1.0, 1.0]) * 0.35, 0.5 * scale, 0.5 * scale,
						"tip" if k == 0 else "short", 0.95, rs, roll_extra=math.radians(90 * (k + 1)))
		# leader: vertical tip sprays forming the spire
		if not self.broken:
			for stem in self.stems:
				top = stem.pts[-1]
				ldr = sp["leader"] * (0.6 if self.sapling else 1.0)
				nt = 2
				for k in range(nt):
					az = k * math.pi / nt + rs.uniform(-0.3, 0.3)
					d = vc.normalize(np.array([0.06 * math.cos(az), 0.06 * math.sin(az), 1.0]))
					length = ldr * rs.uniform(1.0, 1.2) * (1.4 if self.sapling else 1.0)
					base = top - np.array([0, 0, length * 0.95])
					w = vc.normalize(np.array([-math.sin(az), math.cos(az), 0.0]))
					n = vc.normalize(np.cross(d, w))
					fake = Branch()
					fake.phase = rs.random()
					fake.L = length
					fake.z0 = base[2]
					fake.cards0 = [Card(base, d, w, n, length, length * 0.3, "short", 0.0, 0.35, 0.8, fake.phase,
						base[2] / self.H)]
					self.branches.append(fake)

	def _branch_at(self, b: Branch, s: float):
		seg = np.linalg.norm(np.diff(b.pts, axis=0), axis=1)
		cum = np.concatenate([[0], np.cumsum(seg)])
		i = int(np.clip(np.searchsorted(cum, s) - 1, 0, len(seg) - 1))
		f = (s - cum[i]) / max(seg[i], 1e-9)
		return b.pts[i] * (1 - f) + b.pts[i + 1] * f, vc.normalize(b.pts[i + 1] - b.pts[i])

	def _add_card(self, b: Branch, p, tn, side, length, width, region, sfrac, rs, roll_extra=0.0):
		sp = self.sp
		lat = vc.normalize(np.cross(Z, tn))
		if np.linalg.norm(lat) < 1e-6:
			lat = np.array([1.0, 0.0, 0.0])
		a = math.radians(sp["card_angle"] + rs.normal(0, 10)) * side
		d = vc.normalize(tn * math.cos(a) + lat * math.sin(a))
		pitch = math.radians(sp["card_pitch"] * (0.6 + 0.8 * min(b.t, 1.0)) + rs.normal(0, 8))
		d = vc.normalize(d + Z * math.tan(pitch))
		w = vc.normalize(np.cross(Z, d))
		if np.linalg.norm(np.cross(Z, d)) < 1e-6:
			w = lat
		roll = math.radians(rs.normal(0, sp["card_roll"])) + roll_extra
		w = vc.normalize(w * math.cos(roll) + np.cross(d, w) * math.sin(roll))
		n = vc.normalize(np.cross(d, w))
		if n[2] < 0:
			n = -n
			w = -w
		bend = rs.uniform(0.04, 0.12) * length * (1.0 if sp["card_pitch"] < 0 else 0.5)
		w_base = self._wind_weight(b, sfrac)
		w_tip = min(1.0, w_base + 0.25 + 0.3 * length / 1.0)
		b.cards0.append(Card(p, d, w, n, length, width, region, bend, w_base, w_tip, b.phase, p[2] / self.H))

	def _wind_weight(self, b: Branch, sfrac: float) -> float:
		return float(np.clip(sfrac ** 1.3 * min(1.0, 0.35 + b.L / 3.5), 0.0, 1.0))

	# ---------------------------------------------------------------------------------- per-vertex AO & normals
	def crown_ao(self, p: np.ndarray) -> float:
		v = self.var
		H = self.H
		z = float(p[2])
		stem = self.stems[0]
		c = stem.pts[int(np.clip(np.searchsorted(stem.pts[:, 2], z), 0, len(stem.pts) - 1))]
		r = math.hypot(p[0] - c[0], p[1] - c[1])
		z_cb = v["cb"] * H
		t = (H - z) / max(H - z_cb, 0.5)
		reach = max(v["rmax"] * crown_reach(self.sp, min(max(t, 0.02), 1.0)), 0.15)
		if len(self.stems) > 1:
			reach = v["rmax"]
			r = min(math.hypot(p[0] - s.pts[-1][0], p[1] - s.pts[-1][1]) for s in self.stems) * 0.7 + r * 0.3
		radial = min(r / reach, 1.2)
		ao = 0.3 + 0.7 * radial ** 1.15
		ao *= 0.72 + 0.28 * (1.0 - min(max(t, 0.0), 1.0))    # lower crown receives less skylight
		ao *= 0.8 + 0.2 * min(1.0, max(z, 0.0) / 2.0)        # near-ground occlusion
		return float(np.clip(ao, 0.18, 1.0))

	def crown_normal(self, p: np.ndarray) -> np.ndarray:
		stem = self.stems[0]
		z = float(p[2])
		c = stem.pts[int(np.clip(np.searchsorted(stem.pts[:, 2], z), 0, len(stem.pts) - 1))]
		radial = np.array([p[0] - c[0], p[1] - c[1], 0.0])
		if np.linalg.norm(radial) < 1e-4:
			radial = np.array([1.0, 0.0, 0.0])
		radial = vc.normalize(radial)
		# cone-ish crown surface normal, tilted up more near the top
		t = min(max((self.H - z) / max(self.H * (1 - self.var["cb"]), 0.5), 0.0), 1.0)
		up = 0.75 - 0.35 * t
		return vc.normalize(radial + Z * up)


# ------------------------------------------------------------------------------------------------ meshing

def vcol(wind, ao, phase, flutter):
	return (float(wind), float(ao), float(phase), float(flutter))


def mesh_trunk(md: vc.MeshData, tree: Tree, stem: Stem, sides: int, ring_step: float, bark_tile_u: float,
		max_rings: int = 60, top_jag: bool = False) -> None:
	rs = vc.rng("trunkmesh", tree.name, sides)
	L = stem.length
	# ring positions: denser near the flare and at the top taper
	s_list = [0.0]
	s = 0.0
	while s < L - 1e-3 and len(s_list) < max_rings:
		z = s - 0.4
		step = ring_step * (0.45 if z < 1.2 else 1.0) * (0.7 if z > stem.H * 0.9 else 1.0)
		s = min(L, s + step)
		s_list.append(s)
	r13 = float(tree.trunk_radius(stem, 1.7))
	circ = 2 * math.pi * r13
	tiles_u = max(1.0, round(circ / bark_tile_u))
	u_span = tiles_u * bark_tile_u
	theta = np.linspace(0, 2 * math.pi, sides + 1)
	ring_idx = []
	for si, s in enumerate(s_list):
		p, tn = stem.at(s)
		x = vc.perp(tn)
		y = np.cross(tn, x)
		r = tree.trunk_radius(stem, s, theta[:-1])
		ring = []
		z = p[2]
		zrel = max(z, 0.0) / tree.H
		for j in range(sides + 1):
			jj = j % sides
			off = x * math.cos(theta[jj]) + y * math.sin(theta[jj])
			pos = p + off * r[jj]
			if top_jag and si == len(s_list) - 1:
				pos = pos + tn * rs.uniform(-0.35, 0.45) * r[jj] * 3.0
			nrm = vc.normalize(off + tn * 0.1)
			ao = 0.55 + 0.45 * min(1.0, max(z + 0.2, 0.0) / 1.6)
			ao *= tree.crown_ao(pos) ** 0.35 if z > tree.var["cb"] * tree.H else 1.0
			idx = md.add_vert(pos, nrm, (theta[j] / (2 * math.pi) * u_span, s),
				(zrel, 0.0), vcol(0.0, ao, 0.0, 0.0))
			ring.append(idx)
		ring_idx.append(ring)
	for i in range(len(ring_idx) - 1):
		a, b = ring_idx[i], ring_idx[i + 1]
		for j in range(sides):
			md.add_face((a[j], a[j + 1], b[j + 1], b[j]), 0)
	# cap the top (broken snags / tiny tip)
	top = ring_idx[-1]
	p, tn = stem.at(L)
	c = md.add_vert(p + tn * 0.01, tn, (0.5, L), (p[2] / tree.H, 0.0), vcol(0.0, 0.8, 0.0, 0.0))
	for j in range(sides):
		md.add_face((top[j], top[j + 1], c), 0)


def mesh_branch(md: vc.MeshData, tree: Tree, b: Branch, sides: int, frac: float, segs: int) -> None:
	n = len(b.pts)
	seg = np.linalg.norm(np.diff(b.pts, axis=0), axis=1)
	cum = np.concatenate([[0], np.cumsum(seg)])
	L = cum[-1] * frac
	ss = np.linspace(0, L, segs + 1)
	theta = np.linspace(0, 2 * math.pi, sides + 1)
	rings = []
	for k, s in enumerate(ss):
		i = int(np.clip(np.searchsorted(cum, s) - 1, 0, n - 2))
		f = (s - cum[i]) / max(seg[i], 1e-9)
		p = b.pts[i] * (1 - f) + b.pts[i + 1] * f
		tn = vc.normalize(b.pts[i + 1] - b.pts[i])
		r = b.radii[i] * (1 - f) + b.radii[i + 1] * f
		if k == segs:
			r *= 0.6
		x = vc.perp(tn)
		y = np.cross(tn, x)
		ww = tree._wind_weight(b, s / max(b.L, 1e-3))
		ao = tree.crown_ao(p)
		ring = []
		for j in range(sides + 1):
			jj = j % sides
			off = x * math.cos(theta[jj]) + y * math.sin(theta[jj])
			ring.append(md.add_vert(p + off * r, off, (theta[j] / (2 * math.pi) * 0.25, s + b.z0),
				(p[2] / tree.H, b.z0 / tree.H), vcol(ww, ao, b.phase, 0.0)))
		rings.append(ring)
	for i in range(segs):
		a, c = rings[i], rings[i + 1]
		for j in range(sides):
			md.add_face((a[j], a[j + 1], c[j + 1], c[j]), 0)


def mesh_card(md: vc.MeshData, tree: Tree, c: Card, regions: dict, segs: int = 1, bent: float = 0.0,
		ao_override=None) -> None:
	u0, v0, u1, v1 = regions[c.region]["uv"]
	# Blender UV (origin bottom-left): stem at v_b = 1 - v1, tip at v_b = 1 - v0
	vb0, vb1 = 1.0 - v1, 1.0 - v0
	rows = []
	for i in range(segs + 1):
		y = i / segs
		center = c.base + c.d * (c.length * y) - c.n * (c.bend * y * y)
		row = []
		for xk, x in enumerate((-0.5, 0.5)):
			pos = center + c.w * (c.width * x)
			cn = tree.crown_normal(pos)
			nrm = vc.normalize(c.n * (1 - bent) + cn * bent)
			ao = ao_override if ao_override is not None else tree.crown_ao(pos)
			ao *= 0.78 + 0.22 * y
			wind = c.w_base + (c.w_tip - c.w_base) * y
			# COLOR.a = card width / 4 m: lets the shader recover the card centre line for axial facing
			uv = (u0 + (x + 0.5) * (u1 - u0), vb0 + y * (vb1 - vb0))
			row.append(md.add_vert(pos, nrm, uv, (pos[2] / tree.H, c.zrel),
				vcol(min(wind, 1.0), ao, c.phase, min(c.width / 4.0, 1.0))))
		rows.append(row)
	for i in range(segs):
		a, b = rows[i], rows[i + 1]
		md.add_face((a[0], a[1], b[1], b[0]), 1)


# ------------------------------------------------------------------------------------------------ LODs

def build_lod0(tree: Tree, regions: dict, bark_tile_u: float) -> vc.MeshData:
	md = vc.MeshData()
	sap = tree.sapling
	for stem in tree.stems:
		mesh_trunk(md, tree, stem, 6 if sap else 10, 1.25 if not sap else 0.5, bark_tile_u, top_jag=bool(tree.broken))
	for b in tree.branches:
		if b.pts is None:
			continue
		if tree.sp["cards"] is None or b.dead:
			if b.radii[0] > 0.008:
				mesh_branch(md, tree, b, 4 if b.radii[0] > 0.035 else 3, 1.0, 3 if b.L > 1.6 else (2 if b.L > 0.5 else 1))
		elif not sap and b.radii[0] > 0.016 and b.L > 0.9:
			mesh_branch(md, tree, b, 4 if b.radii[0] > 0.04 else 3,
				tree.sp["branch_frac"] * (0.8 if b.t > 0.35 else 0.5), 2 if b.L > 2.2 else 1)
		elif sap and b.L > 0.35:
			mesh_branch(md, tree, b, 3, 0.6, 1)
	for b in tree.branches:
		for c in b.cards0:
			mesh_card(md, tree, c, regions, segs=2 if c.length > 1.0 else 1)
	return md


def build_lod1(tree: Tree, regions: dict, bark_tile_u: float) -> vc.MeshData:
	md = vc.MeshData()
	rs = vc.rng("lod1", tree.name)
	sap = tree.sapling
	for stem in tree.stems:
		mesh_trunk(md, tree, stem, 5 if sap else 7, 2.2 if not sap else 1.0, bark_tile_u, top_jag=bool(tree.broken))
	for b in tree.branches:
		if b.pts is None:
			continue
		if tree.sp["cards"] is None or b.dead:
			if b.L > 0.35 and b.radii[0] > 0.012:
				mesh_branch(md, tree, b, 3, 1.0, 1)
			continue
		if b.radii[0] > 0.03 and tree.sp["branch_frac"] >= 0.75 and not sap:
			mesh_branch(md, tree, b, 3, 0.6, 1)
	if tree.sp["cards"] is None:
		return md
	for b in tree.branches:
		if b.pts is None:
			# leader cards: keep
			for c in b.cards0:
				mesh_card(md, tree, c, regions, segs=1)
			continue
		if b.dead or not b.cards0:
			continue
		# one big card per branch along its outer part, plus a crossed one for long branches
		L = b.L
		s0 = 0.12 * L if not tree.sp.get("tip_cluster") else 0.4 * L
		p, tn = tree._branch_at(b, s0)
		length = max(L - s0, 0.35) * 1.05
		width = max(length * 0.62, 0.35)
		pitch = math.radians(tree.sp["card_pitch"] * 0.5)
		d = vc.normalize(tn + Z * math.tan(pitch))
		w = vc.normalize(np.cross(Z, d))
		roll = math.radians(rs.normal(0, tree.sp["card_roll"] * 0.6))
		w = vc.normalize(w * math.cos(roll) + np.cross(d, w) * math.sin(roll))
		n = vc.normalize(np.cross(d, w))
		if n[2] < 0:
			n, w = -n, -w
		c = Card(p, d, w, n, length, width, "long", 0.08 * length, tree._wind_weight(b, 0.15), 1.0, b.phase, p[2] / tree.H)
		mesh_card(md, tree, c, regions, segs=2 if length > 1.2 else 1)
		if L > 1.6 or tree.sp.get("tip_cluster"):
			w2 = vc.normalize(np.cross(d, w) * (1 if rs.random() < 0.5 else -1) * 0.8 + w * 0.6)
			n2 = vc.normalize(np.cross(d, w2))
			if n2[2] < 0:
				n2, w2 = -n2, -w2
			pp, _ = tree._branch_at(b, max(s0, L * 0.45))
			c2 = Card(pp, d, w2, n2, (L - max(s0, L * 0.45)) * 1.05, width * 0.7, "short", 0.03, tree._wind_weight(b, 0.5),
				1.0, b.phase, pp[2] / tree.H)
			mesh_card(md, tree, c2, regions, segs=1)
	return md


def build_lod2(tree: Tree, regions: dict, bark_tile_u: float) -> vc.MeshData:
	md = vc.MeshData()
	rs = vc.rng("lod2", tree.name)
	sap = tree.sapling
	for stem in tree.stems:
		mesh_trunk(md, tree, stem, 4 if sap else 5, max(tree.H / 5.0, 1.0), bark_tile_u, max_rings=7, top_jag=False)
	if tree.sp["cards"] is None:
		for b in tree.branches:
			if b.pts is not None and b.L > 0.6 and b.radii[0] > 0.02:
				mesh_branch(md, tree, b, 3, 1.0, 1)
		return md
	# tiers: group live branches by height band, emit a fan of big cards per tier
	live = [b for b in tree.branches if b.pts is not None and not b.dead and b.cards0]
	if not live:
		return md
	zmin = min(b.z0 for b in live)
	zmax = max(b.z0 for b in live)
	nt = int(np.clip(round((zmax - zmin) / max(tree.H * 0.09, 0.35)), 2, 12))
	edges = np.linspace(zmin, zmax + 1e-3, nt + 1)
	for k in range(nt):
		band = [b for b in live if edges[k] <= b.z0 < edges[k + 1]]
		if not band:
			continue
		zc = float(np.mean([b.z0 for b in band]))
		reach = float(np.percentile([b.reach for b in band], 80))
		elev = float(np.mean([math.atan2(b.pts[-1][2] - b.pts[0][2], np.linalg.norm(b.pts[-1][:2] - b.pts[0][:2])) for b in band]))
		nf = 5 if reach > 1.2 else 4
		ph = rs.uniform(0, 2 * math.pi)
		stem = tree.stems[0] if len(tree.stems) == 1 else tree.stems[k % len(tree.stems)]
		center, _ = stem.at(stem.s_at_z(zc))
		for i in range(nf):
			az = ph + i * 2 * math.pi / nf + rs.normal(0, 0.15)
			dh = np.array([math.cos(az), math.sin(az), 0.0])
			d = vc.normalize(dh * math.cos(elev) + Z * math.sin(elev))
			w = vc.normalize(np.cross(Z, d))
			roll = rs.normal(0, 0.35)
			w = vc.normalize(w * math.cos(roll) + np.cross(d, w) * math.sin(roll))
			n = vc.normalize(np.cross(d, w))
			if n[2] < 0:
				n, w = -n, -w
			length = reach * 1.12
			width = max(length * 0.9, (edges[1] - edges[0]) * 1.6)
			c = Card(center + dh * 0.05, d, w, n, length, width, "long", 0.1 * length, 0.2, 1.0, rs.random(), zc / tree.H)
			mesh_card(md, tree, c, regions, segs=1)
	# spire
	top = tree.stems[0].pts[-1]
	for i in range(2):
		az = i * math.pi / 2
		w = np.array([math.cos(az), math.sin(az), 0.0])
		ln = tree.sp["leader"] * 1.4 + 0.3
		c = Card(top - Z * ln * 0.9, Z, w, vc.normalize(np.cross(Z, w)), ln, ln * 0.5, "tip", 0.0, 0.4, 0.8, 0.5, 1.0)
		mesh_card(md, tree, c, regions, segs=1)
	return md


# ------------------------------------------------------------------------------------------------ build + export

def build_tree(name: str) -> Tree:
	tree = Tree(name, VARIANTS[name])
	tree.build_stems()
	tree.build_branches()
	return tree


def build_variant(name: str, cards_meta: dict | None = None, mat_meta: dict | None = None) -> dict:
	cards_meta = cards_meta if cards_meta is not None else load_cards_meta()
	mat_meta = mat_meta if mat_meta is not None else load_material_meta()
	var = VARIANTS[name]
	sp = SPECIES[var["sp"]]
	regions = (cards_meta.get(sp["cards"], {}) or {}).get("regions") if sp["cards"] else None
	if regions is None:
		regions = {"long": {"uv": [0.0, 0.0, 0.5, 1.0]}, "short": {"uv": [0.5, 0.0, 1.0, 0.5]},
			"tip": {"uv": [0.5, 0.5, 1.0, 1.0]}}
	bark_tile_u = float(mat_meta.get(sp["bark"], {}).get("tile_m", [0.5, 1.0])[0])
	tree = build_tree(name)
	mul = 1.0
	lod0 = None
	for _ in range(14):
		tree.place_cards(mul)
		lod0 = build_lod0(tree, regions, bark_tile_u)
		if lod0.tri_count() <= LOD0_BUDGET:
			break
		mul *= 1.08
	lod1 = build_lod1(tree, regions, bark_tile_u)
	lod2 = build_lod2(tree, regions, bark_tile_u)
	co = np.array(lod0.co)
	aabb_min = co.min(0)
	aabb_max = co.max(0)
	stem = tree.stems[0]
	r1 = float(tree.trunk_radius(stem, 1.4))
	meta = {
		"species": var["sp"], "height": round(float(aabb_max[2]), 3), "dbh": var["dbh"],
		"trunk_radius": round(r1 / 1.0, 4), "stems": len(tree.stems),
		"crown_radius": round(float(max(np.abs(co[:, 0]).max(), np.abs(co[:, 1]).max())), 3),
		"crown_base": round(var["cb"] * tree.H, 2), "cards": sp["cards"], "bark": sp["bark"],
		"wood_density": sp["wood_density"], "sapling": bool(var.get("sapling", False)),
		"broken": bool(var.get("broken")),
		# Godot space AABB (x, y=up, z=-blender_y)
		"aabb_min": [round(float(aabb_min[0]), 3), round(float(aabb_min[2]), 3), round(float(-aabb_max[1]), 3)],
		"aabb_max": [round(float(aabb_max[0]), 3), round(float(aabb_max[2]), 3), round(float(-aabb_min[1]), 3)],
		"tris": [lod0.tri_count(), lod1.tri_count(), lod2.tri_count()], "card_spacing_mul": round(mul, 3),
	}
	return {"tree": tree, "lods": [lod0, lod1, lod2], "meta": meta}


def export_variant(name: str, built: dict) -> str:
	import bpy
	vc.reset_scene()
	var = VARIANTS[name]
	sp = SPECIES[var["sp"]]
	mats = [vc.simple_material(sp["bark"], (0.3, 0.25, 0.2, 1)),
		vc.simple_material("cards_" + (sp["cards"] or "none"), (0.1, 0.2, 0.1, 1))]
	objs = []
	for i, md in enumerate(built["lods"]):
		ob = md.to_object(f"LOD{i}", mats)
		objs.append(ob)
	path = os.path.join(vc.MODELS_VEG, f"{name}.glb")
	vc.export_glb(path, objs)
	vc.write_godot_scene_import(path)
	return path


def update_manifest(entries: dict, key: str = "trees") -> None:
	p = os.path.join(vc.MODELS_VEG, "vegetation.json")
	data = json.load(open(p)) if os.path.exists(p) else {}
	data.setdefault(key, {})
	data[key].update(entries)
	vc.ensure_dir(vc.MODELS_VEG)
	json.dump(data, open(p, "w"), indent=1, sort_keys=True)


def main():
	a = vc.parse_args()
	only = [s for s in a.get("only", "").split(",") if s] or list(VARIANTS.keys())
	cm = load_cards_meta()
	mm = load_material_meta()
	entries = {}
	for name in only:
		built = build_variant(name, cm, mm)
		path = export_variant(name, built)
		meta = built["meta"]
		meta["path"] = "res://" + os.path.relpath(path, vc.PROJECT).replace(os.sep, "/")
		entries[name] = meta
		print(f"[trees] {name}: tris {meta['tris']} h={meta['height']} crown_r={meta['crown_radius']} mul={meta['card_spacing_mul']}")
	update_manifest(entries)


if __name__ == "__main__":
	main()
