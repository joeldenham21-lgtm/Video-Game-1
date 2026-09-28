"""STARWAKE -- sound design. Every effect is synthesized here from noise,
oscillators and filters, then placed on the film's timeline.

Writes build/audio/sfx.wav (48 kHz stereo float).
"""
import os, sys
import numpy as np
import soundfile as sf
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from timeline import SHOTS, TOTAL  # noqa: E402

SR = 48000
OUT = os.path.join(ROOT, "build", "audio")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(11)
LEN = int((TOTAL + 12) * SR)
BUF = np.zeros((LEN, 2), dtype=np.float64)


def st(sid):
    return SHOTS[sid]["start"]


# ---------------------------------------------------------------- building blocks
def noise(nn):
    return rng.standard_normal(nn)


def brown(nn):
    x = np.cumsum(noise(nn))
    x = signal.sosfilt(signal.butter(1, 10, "high", fs=SR, output="sos"), x)
    return x / (np.abs(x).max() + 1e-9)


def filt(x, kind, f, order=2):
    return signal.sosfilt(signal.butter(order, f, kind, fs=SR, output="sos"), x)


def env(nn, a=0.01, r=None, curve=3.0):
    t = np.arange(nn) / SR
    e = np.minimum(t / max(a, 1e-4), 1.0)
    if r is None:
        r = nn / SR - a
    e *= np.exp(-np.maximum(t - a, 0) / max(r, 1e-4) * curve)
    return e


def fades(x, fi=0.05, fo=0.1):
    nn = len(x)
    a, b = int(fi * SR), int(fo * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None] if x.ndim == 2 else np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)[:, None] if x.ndim == 2 else np.linspace(1, 0, b)
    return x


def sweep_noise(dur, f0, f1, bw=0.6, peak=None):
    """Noise with a moving band (spectral shaping in the STFT domain)."""
    nn = int(dur * SR)
    x = noise(nn)
    f, t, Z = signal.stft(x, fs=SR, nperseg=1024)
    k = t / max(dur, 1e-3)
    fc = f0 * (f1 / f0) ** np.clip(k, 0, 1)
    lf = np.log(np.maximum(f, 1.0))[:, None]
    mask = np.exp(-((lf - np.log(fc)[None, :]) ** 2) / (2 * bw ** 2))
    _, y = signal.istft(Z * mask, fs=SR, nperseg=1024)
    y = y[:nn]
    if peak is not None:
        tt = np.arange(nn) / SR
        y *= np.exp(-((tt - peak) ** 2) / (2 * (dur * 0.22) ** 2))
    return y / (np.abs(y).max() + 1e-9)


def boom(dur=4.0, f0=70, f1=28, sub=1.0, crack=0.5):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    ph = 2 * np.pi * np.cumsum(f1 + (f0 - f1) * np.exp(-t * 3.0)) / SR
    s = np.sin(ph) * np.exp(-t * 1.3) * sub
    nz = filt(noise(nn), "low", 180) * np.exp(-t * 1.6) * 3.0
    cr = filt(noise(nn), "high", 1200) * np.exp(-t * 18) * crack
    y = s + nz + cr
    return y / (np.abs(y).max() + 1e-9)


def explosion(dur=2.5, bright=1.0):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    x = noise(nn)
    y = np.zeros(nn)
    for fc, w in [(6000, .4 * bright), (1800, .7), (500, 1.0), (140, 1.3)]:
        y += filt(x, "low", fc) * w * np.exp(-t * (6 if fc > 1000 else 2.2))
    y += np.sin(2 * np.pi * np.cumsum(55 * np.exp(-t * 2) + 30) / SR) * np.exp(-t * 3) * 1.5
    crackle = (rng.random(nn) > 0.997) * noise(nn) * np.exp(-t * 1.5) * 2
    y += filt(crackle, "high", 800)
    y[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    return y / (np.abs(y).max() + 1e-9)


def laser(dur=0.45, f0=2600, f1=260):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 14)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph + 2.5 * np.sin(ph * 0.5)) * np.exp(-t * 9)
    y += filt(noise(nn), "band", [1500, 6000]) * np.exp(-t * 30) * 0.3
    return y / (np.abs(y).max() + 1e-9)


