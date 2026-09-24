"""Fire, water, ice, snow & rock mass movement, thunder, flares."""
from __future__ import annotations

import math

import numpy as np

from lib import dsp, models as M
from lib.dsp import SR, ns, place, tvec
from catalog import sfx


# ------------------------------------------------------------------------------------------------ fire

def _fire(r, dur: float, crackle_rate: float = 9.0, roar: float = 1.0, hiss: float = 1.0, pops: float = 1.0,
		flutter_hz: float = 4.0, sizzle: float = 1.0) -> np.ndarray:
	n = ns(dur)
	t = tvec(n)
	out = np.zeros(n)
	# lapping flames: low turbulent roar with flicker
	flick = np.clip(0.75 + 0.2 * dsp.smooth_noise(n, r, flutter_hz) + 0.1 * dsp.smooth_noise(n, r, flutter_hz * 3), 0.35, 1.5)
	out += dsp.lp(dsp.brown(n, r), 380, 2) * flick * 0.6 * roar
	out += dsp.bp(dsp.pink(n, r), 300, 1200) * flick ** 1.5 * 0.12 * roar
	# gas hiss
	hs = np.clip(0.5 + 0.4 * dsp.smooth_noise(n, r, 0.3), 0.05, 1.5)
	out += dsp.bp(dsp.pink(n, r), 2500, 9000) * hs * 0.05 * hiss
	# crackles in clusters (burning resin pockets)
	for tt in dsp.poisson_times(dur, crackle_rate, r):
		k = 1 + r.poisson(1.2)
		for j in range(k):
			a = math.exp(0.6 * r.standard_normal()) * 0.3
			place(out, M.crackle_burst(r, 0.6 + r.random()) * a, float(tt) + j * r.exponential(0.02))
	# pops: bigger fractures with a woody body
	for tt in dsp.poisson_times(dur, 0.25 * pops, r):
		c = dsp.click(r, 0.003, 300, 7000, 1.5) * (0.5 + 0.5 * r.random())
		fr, t60, amps = M.wood_modes(r, 500 + 700 * r.random(), 4, 1.8)
		place(out, dsp.mix(c, dsp.resonator_bank(c, fr, t60, amps) * 0.5), float(tt))
	# sap sizzle episodes (steam escaping through a split): fluttering narrow-band noise
	for tt in dsp.poisson_times(dur, 0.12 * sizzle, r):
		m = ns(0.6 + 1.2 * r.random())
		fc = 3000 + 3000 * r.random()
		sz = dsp.bp(r.standard_normal(m), fc * 0.8, fc * 1.25, 2)
		sz *= np.abs(dsp.smooth_noise(m, r, 35)) * dsp.hann_env(m)
		place(out, sz * 0.12, float(tt))
	# embers settling (charcoal tinkle)
	for tt in dsp.poisson_times(dur, 0.08, r):
		fr, t60, amps = M.metal_modes(r, 2500 + 2000 * r.random(), 4, 0.03)
		place(out, dsp.modal(ns(0.05), fr, t60, amps, r=r) * 0.05, float(tt))
	return out


@sfx("fire_loop", n=1, cat="loop", loop=True, target=-22.0, max_distance=30.0, unit_size=3.0)
def fire_loop(r, i):
	x = _fire(r, 26.0, 9.0)
	return dsp.make_loop(x, 2.0)


@sfx("torch_loop", n=1, cat="loop", loop=True, target=-24.0, max_distance=18.0, unit_size=2.0)
def torch_loop(r, i):
	"""Pitch-soaked torch head: stronger flutter/roar, few crackles, dripping sizzle."""
	x = _fire(r, 16.0, 3.0, roar=1.5, hiss=1.4, pops=0.2, flutter_hz=9.0, sizzle=2.0)
	return dsp.make_loop(x, 1.5)


