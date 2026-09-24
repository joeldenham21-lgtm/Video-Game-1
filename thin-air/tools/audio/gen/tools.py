"""Tools, felling, building, doors, creaks, item handling. Modal synthesis + friction + granular debris."""
from __future__ import annotations

import math

import numpy as np

from lib import dsp, models as M
from lib.dsp import SR, ns, place, tvec
from catalog import sfx


def _impulse(dur: float, r, lp_hz: float = 8000) -> np.ndarray:
	x = np.zeros(ns(dur))
	k = ns(0.0015)
	x[:k] = r.standard_normal(k) * np.hanning(k)
	return dsp.lp(x, lp_hz)


def _chips(r, dur: float, count: int, lo: float = 600, hi: float = 5000, amp: float = 0.2, t0: float = 0.08) -> np.ndarray:
	"""Wood chips/bark flakes landing on snow or duff: soft short ticks."""
	out = dsp.zeros(dur)
	for _ in range(count):
		tt = t0 + r.exponential(0.12)
		if tt < dur - 0.02:
			c = dsp.click(r, 0.002 + 0.003 * r.random(), lo, hi) * amp * (0.3 + r.random())
			place(out, c, tt)
	return out


def _handle_buzz(r, dur: float = 0.25, f: float = 180.0, amp: float = 0.3) -> np.ndarray:
	"""Hickory handle flexural vibration after a hit (felt as a buzz)."""
	n = ns(dur)
	t = tvec(n)
	x = np.sin(2 * math.pi * f * t) * np.exp(-t / 0.035) + 0.5 * np.sin(2 * math.pi * f * 2.8 * t) * np.exp(-t / 0.02)
	return x * amp * np.clip(t / 0.002, 0, 1)


# ------------------------------------------------------------------------------------------------ axe

@sfx("axe_swing", n=4, cat="swing")
def axe_swing(r, i):
	d = 0.42 + 0.08 * r.random()
	out = M.whoosh(r, d, 0.55, 180 + 60 * r.random(), 900 + 300 * r.random(), 1.4)
	place(out, M.cloth_rustle(r, 0.3, 0.8, 0.4) * 0.15, 0.0)
	return out


@sfx("axe_hit_wood", n=6, cat="tool")
def axe_hit_wood(r, i):
	"""Steel bit biting into spruce: sharp 'thock', trunk/fibre resonance, handle buzz, chips."""
	out = dsp.zeros(0.9)
	exc = _impulse(0.6, r, 7000)
	crack = dsp.click(r, 0.003, 800, 9000, 1.8) * 1.2
	place(out, crack, 0.0)
	# local wood resonance (radial/tangential, heavily damped)
	f0 = 380 + 380 * r.random()
	fr, t60, amps = M.wood_modes(r, f0, 5, 1.6)
	place(out, dsp.resonator_bank(exc, fr, t60 * 0.7, amps) * 1.8, 0.0)
	# the trunk: low thunk
	place(out, dsp.resonator_bank(exc, [95 + 40 * r.random(), 210 + 60 * r.random()], [0.09, 0.06], [1.0, 0.6]) * 1.2, 0.0)
	# steel head ring, muffled because embedded
	fr2, t602, a2 = M.metal_modes(r, 2800 + 900 * r.random(), 6, 0.05)
	place(out, dsp.modal(ns(0.1), fr2, t602, a2, r=r) * 0.08, 0.0)
	place(out, _handle_buzz(r, 0.2, 160 + 60 * r.random(), 0.25), 0.002)
	# fibre crunch as the bit wedges in
	place(out, M.granular(r, 0.05, np.full(ns(0.05), 900.0), lambda rr: dsp.click(rr, 0.001, 1200, 7000), 0.6) * 0.12, 0.004)
	place(out, _chips(r, 0.9, 3 + r.integers(0, 5), 300, 2500, 0.02), 0.0)
	return out


@sfx("axe_hit_stone", n=4, cat="tool")
def axe_hit_stone(r, i):
	"""Steel on granite: bright clang of the free-ringing head, glancing scrape, rock tick, handle sting."""
	out = dsp.zeros(1.0)
	place(out, dsp.click(r, 0.002, 1500, 14000, 2.0) * 1.5, 0.0)
	fr, t60, amps = M.metal_modes(r, 1900 + 700 * r.random(), 10, 0.35)
	place(out, dsp.modal(ns(0.9), fr, t60, amps, r=r) * 0.45, 0.0)
	place(out, M.scrape(r, 0.07, 2000, 12000, 1500) * dsp.env_points(ns(0.07), [(0, 1), (0.07, 0)]) * 0.35, 0.002)
	place(out, M.rock_knock(r, 0.4, 0.15) * 0.3, 0.0)
	place(out, _handle_buzz(r, 0.3, 190, 0.4), 0.0)
	for _ in range(r.integers(1, 4)):
		place(out, M.stone_ping(r, 0.8 + 1.5 * r.random(), 0.15), 0.15 + 0.3 * r.random())
	return out


