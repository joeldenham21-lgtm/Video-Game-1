"""Stereo ambience beds. Every bed is *exactly periodic*: periodic noise sources, time-varying spectra
evaluated on wrapped time, and events/reverb tails folded back onto the loop start — so the loop point is
mathematically seamless (no crossfade)."""
from __future__ import annotations

import math

import numpy as np

from lib import dsp, models as M
from lib.dsp import SR, ns, place, tvec
from catalog import sfx
import gen.birds as B


def _wrap_shape(x: np.ndarray, gain_fn, nfft: int = 2048, hop: int = 512) -> np.ndarray:
	"""Time-varying spectral shaping of a periodic signal. gain_fn(freqs, t_wrapped) -> (F, T)."""
	L = len(x)
	m = nfft * 2
	xp = np.concatenate([x[-m:], x, x[:m]])
	period = L / SR

	def g(f, t):
		return gain_fn(f, np.mod(t - m / SR, period))
	y = dsp.stft_shape(xp, g, nfft, hop)
	return y[m:m + L]


def _at(env: np.ndarray, t: np.ndarray) -> np.ndarray:
	return env[np.clip((t * SR).astype(int), 0, len(env) - 1)]


def _gusts(L: int, r, rate: float, gustiness: float) -> np.ndarray:
	"""Normalised wind speed v(t)/v_mean: slow swells plus sharper gust fronts (periodic)."""
	# log-normal speed fluctuation (turbulence intensity ~ 0.15-0.35): wind never drops to nothing
	s = 0.8 * dsp.per_smooth(L, r, rate) + 0.45 * dsp.per_smooth(L, r, rate * 3.5)
	s /= np.std(s) + 1e-9
	return np.exp(0.36 * gustiness * s)


def _wind_channel(r, L: int, v: np.ndarray, fc0: float, bright: float, level_exp: float = 2.4,
		whistles=(), buffet: float = 0.0, air: float = 0.0) -> np.ndarray:
	"""One channel of wind: pink-ish turbulence whose level ∝ v^level_exp and whose spectral centre rises
	with speed; optional aeolian whistles (narrow peaks at f ∝ v) and low 'buffeting' at the ears."""
	x = dsp.per_noise(L, r)

	def gain(f, t):
		vv = _at(v, t)[None, :]
		fc = fc0 * vv ** 1.1
		ff = np.maximum(f, 5.0)[:, None]
		# broad band: rising from ~20 Hz, rolling off above fc (−9 dB/oct), + a little high 'air'
		base = (ff / (ff + 25.0)) / np.sqrt(1 + (ff / fc) ** 3) * (ff / 200.0) ** -0.25
		base = base + air * (ff / 4000.0) ** 0.5 / np.sqrt(1 + (ff / (6000 * vv)) ** 4)
		gtot = base * vv ** level_exp
		for (f0, q, amp, thresh) in whistles:
			fw = f0 * vv
			bw = fw / q
			on = np.clip((vv - thresh) / 0.3, 0, 1)
			gtot = gtot + amp * on * vv ** level_exp / np.sqrt(1 + ((ff - fw) / bw) ** 2)
		return gtot * bright
	y = _wrap_shape(x, gain)
	if buffet > 0:
		b = dsp.per_noise(L, r, [5, 20, 60, 150, 400], [-20, 0, -3, -18, -40])
		y = y + b * buffet * 0.5 * np.clip(v - 0.8, 0, None) ** 1.5 * np.std(y)
	return y


def _stereo_wind(r, L, rate, gustiness, fc0, bright=1.0, level_exp=2.4, whistles=(), buffet=0.0, air=0.0,
		lag_s: float = 0.35) -> np.ndarray:
	v = _gusts(L, r, rate, gustiness)
	lag = ns(lag_s)
	vl = v
	vr = np.roll(v, lag)          # gust front sweeps across the listener
	left = _wind_channel(r, L, vl, fc0, bright, level_exp, whistles, buffet, air)
	right = _wind_channel(r, L, vr, fc0, bright, level_exp, whistles, buffet, air)
	return np.stack([left, right], axis=1)


def _fold_events(L: int, events: np.ndarray) -> np.ndarray:
	return dsp.fold(events, L)


def _events_stereo(r, L: int, times, make, pan_spread: float = 0.8, ir=None, wet=0.3, tail_s: float = 4.0):
	"""Place mono events (make(r, k) -> array) with random pans, optional reverb, folded to the loop."""
	out = np.zeros((L + ns(tail_s) + ns(8.0), 2))
	for k, tt in enumerate(times):
		x = make(r, k)
		if x is None:
			continue
		p = (r.random() * 2 - 1) * pan_spread
		st = dsp.pan_stereo(x, p)
		if ir is not None:
			st = dsp.reverb(st, ir, wet)
		m = min(len(st), len(out) - ns(float(tt)))
		place(out, st[:m], float(tt))
	return dsp.fold(out, L)