def chime(dur=3.0, f=1200, bright=1.0):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    y = np.zeros(nn)
    for k, (r, a, d) in enumerate([(1, 1, 1.2), (2.76, .5, 2.5), (5.4, .3, 4), (8.93, .18, 6), (13.3, .1 * bright, 9)]):
        y += a * np.sin(2 * np.pi * f * r * t + k) * np.exp(-t * d)
    y *= np.minimum(t / 0.002, 1)
    return y / (np.abs(y).max() + 1e-9)


def engine(dur, f0=55, bright=0.5, doppler=None):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    f = np.full(nn, float(f0)) if doppler is None else f0 * doppler(t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = sum(np.sin(ph * h + h) / h ** 1.2 for h in range(1, 12))
    y += filt(noise(nn), "band", [300, 3000 + 5000 * bright]) * 0.6
    y *= 1 + 0.1 * np.sin(2 * np.pi * 7 * t)
    return y / (np.abs(y).max() + 1e-9)


def wind(dur, lo=200, hi=1400, gust=0.3):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    x = sweep_noise(dur, lo, hi, bw=0.9)
    x2 = filt(noise(nn), "band", [lo, hi])
    x2 /= np.abs(x2).max() + 1e-9
    m = 0.6 + gust * np.sin(2 * np.pi * 0.13 * t + 1) + 0.2 * np.sin(2 * np.pi * 0.31 * t)
    return (0.5 * x + 0.5 * x2) * m


def rain(dur):
    nn = int(dur * SR)
    x = filt(noise(nn), "high", 2500) * 0.35
    drops = (rng.random(nn) > 0.9985) * noise(nn)
    x += filt(drops, "band", [1500, 7000]) * 1.2
    return x / (np.abs(x).max() + 1e-9)


def thunder(dur=5.0):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    crack = filt(noise(nn), "high", 700) * np.exp(-t * 14)
    rumble = filt(brown(nn), "low", 220) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 0.9 * t + rng.random() * 3))) * np.exp(-t * 0.7)
    y = crack * 0.9 + rumble * 2.0
    return y / (np.abs(y).max() + 1e-9)


def electric(dur=1.2):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    buzz = signal.sawtooth(2 * np.pi * 110 * t) * 0.4 + signal.square(2 * np.pi * 55 * t) * 0.2
    cr = (rng.random(nn) > 0.99) * noise(nn) * 3
    y = (buzz + filt(cr, "high", 1000)) * np.exp(-t * 2.5)
    return y / (np.abs(y).max() + 1e-9)