@sfx("pick_hit_stone", n=4, cat="tool")
def pick_hit_stone(r, i):
	"""Pick/ice-axe adze into rock: heavier head, rock fracture crunch, falling chips."""
	out = dsp.zeros(1.1)
	place(out, dsp.click(r, 0.003, 900, 12000, 1.5) * 1.6, 0.0)
	fr, t60, amps = M.metal_modes(r, 1300 + 500 * r.random(), 9, 0.22)
	place(out, dsp.modal(ns(0.6), fr, t60, amps, r=r) * 0.35, 0.0)
	place(out, M.rock_knock(r, 0.25, 0.2) * 0.8, 0.0)
	n = ns(0.12)
	env = np.exp(-tvec(n) / 0.03)
	place(out, M.granular(r, 0.12, 2500 * env, lambda rr: M.stone_ping(rr, 0.6 + rr.random(), 0.3, 0.02), 0.7) * 0.5, 0.002)
	for _ in range(4 + r.integers(0, 6)):
		place(out, M.stone_ping(r, 0.8 + 2.5 * r.random(), 0.2 + 0.2 * r.random()), 0.12 + r.exponential(0.15))
	place(out, _handle_buzz(r, 0.3, 150, 0.35), 0.0)
	return out


@sfx("knife_hit", n=4, cat="tool", target=-19.0, max_distance=40.0)
def knife_hit(r, i):
	"""Knife work: variants 0,1 = cutting into hide/meat (wet, fibrous); 2,3 = carving wood."""
	out = dsp.zeros(0.5)
	if i < 2:
		n = ns(0.18)
		t = tvec(n)
		slice_ = dsp.bp(dsp.pink(n, r), 1200, 6000) * np.exp(-((t - 0.05) / 0.035) ** 2) * 0.4
		place(out, slice_, 0.0)
		place(out, dsp.lp(_impulse(0.15, r, 900), 600) * 2.0, 0.005)
		for _ in range(5):
			place(out, M.bubble(r, 1.2 + 2 * r.random(), 0.3, 0.4, 0.03, 2.0), 0.02 + 0.1 * r.random())
		place(out, M.scrape(r, 0.12, 600, 4000, 800) * dsp.hann_env(ns(0.12)) * 0.2, 0.03)
	else:
		place(out, dsp.click(r, 0.002, 1500, 9000) * 0.9, 0.0)
		fr, t60, amps = M.wood_modes(r, 900 + 500 * r.random(), 4, 2.0)
		place(out, dsp.resonator_bank(_impulse(0.2, r), fr, t60, amps) * 1.0, 0.0)
		n = ns(0.14)
		sh = M.scrape(r, 0.14, 1500, 8000, 1200) * dsp.env_points(n, [(0, 0), (0.02, 1), (0.14, 0)]) * 0.35
		place(out, sh, 0.01)
		fr2, t602, a2 = M.metal_modes(r, 4200, 5, 0.08)
		place(out, dsp.modal(ns(0.1), fr2, t602, a2, r=r) * 0.05, 0.0)
	return out


@sfx("ice_axe_hit", n=4, cat="tool", target=-17.0)
def ice_axe_hit(r, i):
	"""Ice-axe pick placement in water ice: steel 'thunk', ice fracture, dinner-plating chips skittering."""
	out = dsp.zeros(0.9)
	place(out, dsp.click(r, 0.002, 800, 10000, 1.6) * 1.2, 0.0)
	place(out, dsp.resonator_bank(_impulse(0.3, r), [340, 820, 1500], [0.05, 0.03, 0.02], [1.0, 0.6, 0.4]) * 1.2, 0.0)
	fr, t60, amps = M.metal_modes(r, 2400, 7, 0.08)
	place(out, dsp.modal(ns(0.12), fr, t60, amps, r=r) * 0.12, 0.0)
	n = ns(0.08)
	env = np.exp(-tvec(n) / 0.02)
	place(out, M.granular(r, 0.08, 3000 * env, lambda rr: M.snow_grain(rr, 1.0), 0.7) * 0.3, 0.001)
	for _ in range(5 + r.integers(0, 6)):
		fr2, t2, a2 = M.metal_modes(r, 3500 + 3000 * r.random(), 4, 0.02)
		place(out, dsp.modal(ns(0.03), fr2, t2, a2, r=r) * 0.06, 0.05 + r.exponential(0.1))
	place(out, _handle_buzz(r, 0.2, 210, 0.2), 0.0)
	return out


# ------------------------------------------------------------------------------------------------ felling

