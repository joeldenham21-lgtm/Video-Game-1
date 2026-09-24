"""Mammal and large-bird vocalisations (source-filter) + animal movement sounds.

Reference values (bioacoustics literature, approximate):
  grey wolf howl   F0 150-780 Hz (adult mean ~350-450), 3-11 s, smooth contour, abrupt pitch breaks,
                   energy in the first 3-5 harmonics; vocal tract ~20 cm → formant spacing ~870 Hz
  wolf growl       F0 60-150 Hz, noisy, pulsatile, 0.5-2 s
  grizzly          bawls/roars F0 80-250 Hz, very rough (deterministic chaos, subharmonics), long tract
                   (~30 cm → spacing ~580 Hz); huffs = forced nasal/oral exhalations; jaw pops
  mule deer/elk    alarm snort (nasal blow), elk alarm bark (short harsh voiced cough)
  mountain goat    bleats F0 250-450 Hz with 8-15 Hz tremor
  snowshoe hare    distress scream, F0 ~700-1100 Hz, harsh, harmonic-rich
  common raven     croaks ~0.3 s, F0 ~300-600 Hz with period doubling, formant ~1-2.5 kHz, 2-4 per series
  golden eagle     thin high yelps/whistles, F0 ~1.5-3 kHz, series of 3-7 notes
"""
from __future__ import annotations

import math

import numpy as np

from lib import dsp, models as M, voc
from lib.dsp import SR, ns, place, tvec
from catalog import sfx


def _tract(scale_hz: float, gains=(0, -3, -8, -14, -20), bw=1.0):
	"""Uniform-tube formants: F_k = (2k-1) * spacing/2."""
	return [((2 * k + 1) * scale_hz / 2, (60 + 40 * k) * bw, g) for k, g in enumerate(gains)]


def _outdoor(r, x, t60=1.8, wet=0.18, echoes=((0.45, 0.35), (1.1, 0.2))):
	ir = dsp.make_ir(t60, r, 0.03, 6000, 1800, early=echoes, hp_hz=100)
	return dsp.reverb(x, ir, wet)


def _call(r, dur, f0_pts, amp_pts, formants, tilt=-12.0, f_ref=400.0, noise=0.05, jitter=0.01,
		vib=(5.0, 0.0), sub=0.0, kmax=30, fmax=9000.0, shimmer=0.05, h1=1.0, noise_formants=None):
	n = ns(dur)
	f0 = voc.curve(n, f0_pts) * voc.micro(n, r, jitter, 6)
	if vib[1] > 0:
		f0 = f0 * voc.vibrato(n, vib[0], vib[1], r, 0.4)
	amp = voc.curve(n, amp_pts, "lin")
	x = voc.additive(f0, amp, formants, r, tilt=tilt, f_ref=f_ref, kmax=kmax, fmax=fmax, shimmer=shimmer,
		sub=sub, noise=noise, noise_formants=noise_formants, h1=h1)
	lo = float(np.min(f0)) * (0.45 if sub > 0 else 0.6)
	return dsp.hp(x, lo, 2) if lo > 120 else x


# ------------------------------------------------------------------------------------------------ wolf

