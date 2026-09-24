"""Mixing / mastering DSP in numpy + scipy. All buffers are float64 arrays shaped (N, 2)."""
from __future__ import annotations

import math
import subprocess

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000


def db(x: float) -> float:
    return 10.0 ** (x / 20.0)


def to_db(x: float) -> float:
    return 20.0 * math.log10(max(1e-12, x))


# ------------------------------------------------------------------ filters (RBJ cookbook biquads)
def _biquad(kind: str, f: float, sr: int, q: float = 0.7071, gain_db: float = 0.0) -> np.ndarray:
    f = min(f, sr * 0.45)
    w0 = 2 * math.pi * f / sr
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "bp":
        b = [alpha, 0, -alpha]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "peak":
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]; a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind in ("low", "high"):
        s = 1.0
        al = sw / 2 * math.sqrt((A + 1 / A) * (1 / s - 1) + 2)
        sA = 2 * math.sqrt(A) * al
        if kind == "low":
            b = [A * ((A + 1) - (A - 1) * cw + sA), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sA)]
            a = [(A + 1) + (A - 1) * cw + sA, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sA]
        else:
            b = [A * ((A + 1) + (A - 1) * cw + sA), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sA)]
            a = [(A + 1) - (A - 1) * cw + sA, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sA]
    else:
        raise ValueError(kind)
    b = np.array(b) / a[0]
    a = np.array(a) / a[0]
    return np.concatenate([b, a])[None, :]


def eq(x: np.ndarray, sr: int = SR, hp=None, lp=None, shelf=None, peaks=None, hp_order: int = 2) -> np.ndarray:
    sos = []
    if hp:
        sos.append(signal.butter(hp_order, hp, "hp", fs=sr, output="sos"))
    if lp:
        sos.append(signal.butter(2, min(lp, sr * 0.45), "lp", fs=sr, output="sos"))
    for kind, f, g in (shelf or []):
        sos.append(_biquad(kind, f, sr, gain_db=g))
    for f, g, q in (peaks or []):
        sos.append(_biquad("peak", f, sr, q=q, gain_db=g))
    if not sos:
        return x
    return signal.sosfilt(np.concatenate(sos, axis=0), x, axis=0)


def pan(x: np.ndarray, position: float, width: float = 1.0) -> np.ndarray:
    """Stereo width (M/S) then constant-power balance. position -1 (L) .. +1 (R)."""
    m = (x[:, 0] + x[:, 1]) * 0.5
    s = (x[:, 0] - x[:, 1]) * 0.5 * width
    ang = (max(-1.0, min(1.0, position)) + 1.0) * math.pi / 4.0
    gl, gr = math.cos(ang) * math.sqrt(2.0), math.sin(ang) * math.sqrt(2.0)
    return np.stack([(m + s) * gl, (m - s) * gr], axis=1)


def delay(x: np.ndarray, seconds: float, sr: int = SR) -> np.ndarray:
    n = int(round(seconds * sr))
    if n <= 0:
        return x
    out = np.zeros_like(x)
    out[n:] = x[:-n]
    return out


def echo(x: np.ndarray, t: float, feedback: float, mix: float, sr: int = SR, lp: float = 3500) -> np.ndarray:
    """Soft ping-pong echo (for distant piano/celesta)."""
    out = x.copy()
    tap = x
    for k in range(1, 6):
        tap = eq(delay(tap, t, sr), sr, lp=lp) * feedback
        tap = tap[:, ::-1]  # ping-pong
        out += tap * mix
    return out


