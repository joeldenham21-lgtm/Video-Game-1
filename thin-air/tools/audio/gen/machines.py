"""Engines and gas: station diesel generator, rescue helicopter, Otter cockpit, O2 regulator, crash.

Loops are built exactly periodic (engine cycle / rotor revolution divides the loop length), so they
repeat without crossfade artefacts on tonal components.
"""
from __future__ import annotations

import math

import numpy as np

from lib import dsp, models as M
from lib.dsp import SR, ns, place, tvec
from catalog import sfx


# ------------------------------------------------------------------------------------------------ diesel generator

GEN_CYCLE = 2940            # samples per 4-stroke cycle: 1800 rpm → 2 rev = 1/15 s = 2940 samples @ 44.1 kHz
GEN_FIRE = GEN_CYCLE // 3   # 3 cylinders → firing every 980 samples (45 Hz)


def _block_modes(r):
	return M.metal_modes(r, 620 + 60 * r.random(), 10, 0.05)


def _diesel(r, L: int, load: float = 1.0, rough: float = 0.03) -> np.ndarray:
	"""Kubota-class 3-cylinder diesel at 1800 rpm driving a 60 Hz alternator, in a plywood shed."""
	x = np.zeros(L + GEN_CYCLE)
	fr, t60, amps = _block_modes(r)
	knock_ir = dsp.modal(ns(0.03), fr, t60, amps, r=r)
	exh = np.zeros(ns(0.02))
	exh_n = len(exh)
	exh = np.exp(-np.arange(exh_n) / (exh_n / 4)) * np.sin(np.linspace(0, math.pi, exh_n))
	cyl_gain = [1.0, 0.93, 1.05]
	k = 0
	pos = 0
	while pos < L:
		c = k % 3
		g = cyl_gain[c] * (1 + rough * r.standard_normal())
		place(x, exh * g * 1.0, pos)
		kn = knock_ir * (0.25 + 0.1 * r.random()) * g
		place(x, dsp.click(r, 0.0006, 1500, 9000, 2.0) * 0.12 * g, pos + 30)
		place(x, kn, pos + 30)
		# valve train ticks (camshaft, 2 valves/cyl)
		if k % 2 == 0:
			place(x, dsp.click(r, 0.0005, 3000, 10000) * 0.03, pos + GEN_FIRE // 2)
		pos += GEN_FIRE
		k += 1
	x = dsp.fold(x, L)
	# exhaust pipe / muffler: low-pass resonant tube
	low = dsp.circ(x, lambda z: dsp.resonator_bank(dsp.lp(z, 900), [45.0, 90.0, 135.0, 270.0], [0.25, 0.2, 0.12, 0.06], [1.0, 0.7, 0.4, 0.2]))
	mech = dsp.circ(x, lambda z: dsp.hp(z, 600, 2))
	t = tvec(L)
	# alternator: 60 Hz electrical → 120 Hz magnetostriction hum + slot whine
	hum = np.sin(2 * math.pi * dsp.per_freq(120, L) * t) * 0.05 + np.sin(2 * math.pi * dsp.per_freq(240, L) * t) * 0.02
	whine = np.sin(2 * math.pi * dsp.per_freq(1620, L) * t) * 0.006
	# cooling fan: broadband + blade pass (6 blades @ 30 rev/s = 180 Hz)
	fan = dsp.per_noise(L, r, [50, 200, 800, 3000, 12000], [-10, 0, -4, -12, -30]) * 0.12
	fan += np.sin(2 * math.pi * dsp.per_freq(180, L) * t) * 0.02
	return low * 1.3 * load + mech * 0.9 + hum + whine + fan


@sfx("generator_loop", n=1, cat="loop_big", loop=True, target=-20.0, max_distance=120.0, unit_size=6.0)
def generator_loop(r, i):
	L = GEN_CYCLE * 90                      # exactly 6.0 s
	return _diesel(r, L)


@sfx("generator_start", n=1, cat="loop_big", target=-17.0, max_distance=120.0, unit_size=6.0)
def generator_start(r, i):
	"""Glow-plug wait, starter solenoid clunk, starter cranking (compression pulses), catch, run-up, settle."""
	dur = 7.0
	out = dsp.zeros(dur)
	# relay click, glow plug buzz
	place(out, dsp.click(r, 0.002, 500, 6000) * 0.5, 0.0)
	fr, t60, amps = M.metal_modes(r, 900, 6, 0.06)
	place(out, dsp.modal(ns(0.1), fr, t60, amps, r=r) * 0.2, 0.0)
	# solenoid clunk + starter whine with compression loading
	t0 = 0.9
	place(out, dsp.click(r, 0.003, 200, 5000) * 1.2, t0)
	crank = 2.1 + 0.4 * r.random()
	n = ns(crank)
	t = tvec(n)
	comp_rate = 5.8 + 0.8 * t / crank        # compression strokes per second (≈ 230 rpm cranking)
	comp = 0.5 + 0.5 * np.sin(dsp.phase_from_f(comp_rate))
	f_starter = (190 + 30 * t / crank) * (1 - 0.18 * comp)
	starter = sum(np.sin(dsp.phase_from_f(f_starter * k)) / k for k in range(1, 8))
	starter = starter * (0.4 + 0.6 * (1 - comp)) + dsp.bp(r.standard_normal(n), 800, 5000) * 0.1
	gear = np.sin(dsp.phase_from_f(f_starter * 11)) * 0.12
	place(out, (starter + gear) * dsp.env_points(n, [(0, 0), (0.05, 1), (crank - 0.1, 1), (crank, 0.6)]) * 0.35, t0)
	for k in range(int(crank * 6)):
		place(out, dsp.lp(M.boot_thud(r, 0.4, 0.8, 0.12), 900), t0 + k / 6.2)
	# catch: firing accelerates from ~8 Hz to 45 Hz
	t1 = t0 + crank - 0.15
	fr_b, t60_b, amps_b = _block_modes(r)
	knock = dsp.modal(ns(0.03), fr_b, t60_b, amps_b, r=r)
	tt = t1
	rate = 8.0
	while tt < dur - 0.2:
		g = 1.0 if rate < 40 else 0.8
		exh = np.exp(-np.arange(ns(0.03)) / ns(0.008)) * g
		place(out, dsp.lp(exh, 700) * 2.0, tt)
		place(out, knock * 0.3 * g, tt + 0.001)
		rate = min(45.0 * (1.07 if tt < t1 + 1.2 else 1.0), rate * 1.12 + 0.6)
		if tt > t1 + 1.2:
			rate = 45.0 + 3 * math.exp(-(tt - t1 - 1.2) * 2) * math.sin((tt - t1) * 9)
		tt += 1.0 / rate
	# running bed fades in underneath (alternator/fan)
	L = GEN_CYCLE * 60
	bed = _diesel(r, L) * 0.45
	m = min(len(bed), ns(dur - t1 - 0.3))
	place(out, bed[:m] * dsp.env_points(m, [(0, 0), (1.0, 0.3), (2.5, 1.0), (m / SR, 1.0)]), t1 + 0.3)
	return out


# ------------------------------------------------------------------------------------------------ helicopter

ROTOR = 4096                # samples per main-rotor blade passage: 10.77 Hz BPF (2 blades ≈ 323 rpm, Bell 212 class)


@sfx("helicopter_loop", n=1, cat="loop_big", loop=True, target=-16.0, max_distance=4000.0, unit_size=80.0, doppler=True,
	max_voices=1)
def helicopter_loop(r, i):
	"""Twin-engine medium helicopter in cruise/approach: main-rotor blade slap (BVI impulses at BPF),
	rotational thump harmonics, 2-blade tail rotor buzz (~55 Hz BPF), turbine whine, gearbox, jet roar.
	Mono and dry so the engine's Doppler/attenuation stays physical."""
	L = ROTOR * 64                          # ≈ 5.94 s, integer number of blade passages
	t = tvec(L)
	x = np.zeros(L + ROTOR)
	slap = np.zeros(ns(0.03))
	sn = len(slap)
	# N-wave-ish slap with sharp compression front
	u = np.linspace(0, 1, sn)
	slap = np.where(u < 0.08, u / 0.08, 1 - (u - 0.08) / 0.4) * np.exp(-u * 3)
	slap = slap - np.mean(slap)
	for k in range(64):
		g = 1.0 + 0.08 * r.standard_normal()
		# blades alternate slightly (tracking)
		g *= 1.0 if k % 2 == 0 else 0.9
		place(x, slap * g, k * ROTOR)
	x = dsp.fold(x, L)
	bpf = SR / ROTOR
	thump = dsp.circ(x, lambda z: dsp.lp(z, 1800, 2)) * 1.0
	thump += sum(np.sin(2 * math.pi * bpf * h * t + h) / h ** 1.2 for h in range(1, 8)) * 0.35
	# tail rotor: 2 blades, ~1660 rpm → BPF ≈ 55 Hz (must be periodic in L)
	f_tr = dsp.per_freq(55.4, L)
	tail = sum(np.sin(2 * math.pi * f_tr * h * t + 0.5 * h) * (0.6 ** h) for h in range(1, 12)) * 0.18
	tail *= 1 + 0.2 * np.sin(2 * math.pi * bpf * t)     # modulated by main-rotor wake
	# turbines (two PT6T-class): compressor tones + jet roar
	turb = (np.sin(2 * math.pi * dsp.per_freq(6420, L) * t) * 0.02 + np.sin(2 * math.pi * dsp.per_freq(3180, L) * t) * 0.012
		+ np.sin(2 * math.pi * dsp.per_freq(9870, L) * t) * 0.006)
	roar = dsp.per_noise(L, r, [30, 150, 600, 2000, 6000, 16000], [-6, 0, -3, -9, -14, -30]) * 0.2
	roar *= 1 + 0.25 * (0.5 + 0.5 * np.cos(2 * math.pi * bpf * t))
	gearbox = np.sin(2 * math.pi * dsp.per_freq(1135, L) * t) * 0.01
	return thump + tail + turb + roar + gearbox


# ------------------------------------------------------------------------------------------------ Otter cockpit

OTTER_REV = 1323            # samples per engine revolution at 2000 rpm (33.3 Hz) — R-1340 geared prop


def otter_engine(r, L: int, rough: float = 0.0, power: float = 1.0) -> np.ndarray:
	"""P&W R-1340 Wasp (9-cyl radial, 4-stroke) heard from the cockpit through headsets:
	firing 150 Hz (9 × 2000/60/2), 3-blade prop BPF, exhaust crackle, airframe rattle, slipstream."""
	x = np.zeros(L + OTTER_REV)
	fire_step = OTTER_REV * 2 / 9
	pos = 0.0
	k = 0
	pulse = np.exp(-np.arange(ns(0.006)) / ns(0.0015))
	while pos < L:
		miss = rough > 0 and r.random() < rough
		g = 0.0 if miss else (1 + 0.08 * r.standard_normal())
		place(x, pulse * g, int(pos))
		pos += fire_step
		k += 1
	x = dsp.fold(x, L)
	t = tvec(L)
	exhaust = dsp.circ(x, lambda z: dsp.lp(z, 1400, 2)) * 1.5
	prop_bpf = dsp.per_freq(SR / OTTER_REV * 3 * (2 / 3), L)     # prop geared 3:2 → 22.2 rps × 3 blades = 66.7 Hz
	prop = sum(np.sin(2 * math.pi * prop_bpf * h * t + h) / h for h in range(1, 10)) * 0.5
	slip = dsp.per_noise(L, r, [30, 100, 400, 1500, 5000, 16000], [-4, 0, -2, -8, -16, -30]) * 0.35
	return (exhaust * power + prop * (0.6 + 0.4 * power) + slip)


@sfx("cockpit_loop", n=1, cat="loop_big", loop=True, target=-20.0, max_distance=0.0)
def cockpit_loop(r, i):
	L = OTTER_REV * 200
	return otter_engine(r, L)


@sfx("plane_crash", n=1, cat="big", target=-10.0, max_distance=0.0, cooldown=5.0)
def plane_crash(r, i):
	"""Forced landing into timber: stall-warning horn, wind, first tree strikes (wing), metal tearing,
	fuselage hitting ground, sliding, final stop; then ticking metal and settling snow."""
	dur = 11.0
	out = dsp.zeros(dur)
	n = ns(2.5)
	tt = tvec(n)
	horn = np.sin(2 * math.pi * 2600 * tt) * (0.5 + 0.5 * np.sign(np.sin(2 * math.pi * 3 * tt))) * 0.06
	place(out, dsp.bp(horn, 1500, 5000), 0.0)
	wind = dsp.lp(dsp.pink(ns(3.7), r), 1500) * dsp.env_points(ns(3.7), [(0, 0.3), (3.0, 1.0), (3.5, 1.0), (3.7, 0.0)]) * 0.35
	place(out, wind, 0.0)
	t_hit = 2.6
	for k in range(9):
		c = dsp.click(r, 0.005, 200, 7000, 1.2)
		fr, t60, amps = M.wood_modes(r, 200 + 500 * r.random(), 5, 1.2)
		place(out, dsp.mix(c, dsp.resonator_bank(c, fr, t60, amps)) * (0.5 + r.random()), t_hit + 0.08 * k + 0.05 * r.random())
	# aluminium skin tearing: stick-slip with metal modes, rising chaos
	fr, t60, amps = M.metal_modes(r, 320, 12, 0.3)
	tear = M.creak(r, 0.9, 120, 700, (fr, t60, amps), 0.45, 0.8)
	place(out, tear / (np.max(np.abs(tear)) + 1e-9) * 0.5, t_hit + 0.2)
	# main impact
	t_imp = t_hit + 0.9
	m = ns(1.2)
	tm = tvec(m)
	boom = np.sin(2 * math.pi * 38 * tm * (1 - 0.3 * tm)) * np.exp(-tm / 0.25)
	place(out, boom * 0.9, t_imp)
	place(out, dsp.resonator_bank(dsp.click(r, 0.01, 60, 4000), fr, t60 * 3, amps) * 0.6, t_imp)
	crunch = M.granular(r, 1.0, 900 * np.exp(-tm[:ns(1.0)] / 0.3), lambda rr: dsp.click(rr, 0.003, 300, 6000, 1.3), 0.9)
	place(out, crunch * 0.8, t_imp)
	# slide through snow and brush, decelerating
	s = ns(2.2)
	slide = (dsp.lp(dsp.pink(s, r), 900) * 0.6 + M.scrape(r, 2.2, 400, 4000, 500) * 0.4) * dsp.env_points(s, [(0, 1), (2.2, 0)])
	place(out, slide, t_imp + 0.2)
	place(out, M.creak(r, 1.2, 60, 25, (fr, t60, amps), 0.3) * 0.4, t_imp + 1.6)
	# aftermath: hot engine metal ticking, snow sliding off the wing
	for tt2 in dsp.poisson_times(4.0, 2.0, r, t_imp + 2.6):
		if tt2 < dur - 0.1:
			fr2, t602, a2 = M.metal_modes(r, 2500 + 1500 * r.random(), 4, 0.05)
			place(out, dsp.modal(ns(0.06), fr2, t602, a2, r=r) * 0.12, float(tt2))
	place(out, dsp.lp(dsp.pink(ns(0.8), r), 700) * dsp.hann_env(ns(0.8)) * 0.3, t_imp + 3.4)
	return out


# ------------------------------------------------------------------------------------------------ oxygen

@sfx("o2_hiss", n=3, cat="device", target=-24.0, max_distance=8.0, unit_size=1.0, cooldown=0.3)
def o2_hiss(r, i):
	"""0: demand-regulator breath (valve click, flow hiss, close); 1: cylinder valve cracked open;
	2: exhalation through the mask's flutter valve."""
	if i == 0:
		d = 0.75 + 0.15 * r.random()
		n = ns(d)
		x = dsp.bp(dsp.pink(n, r) + 0.5 * r.standard_normal(n), 2500, 11000) * dsp.env_points(n, [(0, 0), (0.03, 1), (d * 0.7, 0.8), (d, 0)])
		x = dsp.peak_eq(x, 5200, 5, 1.2)
		out = dsp.zeros(d + 0.1)
		place(out, dsp.click(r, 0.0015, 1500, 8000) * 0.4, 0.0)
		place(out, x * 0.5, 0.005)
		place(out, dsp.click(r, 0.0015, 1200, 6000) * 0.3, d)
		return out
	if i == 1:
		d = 2.2
		n = ns(d)
		t = tvec(n)
		env = np.clip(t / 0.02, 0, 1) * (0.55 + 0.45 * np.exp(-t / 0.3))
		x = dsp.bp(dsp.pink(n, r) + 0.6 * r.standard_normal(n), 1800, 13000) * env
		out = dsp.zeros(d + 0.1)
		place(out, M.scrape(r, 0.06, 1000, 6000, 1200) * 0.3, 0.0)
		place(out, x * 0.5, 0.02)
		return out
	d = 0.7
	n = ns(d)
	flutter = 1 - 0.6 * (0.5 + 0.5 * np.sin(dsp.phase_from_f(np.full(n, 42.0))))
	x = dsp.bp(dsp.pink(n, r), 300, 4000) * flutter * dsp.env_points(n, [(0, 0), (0.05, 1), (d, 0)])
	return x