def _howl(r, fp: float, dur: float, brk: bool = True, rise: float = 0.35) -> np.ndarray:
	"""One howl: rise to plateau, slow sag, optional abrupt pitch break (voice register jump), falling end."""
	# slide up from ~60 % of the plateau ("a-hooo"), then slow undulations and a sag toward the falling end
	u1, u2 = 1 + 0.06 * r.standard_normal(), 1 + 0.06 * r.standard_normal()
	pts = [(0, fp * 0.6), (rise * 0.5, fp * 0.85), (rise, fp), (rise + (dur - rise) * 0.3, fp * u1),
		(rise + (dur - rise) * 0.55, fp * (0.98 + 0.03 * r.random())), (rise + (dur - rise) * 0.75, fp * u2 * 0.95),
		(dur - 0.5, fp * 0.88), (dur, fp * 0.6)]
	n = ns(dur)
	f0 = voc.curve(n, pts) * voc.micro(n, r, 0.012, 3) * voc.vibrato(n, 4.5 + r.random(), 0.006, r, 0.8)
	if brk and dur > 2.5:
		t = tvec(n)
		b0 = dur * (0.35 + 0.3 * r.random())
		b1 = b0 + 0.4 + 0.6 * r.random()
		up = 1.28 + 0.15 * r.random()
		step = np.clip((t - b0) / 0.03, 0, 1) * np.clip((b1 - t) / 0.03, 0, 1)
		f0 = f0 * (1 + (up - 1) * step)
	amp = voc.curve(n, [(0, 0), (0.18, 0.8), (rise + 0.2, 1.0), (dur * 0.7, 0.9), (dur - 0.25, 0.6), (dur, 0)], "lin")
	# mouth opening: formants rise mid-howl (brighter), close at the end
	sp = voc.curve(n, [(0, 780), (dur * 0.3, 900), (dur * 0.7, 880), (dur, 700)])
	forms = [(sp * 0.5, 90, 0), (sp * 1.5, 130, -6), (sp * 2.5, 180, -14), (sp * 3.5, 250, -20)]
	x = voc.additive(f0, amp, forms, r, tilt=-15.0, f_ref=fp, kmax=14, fmax=7000, shimmer=0.03, noise=0.035,
		harm_jitter=0.05)
	return dsp.hp(x, fp * 0.45, 2)


@sfx("wolf_howl", n=5, cat="far_call", target=-14.0)
def wolf_howl(r, i):
	if i == 4:
		# pack chorus: 3 wolves at different pitches, staggered, one with yips
		dur = 9.0
		out = dsp.zeros(dur)
		for k, (fp, st, d) in enumerate([(360, 0.0, 6.5), (460, 1.2, 5.5), (540, 2.6, 4.5)]):
			place(out, _howl(r, fp * (0.95 + 0.1 * r.random()), d, True, 0.7 + 0.4 * r.random()) * (1.0 - 0.15 * k), st)
		for tt in dsp.poisson_times(3.0, 3.0, r, 4.0):
			place(out, _yip(r, 900 + 300 * r.random()) * 0.4, float(tt))
		return _outdoor(r, out, 2.6, 0.3, ((0.6, 0.4), (1.5, 0.25), (2.4, 0.15)))
	fp = [330, 420, 480, 380][i] * (0.95 + 0.1 * r.random())
	dur = [6.5, 5.0, 3.0, 7.5][i]
	x = _howl(r, fp, dur, brk=(i != 2), rise=0.8 + 0.4 * r.random() if i != 2 else 1.2)
	return _outdoor(r, x, 2.4, 0.25, ((0.55, 0.35), (1.3, 0.22), (2.2, 0.12)))


def _yip(r, f):
	d = 0.12 + 0.08 * r.random()
	return _call(r, d, [(0, f * 1.1), (d * 0.3, f * 1.2), (d, f * 0.75)], [(0, 0), (0.01, 1), (d, 0)],
		_tract(900), tilt=-9, f_ref=f, noise=0.15, jitter=0.02)