@sfx("tree_crack", n=3, cat="big", target=-15.0, max_distance=300.0, unit_size=18.0)
def tree_crack(r, i):
	"""Hinge wood failing: sparse fibre snaps accelerating, trunk groan (stick-slip), final splintering."""
	dur = 3.2 + 0.8 * r.random()
	out = dsp.zeros(dur + 0.8)
	n = ns(dur)
	t = tvec(n)
	# groan: slow stick-slip, rising rate as the hinge yields
	fr, t60, amps = M.wood_modes(r, 70 + 25 * r.random(), 6, 0.5)
	fr = np.concatenate([fr, [180 + 40 * r.random(), 420]])
	t60 = np.concatenate([t60, [0.15, 0.08]])
	amps = np.concatenate([amps, [0.8, 0.4]])
	f_ss = 14 * (1 + 5 * (t / dur) ** 2) * (1 + 0.25 * dsp.smooth_noise(n, r, 2))
	exc = M.stick_slip(r, f_ss, 0.3) * dsp.env_points(n, [(0, 0.2), (dur * 0.5, 0.6), (dur * 0.9, 1.0), (dur, 0.4)])
	place(out, dsp.resonator_bank(exc, fr, t60, amps) * 1.2, 0.0)
	# fibre snaps: rate grows exponentially
	rate = lambda tt: 3 + 60 * (tt / dur) ** 3
	for tt in dsp.poisson_times(dur, rate, r):
		a = 0.15 + 0.6 * (tt / dur) ** 1.5 * r.random()
		c = dsp.click(r, 0.002 + 0.004 * r.random(), 300, 7000, 1.6)
		c = dsp.mix(c, dsp.resonator_bank(c, fr[:4] * 3, t60[:4] * 0.3, amps[:4]) * 0.5)
		place(out, c * a, float(tt))
	# final splintering burst
	sp = M.granular(r, 0.35, np.full(ns(0.35), 1500.0) * np.exp(-tvec(ns(0.35)) / 0.1),
		lambda rr: dsp.click(rr, 0.003, 400, 8000, 1.5), 0.8)
	place(out, sp * 0.6, dur - 0.1)
	place(out, dsp.resonator_bank(_impulse(0.5, r, 3000), fr, t60, amps) * 1.5, dur - 0.1)
	return out


@sfx("tree_fall", n=2, cat="big", target=-13.0, max_distance=400.0, unit_size=25.0)
def tree_fall(r, i):
	"""The fall itself (ends just before ground impact): accelerating crown whoosh through the air,
	branches raking neighbouring trees, snow shedding from the crown."""
	dur = 3.6 + 0.6 * r.random()
	n = ns(dur)
	t = tvec(n)
	# rigid-body fall: theta'' = (3g/2L) sin(theta); angular velocity grows ~exponentially early on
	L = 20.0
	th = np.zeros(n)
	w = np.zeros(n)
	th0, w0 = 0.05, 0.0
	dt = 1.0 / SR
	a = 1.5 * 9.81 / L
	# integrate coarsely then interpolate
	steps = int(dur * 200)
	ths, ws = [th0], [w0]
	for _ in range(steps):
		w0 += a * math.sin(th0) * (1.0 / 200)
		th0 = min(th0 + w0 / 200, math.pi / 2)
		ths.append(th0)
		ws.append(w0 if th0 < math.pi / 2 else 0)
	ws = np.array(ws)
	# time-rescale so the tree lands at `dur`
	land = int(np.argmax(np.array(ths) >= math.pi / 2 - 1e-3)) or steps
	v = np.interp(np.linspace(0, land, n), np.arange(len(ws)), ws)
	v /= v.max() + 1e-9
	speed = v * L
	# crown air noise: broadband needles/branches, level ~ v^3, spectrum shifts up with speed
	fc = 250 + 1800 * v
	air = dsp.tv_bandpass(dsp.pink(n, r), fc, 0.7) + dsp.tv_bandpass(r.standard_normal(n), fc * 3, 1.0) * 0.4
	air = dsp.lp(air, 5500, 2) * v ** 2.2
	# needle rustle texture (fine crackle modulated)
	crk = M.granular(r, dur, 3000 * v ** 2, lambda rr: dsp.click(rr, 0.001, 2000, 9000), 0.6) * 0.15
	out = dsp.zeros(dur + 0.3)
	place(out, air + crk, 0.0)
	# branches raking neighbours: snap events concentrated in the second half
	for tt in dsp.poisson_times(dur, lambda tt: 1 + 14 * (tt / dur) ** 3, r):
		c = dsp.click(r, 0.003 + 0.006 * r.random(), 250, 6000, 1.4)
		fr, t60, amps = M.wood_modes(r, 400 + 900 * r.random(), 4, 1.5)
		c = dsp.mix(c, dsp.resonator_bank(c, fr, t60, amps) * 0.6)
		place(out, c * (0.3 + 0.8 * r.random()) * (0.3 + v[min(int(tt * SR), n - 1)]), float(tt))
	# snow shedding: soft falling-snow flumps
	for tt in dsp.poisson_times(dur, lambda tt: 0.5 + 3 * (tt / dur), r):
		m = ns(0.25)
		s = dsp.lp(r.standard_normal(m), 700) * dsp.hann_env(m) * 0.3
		place(out, s, float(tt))
	return out