@sfx("flare_loop", n=1, cat="loop", loop=True, target=-21.0, max_distance=40.0, unit_size=3.5)
def flare_loop(r, i):
	"""Road/hand flare (strontium nitrate): fierce broadband hiss with sputter, low roar."""
	dur = 12.0
	n = ns(dur)
	sput = np.clip(0.8 + 0.25 * dsp.smooth_noise(n, r, 22) + 0.15 * dsp.smooth_noise(n, r, 60), 0.2, 1.6)
	x = dsp.lp(dsp.hp(dsp.pink(n, r), 700), 11000) * sput * 0.6
	x += dsp.lp(dsp.brown(n, r), 250) * sput * 0.35
	for tt in dsp.poisson_times(dur, 20, r):
		place(x, M.crackle_burst(r, 0.4) * 0.15, float(tt))
	return dsp.make_loop(x, 1.0)


@sfx("fire_ignite", n=3, cat="handling", target=-20.0, max_distance=25.0)
def fire_ignite(r, i):
	"""0: strike-anywhere match into birch bark; 1: flint lighter; 2: kindling catching with a soft whoomph."""
	out = dsp.zeros(2.4)
	if i == 0:
		n = ns(0.12)
		strike = M.scrape(r, 0.12, 900, 8000, 2500) * dsp.env_points(n, [(0, 0), (0.02, 1), (0.12, 0.3)]) * 0.6
		place(out, strike, 0.0)
		m = ns(0.5)
		flare = dsp.bp(dsp.pink(m, r), 500, 6000) * dsp.env_points(m, [(0, 0), (0.03, 1), (0.5, 0.15)]) * 0.5
		place(out, flare, 0.09)
	elif i == 1:
		n = ns(0.06)
		wheel = M.scrape(r, 0.06, 2000, 10000, 3000) * 0.5
		place(out, wheel, 0.0)
		fr, t60, amps = M.metal_modes(r, 3500, 4, 0.05)
		place(out, dsp.modal(ns(0.08), fr, t60, amps, r=r) * 0.15, 0.0)
		m = ns(0.7)
		gas = dsp.bp(dsp.pink(m, r), 800, 5000) * dsp.env_points(m, [(0, 0), (0.05, 1), (0.6, 0.8), (0.7, 0)]) * 0.15
		place(out, gas, 0.05)
	m = ns(1.8)
	t = tvec(m)
	grow = np.clip(t / 0.9, 0, 1) ** 1.5
	catch = _fire(r, 1.8, 14, 0.8, 0.8, 0.5) * grow
	place(out, catch * 0.9, 0.4 if i < 2 else 0.0)
	if i == 2:
		w = dsp.lp(dsp.brown(ns(0.6), r), 300) * dsp.env_points(ns(0.6), [(0, 0), (0.15, 1), (0.6, 0)])
		place(out, w * 0.9, 0.3)
	return out


@sfx("flare_ignite", n=2, cat="handling", target=-17.0, max_distance=40.0)
def flare_ignite(r, i):
	"""Cap striker scraped across the flare, pyrotechnic catches with a hard sputtering 'pssshh'."""
	out = dsp.zeros(2.0)
	n = ns(0.15)
	place(out, M.scrape(r, 0.15, 800, 7000, 3000) * dsp.env_points(n, [(0, 0), (0.02, 1), (0.15, 0)]) * 0.6, 0.0)
	m = ns(1.8)
	t = tvec(m)
	env = np.clip(t / 0.08, 0, 1) * (1 + 0.8 * np.exp(-t / 0.15))
	sput = np.clip(0.8 + 0.4 * dsp.smooth_noise(m, r, 30), 0.1, 2)
	x = dsp.lp(dsp.hp(dsp.pink(m, r), 600), 11000) * env * sput * 0.5
	for tt in dsp.poisson_times(0.6, 40, r, 0.1):
		place(x, M.crackle_burst(r, 1.0) * 0.4, float(tt))
	place(out, x, 0.12)
	return out