@sfx("wolf_growl", n=4, cat="creature", target=-15.0, max_distance=60.0, unit_size=6.0)
def wolf_growl(r, i):
	"""Low rumbling growl on the exhale, lips retracted; brief gasp between phrases."""
	dur = 1.4 + 0.8 * r.random()
	out = dsp.zeros(dur + 0.6)
	tt = 0.0
	while tt < dur - 0.3:
		d = 0.6 + 0.6 * r.random()
		n = ns(d)
		f0 = voc.curve(n, [(0, 85 + 25 * r.random()), (d * 0.4, 110 + 30 * r.random()), (d, 80)]) * voc.micro(n, r, 0.06, 15)
		src = voc.pulse_source(f0, r, jitter=0.08, shimmer=0.3, oq=0.4, irregular=0.25)
		forms = [(520, 160, 1.0), (1350, 220, 0.6), (2300, 300, 0.35), (3300, 400, 0.2)]
		v = dsp.formant_filter(src, forms)
		nz = voc.shaped_noise(n, r, [(F, B, 0) for F, B, _ in forms], -2.0)
		v = v / (np.std(v) + 1e-9) + nz / (np.std(nz) + 1e-9) * 0.3
		v = dsp.lp(v, 2800, 2) + dsp.lp(src, 250) / (np.std(dsp.lp(src, 250)) + 1e-9) * 0.5
		env = voc.curve(n, [(0, 0), (0.06, 1), (d * 0.75, 0.85), (d, 0)], "lin") * (1 + 0.3 * dsp.smooth_noise(n, r, 12))
		place(out, v * env, tt)
		tt += d
		# quick inhale gasp
		g = ns(0.12)
		gasp = dsp.bp(r.standard_normal(g), 800, 4000) * dsp.hann_env(g) * 0.25
		place(out, gasp, tt)
		tt += 0.14
	return _outdoor(r, dsp.lp(out, 6000), 0.8, 0.1, ((0.03, 0.3),))


@sfx("wolf_bark", n=3, cat="creature", target=-13.0, max_distance=300.0, unit_size=16.0)
def wolf_bark(r, i):
	"""Wolves' alarm bark: short, gruff, noisy 'wuff', sometimes followed by a bark-howl."""
	out = dsp.zeros(2.5)
	reps = [1, 2, 1][i]
	tt = 0.0
	for k in range(reps):
		d = 0.18 + 0.1 * r.random()
		f = 280 + 120 * r.random()
		x = _call(r, d, [(0, f * 1.2), (0.04, f * 1.3), (d, f * 0.8)], [(0, 0), (0.008, 1), (0.06, 0.8), (d, 0)],
			_tract(850, (0, -2, -6, -10, -16)), tilt=-8, f_ref=f, noise=0.7, jitter=0.05, sub=0.3)
		place(out, x, tt)
		tt += d + 0.25 + 0.15 * r.random()
	if i == 2:
		place(out, _howl(r, 420, 1.3, False, 0.15) * 0.8, 0.25)
	return _outdoor(r, out, 1.8, 0.2)


@sfx("wolf_attack", n=3, cat="creature", target=-12.0, max_distance=60.0, unit_size=6.0)
def wolf_attack(r, i):
	"""Lunge: explosive snarl, jaws snapping shut (teeth clack), paws scrabbling."""
	out = dsp.zeros(1.3)
	d = 0.45 + 0.15 * r.random()
	n = ns(d)
	f0 = voc.curve(n, [(0, 160), (0.1, 230), (d, 140)]) * voc.micro(n, r, 0.08, 20)
	src = voc.pulse_source(f0, r, jitter=0.1, shimmer=0.35, oq=0.35, irregular=0.3)
	forms = [(700, 180, 1.0), (1600, 250, 0.8), (2700, 350, 0.5), (3800, 450, 0.3)]
	v = dsp.formant_filter(src, forms)
	nz = voc.shaped_noise(n, r, [(F, B, 0) for F, B, _ in forms], -1.0)
	snarl = (v / (np.std(v) + 1e-9) + nz / (np.std(nz) + 1e-9) * 0.9) * voc.curve(n, [(0, 0), (0.02, 1), (d, 0)], "lin")
	place(out, snarl, 0.0)
	for k in range(1 + (i != 1)):
		tt = d - 0.05 + 0.13 * k
		clack = dsp.click(r, 0.002, 1200, 9000, 2.0) * 1.2
		place(out, clack, tt)
		place(out, dsp.resonator_bank(clack, [1800, 3100, 4700], [0.02, 0.015, 0.01], [1, 0.6, 0.4]) * 0.8, tt)
	for tt in dsp.poisson_times(0.6, 14, r, 0.1):
		place(out, M.boot_thud(r, 0.25, 0.3, 0.06) + 0, float(tt))
		place(out, M.scrape(r, 0.05, 800, 5000, 400) * 0.05, float(tt))
	return out