def splash(dur=3.0, big=1.0):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    y = filt(noise(nn), "band", [300, 7000]) * np.exp(-t * 2.2) * 1.2
    y += filt(noise(nn), "low", 300) * np.exp(-t * 4) * 2 * big
    drops = (rng.random(nn) > 0.996) * noise(nn) * np.exp(-t * 0.8)
    y += filt(drops, "band", [800, 5000]) * 1.5
    y[: int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
    return y / (np.abs(y).max() + 1e-9)


def lap(dur):
    """Gentle water lapping."""
    nn = int(dur * SR)
    y = np.zeros(nn)
    tt = 0.0
    while tt < dur - 0.5:
        k = int(tt * SR)
        m = int(rng.uniform(0.25, 0.7) * SR)
        m = min(m, nn - k)
        seg = filt(noise(m), "band", [180, 1400]) * np.hanning(m) * rng.uniform(0.3, 1.0)
        y[k:k + m] += seg
        tt += rng.uniform(0.4, 1.3)
    return y / (np.abs(y).max() + 1e-9)


def creatures(dur, density=0.4, base=300):
    """Alien night fauna: gliding tonal calls and chirps."""
    nn = int(dur * SR)
    y = np.zeros(nn)
    tt = rng.uniform(0, 1.5)
    while tt < dur - 1.0:
        L = rng.uniform(0.25, 1.1)
        m = int(L * SR)
        t = np.arange(m) / SR
        f0 = base * rng.uniform(0.8, 3.0)
        f = f0 * (1 + 0.5 * np.sin(2 * np.pi * rng.uniform(0.8, 3) * t)) * np.linspace(1, rng.uniform(0.6, 1.5), m)
        call = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.hanning(m) * rng.uniform(0.2, 1)
        k = int(tt * SR)
        y[k:k + m] += call[: nn - k]
        tt += rng.exponential(1 / density)
    return y / (np.abs(y).max() + 1e-9)


def hum(dur, freqs=(55, 82.5, 110, 164.8), beat=0.3):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    y = sum(np.sin(2 * np.pi * f * t + i) * (1 + 0.3 * np.sin(2 * np.pi * beat * (i + 1) * t)) / (i + 1) for i, f in enumerate(freqs))
    return y / (np.abs(y).max() + 1e-9)


def heartbeat(dur, bpm=60):
    nn = int(dur * SR)
    y = np.zeros(nn)
    per = 60 / bpm
    tt = 0.0
    while tt < dur - 0.4:
        for off, a in ((0, 1.0), (0.22, 0.7)):
            k = int((tt + off) * SR)
            m = int(0.25 * SR)
            t = np.arange(m) / SR
            y[k:k + m] += np.sin(2 * np.pi * 50 * t) * np.exp(-t * 18) * a
        tt += per
    return y / (np.abs(y).max() + 1e-9)


def screams(dur):
    """The caged suns: formant-filtered voices, wavering."""
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    y = np.zeros(nn)
    for k in range(7):
        f = 180 * 2 ** (rng.uniform(0, 2)) * (1 + 0.03 * np.sin(2 * np.pi * rng.uniform(3, 7) * t))
        src = signal.sawtooth(2 * np.pi * np.cumsum(f) / SR)
        v = sum(filt(src, "band", [fc * 0.85, fc * 1.15]) * g for fc, g in ((700, 1), (1100, .7), (2600, .4)))
        y += v * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(0.1, 0.4) * t + k))
    return y / (np.abs(y).max() + 1e-9)


def beep(f=1800, dur=0.12, n=2, gap=0.08):
    seg = []
    for i in range(n):
        m = int(dur * SR)
        t = np.arange(m) / SR
        seg.append(np.sin(2 * np.pi * f * t) * np.hanning(m))
        seg.append(np.zeros(int(gap * SR)))
    return np.concatenate(seg)


def reverse_swell(dur=3.0):
    nn = int(dur * SR)
    t = np.arange(nn) / SR
    y = filt(noise(nn), "high", 2000) * (t / dur) ** 3
    y += filt(noise(nn), "band", [300, 3000]) * (t / dur) ** 4 * 0.5
    return y / (np.abs(y).max() + 1e-9)


# ---------------------------------------------------------------- placement
def place(t, x, gain=1.0, pan=0.0, pan_to=None, fi=0.0, fo=0.0):
    if x.ndim == 1:
        nn = len(x)
        p0 = pan
        p1 = pan if pan_to is None else pan_to
        pp = np.linspace(p0, p1, nn)
        L = np.cos((pp + 1) * np.pi / 4)
        R = np.sin((pp + 1) * np.pi / 4)
        x = np.stack([x * L, x * R], axis=1) * np.sqrt(2)
    x = fades(x.copy(), fi, fo) if (fi or fo) else x
    k = int(t * SR)
    if k >= LEN:
        return
    m = min(len(x), LEN - k)
    BUF[k:k + m] += x[:m] * gain


def bed(t0, t1, gen, gain, fi=1.0, fo=1.0, pan=0.0, width=0.5):
    dur = t1 - t0
    a = gen(dur)
    b = gen(dur)
    x = np.stack([a * (1 - width * 0.5) + b * width * 0.5, b * (1 - width * 0.5) + a * width * 0.5], axis=1)
    place(t0, fades(x, fi, fo), gain)


