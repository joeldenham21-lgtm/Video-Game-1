"""Custom synthesis layers rendered in numpy (the ambient bed under the orchestra).

Every layer is described in BEATS by the cue and rendered into the cue timeline (seconds) at 48 kHz.
Layers flagged continuous=True inside a looping cue are generated exactly one loop long with all
oscillator/LFO frequencies quantised to whole cycles per loop, so they are periodic by construction.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy import signal

from theory import P

SR = 48000


def midi_hz(p: float) -> float:
    return 440.0 * 2 ** ((p - 69) / 12.0)


def _env(n: int, sr: int, attack: float, release: float, shape: str = "cos") -> np.ndarray:
    """Attack/sustain/release envelope over n samples (release inside n)."""
    e = np.ones(n)
    a = min(n, int(attack * sr))
    r = min(n - a, int(release * sr))
    if a > 0:
        u = np.linspace(0, 1, a, endpoint=False)
        e[:a] = (0.5 - 0.5 * np.cos(np.pi * u)) if shape == "cos" else u
    if r > 0:
        u = np.linspace(0, 1, r)
        e[n - r:] *= (0.5 + 0.5 * np.cos(np.pi * u)) if shape == "cos" else (1 - u)
    return e


def _saw_blep(freq: np.ndarray, sr: int, phase0: float) -> np.ndarray:
    dt = freq / sr
    ph = (phase0 + np.cumsum(dt)) % 1.0
    y = 2.0 * ph - 1.0
    m1 = ph < dt
    x = ph[m1] / dt[m1]
    y[m1] -= x + x - x * x - 1.0
    m2 = ph > 1.0 - dt
    x = (ph[m2] - 1.0) / dt[m2]
    y[m2] -= x * x + x + x + 1.0
    return y


def _tv_lowpass(x: np.ndarray, cutoff: np.ndarray, sr: int, q: float = 0.6, block: int = 256) -> np.ndarray:
    """Time-varying 2-pole low-pass (RBJ), coefficients updated per block, state carried."""
    y = np.empty_like(x)
    zi = np.zeros((2, x.shape[1])) if x.ndim == 2 else np.zeros(2)
    for s in range(0, len(x), block):
        e = min(len(x), s + block)
        f = float(min(sr * 0.45, max(20.0, cutoff[min(len(cutoff) - 1, s)])))
        w0 = 2 * math.pi * f / sr
        cw, sw = math.cos(w0), math.sin(w0)
        al = sw / (2 * q)
        b = np.array([(1 - cw) / 2, 1 - cw, (1 - cw) / 2]) / (1 + al)
        a = np.array([1.0, -2 * cw / (1 + al), (1 - al) / (1 + al)])
        if x.ndim == 2:
            for c in range(x.shape[1]):
                y[s:e, c], zi[:, c] = signal.lfilter(b, a, x[s:e, c], zi=zi[:, c])
        else:
            y[s:e], zi = signal.lfilter(b, a, x[s:e], zi=zi)
    return y


def _curve(points, cue, times: np.ndarray, default: float) -> np.ndarray:
    """Breakpoints [(beat, value)] -> values at `times` (seconds, cue timeline)."""
    if not points:
        return np.full(len(times), default)
    ts = np.array([cue.sec(b) for b, _ in points])
    vs = np.array([v for _, v in points], dtype=float)
    return np.interp(times, ts, vs)


@dataclass
class Layer:
    name: str
    gain_db: float = 0.0
    send: float = 0.5
    pan: float = 0.0
    width: float = 1.0
    hp: float | None = 30.0
    lp: float | None = None
    dry_db: float = 0.0
    continuous: bool = False    # periodic across the loop (quantised oscillators)

    def render(self, cue, sr: int, n: int, pre: float, loop_len: int | None) -> np.ndarray:
        raise NotImplementedError


@dataclass
class SawPad(Layer):
    """Warm analogue-style pad: per note, several detuned band-limited saws with slow pitch drift,
    stereo-spread, long cosine envelopes. The summed bus runs through a low-pass whose cutoff follows
    `cutoff` breakpoints [(beat, hz)] (slow filter sweeps)."""
    notes: list = field(default_factory=list)       # (pitch, beat, dur_beats, level_db)
    voices: int = 5
    detune_cents: float = 9.0
    attack: float = 3.0
    release: float = 4.0
    cutoff: list = field(default_factory=list)       # [(beat, hz)]
    resonance: float = 0.65
    sine_mix: float = 0.35                          # adds a pure fundamental for body
    seed: int = 1

    def render(self, cue, sr, n, pre, loop_len):
        rng = np.random.default_rng(self.seed)
        out = np.zeros((n, 2))
        for (pitch, beat, dur, lvl) in self.notes:
            t0 = pre + cue.sec(beat)
            t1 = pre + cue.sec(beat + dur)
            i0 = int(t0 * sr)
            m = int((t1 - t0 + self.release) * sr)
            if i0 >= n or m <= 0:
                continue
            m = min(m, n - i0)
            tt = np.arange(m) / sr
            env = _env(m, sr, self.attack, self.release)
            f0 = midi_hz(P(pitch))
            acc = np.zeros((m, 2))
            for v in range(self.voices):
                spread = (v - (self.voices - 1) / 2) / max(1, (self.voices - 1) / 2)
                cents = spread * self.detune_cents
                drift = 3.0 * np.sin(2 * np.pi * (0.05 + 0.03 * rng.random()) * tt + rng.random() * 6.28)
                f = f0 * 2 ** ((cents + drift) / 1200.0)
                y = _saw_blep(f, sr, rng.random())
                pos = spread * 0.8
                gl, gr = math.cos((pos + 1) * math.pi / 4), math.sin((pos + 1) * math.pi / 4)
                acc[:, 0] += y * gl
                acc[:, 1] += y * gr
            acc /= self.voices ** 0.5
            if self.sine_mix:
                s = np.sin(2 * np.pi * f0 * tt + rng.random() * 6.28) * self.sine_mix * 1.4
                acc += s[:, None]
            out[i0:i0 + m] += acc * env[:, None] * 10 ** (lvl / 20)
        times = np.arange(n) / sr - pre
        cut = _curve(self.cutoff, cue, times, 1200.0)
        return _tv_lowpass(out, cut, sr, self.resonance)


@dataclass
class Drone(Layer):
    """Continuous low drone: stacked sine/soft-saw partials on given pitches with slow amplitude
    'breathing'. With continuous=True it is exactly periodic over the loop."""
    pitches: list = field(default_factory=list)      # (pitch, level_db)
    start: float = 0.0                               # beats (ignored when continuous)
    end: float = 0.0
    breathe_hz: float = 0.05
    breathe_depth: float = 0.35
    brightness: float = 0.25                         # 0 pure sine .. 1 saw-ish
    fade: float = 6.0
    level_pts: list = field(default_factory=list)    # [(beat, db)] overall contour (non-continuous)
    seed: int = 2

    def render(self, cue, sr, n, pre, loop_len):
        rng = np.random.default_rng(self.seed)
        if self.continuous and loop_len:
            m = loop_len
            i0 = int(pre * sr)
            L = m / sr
            q = lambda f: max(1, round(f * L)) / L  # noqa: E731  whole cycles per loop
        else:
            t0 = pre + cue.sec(self.start)
            t1 = pre + cue.sec(self.end)
            i0 = int(t0 * sr)
            m = int((t1 - t0) * sr)
            q = lambda f: f  # noqa: E731
        tt = np.arange(m) / sr
        acc = np.zeros((m, 2))
        for (pitch, lvl) in self.pitches:
            f0 = midi_hz(P(pitch))
            for ch in range(2):
                f = q(f0 * 2 ** ((1.5 if ch else -1.5) / 1200.0))
                ph = rng.random() * 6.28
                y = np.zeros(m)
                nh = 1 + int(self.brightness * 10)
                for h in range(1, nh + 1):
                    if f * h > 6000:
                        break
                    amp = (1.0 / h) * (self.brightness if h > 1 else 1.0)
                    y += amp * np.sin(2 * np.pi * q(f * h) * tt + ph * h)
                br = q(self.breathe_hz * (0.8 + 0.4 * rng.random()))
                y *= 1 - self.breathe_depth * (0.5 + 0.5 * np.sin(2 * np.pi * br * tt + rng.random() * 6.28))
                acc[:, ch] += y * 10 ** (lvl / 20)
        if not (self.continuous and loop_len):
            acc *= _env(m, sr, self.fade, self.fade)[:, None]
            if self.level_pts:
                lv = _curve(self.level_pts, cue, tt + (i0 / sr - pre), 0.0)
                acc *= (10 ** (lv / 20))[:, None]
        out = np.zeros((n, 2))
        e = min(n, i0 + m)
        out[i0:e] = acc[: e - i0]
        return out


@dataclass
class Glass(Layer):
    """Additive 'glass' tones (bowed glass / crystal harmonics): near-sine partials with slight
    inharmonicity, slow swells and a faint shimmer. notes: (pitch, beat, dur_beats, level_db)."""
    notes: list = field(default_factory=list)
    partials: list = field(default_factory=lambda: [(1.0, 1.0), (2.001, 0.28), (3.004, 0.10), (4.2, 0.05), (5.43, 0.025)])
    attack: float = 1.8
    release: float = 3.5
    shimmer_hz: float = 5.2
    shimmer_depth: float = 0.08
    seed: int = 3

    def render(self, cue, sr, n, pre, loop_len):
        rng = np.random.default_rng(self.seed)
        out = np.zeros((n, 2))
        for (pitch, beat, dur, lvl) in self.notes:
            t0 = pre + cue.sec(beat)
            t1 = pre + cue.sec(beat + dur)
            i0 = int(t0 * sr)
            m = min(n - i0, int((t1 - t0 + self.release) * sr))
            if m <= 0:
                continue
            tt = np.arange(m) / sr
            f0 = midi_hz(P(pitch))
            env = _env(m, sr, self.attack, self.release)
            y = np.zeros((m, 2))
            for (ratio, amp) in self.partials:
                f = f0 * ratio
                if f > 16000:
                    continue
                for ch in range(2):
                    det = 1 + (0.0007 if ch else -0.0007) * ratio
                    y[:, ch] += amp * np.sin(2 * np.pi * f * det * tt + rng.random() * 6.28)
            trem = 1 - self.shimmer_depth * (0.5 + 0.5 * np.sin(2 * np.pi * self.shimmer_hz * tt + rng.random() * 6.28))
            out[i0:i0 + m] += y * (env * trem)[:, None] * 10 ** (lvl / 20)
        return out


@dataclass
class NoiseSwell(Layer):
    """Band-limited noise 'air': each band (centre_hz, q, [(beat, db), ...]) has its own contour.
    Continuous layers use FFT-periodic noise so the loop seam is invisible."""
    bands: list = field(default_factory=list)
    seed: int = 4

    def render(self, cue, sr, n, pre, loop_len):
        rng = np.random.default_rng(self.seed)
        out = np.zeros((n, 2))
        periodic = self.continuous and loop_len
        m = loop_len if periodic else n
        i0 = int(pre * sr) if periodic else 0
        times = (np.arange(m) / sr) + (0 if periodic else -pre)
        for (fc, q, pts) in self.bands:
            if periodic:
                spec = np.fft.rfft(rng.standard_normal((m, 2)), axis=0)
                f = np.fft.rfftfreq(m, 1 / sr)
                bw = fc / q
                shape = 1.0 / (1.0 + ((f - fc) / (bw / 2)) ** 2)
                noise = np.fft.irfft(spec * shape[:, None], n=m, axis=0)
            else:
                noise = rng.standard_normal((m, 2))
                sos = signal.butter(2, [max(20, fc - fc / q / 2), min(sr * 0.45, fc + fc / q / 2)], "bp", fs=sr, output="sos")
                noise = signal.sosfilt(sos, noise, axis=0)
            noise /= np.sqrt(np.mean(noise ** 2)) + 1e-12
            if periodic:
                bt = [(b, v) for b, v in pts]
                lv = _curve(bt, cue, times, -120.0)
            else:
                lv = _curve(pts, cue, times, -120.0)
            out[i0:i0 + m] += noise * (10 ** (lv / 20))[:, None]
        return out


@dataclass
class Pluck(Layer):
    """Muted synth pulse for ostinati: two slightly detuned band-limited saws + a sub sine, fast
    exponential decay, low-passed. notes: (pitch, beat, dur_beats, level_db)."""
    notes: list = field(default_factory=list)
    decay: float = 0.16
    cutoff: float = 850.0
    sub: float = 0.6
    seed: int = 6

    def render(self, cue, sr, n, pre, loop_len):
        rng = np.random.default_rng(self.seed)
        out = np.zeros((n, 2))
        sos = signal.butter(2, self.cutoff, "lp", fs=sr, output="sos")
        for (pitch, beat, dur, lvl) in self.notes:
            i0 = int((pre + cue.sec(beat)) * sr)
            m = min(n - i0, int((cue.sec(beat + dur) - cue.sec(beat) + self.decay * 4) * sr))
            if m <= 0 or i0 < 0:
                continue
            tt = np.arange(m) / sr
            f0 = midi_hz(P(pitch))
            env = np.exp(-tt / self.decay) * np.clip(tt / 0.002, 0, 1)
            gate = cue.sec(beat + dur) - cue.sec(beat)
            env *= np.where(tt < gate, 1.0, np.exp(-(tt - gate) / 0.03))
            y = np.zeros((m, 2))
            for ch, cents in ((0, -4.0), (1, 4.0)):
                f = np.full(m, f0 * 2 ** (cents / 1200))
                y[:, ch] = _saw_blep(f, sr, rng.random()) * 0.6
            y += (np.sin(2 * np.pi * f0 / 2 * tt) * self.sub)[:, None]
            y = signal.sosfilt(sos, y, axis=0)
            out[i0:i0 + m] += y * env[:, None] * 10 ** (lvl / 20)
        return out


@dataclass
class Cymbal(Layer):
    """Suspended-cymbal roll swells and crashes: many inharmonic partials (seeded) plus high noise,
    shimmering amplitude modulation. swells: [(start_beat, end_beat, peak_db)] crescendo to the end
    beat then a crash-like decay; crashes: [(beat, level_db)]."""
    swells: list = field(default_factory=list)
    crashes: list = field(default_factory=list)
    decay: float = 3.5
    seed: int = 7

    def _metal(self, m, sr, rng):
        tt = np.arange(m) / sr
        y = np.zeros((m, 2))
        freqs = np.exp(rng.uniform(np.log(420), np.log(11000), 48))
        for f in freqs:
            for ch in range(2):
                y[:, ch] += np.sin(2 * np.pi * f * (1 + (0.002 if ch else -0.002)) * tt + rng.random() * 6.28) / (1 + f / 3000)
        nz = rng.standard_normal((m, 2))
        nz = signal.sosfilt(signal.butter(2, [2500, 14000], "bp", fs=sr, output="sos"), nz, axis=0)
        y = y / (np.sqrt(np.mean(y ** 2)) + 1e-9) * 0.6 + nz / (np.sqrt(np.mean(nz ** 2)) + 1e-9) * 0.5
        return y

    def render(self, cue, sr, n, pre, loop_len):
        rng = np.random.default_rng(self.seed)
        out = np.zeros((n, 2))
        for (b0, b1, pk) in self.swells:
            t0, t1 = pre + cue.sec(b0), pre + cue.sec(b1)
            i0 = int(t0 * sr)
            m = min(n - i0, int((t1 - t0 + self.decay * 1.5) * sr))
            y = self._metal(m, sr, rng)
            tt = np.arange(m) / sr
            L = t1 - t0
            env = np.where(tt < L, (np.clip(tt / L, 0, 1) ** 2.2), np.exp(-(tt - L) / (self.decay * 0.35)))
            y *= (env * (1 + 0.15 * np.sin(2 * np.pi * 7.3 * tt)))[:, None]
            out[i0:i0 + m] += y * 10 ** (pk / 20)
        for (b, lvl) in self.crashes:
            i0 = int((pre + cue.sec(b)) * sr)
            m = min(n - i0, int(self.decay * 1.6 * sr))
            y = self._metal(m, sr, rng)
            tt = np.arange(m) / sr
            env = np.exp(-tt / (self.decay * 0.45)) * np.clip(tt / 0.003, 0, 1)
            out[i0:i0 + m] += y * env[:, None] * 10 ** (lvl / 20)
        return out


@dataclass
class Boom(Layer):
    """Cinematic low hit: pitched sine sweep (e.g. 64 -> 34 Hz) with exponential decay plus a soft
    noise transient. hits: [(beat, level_db)]."""
    hits: list = field(default_factory=list)
    f_start: float = 62.0
    f_end: float = 33.0
    decay: float = 2.2
    click_db: float = -18.0
    seed: int = 5

    def render(self, cue, sr, n, pre, loop_len):
        rng = np.random.default_rng(self.seed)
        out = np.zeros((n, 2))
        m = int(sr * (self.decay * 2.5))
        tt = np.arange(m) / sr
        f = self.f_end + (self.f_start - self.f_end) * np.exp(-tt / 0.18)
        ph = 2 * np.pi * np.cumsum(f) / sr
        body = np.sin(ph) * np.exp(-tt / self.decay) * np.clip(tt / 0.004, 0, 1)
        nz = rng.standard_normal(m) * np.exp(-tt / 0.05)
        nz = signal.sosfilt(signal.butter(2, [60, 900], "bp", fs=sr, output="sos"), nz)
        y = body + nz * 10 ** (self.click_db / 20)
        y = np.tanh(y * 1.4) / np.tanh(1.4)
        for (beat, lvl) in self.hits:
            i0 = int((pre + cue.sec(beat)) * sr)
            e = min(n, i0 + m)
            if i0 < n:
                out[i0:e] += (y[: e - i0] * 10 ** (lvl / 20))[:, None]
        return out