@sfx("wolf_yelp", n=3, cat="creature", target=-13.0, max_distance=200.0, unit_size=12.0)
def wolf_yelp(r, i):
	"""Pain yelps: high, falling, strained cries repeated as the animal retreats."""
	out = dsp.zeros(1.6)
	tt = 0.0
	a = 1.0
	for k in range(2 + i % 2 + (i == 2)):
		f = (1000 + 300 * r.random()) * (1 - 0.08 * k)
		d = 0.16 + 0.12 * r.random()
		x = _call(r, d, [(0, f * 0.9), (d * 0.2, f * 1.1), (d, f * 0.55)], [(0, 0), (0.01, 1), (d * 0.6, 0.7), (d, 0)],
			_tract(1000, (0, -2, -7, -12, -18)), tilt=-8, f_ref=f, noise=0.25, jitter=0.03, sub=0.1 * k)
		place(out, x * a, tt)
		tt += d + 0.1 + 0.12 * r.random()
		a *= 0.75
	return _outdoor(r, out, 1.5, 0.15)


# ------------------------------------------------------------------------------------------------ grizzly

def _bear_voice(r, dur, f0_pts, amp_pts, open_pts, rough=0.35, noise=0.8):
	"""Large-tract (≈30 cm) rough phonation: glottal pulses with chaos/subharmonics + turbulent noise."""
	n = ns(dur)
	f0 = voc.curve(n, f0_pts) * voc.micro(n, r, 0.05, 10)
	src = voc.pulse_source(f0, r, jitter=0.06, shimmer=0.3, oq=0.5, irregular=rough)
	op = voc.curve(n, open_pts, "lin")      # 0 closed .. 1 wide open (raises F1/F2)
	forms = [(280 + 220 * op, 120, 1.0), (850 + 250 * op, 170, 0.8), (1500 + 200 * op, 220, 0.5),
		(2150, 280, 0.3), (2800, 350, 0.18)]
	v = dsp.formant_filter(src, forms)
	nz = voc.shaped_noise(n, r, [(F, B, 0) for F, B, _ in forms], -2.0)
	x = v / (np.std(v) + 1e-9) + nz / (np.std(nz) + 1e-9) * noise
	chest = dsp.lp(src, 300) * 0.6
	x = x + chest / (np.std(chest) + 1e-9) * 0.5
	x = dsp.lp(x, 3200, 2)
	return x * voc.curve(n, amp_pts, "lin")


@sfx("bear_roar", n=3, cat="creature", target=-11.0, max_distance=400.0, unit_size=22.0)
def bear_roar(r, i):
	"""Grizzly aggressive bawl-roar: rough, low, open-mouthed, with a growling tail."""
	dur = [2.2, 1.8, 2.6][i] + 0.3 * r.random()
	f = 120 + 40 * r.random()
	x = _bear_voice(r, dur, [(0, f * 0.8), (0.25, f * 1.4), (dur * 0.5, f * 1.3), (dur, f * 0.6)],
		[(0, 0), (0.12, 0.9), (0.4, 1.0), (dur * 0.7, 0.8), (dur, 0)], [(0, 0.2), (0.3, 1.0), (dur * 0.7, 0.8), (dur, 0.1)],
		rough=0.22, noise=0.5)
	out = dsp.zeros(dur + 0.5)
	place(out, x, 0.0)
	return _outdoor(r, out, 1.6, 0.18)