def space_rumble(d):
    return filt(brown(int(d * SR)), "low", 70) * 1.0


def maw_drone(d):
    nn = int(d * SR)
    t = np.arange(nn) / SR
    y = sum(signal.sawtooth(2 * np.pi * f * t + i) / (i + 1) for i, f in enumerate((36.7, 38.9, 55.0, 73.4)))
    y = filt(y, "low", 400)
    y += filt(noise(nn), "band", [60, 300]) * 0.5
    y *= 1 + 0.2 * np.sin(2 * np.pi * 0.2 * t)
    return y / (np.abs(y).max() + 1e-9)


def plasma_roar(d):
    nn = int(d * SR)
    t = np.arange(nn) / SR
    y = filt(noise(nn), "band", [200, 2500]) * (0.7 + 0.3 * np.sin(2 * np.pi * 3.1 * t) * np.sin(2 * np.pi * 0.7 * t))
    y += filt(brown(nn), "low", 120) * 1.5
    return y / (np.abs(y).max() + 1e-9)


def night_bed(d):
    return lap(d) * 0.6 + creatures(d, 0.5, 260) * 0.35 + filt(noise(int(d * SR)), "band", [3000, 9000]) * 0.02


# ================================================================ PROLOGUE
bed(0, st("S03"), space_rumble, 0.10, fi=4, fo=2)
place(st("S01") + 1.0, sweep_noise(12, 80, 400, bw=0.8, peak=6), 0.04)
bed(st("S03"), st("S06"), maw_drone, 0.14, fi=1.5, fo=0.2)
bed(st("S03"), st("S05") + 8.5, plasma_roar, 0.10, fi=1.0, fo=1.5)
place(st("S04"), sweep_noise(6, 300, 1500, bw=0.5, peak=3), 0.12, pan=-0.3, pan_to=0.4)
place(st("S05") + 5.5, reverse_swell(3.0), 0.16)
place(st("S05") + 8.5, boom(6.0, 60, 22, sub=1.0, crack=0.3), 0.55)
place(st("S05") + 8.5, sweep_noise(5, 3000, 120, bw=0.7), 0.12)
bed(st("S06"), st("S07"), lambda d: filt(noise(int(d * SR)), "band", [4000, 9000]) * 0.3 + space_rumble(d), 0.05, fi=1, fo=1)
place(st("S07") + 0.2, reverse_swell(3.0), 0.22)
place(st("S07") + 3.2, boom(6.5, 80, 24, sub=1.0, crack=0.6), 0.5)
place(st("S07") + 3.2, chime(6.0, 880, 1.0), 0.05)

# ================================================================ ACT ONE
bed(st("S08"), st("S10"), space_rumble, 0.10, fi=1, fo=1)
bed(st("S08"), st("S09") + 3, maw_drone, 0.07, fi=1, fo=3)
for i in range(8):
    ta = st("S08") + 1.0 + i * 0.55 + (((i * 9.1) * 0.1031 % 1) * 0.4)
    place(ta - 0.35, sweep_noise(0.6, 4000, 300, bw=0.5), 0.10, pan=-0.4 + i * 0.1)
    place(ta, boom(2.0, 90, 35, sub=0.6, crack=0.8), 0.16 - i * 0.012, pan=-0.3 + i * 0.1)