# ------------------------------------------------------------------------------------------------ wind beds

@sfx("wind_loop", n=1, cat="loop_big", loop=True, target=-24.0, max_distance=80.0, unit_size=10.0, quality=3.0)
def wind_loop(r, i):
	"""Mono gusty wind for spot emitters (ridge edges, the wreck's torn skin, the summit mast).
	The listener's own wind is the stereo bed system (Audio ambience manager)."""
	L = ns(30.0)
	v = _gusts(L, r, 0.14, 0.7)
	return _wind_channel(r, L, v, 600, 1.0, 2.4, whistles=((540, 35, 0.06, 1.2),), air=0.15)


@sfx("amb_wind_calm", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-36.0, quality=3.0)
def amb_wind_calm(r, i):
	"""Still air: faint low pressure movement, the 'sound of space' outdoors, rare soft breaths of air."""
	L = ns(40.0)
	return _stereo_wind(r, L, 0.06, 0.5, 220, 1.0, 2.0, air=0.08)


@sfx("amb_wind_breeze", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-29.0, quality=3.0)
def amb_wind_breeze(r, i):
	L = ns(45.0)
	return _stereo_wind(r, L, 0.12, 0.6, 450, 1.0, 2.4, air=0.12)


@sfx("amb_wind_strong", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-22.0, quality=3.0)
def amb_wind_strong(r, i):
	L = ns(45.0)
	# sustained wind: swells of ~10-14 dB (p10..p90), never dropping to a calm-day hush between gusts
	return _stereo_wind(r, L, 0.16, 0.6, 700, 1.0, 2.3, buffet=0.5, air=0.15,
		whistles=((520, 25, 0.05, 1.25),))


@sfx("amb_wind_gale", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-18.0, quality=3.0)
def amb_wind_gale(r, i):
	L = ns(45.0)
	# a gale is a continuous roar with violent swells on top (turbulence intensity ~0.2)
	return _stereo_wind(r, L, 0.22, 0.6, 1000, 1.0, 2.2, buffet=1.0, air=0.2,
		whistles=((480, 30, 0.08, 1.05), (760, 40, 0.05, 1.2), (1150, 50, 0.03, 1.35)))


@sfx("amb_wind_alpine", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-23.0, quality=3.0)
def amb_wind_alpine(r, i):
	"""Above the treeline: thin, cold roar over rock with eerie gliding howls off ridges and cornices,
	and spindrift hissing across the snow surface during gusts."""
	L = ns(60.0)
	w = _stereo_wind(r, L, 0.1, 0.75, 650, 1.0, 2.7, buffet=0.3, air=0.25,
		whistles=((310, 45, 0.12, 0.9), (455, 55, 0.1, 1.05), (690, 60, 0.06, 1.2), (980, 70, 0.03, 1.35)))
	v = _gusts(L, r, 0.1, 0.75)
	for c in range(2):
		env = np.clip(v - 1.0, 0, None) ** 2
		drift = dsp.circ(dsp.per_noise(L, r), lambda z: dsp.bp(z, 3000, 11000, 2)) * env
		w[:, c] += drift * np.std(w[:, c]) * 0.6
	return w


@sfx("amb_wind_spruce", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-27.0, quality=3.0)
def amb_wind_spruce(r, i):
	"""Wind through conifers ('soughing'): needle hiss and branch rush that swell with each gust,
	a wide stereo field of many trees, the odd trunk creak."""
	L = ns(50.0)
	v = _gusts(L, r, 0.1, 0.7)
	chans = []
	for c in range(2):
		vv = np.roll(v, ns(0.6) * c)
		x = dsp.per_noise(L, r)

		def gain(f, t, vv=vv):
			s = _at(vv, t)[None, :]
			ff = np.maximum(f, 5.0)[:, None]
			rush = np.exp(-0.5 * (np.log(ff / (700 * s ** 0.6)) / 0.9) ** 2)       # branch rush
			hiss = np.exp(-0.5 * (np.log(ff / 4200.0) / 0.55) ** 2) * 0.6             # needles
			low = (ff / (ff + 30)) / np.sqrt(1 + (ff / 180.0) ** 2) * 0.25
			return (rush + hiss * s ** 0.8 + low) * s ** 2.2
		chans.append(_wrap_shape(x, gain))
	bed = np.stack(chans, axis=1)
	fr, t60, amps = M.wood_modes(r, 90, 6, 0.5)
	ev = _events_stereo(r, L, dsp.poisson_times(L / SR, 0.05, r), lambda rr, k: M.creak(rr, 1.2 + rr.random(), 12 + 15 * rr.random(),
		20 + 20 * rr.random(), M.wood_modes(rr, 90 + 60 * rr.random(), 6, 0.5), 0.25, 0.3) * 0.05, 0.9)
	return bed + ev * np.std(bed) * 8