@sfx("bear_huff", n=3, cat="creature", target=-15.0, max_distance=120.0, unit_size=8.0)
def bear_huff(r, i):
	"""Stressed bear: forceful huffs (nasal/oral blows) and jaw pops (teeth clacking)."""
	out = dsp.zeros(3.0)
	tt = 0.05
	for k in range(2 + r.integers(0, 3)):
		d = 0.22 + 0.12 * r.random()
		n = ns(d)
		forms = [(350, 200, 0), (900, 250, -3), (1700, 300, -8), (2600, 400, -12)]
		blow = voc.shaped_noise(n, r, forms, -4.0)
		env = voc.curve(n, [(0, 0), (0.015, 1), (d * 0.35, 0.6), (d, 0)], "lin")
		blow = blow / (np.std(blow) + 1e-9) * env
		lo = dsp.lp(r.standard_normal(n), 250) * env * 0.8
		place(out, blow + lo, tt)
		tt += d + 0.2 + 0.25 * r.random()
		if r.random() < 0.6:
			for j in range(1 + r.integers(0, 3)):
				c = dsp.click(r, 0.003, 700, 6000, 1.5)
				c = dsp.mix(c, dsp.resonator_bank(c, [900, 1900, 3200], [0.03, 0.02, 0.012], [1, 0.6, 0.3]) * 0.6)
				place(out, c * 0.7, tt + 0.09 * j)
			tt += 0.3
		if tt > 2.4:
			break
	return _outdoor(r, out, 1.0, 0.12)


@sfx("bear_attack", n=2, cat="creature", target=-10.0, max_distance=150.0, unit_size=10.0)
def bear_attack(r, i):
	"""Charge contact: heavy footfalls, explosive roar-bark, jaw snap."""
	out = dsp.zeros(1.8)
	for k in range(3):
		n = ns(0.2)
		thud = np.sin(2 * math.pi * 45 * tvec(n)) * np.exp(-tvec(n) / 0.05) * 0.8
		place(out, thud + 0, 0.05 + 0.13 * k)
		place(out, M.scrape(r, 0.08, 400, 4000, 300) * 0.1, 0.05 + 0.13 * k)
	d = 0.9 + 0.3 * r.random()
	f = 170
	x = _bear_voice(r, d, [(0, f), (0.1, f * 1.5), (d, f * 0.7)], [(0, 0), (0.03, 1), (d * 0.6, 0.8), (d, 0)],
		[(0, 0.6), (0.1, 1), (d, 0.3)], rough=0.3, noise=0.7)
	place(out, x, 0.3)
	c = dsp.click(r, 0.003, 600, 7000, 2)
	place(out, dsp.mix(c, dsp.resonator_bank(c, [800, 1700, 2900], [0.04, 0.02, 0.01], [1, 0.6, 0.3])) * 1.0, 0.3 + d)
	return out


# ------------------------------------------------------------------------------------------------ ungulates

@sfx("deer_bark", n=4, cat="creature", target=-14.0, max_distance=300.0, unit_size=16.0)
def deer_bark(r, i):
	"""0,1: mule deer alarm snort (explosive nasal blow with whistle); 2,3: elk alarm bark (harsh voiced cough)."""
	if i < 2:
		d = 0.45 + 0.2 * r.random()
		n = ns(d)
		forms = [(900, 300, 0), (1900, 350, -2), (3200, 500, -6)]
		blow = voc.shaped_noise(n, r, forms, -1.0)
		env = voc.curve(n, [(0, 0), (0.01, 1), (0.08, 0.7), (d, 0)], "lin")
		wh = np.sin(dsp.phase_from_f(voc.curve(n, [(0, 1500), (d, 1150)]) * voc.micro(n, r, 0.02, 20))) * env ** 2 * 0.25
		x = blow / (np.std(blow) + 1e-9) * env + wh / (np.std(wh) + 1e-9) * 0.3 * env
		out = dsp.zeros(d + 0.8)
		place(out, x, 0.0)
		if i == 1:
			place(out, x * 0.6, d + 0.25)
		return _outdoor(r, out, 1.4, 0.15)
	d = 0.28 + 0.1 * r.random()
	f = 420 + 120 * r.random()
	x = _call(r, d, [(0, f * 1.1), (0.05, f * 1.25), (d, f * 0.7)], [(0, 0), (0.008, 1), (0.1, 0.7), (d, 0)],
		_tract(1000, (0, -1, -5, -9, -14)), tilt=-7, f_ref=f, noise=0.9, jitter=0.06, sub=0.4)
	out = dsp.zeros(d + 1.2)
	place(out, x, 0.0)
	if i == 3:
		place(out, x * 0.8, d + 0.5)
	return _outdoor(r, out, 1.8, 0.2)