@sfx("tree_impact", n=3, cat="big", target=-11.0, max_distance=500.0, unit_size=30.0)
def tree_impact(r, i):
	"""Trunk hitting the forest floor: ground thud, bounce, crown crash, snow burst, settling."""
	dur = 3.5
	out = dsp.zeros(dur)
	n = ns(0.8)
	t = tvec(n)
	f = 34 + 10 * r.random()
	thud = np.sin(2 * math.pi * f * t * (1 - 0.3 * t)) * np.exp(-t / 0.12) * np.clip(t / 0.01, 0, 1)
	thud += dsp.lp(r.standard_normal(n), 180) * np.exp(-t / 0.08) * 0.6
	place(out, thud * 1.6, 0.0)
	fr, t60, amps = M.wood_modes(r, 55 + 20 * r.random(), 6, 0.6)
	place(out, dsp.resonator_bank(_impulse(1.0, r, 2000), fr, t60, amps) * 1.5, 0.0)
	# bounce
	place(out, thud[:ns(0.4)] * 0.45, 0.28 + 0.1 * r.random())
	# crown crash: dense branch breakage + needle rustle, decaying
	m = ns(1.6)
	env = np.exp(-tvec(m) / 0.35)
	crash = M.granular(r, 1.6, 700 * env, lambda rr: dsp.click(rr, 0.002 + 0.006 * rr.random(), 250, 7000, 1.3), 0.9)
	place(out, crash * 0.8, 0.02)
	rustle = dsp.bp(dsp.pink(m, r), 400, 7000) * env ** 0.7 * 0.35
	place(out, rustle, 0.03)
	for _ in range(6):
		fr2, t602, a2 = M.wood_modes(r, 300 + 900 * r.random(), 4, 1.3)
		place(out, dsp.resonator_bank(_impulse(0.3, r), fr2, t602, a2) * (0.3 + 0.5 * r.random()), 0.02 + r.exponential(0.2))
	# snow cloud falling back
	for tt in dsp.poisson_times(2.0, lambda tt: 12 * math.exp(-tt / 0.6), r, 0.1):
		s = dsp.lp(r.standard_normal(ns(0.3)), 600) * dsp.hann_env(ns(0.3)) * 0.18
		place(out, s, float(tt))
	# settling creaks
	place(out, M.creak(r, 0.6, 50, 35, (fr, t60, amps), 0.3) * 0.25, 1.4 + 0.5 * r.random())
	return out


@sfx("log_split", n=3, cat="tool", target=-15.0)
def log_split(r, i):
	"""Splitting a round: bite, rapid fibre tear along the grain, halves falling off the block."""
	out = dsp.zeros(1.2)
	base = axe_hit_wood(r, 0)
	place(out, base * 0.8, 0.0)
	m = ns(0.09)
	tear = M.granular(r, 0.09, np.full(m, 3500.0) * np.linspace(1, 0.3, m), lambda rr: dsp.click(rr, 0.0015, 500, 7000, 1.4), 0.6)
	place(out, tear * 0.7, 0.012)
	for k in range(2):
		tt = 0.22 + 0.12 * k + 0.08 * r.random()
		fr, t60, amps = M.wood_modes(r, 300 + 250 * r.random(), 6, 1.0)
		place(out, dsp.resonator_bank(_impulse(0.4, r, 4000), fr, t60, amps) * 0.9, tt)
		place(out, dsp.resonator_bank(_impulse(0.3, r, 3000), fr * 1.02, t60, amps) * 0.35, tt + 0.07 + 0.04 * r.random())
	return out


# ------------------------------------------------------------------------------------------------ bow / spear

@sfx("bow_draw", n=3, cat="handling", target=-24.0)
def bow_draw(r, i):
	"""Drawing a wooden recurve: limb creak rising with draw weight, arrow on the rest, string tension."""
	dur = 1.0 + 0.2 * r.random()
	n = ns(dur)
	t = tvec(n) / dur
	out = dsp.zeros(dur + 0.2)
	fr, t60, amps = M.wood_modes(r, 240 + 60 * r.random(), 5, 0.7)
	cr = M.creak(r, dur, 25, 110, (fr, t60, amps), 0.25, 0.3)
	place(out, cr * dsp.env_points(n, [(0, 0.1), (dur * 0.8, 1), (dur, 0.6)]) * 0.5, 0.0)
	scr = M.scrape(r, dur * 0.7, 1500, 7000, 250) * dsp.env_points(ns(dur * 0.7), [(0, 0), (0.05, 1), (dur * 0.7, 0.2)]) * 0.08
	place(out, scr, 0.05)
	place(out, M.cloth_rustle(r, 0.5, 0.8) * 0.15, 0.0)
	return out