# ------------------------------------------------------------------ reverb
def make_ir(sr: int = SR, rt60: float = 3.4, predelay_ms: float = 30.0, seed: int = 7,
            brightness: float = 0.5) -> np.ndarray:
    """Synthetic concert-hall impulse response: decorrelated stereo noise with frequency-dependent
    exponential decay (lows ring longer, highs die faster), a density build-up, sparse early
    reflections and a pre-delay. Returned normalised to unit energy per channel."""
    rng = np.random.default_rng(seed)
    length = rt60 * 1.3
    n = int(sr * length)
    nper = 1024
    out = []
    for ch in range(2):
        noise = rng.standard_normal(n)
        f, t, Z = signal.stft(noise, fs=sr, nperseg=nper, noverlap=nper * 3 // 4)
        # RT multiplier per frequency: warm hall (lows slightly longer, air absorption on highs)
        ff = np.maximum(f, 20.0)
        mult = np.interp(np.log10(ff), np.log10([20, 120, 400, 1500, 4000, 8000, 16000, 24000]),
                         [1.25, 1.2, 1.05, 1.0, 0.78 + 0.1 * brightness, 0.55 + 0.12 * brightness,
                          0.32 + 0.1 * brightness, 0.25])
        rt = rt60 * mult
        decay = np.exp(-6.9078 * t[None, :] / rt[:, None])
        # static tone of the diffuse field: gentle low-mid warmth, rolled-off top
        tone = np.interp(np.log10(ff), np.log10([20, 60, 250, 1000, 5000, 10000, 24000]),
                         [0.35, 0.8, 1.1, 1.0, 0.75 + 0.2 * brightness, 0.45 + 0.2 * brightness, 0.2])
        Z = Z * decay * tone[:, None]
        _, y = signal.istft(Z, fs=sr, nperseg=nper, noverlap=nper * 3 // 4)
        y = y[:n]
        # density build-up over ~70 ms
        tt = np.arange(n) / sr
        y *= np.clip(tt / 0.07, 0, 1) ** 1.5
        # early reflections (8..90 ms), each a softened click
        er = np.zeros(n)
        taps = sorted(rng.uniform(0.008, 0.09, 11))
        for k, tap in enumerate(taps):
            i = int(tap * sr)
            er[i] += (0.55 - 0.035 * k) * (1 if rng.random() > 0.5 else -1)
        er = signal.sosfilt(signal.butter(2, 5000 + 2000 * brightness, "lp", fs=sr, output="sos"), er)
        y = y / (np.sqrt(np.sum(y ** 2)) + 1e-12)
        er = er / (np.sqrt(np.sum(er ** 2)) + 1e-12) * 0.35
        out.append(y + er)
    ir = np.stack(out, axis=1)
    # slight cross-feed keeps the image stable while staying decorrelated
    ir = np.stack([ir[:, 0] + 0.12 * ir[:, 1], ir[:, 1] + 0.12 * ir[:, 0]], axis=1)
    pre = np.zeros((int(sr * predelay_ms / 1000.0), 2))
    ir = np.concatenate([pre, ir], axis=0)
    ir /= np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True)) + 1e-12
    return ir


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    n = x.shape[0]
    return np.stack([signal.oaconvolve(x[:, c], ir[:, c])[:n] for c in range(2)], axis=1)


# ------------------------------------------------------------------ dynamics
def compress(x: np.ndarray, sr: int = SR, threshold_db: float = -24.0, ratio: float = 2.0,
             attack_ms: float = 30.0, release_ms: float = 400.0, knee_db: float = 8.0,
             circular: bool = False) -> np.ndarray:
    """Feed-forward RMS bus compressor (soft knee). With circular=True the detector is warmed up on
    the end of the buffer so a loop's first sample sees the same state as its last."""
    hop = 32
    warm = 0
    src = x
    if circular:
        warm = min(len(x), int(sr * 4))
        src = np.concatenate([x[-warm:], x], axis=0)
    p = np.mean(src ** 2, axis=1)
    nb = len(p) // hop
    pb = p[: nb * hop].reshape(nb, hop).mean(axis=1)
    # 30 ms RMS integration
    a_rms = math.exp(-hop / (sr * 0.03))
    pb = signal.lfilter([1 - a_rms], [1, -a_rms], pb)
    lvl = 10 * np.log10(pb + 1e-12)
    over = lvl - threshold_db
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, over * (1 / ratio - 1),
                           (1 / ratio - 1) * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    ga = math.exp(-hop / (sr * attack_ms / 1000))
    gr_rel = math.exp(-hop / (sr * release_ms / 1000))
    sm = np.empty_like(gr)
    g = 0.0
    for i in range(len(gr)):
        target = gr[i]
        coef = ga if target < g else gr_rel
        g = target + (g - target) * coef
        sm[i] = g
    gain = np.repeat(10 ** (sm / 20), hop)
    if len(gain) < len(src):
        gain = np.concatenate([gain, np.full(len(src) - len(gain), gain[-1])])
    y = src * gain[:, None]
    return y[warm:]


