"""Record the cast: synthesize every line with Kokoro, then give each
character their sonic treatment (pitch, radio, reverb, doubling).

Outputs build/voices/<ID>.wav (48 kHz stereo float) and
build/voices/durations.json (seconds, including processed tails).
"""
import json, os, subprocess, sys
import numpy as np
import soundfile as sf
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from script import CAST, LINES  # noqa: E402

OUT = os.path.join(ROOT, "build", "voices")
RAW = os.path.join(OUT, "raw")
SR = 48000
os.makedirs(RAW, exist_ok=True)


def trim(x, thr=0.004, pad=0.03, sr=SR):
    env = np.convolve(np.abs(x), np.ones(240) / 240, mode="same")
    idx = np.where(env > thr)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(pad * sr))
    b = min(len(x), idx[-1] + int(pad * sr * 2))
    return x[a:b]


def sox(inp, out, *effects):
    subprocess.run(["sox", inp, out, *effects], check=True, capture_output=True)


def impulse(seconds, decay, sr=SR, seed=0, bright=0.5):
    """Stereo synthetic hall impulse: decorrelated noise, exponential decay,
    high frequencies dying faster than lows."""
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    ir = np.zeros((n, 2))
    for c in range(2):
        noise = rng.standard_normal(n)
        lo = signal.sosfilt(signal.butter(2, 1800, "low", fs=sr, output="sos"), noise)
        hi = noise - lo
        ir[:, c] = lo * np.exp(-t / decay) + bright * hi * np.exp(-t / (decay * 0.35))
    # sparse early reflections
    for k in range(14):
        d = int(rng.uniform(0.008, 0.07) * sr)
        ir[d, rng.integers(2)] += rng.uniform(0.2, 0.6) * (1 - k / 14)
    ir[: int(0.004 * sr)] *= np.linspace(0, 1, int(0.004 * sr))[:, None]
    return ir / np.sqrt((ir ** 2).sum(axis=0).mean())


def reverb(dry, ir, wet):
    dry = np.atleast_2d(dry.T).T if dry.ndim == 1 else dry
    if dry.shape[1] == 1:
        dry = np.repeat(dry, 2, axis=1)
    pad = np.zeros((len(ir), 2))
    x = np.vstack([dry, pad])
    w = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)
    return x * (1 - wet * 0.35) + w * wet * 0.22


def radio(x, sr=SR, seed=1):
    rng = np.random.default_rng(seed)
    sos = signal.butter(4, [320, 3300], "band", fs=sr, output="sos")
    y = signal.sosfilt(sos, x * 2.2)
    y = np.tanh(y * 2.8) / np.tanh(2.8)
    # static bed + squelch clicks at head and tail
    hiss = signal.sosfilt(signal.butter(2, [1500, 6000], "band", fs=sr, output="sos"),
                          rng.standard_normal(len(y))) * 0.018
    crackle = (rng.random(len(y)) > 0.9994) * rng.standard_normal(len(y)) * 0.25
    lead = int(0.09 * sr)
    y = np.concatenate([np.zeros(lead), y, np.zeros(int(0.12 * sr))])
    bed = signal.sosfilt(signal.butter(2, [1200, 7000], "band", fs=sr, output="sos"),
                         rng.standard_normal(len(y))) * 0.03
    bed[:lead] *= np.linspace(0, 1, lead)
    y = y + bed
    y[: len(hiss)] += hiss + crackle
    for pos in (0, len(y) - int(0.06 * sr)):
        n = int(0.05 * sr)
        tt = np.arange(n) / sr
        y[pos:pos + n] += 0.12 * np.sin(2 * np.pi * 2400 * tt) * np.exp(-tt * 60)
    return y