@sfx("bow_release", n=3, cat="tool", target=-17.0, max_distance=50.0)
def bow_release(r, i):
	"""String release: string slap + low 'thrum' of the string/limbs, arrow leaving."""
	out = dsp.zeros(0.6)
	n = ns(0.4)
	t = tvec(n)
	f = 95 + 25 * r.random()
	string = sum(np.sin(2 * math.pi * f * k * t * (1 + 0.002 * k)) * np.exp(-t * (18 + 6 * k)) / k for k in range(1, 9))
	place(out, string * 0.8, 0.0)
	place(out, dsp.click(r, 0.004, 300, 6000, 1.2) * 1.2, 0.0)
	place(out, M.whoosh(r, 0.18, 0.2, 600, 2500, 1.6) * 0.25, 0.005)
	return out


@sfx("arrow_hit", n=4, cat="tool", target=-17.0, max_distance=50.0)
def arrow_hit(r, i):
	"""Arrow striking wood/flesh: 'thock' + shaft flexural vibration buzz."""
	out = dsp.zeros(0.6)
	place(out, dsp.click(r, 0.003, 500, 8000, 1.5), 0.0)
	fr, t60, amps = M.wood_modes(r, 500 + 300 * r.random(), 4, 1.5)
	place(out, dsp.resonator_bank(_impulse(0.2, r), fr, t60, amps), 0.0)
	n = ns(0.4)
	t = tvec(n)
	f = 55 + 25 * r.random()
	shaft = (np.sin(2 * math.pi * f * t) + 0.4 * np.sin(2 * math.pi * f * 2.76 * t)) * np.exp(-t / 0.07)
	shaft *= 1 + 0.6 * np.sign(np.sin(2 * math.pi * f * t))  # fletching/shaft rattle
	place(out, dsp.lp(shaft, 900) * 0.35, 0.002)
	return out


@sfx("spear_throw", n=3, cat="swing")
def spear_throw(r, i):
	out = dsp.zeros(0.8)
	place(out, M.cloth_rustle(r, 0.35, 1.0) * 0.2, 0.0)
	place(out, M.whoosh(r, 0.6, 0.4, 150, 700, 1.1), 0.08)
	return out


# ------------------------------------------------------------------------------------------------ building

@sfx("build_place", n=4, cat="build")
def build_place(r, i):
	"""Setting down a log/timber piece: heavy wooden thud, log modes, settle and small slide."""
	out = dsp.zeros(1.0)
	n = ns(0.4)
	t = tvec(n)
	place(out, np.sin(2 * math.pi * 60 * t) * np.exp(-t / 0.05) * np.clip(t / 0.004, 0, 1) * 0.8, 0.0)
	fr, t60, amps = M.wood_modes(r, 140 + 80 * r.random(), 6, 0.9)
	place(out, dsp.resonator_bank(_impulse(0.6, r, 3500), fr, t60, amps) * 1.6, 0.0)
	place(out, dsp.resonator_bank(_impulse(0.4, r, 2500), fr * 1.01, t60, amps) * 0.5, 0.09 + 0.05 * r.random())
	place(out, M.scrape(r, 0.15, 400, 3500, 300) * dsp.hann_env(ns(0.15)) * 0.12, 0.12)
	place(out, _chips(r, 0.8, 3, 500, 3000, 0.04, 0.05), 0.0)
	return out


@sfx("build_hammer", n=4, cat="build")
def build_hammer(r, i):
	"""Hammer driving a nail into timber: steel-on-steel 'tink' (nail rings), wood thud."""
	out = dsp.zeros(0.6)
	place(out, dsp.click(r, 0.0015, 2000, 14000, 2), 0.0)
	f_nail = 2600 + 1400 * (i / 3.0) + 300 * r.random()   # pitch rises as the nail shortens
	fr, t60, amps = M.metal_modes(r, f_nail, 6, 0.12, "beam")
	place(out, dsp.modal(ns(0.3), fr, t60, amps, r=r) * 0.35, 0.0)
	fr2, t602, a2 = M.metal_modes(r, 1500, 6, 0.06)
	place(out, dsp.modal(ns(0.1), fr2, t602, a2, r=r) * 0.2, 0.0)
	fr3, t603, a3 = M.wood_modes(r, 180 + 60 * r.random(), 5, 1.0)
	place(out, dsp.resonator_bank(_impulse(0.4, r, 3000), fr3, t603, a3) * 1.0, 0.0)
	place(out, _handle_buzz(r, 0.15, 230, 0.15), 0.0)
	return out


