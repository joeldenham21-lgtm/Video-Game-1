"""Player body sounds: breathing (exertion/cold/altitude), heartbeat, pain, death, eating, drinking.

Voice: Sam Calder, adult, low-mid register (F0 ≈ 105-150 Hz), vocal tract scale 1.0 (≈17 cm).
Sources are glottal pulse trains (jitter, shimmer, creak) through time-varying formants, plus aspiration.
"""
from __future__ import annotations

import math

import numpy as np

from lib import dsp, models as M, voc
from lib.dsp import SR, ns, place, tvec
from catalog import sfx

TRACT = 1.0      # formant scale (1.0 ≈ adult male; 1.15 ≈ adult female)
F0_BASE = 122.0


def creak_am(n: int, r, rate: float = 55.0, depth: float = 0.7) -> np.ndarray:
	"""Vocal-fry amplitude pattern: irregular glottal bursts at a low rate (multiplies a voiced signal)."""
	out = np.zeros(n)
	t = 0.0
	pw = ns(0.004)
	pulse = np.hanning(pw)
	while True:
		i = int(t * SR)
		if i >= n:
			break
		place(out, pulse * (0.5 + r.random()), i)
		t += (1.0 / rate) * (1 + 0.35 * r.standard_normal()) if r.random() > 0.08 else 2.2 / rate
		t = max(t, i / SR + 0.004)
	out = dsp.lp(out, 400, 1)
	out /= (np.max(out) + 1e-9)
	return 1 - depth + depth * out


def _voiced(r, dur, f0_pts, vowels, amp_pts, breath=0.25, jitter=0.02, irregular=0.0, creak_tail=0.0,
		tract=TRACT, pressed=0.0):
	"""Additive glottal source (tilt, jitter, shimmer) → vowel formants; + aspiration; optional vocal fry tail."""
	n = ns(dur)
	t = tvec(n)
	f0 = voc.curve(n, f0_pts) * voc.micro(n, r, 0.012 + jitter, 9)
	k = np.clip((t - (dur - creak_tail)) / max(creak_tail, 1e-3), 0, 1) if creak_tail > 0 else np.zeros(n)
	f0 = f0 * (1 - 0.4 * k)
	forms = voc.morph(n, vowels, tract, (0, -2, -8, -14, -20))
	tilt = -10.0 + 4.0 * pressed
	harm = voc.additive(f0, np.ones(n), forms, r, tilt=tilt, f_ref=220.0, kmax=45, fmax=9500.0,
		shimmer=0.06 + 0.1 * pressed, sub=np.clip(irregular * 2.5 + 0.35 * k, 0, 0.6), harm_jitter=0.15 + pressed * 0.3)
	if irregular > 0 or creak_tail > 0:
		harm *= 1 - (k + irregular) * 0.9 + (k + irregular) * 0.9 * creak_am(n, r, 45 + 20 * r.random(), 0.9)
	asp = voc.shaped_noise(n, r, forms, 0.0)
	asp = dsp.hp(asp, 900, 2)
	hr = np.sqrt(np.mean(harm ** 2)) + 1e-9
	ar = np.sqrt(np.mean(asp ** 2)) + 1e-9
	amp = voc.curve(n, amp_pts, "lin")
	return (harm / hr + asp / ar * breath) * amp