def process(line_id, who, fx, raw_path):
    voice, _, semis = CAST[who]
    tmp = os.path.join(RAW, f"{line_id}_p.wav")
    effects = ["rate", str(SR)]
    if semis:
        effects = ["pitch", str(int(semis * 100)), "rate", str(SR)]
    sox(raw_path, tmp, *effects)
    x, _ = sf.read(tmp)
    x = trim(x)
    # gentle presence EQ + de-mud
    x = signal.sosfilt(signal.butter(2, 90, "high", fs=SR, output="sos"), x)

    if fx == "radio":
        y = radio(x, seed=hash(line_id) % 1000)
        y = reverb(y, impulse(0.5, 0.08, seed=3), 0.25)
    elif fx == "vo":
        y = reverb(x, impulse(3.2, 0.9, seed=7, bright=0.35), 0.55)
    elif fx == "near":
        y = reverb(x, impulse(1.2, 0.28, seed=11), 0.35)
    elif fx == "ai":
        # slightly glassy: tiny comb + band shelf, short room
        d = int(0.0045 * SR)
        z = x.copy()
        z[d:] += 0.35 * x[:-d]
        z = signal.sosfilt(signal.butter(2, [180, 7500], "band", fs=SR, output="sos"), z)
        y = reverb(z, impulse(0.6, 0.12, seed=5), 0.3)
    elif fx == "choir":
        tmp2 = os.path.join(RAW, f"{line_id}_oct.wav")
        sox(tmp, tmp2, "pitch", "-1200")
        lo, _ = sf.read(tmp2)
        lo = trim(lo)
        n = max(len(x), len(lo))
        mix = np.zeros(n)
        mix[: len(x)] += x
        mix[: len(lo)] += 0.33 * lo[:n]
        # detuned twin, slightly late, panned
        tmp3 = os.path.join(RAW, f"{line_id}_tw.wav")
        sox(tmp, tmp3, "pitch", "35")
        tw, _ = sf.read(tmp3)
        tw = trim(tw)
        st = np.zeros((n + int(0.03 * SR), 2))
        st[: n, 0] += mix
        st[: n, 1] += mix
        off = int(0.022 * SR)
        m = min(len(tw), n)
        st[off:off + m, 0] += 0.3 * tw[:m]
        st[off:off + m, 1] -= 0.1 * tw[:m]
        y = reverb(st, impulse(5.0, 1.6, seed=13, bright=0.5), 0.75)
    else:
        raise ValueError(fx)

    if y.ndim == 1:
        y = np.stack([y, y], axis=1)
    peak = np.abs(y).max()
    y = y / peak * 0.7
    # trim reverb tail noise floor
    env = np.abs(y).max(axis=1)
    end = np.where(env > 0.002)[0][-1] + 1
    y = y[:end]
    fade = min(len(y), int(0.05 * SR))
    y[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return y


def main(only=None):
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(ROOT, "models", "kokoro-v1.0.onnx"),
               os.path.join(ROOT, "models", "voices-v1.0.bin"))
    durations = {}
    dpath = os.path.join(OUT, "durations.json")
    if os.path.exists(dpath):
        durations = json.load(open(dpath))
    for line_id, who, fx, text, speed in LINES:
        if only and line_id not in only:
            continue
        voice, base_speed, _ = CAST[who]
        lang = "en-gb" if voice.startswith("b") else "en-us"
        samples, sr = k.create(text, voice=voice, speed=speed or base_speed, lang=lang)
        raw_path = os.path.join(RAW, f"{line_id}.wav")
        sf.write(raw_path, samples, sr)
        y = process(line_id, who, fx, raw_path)
        sf.write(os.path.join(OUT, f"{line_id}.wav"), y.astype(np.float32), SR, subtype="FLOAT")
        # speech-only duration (before reverb tail) is what the edit cares about
        durations[line_id] = round(len(trim(sf.read(raw_path)[0], sr=sr)) / sr, 3)
        print(f"{line_id:4s} {who:8s} {durations[line_id]:6.2f}s  {text[:60]}")
    json.dump(durations, open(dpath, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:] or None)
