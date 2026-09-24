"""Footsteps per surface. Each step = heel strike + weight roll + toe push-off exciting a surface model."""
from __future__ import annotations

import math

import numpy as np

from lib import dsp, models as M
from lib.dsp import ns, place, tvec
from catalog import sfx

STEP_LEN = 0.55


def _timing(r):
	heel = 0.004
	toe = 0.11 + 0.05 * r.random()
	return heel, toe


def _weight(i: int) -> float:
	# alternate strong/soft feet + spread so the pool has natural dynamics
	return [1.0, 0.82, 0.93, 0.75, 1.05, 0.88, 0.97, 0.8][i % 8]


# ------------------------------------------------------------------------------------------------ snow

def _snow_crunch(r, dur, peak_t, rate, cold=0.0, body=1.0):
	n = ns(dur)
	t = tvec(n)
	# compaction: fracture rate rises quickly then decays as the snowpack under the sole densifies
	env = ((t / peak_t) * np.exp(1 - t / peak_t)) ** 1.6
	g = M.granular(r, dur, rate * env, lambda rr: M.snow_grain(rr, cold), 0.5)
	# mid-band crunch body: densifying layer, rough AM
	mid = dsp.bp(r.standard_normal(n), 300, 1600 + 800 * cold, 2) * env * (0.5 + np.abs(dsp.smooth_noise(n, r, 180)))
	g = g + mid * 0.08
	g = dsp.lp(g, 6500 + 3000 * cold, 1)
	whump = dsp.lp(r.standard_normal(n), 220 - 60 * cold, 2) * env ** 0.7 * 0.12 * body
	return g + whump


@sfx("step_snow", n=8, cat="foot")
def step_snow(r, i):
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	place(out, M.boot_thud(r, 0.35 * w, 0.2), heel)
	place(out, _snow_crunch(r, 0.2, 0.035 + 0.01 * r.random(), 2600 * w, 0.0), heel)
	place(out, _snow_crunch(r, 0.16, 0.03, 1500 * w, 0.1, 0.5) * 0.55, toe)
	return dsp.lp(out, 11000)


@sfx("step_snow_cold", n=8, cat="foot")
def step_snow_cold(r, i):
	"""Below about -10 °C snow squeaks: bonds fracture in quasi-periodic stick-slip chains."""
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	place(out, M.boot_thud(r, 0.35 * w, 0.3), heel)
	place(out, _snow_crunch(r, 0.18, 0.03, 2000 * w, 0.8, 0.5) * 0.7, heel)
	f0 = 650 + 450 * r.random()
	place(out, M.snow_squeak(r, 0.13 + 0.06 * r.random(), f0) * 1.6 * w, heel + 0.015)
	place(out, M.snow_squeak(r, 0.09 + 0.04 * r.random(), f0 * (1.1 + 0.2 * r.random())) * 0.9 * w, toe)
	place(out, _snow_crunch(r, 0.12, 0.025, 1200 * w, 0.9, 0.2) * 0.4, toe)
	return dsp.lp(out, 12000)


# ------------------------------------------------------------------------------------------------ rock / scree / gravel

@sfx("step_rock", n=8, cat="foot")
def step_rock(r, i):
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	place(out, M.boot_thud(r, 0.9 * w, 0.95), heel)
	place(out, M.scrape(r, 0.03, 1200, 7000, 900) * 0.06 * dsp.hann_env(ns(0.03)), heel + 0.004)
	place(out, M.boot_thud(r, 0.35 * w, 0.8, 0.08), toe)
	place(out, M.scrape(r, 0.05, 900, 6000, 700) * dsp.hann_env(ns(0.05)) * 0.05, toe + 0.008)
	if r.random() < 0.45:
		place(out, M.stone_ping(r, 1.5 + 2.5 * r.random(), 0.25), toe + 0.02 + 0.05 * r.random())
	return out


@sfx("step_scree", n=8, cat="foot")
def step_scree(r, i):
	"""Loose talus/scree: the step shifts stones — clatter, grinding slide, trailing pebble."""
	w = _weight(i)
	dur = 0.75
	out = dsp.zeros(dur)
	heel, toe = _timing(r)
	place(out, M.boot_thud(r, 0.6 * w, 0.75), heel)
	k = 5 + r.integers(0, 8)
	for _ in range(k):
		tt = heel + 0.005 + r.exponential(0.08)
		if tt < dur - 0.1:
			place(out, M.stone_ping(r, 2 + 7 * r.random(), 0.2 + 0.5 * r.random()), tt)
	for _ in range(r.integers(1, 3)):
		place(out, M.rock_knock(r, 0.08 + 0.1 * r.random(), 0.12) * 0.25, heel + 0.01 + 0.08 * r.random())
	slide = M.scrape(r, 0.25, 500, 5000, 1400) * dsp.env_points(ns(0.25), [(0, 0), (0.03, 1), (0.25, 0)]) * 0.12
	place(out, slide, heel + 0.01)
	# trailing pebble bouncing away (decreasing intervals and amplitude)
	if r.random() < 0.7:
		tt = 0.18 + 0.1 * r.random()
		gap = 0.07 + 0.04 * r.random()
		a = 0.35
		size = 1.2 + 1.5 * r.random()
		while tt < dur - 0.05 and a > 0.03:
			place(out, M.stone_ping(r, size, a * 0.6), tt)
			tt += gap
			gap *= 0.72
			a *= 0.68
	place(out, M.boot_thud(r, 0.3 * w, 0.7, 0.1), toe + 0.04)
	return out