# Asha's interceptor passes
place(st("S09"), fades(engine(11, 48, 0.4, doppler=lambda t: 1.08 - 0.12 * (t / 11)), 1.5, 1.5), 0.07, pan=-0.7, pan_to=0.6)
# cockpit
bed(st("S10"), st("S11"), lambda d: hum(d, (92, 184, 276), 0.2) * 0.4 + filt(noise(int(d * SR)), "band", [600, 4000]) * 0.08, 0.08, fi=0.3, fo=0.3)
place(st("S10") + 0.55, beep(1600, 0.1, 2), 0.05, pan=0.4)
place(st("S10") + 3.9, beep(1200, 0.08, 1), 0.04, pan=0.4)
frost = filt((rng.random(int(12 * SR)) > 0.9993) * noise(int(12 * SR)), "high", 3000)
place(st("S10"), frost / (np.abs(frost).max() + 1e-9), 0.05)
bed(st("S11"), st("S13"), lambda d: engine(d, 46, 0.3), 0.06, fi=0.5, fo=0.2)
bed(st("S11"), st("S13"), space_rumble, 0.08, fi=0.5, fo=0.2)
# spool-up and jump
spool = engine(4.0, 40, 0.8, doppler=lambda t: 1 + (t / 4) ** 2 * 3)
place(st("S12") + 4.2, fades(spool * np.linspace(0.3, 1, len(spool)), 0.3, 0.05), 0.10)
place(st("S12") + 8.15, boom(4.0, 120, 30, sub=0.8, crack=1.0), 0.45)
place(st("S12") + 7.6, sweep_noise(1.2, 300, 6000, bw=0.5, peak=0.9), 0.2)
bed(st("S13"), st("S14"), lambda d: sweep_noise(d, 400, 900, bw=1.0) + filt(brown(int(d * SR)), "low", 90), 0.18, fi=0.05, fo=0.2)
place(st("S13") + 4.6, sweep_noise(1.0, 5000, 200, bw=0.6, peak=0.25), 0.2)

# ================================================================ ACT TWO
place(st("S14"), boom(3.0, 70, 30, sub=0.5, crack=0.3), 0.18)
bed(st("S14"), st("S16"), lambda d: space_rumble(d) + chime(d, 1760, 0.5) * 0.0, 0.06, fi=0.5, fo=1)
for k in range(10):
    place(st("S14") + 1.5 + k * 1.3, chime(3.5, float(rng.choice([1174.7, 1318.5, 1480, 1661.2, 1760]))), 0.012, pan=float(rng.uniform(-0.8, 0.8)))
place(st("S15") + 2.0, fades(engine(4, 60, 0.6, doppler=lambda t: 1.15 - 0.3 * t / 4), 0.8, 1.2), 0.08, pan=-0.8, pan_to=0.8)
# entry
bed(st("S16"), st("S17"), lambda d: wind(d, 300, 3000, 0.2), 0.05, fi=0.5, fo=0.8)
entry = sweep_noise(7.0, 200, 1800, bw=0.8)
entry = entry * np.linspace(0.1, 1.0, len(entry)) ** 2
place(st("S16") + 2.0, fades(entry, 0.2, 0.8), 0.22)
place(st("S16") + 2.0, fades(filt(brown(int(7 * SR)), "low", 100) * np.linspace(0, 1, int(7 * SR)), 0.2, 0.8), 0.25)
# above the cloud sea
bed(st("S17"), st("S18"), lambda d: wind(d, 150, 900, 0.35), 0.06, fi=1.2, fo=0.3)
place(st("S17") + 1.0, creatures(12, 0.35, 140), 0.05, pan=-0.4)
place(st("S17") + 2.0, fades(engine(10, 52, 0.3, doppler=lambda t: 1.05 - 0.1 * t / 10), 1, 2), 0.035, pan=0.2, pan_to=0.5)
# the storm
bed(st("S18"), st("S20"), rain, 0.09, fi=0.2, fo=1.5)
bed(st("S18"), st("S19") + 4.4, lambda d: wind(d, 200, 2500, 0.5), 0.10, fi=0.2, fo=0.2)
bed(st("S18"), st("S19") + 4.4, lambda d: engine(d, 58, 0.5), 0.06, fi=0.1, fo=0.1)
for tb, g in ((st("S18") + 0.0, 0.35), (st("S18") + 2.3, 0.35)):
    place(tb, thunder(5.0), g, pan=float(rng.uniform(-0.5, 0.5)))