@sfx("build_invalid", n=2, cat="ui", target=-26.0)
def build_invalid(r, i):
	"""Soft muted double knock (knuckle on wood) — understated negative feedback."""
	out = dsp.zeros(0.3)
	for k in range(2):
		fr, t60, amps = M.wood_modes(r, 260 + 20 * k, 4, 2.5)
		place(out, dsp.resonator_bank(_impulse(0.12, r, 1500), fr, t60, amps) * (1 - 0.3 * k), 0.11 * k)
	return dsp.lp(out, 2500)


# ------------------------------------------------------------------------------------------------ doors & creaks

def _hinge_squeal(r, dur, f_a, f_b, metal=True):
	n = ns(dur)
	if metal:
		fr, t60, amps = M.metal_modes(r, 380 + 120 * r.random(), 8, 0.25)
	else:
		fr, t60, amps = M.wood_modes(r, 200 + 60 * r.random(), 5, 0.8)
	return M.creak(r, dur, f_a, f_b, (fr, t60, amps), 0.12, 0.25)


@sfx("door_open", n=3, cat="build", target=-20.0, max_distance=40.0)
def door_open(r, i):
	"""Cabin door: iron thumb-latch lift, strap-hinge squeal, air as the plank door swings."""
	out = dsp.zeros(1.6)
	fr, t60, amps = M.metal_modes(r, 1700, 6, 0.08)
	place(out, dsp.modal(ns(0.12), fr, t60, amps, r=r) * 0.4 + 0, 0.0)
	place(out, dsp.click(r, 0.002, 1000, 8000) * 0.5, 0.0)
	place(out, dsp.modal(ns(0.1), fr * 1.1, t60, amps, r=r) * 0.25, 0.06)
	place(out, _hinge_squeal(r, 0.8 + 0.3 * r.random(), 60 + 40 * r.random(), 160 + 80 * r.random()) * 0.35, 0.15)
	n = ns(0.9)
	place(out, dsp.lp(dsp.pink(n, r), 500) * dsp.hann_env(n) * 0.08, 0.2)
	return out


@sfx("door_close", n=3, cat="build", target=-17.0, max_distance=50.0)
def door_close(r, i):
	"""Plank door closing: short swing, slab thud into the frame, latch dropping."""
	out = dsp.zeros(1.1)
	place(out, _hinge_squeal(r, 0.3, 120, 70) * 0.2, 0.0)
	tt = 0.3 + 0.05 * r.random()
	fr, t60, amps = M.wood_modes(r, 85 + 30 * r.random(), 6, 0.8)
	place(out, dsp.resonator_bank(_impulse(0.7, r, 2500), fr, t60, amps) * 1.8, tt)
	n = ns(0.3)
	place(out, np.sin(2 * math.pi * 55 * tvec(n)) * np.exp(-tvec(n) / 0.05) * 0.6, tt)
	fr2, t602, a2 = M.metal_modes(r, 1500, 6, 0.07)
	place(out, dsp.modal(ns(0.12), fr2, t602, a2, r=r) * 0.35, tt + 0.03)
	return out


@sfx("door_open_metal", n=2, cat="build", target=-20.0, max_distance=40.0)
def door_open_metal(r, i):
	"""Station module door: lever handle, cam latch, gasket seal peeling, heavy hinge."""
	out = dsp.zeros(1.6)
	fr, t60, amps = M.metal_modes(r, 900, 8, 0.2)
	place(out, dsp.modal(ns(0.3), fr, t60, amps, r=r) * 0.4, 0.0)
	place(out, dsp.click(r, 0.003, 600, 7000) * 0.7, 0.05)
	n = ns(0.25)
	seal = dsp.bp(dsp.pink(n, r), 300, 3000) * dsp.env_points(n, [(0, 0), (0.03, 1), (0.25, 0)]) * 0.25
	seal *= 1 + 0.8 * np.abs(dsp.smooth_noise(n, r, 60))
	place(out, seal, 0.2)
	place(out, _hinge_squeal(r, 0.6, 40, 90) * 0.15, 0.35)
	fr2, t602, a2 = M.metal_modes(r, 180, 10, 0.5)
	place(out, dsp.resonator_bank(_impulse(0.8, r, 2000), fr2, t602, a2) * 0.25, 0.3)
	return out


@sfx("door_close_metal", n=2, cat="build", target=-16.0, max_distance=50.0)
def door_close_metal(r, i):
	out = dsp.zeros(1.4)
	tt = 0.15
	fr, t60, amps = M.metal_modes(r, 150 + 40 * r.random(), 12, 0.7)
	place(out, dsp.resonator_bank(_impulse(1.2, r, 3000), fr, t60, amps) * 1.0, tt)
	n = ns(0.3)
	place(out, np.sin(2 * math.pi * 50 * tvec(n)) * np.exp(-tvec(n) / 0.06) * 0.8, tt)
	fr2, t602, a2 = M.metal_modes(r, 1100, 6, 0.1)
	place(out, dsp.modal(ns(0.2), fr2, t602, a2, r=r) * 0.4, tt + 0.08)
	place(out, dsp.modal(ns(0.2), fr2 * 1.2, t602, a2, r=r) * 0.3, tt + 0.35)
	return out