@sfx("amb_blizzard", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-17.0, quality=3.0)
def amb_blizzard(r, i):
	"""Whiteout: violent gusting roar, ice grains rattling on the hood and jacket, whistling edges."""
	L = ns(60.0)
	w = _stereo_wind(r, L, 0.25, 0.8, 1100, 1.0, 2.6, buffet=1.2, air=0.3,
		whistles=((400, 30, 0.06, 1.0), (620, 40, 0.05, 1.2), (900, 45, 0.03, 1.4)))
	v = _gusts(L, r, 0.25, 0.8)
	for c in range(2):
		dens = np.clip(np.roll(v, ns(0.3) * c), 0.2, 3) ** 2
		ev = np.zeros(L + ns(0.1))
		rate = 900.0
		times = dsp.poisson_times(L / SR, rate, r)
		dmax = float(np.max(dens))
		for tt in times:
			if r.random() < dens[min(int(tt * SR), L - 1)] / dmax:
				g = M.snow_grain(r, 1.0) * (0.2 + r.random())
				place(ev, g, float(tt))
		grains = dsp.fold(ev, L)
		grains = dsp.circ(grains, lambda z: dsp.hp(z, 1800, 2))
		w[:, c] += grains / (np.std(grains) + 1e-9) * np.std(w[:, c]) * 0.35
	return w


# ------------------------------------------------------------------------------------------------ forest

def _distant(x, r, dist=120.0, t60=1.4, wet=0.45):
	ir = dsp.make_ir(t60, r, 0.02, 5000, 1500, early=[(0.03, 0.3), (0.08, 0.2)], hp_hz=250)
	return dsp.reverb(dsp.air_absorb(x, dist), ir, wet)


@sfx("amb_forest_day", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-34.0, quality=3.0)
def amb_forest_day(r, i):
	"""Quiet spruce-fir forest by day in late October: soft air in the canopy, a very distant creek
	murmur, a few far-off chickadees/nuthatch/raven (the near birds are separate spatial events)."""
	L = ns(60.0)
	bed = _stereo_wind(r, L, 0.07, 0.5, 900, 1.0, 2.0, air=0.25) * 0.6
	murmur = np.stack([dsp.circ(dsp.per_noise(L, r), lambda z: dsp.lp(dsp.hp(z, 200), 1200)) for _ in range(2)], axis=1)
	bed = bed + murmur * np.std(bed) * 0.3
	calls = [B.chickadee_feebee, B.nuthatch_yank, B.chickadee_call, B.kinglet_tsee]
	times = [4.0, 17.5, 29.0, 44.0]

	def make(rr, k):
		if k == 4:
			from gen.fauna import _croak
			x = np.zeros(ns(1.6))
			place(x, _croak(rr, 380, 0.32), 0.0)
			place(x, _croak(rr, 370, 0.3), 0.6)
			return _distant(x, rr, 400, 2.0, 0.6) * 0.5
		return _distant(calls[k](rr), rr, 90 + 60 * rr.random())
	ev = _events_stereo(r, L, times + [52.0], make, 0.9)
	return bed + ev * np.std(bed) * 3.5


@sfx("amb_forest_night", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-40.0, quality=3.0)
def amb_forest_night(r, i):
	"""Cold still night under the trees: near silence, faint air, a tree creaking with frost, one distant owl."""
	L = ns(60.0)
	bed = _stereo_wind(r, L, 0.05, 0.4, 300, 1.0, 2.0, air=0.05) * 0.8

	def make(rr, k):
		if k == 0:
			x = np.zeros(ns(2.6))
			f = 300
			for t0, d, ff, a in [(0.05, 0.28, f, 0.8), (0.58, 0.12, f * 1.02, 0.7), (0.72, 0.42, f * 1.04, 1.0), (1.35, 0.3, f, 0.8), (1.85, 0.3, f * 0.98, 0.75)]:
				place(x, B._hoot(rr, d, ff, a), t0)
			return _distant(x, rr, 300, 1.8, 0.5)
		if k == 1:
			return _distant(M.creak(rr, 1.5, 15, 22, M.wood_modes(rr, 100, 6, 0.5), 0.25) * 0.4, rr, 60, 1.2, 0.3)
		return _distant(dsp.click(rr, 0.004, 400, 6000, 1.8) * 0.5, rr, 50, 1.2, 0.35)
	ev = _events_stereo(r, L, [12.0, 31.0, 47.0], make, 0.9)
	return bed + ev * np.std(bed) * 3.0