def grunt(r, kind: str = "oof", strength: float = 0.5) -> np.ndarray:
	f = F0_BASE * (0.9 + 0.25 * r.random())
	if kind == "oof":
		d = 0.26 + 0.08 * r.random()
		return _voiced(r, d, [(0, f * 1.25), (0.05, f * 1.15), (d, f * 0.8)], [(0, "uh"), (d * 0.6, "o"), (d, "u")],
			[(0, 0), (0.008, 1), (0.08, 0.8), (d, 0)], breath=0.45, pressed=0.3 * strength)
	if kind == "ugh":
		d = 0.42 + 0.15 * r.random()
		return _voiced(r, d, [(0, f * 1.1), (0.07, f * 1.45), (d * 0.6, f * 1.1), (d, f * 0.75)],
			[(0, "uh"), (d * 0.55, "uh"), (d, "ng")], [(0, 0), (0.02, 1), (d * 0.5, 0.75), (d, 0)],
			breath=0.25, creak_tail=0.12, pressed=0.4 * strength)
	if kind == "argh":
		d = 0.65 + 0.25 * r.random()
		return _voiced(r, d, [(0, f * 1.3), (0.08, f * 1.75), (d * 0.5, f * 1.6), (d, f * 0.9)],
			[(0, "a"), (d * 0.6, "a"), (d, "uh")], [(0, 0), (0.03, 1), (d * 0.6, 0.85), (d, 0)],
			breath=0.2, irregular=0.06, creak_tail=0.15, pressed=0.9 * strength)
	if kind == "hiss":
		d = 0.5 + 0.2 * r.random()
		n = ns(d)
		t = tvec(n)
		s = voc.shaped_noise(n, r, voc.vowel_formants("hiss", 1.0, (0, 2, 4, 2, -2)), 0.0)
		env = voc.curve(n, [(0, 0), (0.05, 1), (d * 0.7, 0.7), (d, 0)], "lin")
		trem = 1 + 0.25 * np.sin(2 * math.pi * 9 * t)
		return dsp.hp(s * env * trem, 1500)
	raise ValueError(kind)


# ------------------------------------------------------------------------------------------ breathing

def _breath_noise(r, dur, vowel, env_pts, tract=TRACT, hp_hz=120, voiced=0.0, f0=110.0, tilt=-2.0):
	n = ns(dur)
	forms = voc.vowel_formants(vowel, tract, (0, -3, -8, -12, -16))
	x = voc.shaped_noise(n, r, forms, tilt)
	x = dsp.hp(x, hp_hz)
	env = voc.curve(n, env_pts, "lin")
	# turbulence flutter
	env = env * (1 + 0.12 * dsp.smooth_noise(n, r, 18))
	out = x / (np.std(x) + 1e-9) * env
	if voiced > 0:
		vv = _voiced(r, dur, [(0, f0 * 1.1), (dur, f0 * 0.85)], [(0, vowel), (dur, vowel)], env_pts, breath=0.0)
		out = out + dsp.hp(vv, 150) * voiced
	return out


def _inhale(r, dur, level=1.0, mouth=True, cold=0.0):
	pts = [(0, 0), (dur * 0.35, 1), (dur * 0.8, 0.8), (dur, 0)]
	if mouth:
		x = _breath_noise(r, dur, "e" if cold < 0.5 else "i", pts, hp_hz=400 + 1500 * cold, tilt=0.5 + 2 * cold)
	else:
		x = _breath_noise(r, dur, "i", pts, hp_hz=1200, tilt=1.5)
		x = dsp.peak_eq(x, 3200, 5, 1.5)
	if cold > 0:
		# air drawn over clenched teeth: sibilant band
		n = len(x)
		s = dsp.bp(r.standard_normal(n), 4500, 10000) * voc.curve(n, pts, "lin") * cold * 0.6
		x = x + s
	return x * level


def _exhale(r, dur, level=1.0, vowel="uh", voiced=0.0, shiver=0.0):
	pts = [(0, 0), (0.04, 1), (dur * 0.45, 0.7), (dur, 0)]
	x = _breath_noise(r, dur, vowel, pts, hp_hz=260, voiced=voiced, tilt=-2.0)
	if shiver > 0:
		t = tvec(len(x))
		f = 9 + 2 * dsp.smooth_noise(len(x), r, 1.0)
		x = x * (1 - shiver * 0.5 * (1 + np.sin(dsp.phase_from_f(f))))
	return x * level