@sfx("step_gravel", n=8, cat="foot")
def step_gravel(r, i):
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)

	def pebble(rr):
		return M.stone_ping(rr, 0.9 + 1.8 * rr.random(), 0.35, 0.03)

	def crunch(dur, peak, rate):
		n = ns(dur)
		t = tvec(n)
		env = ((t / peak) * np.exp(1 - t / peak)) ** 1.4
		g = M.granular(r, dur, rate * env, pebble, 0.6)
		g += dsp.bp(dsp.pink(n, r), 500, 4000) * env * 0.08
		return dsp.lp(g, 8000, 2)

	place(out, M.boot_thud(r, 0.55 * w, 0.6), heel)
	place(out, crunch(0.16, 0.03, 1000 * w), heel)
	place(out, crunch(0.14, 0.035, 700 * w) * 0.7, toe)
	return dsp.lp(out, 12500)


# ------------------------------------------------------------------------------------------------ vegetation

@sfx("step_grass", n=8, cat="foot")
def step_grass(r, i):
	"""Late-October meadow: dry, partly frosted grass — brushing blades, crisp stems, soft soil thud."""
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	place(out, M.boot_thud(r, 0.5 * w, 0.25), heel)
	n = ns(0.22)
	t = tvec(n)
	sw_env = np.exp(-((t - 0.05) / 0.045) ** 2) + 0.6 * np.exp(-((t - 0.15) / 0.05) ** 2)
	swish = dsp.lp(dsp.bp(dsp.pink(n, r), 1500, 7000, 2), 6000, 2) * sw_env * 0.1
	place(out, swish * w, heel - 0.002 if heel > 0.002 else 0.0)
	stems = np.zeros(ns(0.3))
	for tt in dsp.poisson_times(0.18, 90 * w, r):
		place(stems, dsp.click(r, 0.0015 + 0.002 * r.random(), 1500, 8000) * (0.1 + 0.3 * r.random()), float(tt))
	place(out, stems, heel)
	place(out, M.boot_thud(r, 0.25 * w, 0.2, 0.1), toe)
	return out


@sfx("step_forest", n=8, cat="foot")
def step_forest(r, i):
	"""Spruce/fir forest floor: needle duff over moss — muffled thud, needle rustle, occasional twig."""
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	place(out, dsp.lp(M.boot_thud(r, 0.7 * w, 0.15), 900), heel)
	n = ns(0.25)
	t = tvec(n)
	env = (t / 0.03) * np.exp(1 - t / 0.03)
	rustle = dsp.lp(dsp.bp(dsp.pink(n, r), 350, 3500, 2), 3000, 2) * env * 0.1
	cr = np.zeros(n)
	for tt in dsp.poisson_times(0.12, 160 * w, r):
		place(cr, dsp.click(r, 0.001 + 0.0015 * r.random(), 900, 6000) * (0.05 + 0.2 * r.random()), float(tt))
	place(out, rustle + cr, heel)
	if r.random() < 0.3 or i == 2:
		# dead twig snapping under the boot (brittle fracture + small resonance)
		tw = dsp.click(r, 0.004, 400, 9000, 2.0) * 1.2
		fr, t60, amps = M.wood_modes(r, 900 + 900 * r.random(), 4, 2.0)
		tw = tw + dsp.resonator_bank(tw, fr, t60 * 0.3, amps) * 0.8
		place(out, tw * 0.45, heel + 0.02 + 0.04 * r.random())
	place(out, dsp.lp(M.boot_thud(r, 0.35 * w, 0.15, 0.1), 800), toe)
	place(out, dsp.bp(r.standard_normal(ns(0.08)), 700, 4000) * dsp.hann_env(ns(0.08)) * 0.08, toe + 0.01)
	return out