def limit(x: np.ndarray, sr: int = SR, ceiling_db: float = -1.3, lookahead_ms: float = 5.0,
          release_ms: float = 150.0, circular: bool = False) -> np.ndarray:
    """Look-ahead true-peak limiter (4x oversampled detection)."""
    pad = int(sr * 0.5) if circular else 0
    src = np.concatenate([x[-pad:], x, x[:pad]], axis=0) if circular else x
    os = signal.resample_poly(src, 4, 1, axis=0)
    pk = np.max(np.abs(os), axis=1)
    pk = pk[: (len(pk) // 4) * 4].reshape(-1, 4).max(axis=1)
    if len(pk) < len(src):
        pk = np.concatenate([pk, np.zeros(len(src) - len(pk))])
    ceil = db(ceiling_db)
    req = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    if req.min() >= 1.0:
        return x
    la = max(1, int(sr * lookahead_ms / 1000))
    hold = int(sr * release_ms / 1000)
    # forward-looking min over [t, t+la] plus a hold of `hold` samples behind
    m = minimum_filter1d(req, size=la + hold + 1, origin=(hold - la) // 2, mode="nearest")
    # boxcar over [t-la, t]: every averaged value's window contains t => g(t) <= req(t)
    g = uniform_filter1d(m, size=la + 1, origin=la // 2, mode="nearest")
    g = np.minimum(g, req)
    y = src * g[:, None]
    return y[pad: pad + len(x)] if circular else y


# ------------------------------------------------------------------ loudness (ITU-R BS.1770-4)
def _k_weight(x: np.ndarray, sr: int) -> np.ndarray:
    if sr != 48000:
        x = signal.resample_poly(x, 48000, sr, axis=0)
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
    a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, -1.99004745483398, 0.99007225036621]
    y = signal.lfilter(b1, a1, x, axis=0)
    return signal.lfilter(b2, a2, y, axis=0)


def lufs(x: np.ndarray, sr: int = SR) -> float:
    y = _k_weight(x, sr)
    fs = 48000
    blk, hop = int(0.4 * fs), int(0.1 * fs)
    if len(y) < blk:
        return -70.0
    p = np.sum(y ** 2, axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    starts = np.arange(0, len(y) - blk + 1, hop)
    z = (c[starts + blk] - c[starts]) / blk
    l = -0.691 + 10 * np.log10(z + 1e-15)
    z1 = z[l > -70]
    if len(z1) == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(z1)) - 10
    z2 = z[(l > -70) & (l > rel)]
    return float(-0.691 + 10 * np.log10(np.mean(z2)))


def true_peak_db(x: np.ndarray) -> float:
    os = signal.resample_poly(x, 4, 1, axis=0)
    return to_db(float(np.max(np.abs(os))))


# ------------------------------------------------------------------ loops / resampling / io
def fold_loop(x: np.ndarray, start: int, length: int) -> np.ndarray:
    """Wrap a rendered timeline onto [start, start+length): everything before `start` (pre-roll,
    early humanised notes) lands at the end of the loop and everything after (sustains, releases,
    reverb tails) lands at the beginning, so the loop's end flows sample-accurately into its start."""
    out = np.zeros((length, x.shape[1]))
    k0 = -math.ceil(start / length)
    s = start + k0 * length
    while s < len(x):
        a, b = max(0, s), min(len(x), s + length)
        if b > a:
            out[a - s: b - s] += x[a:b]
        s += length
    return out


def resample(x: np.ndarray, sr_in: int, sr_out: int, periodic: bool = False) -> np.ndarray:
    if periodic:
        n_out = int(round(len(x) * sr_out / sr_in))
        return signal.resample(x, n_out, axis=0)
    g = math.gcd(sr_in, sr_out)
    return signal.resample_poly(x, sr_out // g, sr_in // g, axis=0)


def write_wav(path: str, x: np.ndarray, sr: int) -> None:
    from scipy.io import wavfile
    wavfile.write(path, sr, x.astype(np.float32))


def read_wav(path: str) -> tuple[int, np.ndarray]:
    import warnings
    from scipy.io import wavfile
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        sr, x = wavfile.read(path)
    x = x.astype(np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    return sr, x


def encode_ogg(wav_path: str, ogg_path: str, quality: int = 6) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path, "-c:a", "libvorbis",
                    "-q:a", str(quality), "-ar", "44100", "-ac", "2", ogg_path], check=True)


def ebur128(path: str) -> dict:
    """Integrated loudness, loudness range and true peak as measured by ffmpeg."""
    r = subprocess.run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-filter_complex",
                        "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    txt = r.stderr
    tail = txt[txt.rfind("Summary:"):]
    out = {}
    for line in tail.splitlines():
        line = line.strip()
        if line.startswith("I:"):
            out["I"] = float(line.split()[1])
        elif line.startswith("LRA:"):
            out["LRA"] = float(line.split()[1])
        elif line.startswith("Peak:"):
            out["TP"] = float(line.split()[1])
    return out