@sfx("deer_flee", n=3, cat="creature", target=-15.0, max_distance=150.0, unit_size=10.0)
def deer_flee(r, i):
	"""Bounding away through the forest: hoof strikes (4-beat stotting groups), brush crashing, receding."""
	dur = 3.2
	out = dsp.zeros(dur)
	tt = 0.05
	k = 0
	while tt < dur - 0.3:
		dist = 1 + 6 * (tt / dur)
		g = 1.0 / dist
		for j in range(4):
			hoof = M.boot_thud(r, 0.6, 0.8, 0.08)
			place(hoof, dsp.click(r, 0.002, 800, 6000) * 0.4, 0)
			place(out, dsp.lp(hoof, 6000 / (1 + tt)) * g, tt + j * (0.018 + 0.01 * r.random()))
		place(out, dsp.bp(dsp.pink(ns(0.25), r), 500, 5000) * dsp.hann_env(ns(0.25)) * 0.3 * g, tt)
		if r.random() < 0.5:
			tw = dsp.click(r, 0.004, 500, 8000, 1.8)
			place(out, tw * 0.6 * g, tt + 0.05 + 0.1 * r.random())
		tt += 0.42 + 0.08 * r.random()
		k += 1
	return out


@sfx("goat_bleat", n=4, cat="creature", target=-15.0, max_distance=300.0, unit_size=16.0)
def goat_bleat(r, i):
	"""Mountain goat bleat: nasal 'meh-eh', strong 8-14 Hz tremor (the bleat's quaver). i=3: kid (higher)."""
	kid = i == 3
	d = (0.7 + 0.5 * r.random()) * (0.8 if kid else 1.0)
	f = (320 + 80 * r.random()) * (1.6 if kid else 1.0)
	n = ns(d)
	trem_rate = 9 + 4 * r.random()
	trem = 1 + 0.07 * np.sin(dsp.phase_from_f(trem_rate * voc.micro(n, r, 0.1, 2)))
	f0 = voc.curve(n, [(0, f * 0.9), (0.08, f * 1.05), (d * 0.7, f), (d, f * 0.82)]) * trem * voc.micro(n, r, 0.02, 8)
	amp = voc.curve(n, [(0, 0), (0.05, 1), (d * 0.8, 0.8), (d, 0)], "lin") * (1 + 0.45 * (trem - 1) / 0.07 * 0.5)
	sp = 1.0 if not kid else 1.3
	forms = voc.morph(n, [(0, "e"), (d * 0.4, "ah"), (d, "uh")], 1.25 * sp, (0, -3, -8, -12, -18))
	forms.append((250 * sp, 80, -4))   # nasal murmur
	x = voc.additive(f0, amp, forms, r, tilt=-9, f_ref=f, kmax=30, fmax=8000, shimmer=0.1, sub=0.15, noise=0.25)
	out = dsp.zeros(d + 0.6)
	place(out, x, 0.0)
	return _outdoor(r, out, 2.2, 0.22, ((0.5, 0.35), (1.2, 0.2)))


@sfx("hare_squeal", n=3, cat="creature", target=-14.0, max_distance=150.0, unit_size=8.0)
def hare_squeal(r, i):
	"""Snowshoe hare distress scream: harsh, high, infant-like cries in bursts."""
	out = dsp.zeros(1.8)
	tt = 0.0
	for k in range(2 + i):
		d = 0.25 + 0.2 * r.random()
		f = 850 + 250 * r.random()
		x = _call(r, d, [(0, f * 0.9), (d * 0.25, f * 1.15), (d, f * 0.8)], [(0, 0), (0.02, 1), (d * 0.7, 0.8), (d, 0)],
			_tract(1800, (0, -2, -4, -8, -12)), tilt=-6, f_ref=f, noise=0.45, jitter=0.04, sub=0.25, kmax=20, fmax=12000)
		place(out, x, tt)
		tt += d + 0.08 + 0.1 * r.random()
		if tt > 1.4:
			break
	return out


