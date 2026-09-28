"""STARWAKE -- final mix.

Places every recorded line on the timeline, ducks music and effects
under dialogue, glues the stems on a gentle bus compressor and writes
build/audio/mix.wav plus the subtitle track build/starwake.srt.
"""
import json, os, sys
import numpy as np
import soundfile as sf
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from timeline import SHOTS, TOTAL  # noqa: E402
from script import LINES  # noqa: E402

SR = 48000
A = os.path.join(ROOT, "build", "audio")
V = os.path.join(ROOT, "build", "voices")
N = int((TOTAL + 1.0) * SR)
TEXT = {lid: (who, txt) for lid, who, fx, txt, sp in LINES}


def load(path):
    x, sr = sf.read(path, always_2d=True)
    assert sr == SR, path
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    out = np.zeros((N, 2))
    m = min(N, len(x))
    out[:m] = x[:m]
    return out


def rms_env(x, attack=0.03, release=0.35):
    """Envelope follower on a mono signal."""
    a = np.abs(x)
    # decimate for speed
    hop = 240
    a = a[: len(a) // hop * hop].reshape(-1, hop).max(axis=1)
    ea, er = np.exp(-hop / (attack * SR)), np.exp(-hop / (release * SR))
    e = np.zeros_like(a)
    v = 0.0
    for i, s in enumerate(a):
        c = ea if s > v else er
        v = c * v + (1 - c) * s
        e[i] = v
    e = np.repeat(e, hop)
    return np.pad(e, (0, max(0, len(x) - len(e))))[: len(x)]


def compress(x, thresh_db=-18, ratio=2.2, attack=0.02, release=0.25, makeup_db=2.0):
    mono = np.abs(x).max(axis=1)
    e = rms_env(mono, attack, release)
    lvl = 20 * np.log10(e + 1e-9)
    over = np.maximum(lvl - thresh_db, 0)
    gain_db = -over * (1 - 1 / ratio) + makeup_db
    return x * (10 ** (gain_db / 20))[:, None]


def srt_time(t):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"


def main():
    durs = json.load(open(os.path.join(V, "durations.json")))
    dia = np.zeros((N, 2))
    subs = []
    windows = []
    for sid, s in SHOTS.items():
        for lid, off in s["lines"]:
            t = s["start"] + off
            x, sr = sf.read(os.path.join(V, f"{lid}.wav"), always_2d=True)
            k = int(t * SR)
            m = min(len(x), N - k)
            dia[k:k + m] += x[:m]
            who, txt = TEXT[lid]
            subs.append((t, t + durs[lid] + 0.35, who, txt))
            windows.append((t, t + durs[lid]))

    music = load(os.path.join(A, "score.wav"))
    sfx = load(os.path.join(A, "sfx.wav"))

    # levels (the stems are peak-normalised; these are the faders)
    dia *= 0.92
    music *= 0.62
    sfx *= 0.85

    # duck music and effects under the voices
    e = rms_env(np.abs(dia).max(axis=1), 0.05, 0.6)
    e = e / (np.percentile(e[e > 1e-4], 90) + 1e-9)
    duck = np.clip(e, 0, 1)
    music *= (1 - 0.58 * duck)[:, None]
    sfx *= (1 - 0.40 * duck)[:, None]

    # guarantee clearance: every line sits at least 9 dB over its background
    def db(a):
        return 20 * np.log10(np.sqrt(np.mean(a ** 2)) + 1e-12)
    extra = np.zeros(N)
    for a, b in windows:
        i, j = int(a * SR), int(b * SR)
        margin = db(dia[i:j]) - db(music[i:j] + sfx[i:j])
        if margin < 9.0:
            need = 9.0 - margin
            i0, j1 = max(0, i - int(0.25 * SR)), min(N, j + int(0.4 * SR))
            ramp = np.ones(j1 - i0)
            r = int(0.2 * SR)
            ramp[:r] = np.linspace(0, 1, r)
            ramp[-r:] = np.linspace(1, 0, r)
            extra[i0:j1] = np.maximum(extra[i0:j1], need * ramp)
    g = (10 ** (-extra / 20))[:, None]
    music *= g
    sfx *= g

    # voices sit forward: presence lift
    dia = dia + signal.sosfilt(signal.butter(2, [2000, 5000], "band", fs=SR, output="sos"), dia, axis=0) * 0.25

    mix = dia + music + sfx
    mix = compress(mix, thresh_db=-16, ratio=2.0, makeup_db=1.5)
    peak = np.abs(mix).max()
    mix *= 0.97 / peak
    sf.write(os.path.join(A, "mix.wav"), mix.astype(np.float32), SR, subtype="FLOAT")
    for name, stem in (("dialogue", dia), ("music_ducked", music), ("sfx_ducked", sfx)):
        sf.write(os.path.join(A, f"stem_{name}.wav"), (stem / (np.abs(stem).max() + 1e-9) * 0.9).astype(np.float32), SR, subtype="FLOAT")

    subs.sort()
    with open(os.path.join(ROOT, "build", "starwake.srt"), "w") as f:
        for i, (a, b, who, txt) in enumerate(subs, 1):
            f.write(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{txt}\n\n")
    print("mix peak normalised; lines:", len(subs), "length", N / SR)


if __name__ == "__main__":
    main()