hit = st("S18") + 3.35
place(hit, electric(1.8), 0.25)
place(hit, explosion(2.0, 1.2), 0.35)
place(hit, thunder(5.0), 0.4)
place(st("S18") + 0.9, np.tile(beep(2200, 0.09, 1, 0.12), 14)[: int(6.5 * SR)], 0.035, pan=0.3)
sparks = (rng.random(int(5 * SR)) > 0.9985) * noise(int(5 * SR))
place(hit + 0.3, filt(sparks, "high", 1500), 0.12)
fall = engine(4.4, 70, 0.6, doppler=lambda t: 1.0 - 0.55 * t / 4.4)
place(st("S19"), fades(fall, 0.1, 0.05), 0.12, pan=0.5, pan_to=-0.2)
place(st("S19"), fades(sweep_noise(4.4, 800, 3500, bw=0.6) * np.linspace(0.3, 1, int(4.4 * SR)), 0.1, 0.02), 0.14, pan=0.4, pan_to=-0.1)
crash = st("S19") + 4.4
place(crash, splash(4.0, 1.5), 0.45)
place(crash, boom(3.0, 60, 30, sub=0.8, crack=0.4), 0.35)
# night on Veyra
bed(st("S20"), st("S26"), night_bed, 0.10, fi=2.5, fo=1.0)
bed(st("S20"), st("S23"), lambda d: filt((rng.random(int(d * SR)) > 0.9994) * noise(int(d * SR)), "high", 2000) * 3 + filt(noise(int(d * SR)), "band", [200, 900]) * 0.05, 0.04, fi=1, fo=1, pan=-0.4)
for k in range(5):
    tg = st("S21") + 1.0 + k * 0.7 + 1.0
    place(tg, chime(4.0, float([987.8, 1174.7, 1318.5, 1480, 1661.2][k]), 0.6), 0.03, pan=-0.6 + k * 0.3)
for sid, t0, t1, rate, pan in (("S21", 4.0, 11.5, 0.95, -0.1), ("S24", 0.0, 13.0, 0.66, 0.0), ("S26", 0.0, 9.0, 0.7, 0.0)):
    tt = st(sid) + t0
    while tt < st(sid) + t1:
        s = splash(0.4, 0.2) * env(int(0.4 * SR), 0.005, 0.12)
        place(tt, s, 0.04 if sid != "S26" else 0.02, pan=pan + float(rng.uniform(-0.1, 0.1)))
        tt += rate * float(rng.uniform(0.9, 1.1))
place(st("S23"), fades(hum(5.5, (220, 330, 495), 0.5) * 0.5, 1, 1), 0.025)
# the chamber
bed(st("S26"), st("S28"), lambda d: hum(d, (55, 82.4, 110, 146.8, 220), 0.17), 0.07, fi=2.5, fo=0.5)
for k in range(8):
    place(st("S26") + 1.0 + k * 2.1, chime(3.0, float(rng.choice([1760, 2217.5, 2637, 2960]))), 0.01, pan=float(rng.uniform(-0.7, 0.7)))
touch = st("S27") + 4.4
place(touch - 1.2, reverse_swell(1.2), 0.12)
place(touch, sweep_noise(3.0, 6000, 300, bw=0.8, peak=0.3), 0.12)
for f in (587.3, 880, 1174.7, 1480):
    place(touch, chime(5.0, f), 0.05)
# the vision
place(st("S28"), fades(screams(12.0), 1.5, 0.8), 0.06)
place(st("S28"), heartbeat(12.0, 58), 0.20)
bed(st("S28"), st("S29"), maw_drone, 0.10, fi=1, fo=0.5)
bed(st("S29"), st("S30"), lambda d: hum(d, (55, 82.4, 110, 146.8, 220), 0.17), 0.06, fi=0.5, fo=1.0)