@sfx("flaregun_fire", n=2, cat="big", target=-10.0, max_distance=900.0, unit_size=40.0, pitch_var=0.03)
def flaregun_fire(r, i):
	"""12-gauge flare pistol: hammer click, muzzle blast, the burning shell hissing away, valley echo."""
	dur = 4.5
	out = dsp.zeros(dur)
	fr, t60, amps = M.metal_modes(r, 2600, 6, 0.05)
	place(out, dsp.modal(ns(0.05), fr, t60, amps, r=r) * 0.15, 0.0)
	b0 = 0.05
	n = ns(0.06)
	t = tvec(n)
	blast = np.where(t < 0.0012, t / 0.0012, np.exp(-(t - 0.0012) / 0.004) * np.cos(2 * math.pi * 90 * (t - 0.0012)))
	blast = blast + r.standard_normal(n) * np.exp(-t / 0.006) * 0.4
	place(out, blast * 1.0, b0)
	place(out, dsp.lp(r.standard_normal(ns(0.3)), 250) * np.exp(-tvec(ns(0.3)) / 0.05) * 0.6, b0)
	m = ns(2.5)
	tm = tvec(m)
	hiss = dsp.bp(dsp.pink(m, r), 1500, 9000) * np.exp(-tm / 0.9) * 0.2
	hiss = dsp.tv_lowpass(hiss, 9000 * np.exp(-tm / 1.2) + 1200)
	place(out, hiss, b0 + 0.01)
	ir = dsp.make_ir(2.8, r, 0.25, 4000, 1200, early=[(0.35, 0.5), (0.8, 0.3), (1.4, 0.2)], hp_hz=120)
	return dsp.reverb(out, ir, 0.35)


# ------------------------------------------------------------------------------------------------ water one-shots

@sfx("splash", n=3, cat="tool", target=-17.0, max_distance=70.0, unit_size=5.0)
def splash(r, i):
	return M.splash_body(r, [0.7, 1.0, 1.4][i], 1.4)


@sfx("swim_stroke", n=4, cat="body", target=-24.0)
def swim_stroke(r, i):
	"""Breaststroke-ish arm stroke: hand entry, pull (displacement swoosh + bubbles), drips."""
	out = dsp.zeros(1.1)
	place(out, M.splash_body(r, 0.3, 0.4) * 0.6, 0.0)
	n = ns(0.5)
	t = tvec(n)
	pull = dsp.lp(dsp.pink(n, r), 900) * np.exp(-((t - 0.2) / 0.12) ** 2) * 0.5
	place(out, pull, 0.08)
	place(out, M.bubble_field(r, 0.45, 220, 1.5, 10, 2.3, 0.2, 0.5) * dsp.hann_env(ns(0.45)), 0.1)
	for tt in dsp.poisson_times(0.4, 20, r, 0.55):
		place(out, M.drop_plink(r, 1.6) * 0.12, float(tt))
	return out


# ------------------------------------------------------------------------------------------------ water loops (positional)

def _stream(r, dur: float, rate: float, rmin: float, rmax: float, rush: float, gurgle: float) -> np.ndarray:
	n = ns(dur)
	# flow speed fluctuations modulate bubble production
	flow = np.clip(1 + 0.3 * dsp.smooth_noise(n, r, 0.8) + 0.2 * dsp.smooth_noise(n, r, 4), 0.2, 2)
	x = M.bubble_field(r, dur, rate, rmin, rmax, 2.2, 0.12, 0.6, rate_env=np.clip(flow / 1.6, 0, 1))
	# gurgles: a few big resonant bubbles in quick bursts (water tumbling over a stone)
	for tt in dsp.poisson_times(dur, 1.4 * gurgle, r):
		k = 2 + r.integers(0, 5)
		base = 5 + 10 * r.random()
		for j in range(k):
			place(x, M.bubble(r, base * (0.8 + 0.4 * r.random()), 0.7, 0.35), float(tt) + j * (0.02 + 0.03 * r.random()))
	body = dsp.lp(dsp.pink(n, r), 1400) * flow * 0.12 * rush
	hi = dsp.bp(dsp.pink(n, r), 2500, 9000) * flow * 0.03 * rush
	return x + body + hi


@sfx("water_stream_loop", n=1, cat="water_loop", loop=True, target=-22.0, max_distance=70.0, unit_size=6.0)
def water_stream_loop(r, i):
	"""Mountain creek over cobbles: Minnaert bubble population + gurgles + flow rush."""
	x = _stream(r, 24.0, 700, 0.8, 12.0, 1.0, 1.0)
	return dsp.make_loop(x, 2.0)