@sfx("metal_creak", n=3, cat="big", target=-20.0, max_distance=80.0, unit_size=8.0)
def metal_creak(r, i):
	"""Steel structure flexing under wind load (mast, module skin, wreck): slow stick-slip groan + squeal."""
	dur = 1.6 + 1.2 * r.random()
	out = dsp.zeros(dur + 0.6)
	fr, t60, amps = M.metal_modes(r, 140 + 80 * r.random(), 12, 0.6)
	f0 = 18 + 20 * r.random()
	place(out, M.creak(r, dur, f0, f0 * (1.5 + r.random()), (fr, t60, amps), 0.18, 0.4) * 0.6, 0.0)
	if r.random() < 0.7:
		fr2, t602, a2 = M.metal_modes(r, 700, 8, 0.2)
		place(out, M.creak(r, dur * 0.4, 200, 380, (fr2, t602, a2), 0.05, 0.1) * 0.2, dur * 0.3)
	return out


@sfx("wood_creak", n=4, cat="big", target=-21.0, max_distance=60.0, unit_size=6.0)
def wood_creak(r, i):
	"""Timber/tree creak: stick-slip at 10-60 Hz through lossy wood modes (cabin logs, leaning trunks)."""
	dur = 0.9 + 1.4 * r.random()
	out = dsp.zeros(dur + 0.4)
	fr, t60, amps = M.wood_modes(r, 110 + 90 * r.random(), 6, 0.55)
	f0 = 12 + 25 * r.random()
	place(out, M.creak(r, dur, f0, f0 * (0.6 + 1.2 * r.random()), (fr, t60, amps), 0.22, 0.35) * 0.8, 0.0)
	return out


# ------------------------------------------------------------------------------------------------ item handling

def _zipper(r, dur: float, speed_env=None, bright: float = 1.0) -> np.ndarray:
	n = ns(dur)
	v = speed_env if speed_env is not None else dsp.env_points(n, [(0, 0.2), (dur * 0.2, 1), (dur * 0.85, 0.9), (dur, 0.1)])
	rate = 150 + 450 * v
	x = M.stick_slip(r, rate, 0.04, 0.12)
	x = dsp.bp(x, 1200 * bright, 9000, 2) + dsp.resonator_bank(x, [2400, 4100, 6200], [0.004, 0.003, 0.002], [0.5, 0.4, 0.3])
	x += dsp.bp(dsp.pink(n, r), 1500, 7000) * v * 0.02
	return x * v


@sfx("inventory_open", n=2, cat="handling", target=-26.0, max_distance=0.0)
def inventory_open(r, i):
	"""Swinging the pack off a shoulder and unzipping the lid."""
	out = dsp.zeros(0.9)
	place(out, M.cloth_rustle(r, 0.35, 1.2, 0.4) * 0.35, 0.0)
	place(out, M.gear_rattle(r, 0.2, 0.4) * 0.15, 0.05)
	place(out, _zipper(r, 0.35 + 0.1 * r.random()) * 0.25, 0.28)
	return out


@sfx("inventory_close", n=2, cat="handling", target=-26.0, max_distance=0.0)
def inventory_close(r, i):
	out = dsp.zeros(0.8)
	place(out, _zipper(r, 0.3 + 0.08 * r.random()) * 0.25, 0.0)
	place(out, M.cloth_rustle(r, 0.3, 1.0, 0.4) * 0.3, 0.3)
	place(out, dsp.lp(M.boot_thud(r, 0.25, 0.1, 0.1), 600), 0.4)
	return out


@sfx("pickup", n=4, cat="handling", target=-25.0)
def pickup(r, i):
	"""Gloved hand picking something up: glove/cloth rustle + light lift."""
	out = dsp.zeros(0.5)
	place(out, M.cloth_rustle(r, 0.22, 0.9, 0.3) * 0.4, 0.0)
	place(out, dsp.lp(M.boot_thud(r, 0.18, 0.4, 0.08), 1500), 0.02)
	kinds = ["wood", "stone", "cloth", "metal"]
	k = kinds[i % 4]
	if k == "wood":
		fr, t60, amps = M.wood_modes(r, 600, 4, 2.0)
		place(out, dsp.resonator_bank(_impulse(0.15, r), fr, t60, amps) * 0.25, 0.03)
	elif k == "stone":
		place(out, M.stone_ping(r, 4, 0.15), 0.03)
	elif k == "metal":
		fr, t60, amps = M.metal_modes(r, 2200, 5, 0.08)
		place(out, dsp.modal(ns(0.1), fr, t60, amps, r=r) * 0.06, 0.03)
	return out