# ------------------------------------------------------------------------------------------------ water

def _stream_st(r, L, rate, rmin, rmax, rush, gurgle):
	from gen.nature import _stream
	chans = []
	dur = L / SR
	for c in range(2):
		x = _stream(r, dur + 1.0, rate, rmin, rmax, rush, gurgle)
		chans.append(dsp.fold(x, L))
	st = np.stack(chans, axis=1)
	# cross-feed a little so the field is wide but not disjoint
	return np.stack([st[:, 0] * 0.8 + st[:, 1] * 0.2, st[:, 1] * 0.8 + st[:, 0] * 0.2], axis=1)


@sfx("amb_creek", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-24.0, quality=3.0)
def amb_creek(r, i):
	return _stream_st(r, ns(40.0), 800, 0.8, 12.0, 1.0, 1.2)


@sfx("amb_river", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-20.0, quality=3.0)
def amb_river(r, i):
	"""Braided glacial river: dense aerated flow, low roar, bedload gravel knocking along the bottom."""
	L = ns(45.0)
	st = _stream_st(r, L, 1800, 1.0, 20.0, 2.5, 1.6)
	low = np.stack([dsp.circ(dsp.per_noise(L, r), lambda z: dsp.lp(z, 250)) for _ in range(2)], axis=1)
	st = st + low * np.std(st) * 0.6
	knock = _events_stereo(r, L, dsp.poisson_times(L / SR, 3.0, r), lambda rr, k: dsp.lp(M.stone_ping(rr, 3 + 4 * rr.random(), 1.0, 0.05), 1500), 0.7)
	return st + knock * np.std(st) * 0.6


@sfx("amb_lake_shore", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-28.0, quality=3.0)
def amb_lake_shore(r, i):
	from gen.nature import lake_lap_loop
	L = ns(40.0)
	chans = []
	for c in range(2):
		x = lake_lap_loop(dsp.rng_for("lake", c), 0)
		x = dsp.pad_to(np.concatenate([x, x]), L)
		chans.append(x)
	st = np.stack(chans, axis=1)
	air = _stereo_wind(r, L, 0.06, 0.4, 400, 1.0, 2.0, air=0.1)
	return st + air * np.std(st) * 0.25


@sfx("amb_waterfall", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-17.0, quality=3.0)
def amb_waterfall(r, i):
	L = ns(40.0)
	chans = []
	for c in range(2):
		surge = np.clip(1 + 0.15 * dsp.per_smooth(L, r, 0.5) + 0.1 * dsp.per_smooth(L, r, 3), 0.5, 1.5)
		roar = dsp.circ(dsp.per_noise(L, r), lambda z: dsp.lp(z, 6000)) * surge * 0.5
		thunder = dsp.circ(dsp.per_noise(L, r, slope_db_oct=-6), lambda z: dsp.lp(z, 160)) * surge ** 2 * 0.6
		spray = dsp.circ(dsp.per_noise(L, r), lambda z: dsp.bp(z, 3000, 12000)) * 0.05
		chans.append(roar + thunder + spray)
	return np.stack(chans, axis=1)


# ------------------------------------------------------------------------------------------------ interiors

@sfx("amb_cave", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-33.0, quality=3.0)
def amb_cave(r, i):
	"""Mine adit / cave: deep still air, slow drips (some rhythmic from fixed points), long stone reverb,
	a faint draught moaning in the passage."""
	L = ns(60.0)
	room = np.stack([dsp.circ(dsp.per_noise(L, r, slope_db_oct=-6), lambda z: dsp.lp(z, 120)) for _ in range(2)], axis=1) * 0.02
	draught = np.stack([_wind_channel(r, L, _gusts(L, r, 0.04, 0.4), 250, 1.0, 2.0,
		whistles=((180, 20, 0.05, 1.0),)) for _ in range(2)], axis=1) * 0.25
	ir = dsp.make_ir(3.2, r, 0.03, 5000, 1200, early=[(0.011, 0.5), (0.023, 0.4), (0.041, 0.3), (0.067, 0.2)],
		stereo=True, hp_hz=120)
	times = []
	for src in range(3):   # fixed drip points with fairly regular periods
		per = 2.2 + 3.5 * r.random()
		t = r.random() * per
		while t < L / SR:
			times.append((t, src))
			t += per * (0.9 + 0.2 * r.random())
	for t in dsp.poisson_times(L / SR, 0.25, r):
		times.append((float(t), 3))
	times.sort()
	pans = [-0.6, 0.3, 0.75, 0.0]
	out = np.zeros((L + ns(6.0), 2))
	for t, src in times:
		d = M.drop_plink(r, [1.0, 1.4, 0.8, 1.1][src]) * (0.5 + 0.5 * r.random())
		place(out, dsp.pan_stereo(d, pans[src] + 0.1 * r.standard_normal()), float(t))
	wet = np.stack([dsp.fir_conv(out[:, c], ir[:, c]) for c in range(2)], axis=1)
	drips = dsp.fold(out, L) + dsp.fold(wet, L) * 0.5
	return room + draught * np.std(drips) * 2 + drips