@sfx("waterfall_loop", n=1, cat="water_loop", loop=True, target=-17.0, max_distance=260.0, unit_size=30.0)
def waterfall_loop(r, i):
	"""Plunging falls: dense aerated roar, plunge-pool thunder, spray hiss."""
	dur = 24.0
	n = ns(dur)
	surge = np.clip(1 + 0.15 * dsp.smooth_noise(n, r, 0.5) + 0.1 * dsp.smooth_noise(n, r, 3), 0.5, 1.5)
	roar = dsp.lp(dsp.pink(n, r), 6000) * surge * 0.5
	thunder = dsp.lp(dsp.brown(n, r), 160) * (surge ** 2) * 0.6
	spray = dsp.bp(r.standard_normal(n), 3000, 12000) * 0.04
	bub = M.bubble_field(r, dur, 1500, 1.0, 20.0, 2.0, 0.1, 0.4)
	x = roar + thunder + spray + bub * 0.5
	return dsp.make_loop(x, 2.0)


@sfx("lake_lap_loop", n=1, cat="water_loop", loop=True, target=-26.0, max_distance=40.0, unit_size=4.0)
def lake_lap_loop(r, i):
	"""Wavelets on a gravel shore: irregular sloshes, receding trickle through pebbles, plops."""
	dur = 28.0
	n = ns(dur)
	x = np.zeros(n)
	tt = 0.3
	while tt < dur - 1.0:
		a = 0.5 + 0.7 * r.random()
		m = ns(0.5 + 0.4 * r.random())
		tm = tvec(m)
		slosh = dsp.lp(dsp.pink(m, r), 700 + 500 * r.random()) * (tm / (0.12)) * np.exp(1 - tm / 0.12) * a * 0.6
		place(x, slosh, tt)
		# receding: water draining through gravel
		k = ns(0.8)
		env = np.exp(-tvec(k) / 0.3)
		trick = M.bubble_field(r, 0.8, 350 * a, 0.7, 5, 2.4, 0.3, 0.35, rate_env=env)
		trick += M.granular(r, 0.8, 60 * env * a, lambda rr: M.stone_ping(rr, 1.5, 0.05, 0.02), 0.5)
		place(x, trick, tt + 0.15)
		tt += 1.4 + 2.2 * r.random()
	x += dsp.lp(dsp.pink(n, r), 500) * 0.015
	return dsp.make_loop(x, 1.5)


# ------------------------------------------------------------------------------------------------ ice

def _dispersive_arrival(r, D: float, fc_lo: float, fc_hi: float, dur: float = 1.5, t0: float = 0.05) -> np.ndarray:
	"""Flexural wave in floating ice: group delay τ(ω) = t0 + D/√ω (high frequencies arrive first) —
	the descending 'pew/zing' of lake ice. Built in the frequency domain."""
	n = ns(dur)
	m = 1 << int(math.ceil(math.log2(n * 2)))
	f = np.fft.rfftfreq(m, 1.0 / SR)
	w = 2 * math.pi * np.maximum(f, 1.0)
	phase = w * t0 + 2.0 * D * np.sqrt(w)
	A = np.exp(-0.5 * (np.log(np.maximum(f, 1) / math.sqrt(fc_lo * fc_hi)) / (0.5 * math.log(fc_hi / fc_lo))) ** 2)
	A *= 1 + 0.25 * np.sin(np.log(np.maximum(f, 1)) * (3 + 2 * r.random()) + r.random() * 6.28)
	A *= np.clip((12000 - f) / 4000, 0, 1)
	X = A * np.exp(-1j * phase)
	x = np.fft.irfft(X, m)[:n]
	return x / (np.max(np.abs(x)) + 1e-9)