# ================================================================ ACT THREE
arr = st("S30") + 1.2
place(arr - 1.2, reverse_swell(1.2), 0.25)
place(arr, boom(7.0, 55, 20, sub=1.0, crack=0.8), 0.6)
bed(st("S30"), st("S32"), maw_drone, 0.14, fi=1.0, fo=1.0)
bed(st("S30"), st("S32"), space_rumble, 0.10, fi=1.0, fo=1.0)
for i in range(9):
    ta = st("S30") + 4.0 + i * 0.55 + (((i * 9.1) * 0.1031 % 1) * 0.4)
    place(ta, boom(1.6, 100, 40, sub=0.4, crack=0.9), 0.06, pan=float(rng.uniform(-0.6, 0.6)))
beam = st("S31") + 1.5
place(beam, electric(3.0), 0.12)
bed(beam, st("S32"), plasma_roar, 0.14, fi=1.5, fo=1.0)
place(beam, sweep_noise(4.0, 200, 2000, bw=0.6), 0.1)
# red sky: wind and far thunder while the Aurai sing
bed(st("S32"), st("S34"), lambda d: wind(d, 150, 1200, 0.4), 0.06, fi=1.5, fo=0.5)
bed(st("S32"), st("S34"), lambda d: lap(d), 0.05, fi=1, fo=0.5)
place(st("S32") + 2.0, thunder(6.0), 0.12, pan=-0.6)
place(st("S32") + 8.0, thunder(6.0), 0.1, pan=0.6)
# the fighter rises, then launches
rise = st("S33") + 0.5
place(rise, splash(5.0, 0.6), 0.2)
place(rise, fades(filt(noise(int(5 * SR)), "band", [300, 3000]) * np.linspace(1, 0.2, int(5 * SR)), 0.2, 0.5), 0.12)
place(rise, fades(engine(5.0, 50, 0.5, doppler=lambda t: 1 + 0.2 * t / 5), 0.5, 0.2), 0.12)
launch = st("S33") + 5.5
place(launch, boom(4.0, 100, 35, sub=0.9, crack=1.0), 0.4)
place(launch, fades(engine(4.5, 60, 0.9, doppler=lambda t: 1.3 - 0.5 * t / 4.5), 0.05, 1.5), 0.2, pan=0.0, pan_to=-0.5)
# battle
bed(st("S34"), st("S37"), lambda d: engine(d, 62, 0.6), 0.09, fi=0.3, fo=0.2)
bed(st("S34"), st("S37"), space_rumble, 0.10, fi=0.3, fo=0.2)
bed(st("S34"), st("S35"), maw_drone, 0.08, fi=0.5, fo=0.5)
for sid, dur, rate in (("S34", 11.0, 0.32), ("S35", 10.0, 0.28), ("S36", 8.0, 0.5)):
    tt = st(sid) + 0.2
    while tt < st(sid) + dur - 0.3:
        place(tt, laser(0.45, float(rng.uniform(1800, 3200)), float(rng.uniform(180, 400))), 0.06, pan=float(rng.uniform(-0.9, 0.9)))
        tt += rate * float(rng.uniform(0.6, 1.4))
for k in range(7):
    place(st("S34") + 0.5 + k * 1.6, explosion(2.0, 0.8), 0.10, pan=float(rng.uniform(-0.7, 0.7)))
place(st("S35") + 5.6, explosion(2.5, 1.2), 0.35, pan=-0.3)
place(st("S35") + 8.2, explosion(2.0, 1.0), 0.18, pan=-0.6)
place(st("S36") + 0.3, fades(engine(2.5, 70, 0.8, doppler=lambda t: 1.25 - 0.4 * t / 2.5), 0.1, 0.8), 0.16, pan=-0.8, pan_to=0.2)
for k in range(6):
    place(st("S36") + 1.6 + k * 0.25, laser(0.35, 1400, 300), 0.10, pan=-0.2)