def _hum(L, r, f_fan=108.0, level=1.0):
	t = tvec(L)
	x = np.zeros(L)
	# ventilation fan: blade-pass tone + harmonics + airflow noise
	fb = dsp.per_freq(f_fan, L)
	for h, a in [(1, 1.0), (2, 0.4), (3, 0.2), (4, 0.1)]:
		x += a * np.sin(2 * math.pi * fb * h * t + h)
	x *= 0.03
	x += np.sin(2 * math.pi * dsp.per_freq(120, L) * t) * 0.02 + np.sin(2 * math.pi * dsp.per_freq(240, L) * t) * 0.008
	x += np.sin(2 * math.pi * dsp.per_freq(360, L) * t) * 0.004
	x += dsp.per_noise(L, r, [40, 150, 600, 2500, 8000], [-12, 0, -6, -14, -30]) * 0.03
	return x * level


@sfx("amb_station_hum", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-30.0, quality=3.0)
def amb_station_hum(r, i):
	"""Kestrel Station module with power: HVAC fan, 60 Hz transformer hum, electronics, the storm outside
	buffeting the insulated walls, the odd tick of the steel frame."""
	L = ns(45.0)
	h = _hum(L, r)
	outside = _stereo_wind(r, L, 0.15, 0.8, 250, 1.0, 2.8, buffet=0.6) * 0.35
	st = np.stack([h * 1.0 + outside[:, 0] * 0.0, h * 0.95], axis=1)
	st = st + outside * np.std(h) * 0.9
	ticks = _events_stereo(r, L, dsp.poisson_times(L / SR, 0.12, r),
		lambda rr, k: dsp.modal(ns(0.08), *M.metal_modes(rr, 1400 + 1500 * rr.random(), 5, 0.05), r=rr) * 0.2, 0.8)
	return st + ticks * np.std(h) * 3


@sfx("amb_station_dead", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-34.0, quality=3.0)
def amb_station_dead(r, i):
	"""The station without power: no hum at all, only the wind on the walls, frame creaks, a loose panel."""
	L = ns(45.0)
	outside = _stereo_wind(r, L, 0.15, 0.8, 250, 1.0, 2.8, buffet=0.6)
	creaks = _events_stereo(r, L, dsp.poisson_times(L / SR, 0.1, r),
		lambda rr, k: M.creak(rr, 1.0 + rr.random(), 20, 30, M.metal_modes(rr, 160, 10, 0.5), 0.2) * 0.3, 0.8)
	rattle = _events_stereo(r, L, dsp.poisson_times(L / SR, 0.06, r),
		lambda rr, k: M.gear_rattle(rr, 0.4, 1.5) * 0.3, 0.6)
	return outside + (creaks + rattle) * np.std(outside) * 3


@sfx("amb_interior_wind", n=1, cat="bed", loop=True, stereo=True, folder="ambience", target=-32.0, quality=3.0)
def amb_interior_wind(r, i):
	"""Inside a log cabin/shelter in wind: walls filter the gale to a low moan, gusts thump the structure,
	logs creak."""
	L = ns(45.0)
	w = _stereo_wind(r, L, 0.14, 0.8, 180, 1.0, 2.8, buffet=0.8)
	w = np.stack([dsp.circ(w[:, c], lambda z: dsp.lp(z, 600, 2)) for c in range(2)], axis=1)
	creaks = _events_stereo(r, L, dsp.poisson_times(L / SR, 0.08, r),
		lambda rr, k: M.creak(rr, 0.8 + rr.random(), 12, 25, M.wood_modes(rr, 120, 6, 0.6), 0.25) * 0.4, 0.8)
	return w + creaks * np.std(w) * 3