@sfx("step_dirt", n=8, cat="foot")
def step_dirt(r, i):
	"""Packed, half-frozen soil/trail."""
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	place(out, M.boot_thud(r, 0.8 * w, 0.55), heel)
	place(out, M.scrape(r, 0.06, 900, 6000, 300) * dsp.hann_env(ns(0.06)) * 0.12, heel + 0.006)
	for _ in range(r.integers(0, 4)):
		place(out, dsp.click(r, 0.002, 1200, 7000) * 0.08, heel + 0.01 + 0.08 * r.random())
	place(out, M.boot_thud(r, 0.4 * w, 0.5, 0.1), toe)
	place(out, M.scrape(r, 0.09, 700, 5000, 250) * dsp.hann_env(ns(0.09)) * 0.14, toe + 0.015)
	return out


# ------------------------------------------------------------------------------------------------ hard/built

@sfx("step_ice", n=8, cat="foot")
def step_ice(r, i):
	"""Clear lake/glacier ice: hard 'tock', brief glassy ring of the ice plate, faint sole slip."""
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	thud = M.boot_thud(r, 0.8 * w, 1.0)
	place(out, thud, heel)
	fr, t60, amps = M.metal_modes(r, 1100 + 700 * r.random(), 8, 0.09)
	ring = dsp.modal(ns(0.2), fr, t60, amps, r=r) * 0.18 * w
	place(out, ring, heel + 0.001)
	# grit of frozen snow grains on the surface
	place(out, M.scrape(r, 0.03, 2500, 10000, 800) * dsp.hann_env(ns(0.03)) * 0.12, heel + 0.003)
	place(out, M.boot_thud(r, 0.35 * w, 1.0, 0.08), toe)
	place(out, dsp.modal(ns(0.12), fr * 1.05, t60 * 0.8, amps, r=r) * 0.07, toe)
	if r.random() < 0.4:
		# rubber sole micro-slip squeak
		n = ns(0.05)
		sq = M.stick_slip(r, np.linspace(1400, 1100, n), 0.05) * dsp.hann_env(n)
		place(out, dsp.bp(sq, 900, 5000) * 0.15, toe + 0.03)
	return out


@sfx("step_wood", n=8, cat="foot")
def step_wood(r, i):
	"""Boot on spruce plank floor (cabin, deck, built floors): thud + plank modes + cavity, occasional creak."""
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	thud = M.boot_thud(r, 0.8 * w, 0.75)
	place(out, thud, heel)
	fr, t60, amps = M.wood_modes(r, 95 + 55 * r.random(), 5, 1.2)
	exc = np.zeros(ns(0.4))
	exc[:ns(0.004)] = r.standard_normal(ns(0.004)) * np.hanning(ns(0.004))
	pl = dsp.resonator_bank(dsp.lp(exc, 3000), fr, t60, amps)
	cav = dsp.resonator(exc, 230 + 60 * r.random(), 0.06)
	place(out, (pl * 1.2 + cav * 0.5) * w, heel)
	place(out, M.boot_thud(r, 0.45 * w, 0.7, 0.1), toe)
	place(out, dsp.resonator_bank(dsp.lp(exc, 2000), fr * 1.02, t60, amps) * 0.5 * w, toe)
	if r.random() < 0.3 or i == 1:
		cr = M.creak(r, 0.18 + 0.12 * r.random(), 180 + 120 * r.random(), 120 + 60 * r.random(), M.wood_modes(r, 320, 5, 0.6), 0.1)
		place(out, cr * 0.25, toe - 0.03)
	return out


@sfx("step_metal", n=8, cat="foot")
def step_metal(r, i):
	"""Station floor: steel plate over joists — bright transient, damped plate ring, faint rattle."""
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	place(out, M.boot_thud(r, 0.8 * w, 0.85), heel)
	fr, t60, amps = M.metal_modes(r, 210 + 90 * r.random(), 12, 0.35)
	exc = np.zeros(ns(0.6))
	exc[:ns(0.003)] = r.standard_normal(ns(0.003))
	ring = dsp.resonator_bank(dsp.lp(exc, 5000), fr, t60, amps * 0.6)
	# the boot sole damps the plate while in contact
	ring *= np.concatenate([np.linspace(1, 0.45, ns(0.12)), np.full(len(ring) - ns(0.12), 0.45)])
	place(out, ring * 0.7 * w, heel)
	place(out, M.boot_thud(r, 0.4 * w, 0.8, 0.1), toe)
	place(out, dsp.resonator_bank(dsp.lp(exc, 4000), fr * 1.01, t60 * 0.6, amps) * 0.2 * w, toe)
	if r.random() < 0.35:
		place(out, M.gear_rattle(r, 0.12, 0.5) * 0.25, heel + 0.01)
	return out