@sfx("drop", n=3, cat="handling", target=-24.0)
def drop(r, i):
	"""Item dropped at the feet onto snow/duff: soft thud + rustle."""
	out = dsp.zeros(0.5)
	place(out, M.cloth_rustle(r, 0.15, 0.6) * 0.2, 0.0)
	n = ns(0.2)
	place(out, dsp.lp(r.standard_normal(n), 400) * np.exp(-tvec(n) / 0.03) * 0.9, 0.12)
	place(out, M.granular(r, 0.08, np.full(ns(0.08), 400.0), lambda rr: M.snow_grain(rr), 0.5) * 0.1, 0.12)
	return out


@sfx("equip", n=3, cat="handling", target=-25.0)
def equip(r, i):
	"""Clothing/gear on: fabric rustle, strap cinch, buckle or snap click."""
	out = dsp.zeros(0.8)
	place(out, M.cloth_rustle(r, 0.5, 1.2, 0.5) * 0.4, 0.0)
	fr, t60, amps = M.metal_modes(r, 3000 if i != 1 else 1400, 5, 0.04)
	clk = dsp.click(r, 0.0015, 2000, 10000) * 0.6
	place(out, clk, 0.45)
	place(out, dsp.modal(ns(0.06), fr, t60, amps, r=r) * 0.1, 0.45)
	if i == 2:
		place(out, _zipper(r, 0.2) * 0.15, 0.2)
	return out


@sfx("craft", n=3, cat="handling", target=-24.0)
def craft(r, i):
	"""Hands at work: cord wrapped and pulled, knife trimming, material handled (≈1.4 s)."""
	out = dsp.zeros(1.6)
	place(out, M.cloth_rustle(r, 1.4, 0.8, 0.3) * 0.2, 0.0)
	for k in range(3):
		tt = 0.1 + 0.4 * k + 0.1 * r.random()
		fr, t60, amps = M.wood_modes(r, 350 + 100 * r.random(), 4, 0.9)
		cord = M.creak(r, 0.18, 90, 160, (fr, t60, amps), 0.2, 0.2) * 0.35
		place(out, cord, tt)
	sc = M.scrape(r, 0.25, 1500, 8000, 800) * dsp.hann_env(ns(0.25)) * 0.15
	place(out, sc, 0.7 + 0.2 * r.random())
	fr, t60, amps = M.wood_modes(r, 700, 4, 2.0)
	place(out, dsp.resonator_bank(_impulse(0.2, r), fr, t60, amps) * 0.3, 1.2)
	return out


@sfx("craft_done", n=2, cat="handling", target=-22.0)
def craft_done(r, i):
	"""Final hard pull on the lashing, then the finished piece set down."""
	out = dsp.zeros(0.8)
	fr, t60, amps = M.wood_modes(r, 300, 4, 0.8)
	place(out, M.creak(r, 0.14, 150, 60, (fr, t60, amps), 0.1, 0.1) * 0.5, 0.0)
	place(out, M.cloth_rustle(r, 0.2, 0.8) * 0.2, 0.1)
	fr2, t602, a2 = M.wood_modes(r, 240 + 60 * r.random(), 5, 1.2)
	place(out, dsp.resonator_bank(_impulse(0.4, r, 3000), fr2, t602, a2) * 1.0, 0.28)
	place(out, dsp.lp(M.boot_thud(r, 0.4, 0.3, 0.1), 900), 0.28)
	return out


@sfx("climb_grab", n=4, cat="body", target=-22.0)
def climb_grab(r, i):
	"""Gloved hand slapping onto rock and loading it: slap, grit scrape, pack creak, effort breath."""
	out = dsp.zeros(0.7)
	n = ns(0.05)
	slap = dsp.bp(r.standard_normal(n), 300, 5000) * np.exp(-tvec(n) / 0.008)
	place(out, slap * 0.9, 0.0)
	place(out, dsp.lp(M.boot_thud(r, 0.5, 0.5, 0.1), 1200), 0.0)
	place(out, M.scrape(r, 0.2, 800, 7000, 700) * dsp.env_points(ns(0.2), [(0, 1), (0.2, 0)]) * 0.15, 0.01)
	if r.random() < 0.6:
		for _ in range(r.integers(1, 4)):
			place(out, M.stone_ping(r, 0.8 + r.random(), 0.12), 0.1 + 0.3 * r.random())
	place(out, M.cloth_rustle(r, 0.3, 0.9) * 0.2, 0.05)
	place(out, M.gear_rattle(r, 0.25, 0.5) * 0.15, 0.08)
	return out