@sfx("breath_exert", n=4, cat="breath")
def breath_exert(r, i):
	"""One hard breath cycle after sprinting/climbing: quick mouth inhale, forceful part-voiced exhale."""
	ti = 0.34 + 0.08 * r.random()
	te = 0.46 + 0.12 * r.random()
	out = dsp.zeros(ti + te + 0.15)
	place(out, _inhale(r, ti, 0.75), 0.0)
	place(out, _exhale(r, te, 1.0, "ah" if i % 2 else "uh", voiced=0.12 + 0.1 * (i % 3 == 0)), ti - 0.02)
	return out


@sfx("breath_cold", n=4, cat="breath")
def breath_cold(r, i):
	"""Shivering: breath sucked in over the teeth, exhale shaking with the shiver tremor."""
	ti = 0.55 + 0.15 * r.random()
	te = 0.9 + 0.3 * r.random()
	out = dsp.zeros(ti + te + 0.2)
	place(out, _inhale(r, ti, 0.7, True, cold=0.9), 0.0)
	place(out, _exhale(r, te, 0.85, "uh", voiced=0.06, shiver=0.75), ti + 0.05)
	return out


@sfx("breath_altitude", n=4, cat="breath")
def breath_altitude(r, i):
	"""Hypoxic breathing above 2,800 m: deep, slow, air-hungry gasps with an open throat."""
	ti = 0.85 + 0.2 * r.random()
	te = 1.0 + 0.3 * r.random()
	out = dsp.zeros(ti + te + 0.3)
	place(out, _inhale(r, ti, 1.0) + _breath_noise(r, ti, "a", [(0, 0), (ti * 0.4, 1), (ti, 0)], hp_hz=150) * 0.35, 0.0)
	place(out, _exhale(r, te, 0.9, "a", voiced=0.08), ti + 0.08)
	if i % 2 == 1:
		place(out, _inhale(r, 0.3, 0.45), ti + te + 0.0)
	return out


# ------------------------------------------------------------------------------------------ heartbeat

@sfx("heartbeat", n=3, cat="body", target=-22.0, max_distance=0.0, pitch_var=0.02, cooldown=0.25)
def heartbeat(r, i):
	"""Body-conducted heart sounds: S1 'lub' (valve closure, ~40-60 Hz) then S2 'dub' ~0.3 s later."""
	dur = 0.75
	out = dsp.zeros(dur)

	def thump(f, d, a):
		n = ns(d)
		t = tvec(n)
		x = np.sin(2 * math.pi * f * t * (1 - 0.35 * t / d)) * np.exp(-t / (d / 3.5))
		x += 0.35 * np.sin(2 * math.pi * f * 2.3 * t) * np.exp(-t / (d / 6))
		x *= np.clip(t / 0.006, 0, 1) * np.cos(np.linspace(0, math.pi / 2, n)) ** 2
		return x * a

	s1 = thump(48 + 6 * r.random(), 0.12, 1.0)
	place(s1, dsp.lp(dsp.click(r, 0.01, 60, 400), 300) * 0.4, 0)
	s2 = thump(62 + 8 * r.random(), 0.09, 0.7)
	place(out, s1, 0.0)
	place(out, s2, 0.29 + 0.03 * r.random())
	return dsp.lp(out, 380, 2)


# ------------------------------------------------------------------------------------------ pain / death

@sfx("hurt", n=6, cat="body", target=-19.0, cooldown=0.35)
def hurt(r, i):
	kind = ["oof", "ugh", "argh", "ugh", "hiss", "oof"][i]
	x = grunt(r, kind, 0.8 if kind != "oof" else 1.0)
	out = np.concatenate([x, np.zeros(ns(0.15))])
	if kind in ("oof", "argh"):
		place(out, M.cloth_rustle(r, 0.25, 1.0) * 0.12, 0.0)
	return out