@sfx("step_water", n=8, cat="foot")
def step_water(r, i):
	"""Wading ankle/shin-deep: foot plunge (slap, bubbles, slosh), then lift-out drips."""
	w = _weight(i)
	dur = 0.8
	out = dsp.zeros(dur)
	n = ns(0.5)
	t = tvec(n)
	place(out, M.splash_body(r, 0.45 * w, 0.5) * 0.8, 0.0)
	slosh = dsp.lp(r.standard_normal(n), 700) * (t / 0.08) * np.exp(1 - t / 0.08) * 0.5
	place(out, slosh * w, 0.01)
	for tt in dsp.poisson_times(0.35, 30, r, 0.25):
		if tt < dur - 0.05:
			place(out, M.drop_plink(r, 1.5) * 0.15, float(tt))
	place(out, M.bubble_field(r, 0.3, 300, 1.0, 6.0, 2.5, 0.1, 0.35) * np.linspace(1, 0, ns(0.3)), 0.15)
	return out


@sfx("crampon_step", n=8, cat="foot")
def crampon_step(r, i):
	"""12-point steel crampons biting hard névé/ice: rapid point clicks, steel ring, crunch."""
	w = _weight(i)
	out = dsp.zeros(STEP_LEN)
	heel, toe = _timing(r)
	place(out, M.boot_thud(r, 0.5 * w, 0.6), heel)
	for k in range(10 + r.integers(0, 3)):
		tt = heel + 0.002 + abs(r.normal(0.012, 0.008))
		fr, t60, amps = M.metal_modes(r, 2600 + 3200 * r.random(), 5, 0.05)
		p = dsp.modal(ns(0.06), fr, t60, amps, r=r) * 0.25
		place(p, dsp.click(r, 0.0012, 2500, 12000) * 0.6, 0)
		place(out, p * (0.4 + 0.6 * r.random()) * w, tt)
	place(out, _snow_crunch(r, 0.1, 0.02, 1000 * w, 1.0, 0.25) * 0.5, heel)
	place(out, M.scrape(r, 0.06, 2000, 10000, 900) * dsp.hann_env(ns(0.06)) * 0.2, toe)
	for k in range(4):
		fr, t60, amps = M.metal_modes(r, 3000 + 2500 * r.random(), 4, 0.04)
		place(out, dsp.modal(ns(0.05), fr, t60, amps, r=r) * 0.12 * w, toe + 0.01 * k + 0.01 * r.random())
	return out


# ------------------------------------------------------------------------------------------------ body movement

@sfx("jump", n=4, cat="body")
def jump(r, i):
	"""Push-off: boot scuff, pack shift, short effort exhale through the nose/mouth."""
	out = dsp.zeros(0.5)
	place(out, M.boot_thud(r, 0.4, 0.5, 0.1), 0.0)
	place(out, M.cloth_rustle(r, 0.3, 0.9, 0.6) * 0.5, 0.01)
	place(out, M.gear_rattle(r, 0.25, 0.6) * 0.4, 0.04)
	n = ns(0.22)
	t = tvec(n)
	from lib import voc
	env = (t / 0.03) * np.exp(1 - t / 0.03)
	breath = voc.shaped_noise(n, r, voc.vowel_formants("uh", 1.05, (0, -6, -12, -18, -22)), -2.0) * env
	place(out, breath * 0.3, 0.02)
	return out


def _landing(r, weight, hard):
	out = dsp.zeros(0.9)
	n = ns(0.3)
	t = tvec(n)
	f = 45 + 25 * r.random()
	body = np.sin(2 * math.pi * f * t * (1 - 0.3 * t / 0.3)) * np.exp(-t / (0.05 + 0.03 * hard)) * np.clip(t / 0.004, 0, 1)
	place(out, body * weight, 0.0)
	place(out, M.boot_thud(r, 0.9 * weight, 0.6), 0.0)
	place(out, M.boot_thud(r, 0.7 * weight, 0.6), 0.02 + 0.02 * r.random())
	place(out, M.cloth_rustle(r, 0.35, 1.2, 0.5) * 0.45 * weight, 0.005)
	place(out, M.gear_rattle(r, 0.35, 0.8 + hard) * 0.45 * weight, 0.01)
	place(out, dsp.lp(r.standard_normal(ns(0.08)), 500) * dsp.hann_env(ns(0.08)) * 0.3 * weight, 0.0)
	return out


@sfx("land_soft", n=4, cat="body")
def land_soft(r, i):
	return _landing(r, 0.7, 0.0)


@sfx("land_hard", n=4, cat="body", target=-18.0)
def land_hard(r, i):
	from gen.human import grunt
	out = _landing(r, 1.0, 1.0)
	if i % 2 == 0:
		place(out, grunt(r, "oof", 0.35) * 0.5, 0.03)
	return out