@sfx("ice_crack", n=4, cat="big", target=-15.0, max_distance=600.0, unit_size=30.0)
def ice_crack(r, i):
	"""Lake/glacier ice cracking: fracture snap, dispersive flexural 'pew' + shore echoes, deep boom."""
	dur = 3.0
	out = dsp.zeros(dur)
	near = i % 2 == 0
	if near:
		snap = dsp.click(r, 0.004, 300, 12000, 2.0) * 1.4
		place(out, snap, 0.0)
		place(out, M.granular(r, 0.15, np.full(ns(0.15), 1500.0) * np.exp(-tvec(ns(0.15)) / 0.04),
			lambda rr: M.snow_grain(rr, 1.0), 0.8) * 0.4, 0.002)
	D = (3.0 + 3.0 * r.random()) * (1.0 if near else 1.7)
	for j in range(4):
		place(out, _dispersive_arrival(r, D * (1 + 0.04 * j * r.random()), 300, 5000, 1.0) * (0.7 if j == 0 else 0.25), 0.003 * j)
	for k in range(2 + r.integers(0, 2)):
		e = _dispersive_arrival(r, D * (1.5 + 0.6 * k), 250, 3500, 1.2) * 0.35 / (k + 1)
		place(out, dsp.lp(e, 5000), 0.2 + 0.35 * k + 0.2 * r.random())
	n = ns(1.2)
	t = tvec(n)
	boom = np.sin(2 * math.pi * (38 + 20 * r.random()) * t * (1 - 0.2 * t)) * np.exp(-t / 0.25) * np.clip(t / 0.02, 0, 1)
	place(out, boom * (0.8 if near else 0.5), 0.01)
	return out


# ------------------------------------------------------------------------------------------------ mass movement

@sfx("avalanche", n=2, cat="weather", target=-13.0, max_distance=5000.0, unit_size=500.0, cooldown=10.0)
def avalanche(r, i):
	"""Slab avalanche 1-2 km away: fracture crack, rising roar of the moving mass + powder cloud,
	internal impacts, long decay with valley echoes."""
	dur = 20.0
	n = ns(dur)
	t = tvec(n)
	out = np.zeros(n)
	crack = dsp.lp(dsp.click(r, 0.01, 60, 3000, 1.0), 2500) * 2.0
	place(out, crack, 0.2)
	whumpf = np.sin(2 * math.pi * 30 * tvec(ns(0.6))) * np.exp(-tvec(ns(0.6)) / 0.15)
	place(out, whumpf * 0.6, 0.2)
	env = dsp.env_points(n, [(0, 0), (1.0, 0.05), (4.5, 0.8), (7.5, 1.0), (10.5, 0.8), (15, 0.25), (dur, 0)])
	env *= np.clip(1 + 0.25 * dsp.smooth_noise(n, r, 0.7), 0.3, 1.6)
	rumble = dsp.lp(dsp.brown(n, r), 140, 2) * 1.0 + dsp.lp(dsp.pink(n, r), 450) * 0.35
	powder = dsp.lp(dsp.bp(dsp.pink(n, r), 300, 5000), 2500) * 0.15
	out += (rumble + powder) * env
	for tt in dsp.poisson_times(12.0, lambda tt: 0.5 + 2.5 * math.exp(-((tt - 6) / 3) ** 2), r, 1.0):
		place(out, dsp.lp(M.rock_knock(r, 0.8 + r.random(), 0.3), 1200) * (0.2 + 0.3 * r.random()), float(tt))
	ir = dsp.make_ir(4.5, r, 0.4, 2500, 700, early=[(0.6, 0.4), (1.3, 0.3), (2.2, 0.2)], hp_hz=30)
	y = dsp.reverb(out, ir, 0.35)
	return dsp.lp(y, 3000, 2)


@sfx("rockfall", n=3, cat="amb_event", target=-17.0, max_distance=1500.0, unit_size=80.0, cooldown=5.0)
def rockfall(r, i):
	"""Distant rockfall down a gully: bouncing blocks, clattering debris, dusty trickle."""
	dur = 6.0
	out = dsp.zeros(dur)
	tt = 0.1
	gap = 0.5 + 0.3 * r.random()
	a = 1.0
	for k in range(6 + r.integers(0, 6)):
		place(out, M.rock_knock(r, 0.3 + 0.5 * r.random(), 0.35) * a, tt)
		for _ in range(r.integers(2, 7)):
			place(out, M.stone_ping(r, 3 + 8 * r.random(), 0.25 * a), tt + 0.02 + 0.2 * r.random())
		tt += gap * (0.6 + 0.8 * r.random())
		gap *= 0.85
		a *= 0.85 + 0.2 * r.random()
		if tt > dur - 1.5:
			break
	n = ns(3.0)
	place(out, M.granular(r, 3.0, 200 * np.exp(-tvec(n) / 1.0), lambda rr: M.stone_ping(rr, 1.5 + rr.random(), 0.1, 0.02), 0.6), tt - 0.5)
	ir = dsp.make_ir(2.5, r, 0.15, 3500, 1200, early=[(0.3, 0.4), (0.7, 0.25)], hp_hz=80)
	return dsp.lp(dsp.reverb(out, ir, 0.3), 5000)