place(st("S36") + 2.6, explosion(2.5, 1.2), 0.38, pan=-0.3)
place(st("S36") + 3.3, explosion(2.5, 1.2), 0.38, pan=0.3)
# the throat
bed(st("S37"), st("S38"), lambda d: sweep_noise(d, 300, 700, bw=1.2) + filt(brown(int(d * SR)), "low", 120) * 2, 0.22, fi=0.2, fo=0.3)
tt = st("S37")
while tt < st("S38") - 0.2:
    place(tt, sweep_noise(0.35, 2500, 400, bw=0.5, peak=0.15), 0.05, pan=float(rng.uniform(-0.8, 0.8)))
    tt += 0.2
bed(st("S38"), st("S39"), lambda d: hum(d, (36.7, 55, 73.4, 110), 0.3), 0.12, fi=0.5, fo=0.1)
launch_seed = st("S38") + 5.1
place(launch_seed, sweep_noise(1.4, 400, 5000, bw=0.5, peak=1.0), 0.18)
for f in (880, 1318.5, 1760):
    place(launch_seed, chime(2.0, f), 0.05)
place(launch_seed + 1.3, boom(2.0, 120, 50, sub=0.5, crack=1.0), 0.3)
# the cage breaks, the Starmaw ruptures
brk = st("S39")
place(brk, boom(8.0, 45, 18, sub=1.0, crack=1.0), 0.7)
glass = filt(noise(int(4 * SR)), "high", 3000) * env(int(4 * SR), 0.002, 1.2)
place(brk, glass, 0.2)
for k in range(24):
    place(brk + float(rng.uniform(0, 5)), chime(3.0, float(rng.uniform(1500, 5000))), 0.02, pan=float(rng.uniform(-1, 1)))
bed(st("S40"), st("S41"), lambda d: filt(brown(int(d * SR)), "low", 150) * 2 + maw_drone(d) * 0.5, 0.18, fi=0.3, fo=2.0)
place(st("S40") + 3.0, boom(7.0, 50, 20, sub=1.0, crack=0.8), 0.55)
for k in range(28):
    tt = st("S40") + 3.0 + float(rng.uniform(0, 8.5))
    place(tt, sweep_noise(1.5, 3000, 300, bw=0.4, peak=0.4), 0.05, pan=float(rng.uniform(-1, 1)))
# the galaxy relights
for k in range(40):
    tt = st("S41") + float(rng.uniform(0.3, 9.5))
    place(tt, chime(3.0, float(rng.choice([1174.7, 1318.5, 1480, 1760, 2217.5, 2637]))), 0.012, pan=float(rng.uniform(-1, 1)))
# Kessar rekindles
place(st("S42") + 1.0, boom(6.0, 65, 25, sub=0.9, crack=0.2), 0.35)
place(st("S42") + 1.0, sweep_noise(6.0, 120, 900, bw=0.7, peak=2.0), 0.08)

# ================================================================ EPILOGUE
bed(st("S43"), st("S44"), night_bed, 0.07, fi=1.5, fo=1.5)
bed(st("S43"), st("S44"), lambda d: wind(d, 200, 900, 0.2), 0.03, fi=1.5, fo=1.5)
pod = st("S43") + 10.0
whistle = engine(5.0, 300, 0.2, doppler=lambda t: 1.6 - 0.9 * t / 5)
place(pod, fades(whistle * np.linspace(0.2, 1, len(whistle)), 0.5, 0.05), 0.025, pan=0.6, pan_to=-0.3)
place(pod + 5.0, splash(4.0, 0.6), 0.12, pan=-0.3)
place(pod + 5.0, boom(3.0, 70, 35, sub=0.4, crack=0.2), 0.1, pan=-0.3)


def main():
    y = BUF[: int((TOTAL + 2) * SR)]
    y = signal.sosfilt(signal.butter(2, 20, "high", fs=SR, output="sos"), y, axis=0)
    peak = np.abs(y).max()
    print("sfx peak", peak)
    if peak > 0.95:
        y *= 0.95 / peak
    sf.write(os.path.join(OUT, "sfx.wav"), y.astype(np.float32), SR, subtype="FLOAT")


if __name__ == "__main__":
    main()