@sfx("death", n=2, cat="body", target=-18.0, cooldown=2.0)
def death(r, i):
	"""A last strained groan collapsing into vocal fry, then one long exhale."""
	f = F0_BASE * 1.1
	d = 1.4 + 0.4 * r.random()
	g = _voiced(r, d, [(0, f * 1.4), (0.15, f * 1.6), (d * 0.5, f * 1.0), (d, f * 0.55)],
		[(0, "a"), (d * 0.5, "uh"), (d, "ng")], [(0, 0), (0.05, 1), (d * 0.45, 0.8), (d, 0)],
		breath=0.3, irregular=0.05, creak_tail=0.5, pressed=0.6)
	out = dsp.zeros(d + 2.2)
	place(out, g, 0.0)
	place(out, _exhale(r, 1.6, 0.45, "uh", voiced=0.05), d + 0.3)
	place(out, M.cloth_rustle(r, 0.5, 1.2) * 0.2, 0.2)
	place(out, dsp.lp(M.boot_thud(r, 1.0, 0.3, 0.3), 400) * 0.6, d * 0.7)
	return out


# ------------------------------------------------------------------------------------------ eat / drink

def _chew(r, dur, crunch=0.5, wet=0.5):
	n = ns(dur)
	t = tvec(n)
	env = voc.curve(n, [(0, 0), (0.02, 1), (dur * 0.6, 0.6), (dur, 0)], "lin")
	w = dsp.bp(r.standard_normal(n), 250, 2500) * np.abs(dsp.smooth_noise(n, r, 40)) ** 2 * wet
	c = M.granular(r, dur, np.full(n, 600 * crunch) * env, lambda rr: dsp.click(rr, 0.002, 400, 4500), 0.8)
	# wet clicks (saliva/tongue)
	k = np.zeros(n)
	for tt in dsp.poisson_times(dur, 25 * wet, r):
		place(k, M.bubble(r, 1.5 + 2 * r.random(), 0.4, 0.3, 0.03), float(tt))
	return dsp.lp((w * 0.4 + c * crunch + k * 0.5) * env, 4500)


def _swallow(r):
	n = ns(0.22)
	t = tvec(n)
	f = np.geomspace(340, 150, n)
	g = np.sin(dsp.phase_from_f(f)) * np.exp(-t / 0.04) * np.clip(t / 0.004, 0, 1)
	g += dsp.lp(r.standard_normal(n), 900) * np.exp(-t / 0.03) * 0.4
	return dsp.lp(g, 1500)


@sfx("eat", n=4, cat="handling", target=-23.0)
def eat(r, i):
	"""First-person (bone-conducted) bite, chews, swallow. Variants: crunchy (berries, ration), soft (meat)."""
	crunchy = i % 2 == 0
	out = dsp.zeros(2.2)
	bite = _chew(r, 0.15, 1.4 if crunchy else 0.4, 0.4 if crunchy else 1.0) * 1.3
	place(out, bite, 0.0)
	tt = 0.35
	for k in range(3 + r.integers(0, 2)):
		place(out, _chew(r, 0.16 + 0.05 * r.random(), 0.9 if crunchy else 0.25, 0.6 if crunchy else 1.1) * (0.8 - 0.12 * k), tt)
		tt += 0.28 + 0.06 * r.random()
	place(out, _swallow(r) * 0.8, tt + 0.1)
	return out


@sfx("drink", n=4, cat="handling", target=-23.0)
def drink(r, i):
	"""Drinking from canteen/cup: gulps (throat resonance + inflowing water bubbles), final exhale."""
	gulps = 2 + (i % 3)
	out = dsp.zeros(0.45 * gulps + 1.0)
	tt = 0.05
	for k in range(gulps):
		water = M.bubble_field(r, 0.25, 260, 1.5, 9, 2.2, 0.3, 0.6) * dsp.hann_env(ns(0.25))
		place(out, dsp.lp(water, 3500), tt)
		place(out, _swallow(r), tt + 0.2)
		tt += 0.38 + 0.08 * r.random()
	place(out, _exhale(r, 0.5, 0.35, "ah"), tt + 0.1)
	return out