@sfx("serac_fall", n=2, cat="amb_event", target=-15.0, max_distance=2500.0, unit_size=150.0, cooldown=20.0)
def serac_fall(r, i):
	"""Ice tower collapsing in the icefall: sharp report, grinding crash of blocks, long rumble."""
	dur = 9.0
	out = dsp.zeros(dur)
	place(out, dsp.lp(dsp.click(r, 0.006, 100, 6000, 1.5), 4000) * 2.0, 0.1)
	n = ns(6.0)
	env = dsp.env_points(n, [(0, 0), (0.3, 1), (2.0, 0.6), (6.0, 0)])
	crash = M.granular(r, 6.0, 400 * env, lambda rr: dsp.lp(M.rock_knock(rr, 0.2 + 0.5 * rr.random(), 0.2), 3000), 0.8)
	rum = dsp.lp(dsp.brown(n, r), 180) * env * 0.8
	place(out, crash * 0.7 + rum, 0.25)
	ir = dsp.make_ir(4.0, r, 0.3, 3000, 900, early=[(0.5, 0.4), (1.1, 0.3)], hp_hz=40)
	return dsp.lp(dsp.reverb(out, ir, 0.4), 4000)


# ------------------------------------------------------------------------------------------------ thunder

def _thunder(r, dist: float, dur: float) -> np.ndarray:
	"""Acoustic model of a tortuous lightning channel (Few 1969): each ~10 m segment radiates an N-wave;
	arrival times follow the path distances, so the channel geometry writes the crack/rumble sequence."""
	n = ns(dur)
	out = np.zeros(n)
	c = 335.0
	# channel: random walk from cloud base (2.5 km AGL) toward the ground, with branches
	pts = [np.array([dist * 0.3 * r.standard_normal(), 2500.0, dist * 0.2 * r.standard_normal()])]
	seg = 12.0
	direction = np.array([0.0, -1.0, 0.0])
	while pts[-1][1] > 0 and len(pts) < 600:
		direction = direction + r.normal(0, 0.55, 3)
		direction[1] = -abs(direction[1]) - 0.4
		direction /= np.linalg.norm(direction)
		pts.append(pts[-1] + direction * seg)
	obs = np.array([dist, 0.0, 0.0])
	d = np.array([np.linalg.norm(p - obs) for p in pts])
	t_arr = d / c
	t_arr -= t_arr.min()
	t_arr += 0.05
	for k in range(1, len(pts)):
		tt = t_arr[k]
		if tt >= dur - 0.1:
			continue
		# N-wave duration grows with channel energy/relaxation radius (~ 3-8 ms), amplitude ~ 1/r
		tau = 0.003 + 0.006 * r.random()
		m = ns(tau)
		nwave = np.linspace(1, -1, m)
		a = (1.0 / (d[k] / 1000.0)) * (0.4 + r.random())
		place(out, nwave * a, float(tt))
	# atmospheric absorption: strongly distance-dependent
	fc = max(180.0, 9000.0 / (1 + dist / 400.0))
	out = dsp.lp(out, fc, 2)
	# terrain echoes (valley walls) extend the rumble
	ir = dsp.make_ir(5.0 + dist / 2000.0, r, 0.4, 1500, 400, early=[(0.8, 0.4), (1.9, 0.3), (3.1, 0.2)], hp_hz=25)
	y = dsp.reverb(out, ir, 0.8)[:n]
	return y


@sfx("thunder", n=3, cat="weather", target=-14.0, max_distance=0.0, unit_size=1000.0, cooldown=6.0)
def thunder(r, i):
	dist = [700.0, 2200.0, 6000.0][i]
	return _thunder(r, dist, [9.0, 12.0, 14.0][i])