# ------------------------------------------------------------------------------------------------ corvids & raptors

def _croak(r, f: float, d: float, rough: float = 0.3) -> np.ndarray:
	n = ns(d)
	f0 = voc.curve(n, [(0, f * 0.85), (d * 0.3, f * 1.05), (d, f * 0.8)]) * voc.micro(n, r, 0.04, 20)
	src = voc.pulse_source(f0, r, jitter=0.04, shimmer=0.25, oq=0.45, irregular=rough)
	forms = [(1100 + 200 * r.random(), 250, 1.0), (2200 + 300 * r.random(), 350, 0.7), (3500, 500, 0.35), (600, 200, 0.4)]
	v = dsp.formant_filter(src, forms)
	nz = voc.shaped_noise(n, r, [(F, B, 0) for F, B, _ in forms], -2.0)
	x = v / (np.std(v) + 1e-9) + nz / (np.std(nz) + 1e-9) * 0.35
	# rolled quality: ~35 Hz amplitude flutter
	x *= 1 - 0.35 * (0.5 + 0.5 * np.sin(dsp.phase_from_f(np.full(n, 30 + 15 * r.random()))))
	x = dsp.hp(x, 260, 2)
	return x * voc.curve(n, [(0, 0), (0.02, 1), (d * 0.6, 0.85), (d, 0)], "lin")


@sfx("raven_caw", n=5, cat="creature", target=-14.0, max_distance=400.0, unit_size=20.0)
def raven_caw(r, i):
	"""Common raven: deep resonant croaks 'kraak'/'prruk' in series of 2-4; i=4: hollow 'toc' knocking call."""
	out = dsp.zeros(3.0)
	if i == 4:
		tt = 0.05
		for k in range(4 + r.integers(0, 3)):
			d = 0.06
			x = _call(r, d, [(0, 900), (d, 750)], [(0, 0), (0.005, 1), (d, 0)], [(1200, 300, 0), (2400, 400, -6)],
				tilt=-6, f_ref=900, noise=0.2)
			place(out, x, tt)
			tt += 0.11 + 0.02 * r.random()
		return _outdoor(r, out, 1.8, 0.25)
	tt = 0.05
	f = [420, 360, 480, 300][i] * (0.9 + 0.2 * r.random())
	for k in range(2 + r.integers(0, 3)):
		d = 0.26 + 0.14 * r.random()
		place(out, _croak(r, f * (1 - 0.04 * k), d, 0.25 + 0.2 * (i == 3)), tt)
		tt += d + 0.2 + 0.2 * r.random()
		if tt > 2.4:
			break
	return _outdoor(r, out, 2.0, 0.25, ((0.4, 0.3), (1.0, 0.2)))


@sfx("eagle_cry", n=3, cat="far_call", target=-15.0, max_distance=900.0, unit_size=40.0)
def eagle_cry(r, i):
	"""Golden eagle: thin, high yelping whistles 'kee-yep' in a series, last note drawn out."""
	out = dsp.zeros(3.5)
	tt = 0.05
	k_notes = 3 + r.integers(0, 4)
	for k in range(k_notes):
		last = k == k_notes - 1
		d = (0.16 + 0.1 * r.random()) * (2.2 if last else 1)
		f = (2100 + 400 * r.random()) * (0.95 if last else 1)
		x = _call(r, d, [(0, f * 0.8), (d * 0.3, f * 1.08), (d, f * (0.7 if last else 0.9))],
			[(0, 0), (0.015, 1), (d * 0.7, 0.8), (d, 0)], [(f, 900, 0), (2 * f, 1200, -8)], tilt=-10, f_ref=f,
			noise=0.2, jitter=0.02, sub=0.0, kmax=6, fmax=14000)
		place(out, x, tt)
		tt += d + 0.09 + 0.08 * r.random()
		if tt > 3.0:
			break
	return _outdoor(r, out, 2.6, 0.3, ((0.7, 0.35), (1.6, 0.2)))
