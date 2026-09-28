"""The star song, hummed.

Four notes -- F#, A, E, D -- that a father teaches his daughter on the
night their sun is taken, that the Aurai hear still travelling in its
light twenty years later, and that Asha hums to the cage of stolen suns.

A small voice model: glottal pulse train with vibrato, portamento and
jitter, shaped by nasal 'mmm' formants, plus breath.
Writes build/voices/HUM_*.wav and adds them to durations.json.
"""
import json, os, sys
import numpy as np
import soundfile as sf
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "audio"))
from voices import impulse, reverb  # noqa: E402

SR = 48000
V = os.path.join(ROOT, "build", "voices")
STAR_SONG = [("F#4", 0.8), ("A4", 0.8), ("E5", 1.4), ("D5", 2.3)]
rng = np.random.default_rng(5)


def midi(name):
    base = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[name[0]]
    acc = name.count("#") - name.count("b")
    return 12 * (int(name[-1]) + 1) + base + acc


def hum(song, octave=0, tempo=1.0, formant=1.0, shake=0.0, breath=0.05, gain=1.0):
    notes = [(midi(nm) + 12 * octave, d * tempo) for nm, d in song]
    total = sum(d for _, d in notes) + 0.6
    nn = int(total * SR)
    t = np.arange(nn) / SR
    pitch = np.zeros(nn)
    amp = np.zeros(nn)
    tt = 0.0
    for i, (m, d) in enumerate(notes):
        a, b = int(tt * SR), int((tt + d) * SR)
        f = 440 * 2 ** ((m - 69) / 12)
        pitch[a:b] = f
        seg = np.arange(b - a) / SR
        env = np.minimum(seg / 0.08, 1) * np.minimum((d - seg) / 0.12 + 0.35, 1)
        amp[a:b] = np.maximum(env, 0) * (0.85 if i < len(notes) - 1 else 1.0)
        tt += d
    pitch[int(tt * SR):] = pitch[int(tt * SR) - 1]
    amp[int(tt * SR):] = amp[int(tt * SR) - 1] * np.exp(-np.arange(nn - int(tt * SR)) / SR * 6)
    # portamento
    k = int(0.07 * SR)
    pitch = np.convolve(np.pad(pitch, (k, k), mode="edge"), np.ones(k) / k, mode="same")[k:-k]
    # vibrato that grows into long notes, jitter, and a tremble when frightened
    vib = 1 + 0.012 * np.sin(2 * np.pi * 5.4 * t) * np.clip(t % 1.2 / 0.5, 0, 1)
    jit = 1 + 0.004 * signal.sosfilt(signal.butter(2, 8, "low", fs=SR, output="sos"), rng.standard_normal(nn)) * 20
    trem = 1 + shake * 0.03 * np.sin(2 * np.pi * 7.5 * t + 3 * np.sin(2 * np.pi * 0.7 * t))
    f = pitch * vib * jit * trem
    ph = 2 * np.pi * np.cumsum(f) / SR
    # glottal-ish source: rich harmonics falling off
    src = sum(np.sin(h * ph) / h ** 1.4 for h in range(1, 18))
    # nasal hum: strong low formant, gentle second, anti-resonance near 1 kHz
    y = np.zeros(nn)
    for fc, bw, g in ((270, 90, 1.0), (2100, 300, 0.12), (3000, 400, 0.05)):
        fc *= formant
        y += g * signal.sosfilt(signal.butter(2, [fc - bw / 2, fc + bw / 2], "band", fs=SR, output="sos"), src)
    y += 0.35 * signal.sosfilt(signal.butter(2, 700 * formant, "low", fs=SR, output="sos"), src)
    y *= amp
    br = signal.sosfilt(signal.butter(2, [800, 6000], "band", fs=SR, output="sos"), rng.standard_normal(nn)) * breath
    y += br * (0.3 + amp)
    return y / (np.abs(y).max() + 1e-9) * gain


def stereo(x, pan=0.0):
    L, R = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * L, x * R], axis=1) * np.sqrt(2)


def fit(*xs):
    n = max(len(x) for x in xs)
    return [np.pad(x, ((0, n - len(x)), (0, 0))) for x in xs]


def save(name, y):
    y = y / (np.abs(y).max() + 1e-9) * 0.7
    sf.write(os.path.join(V, f"{name}.wav"), y.astype(np.float32), SR, subtype="FLOAT")
    return round(len(y) / SR - 0.8, 3)


def main():
    durs = json.load(open(os.path.join(V, "durations.json")))
    # rooftop: the father hums, the child joins a beat late and a little unsure
    fa = stereo(hum(STAR_SONG, octave=-1, formant=0.85, breath=0.04), -0.15)
    ch = stereo(np.concatenate([np.zeros(int(0.35 * SR)), hum(STAR_SONG, octave=0, tempo=0.97, formant=1.35, breath=0.07, shake=0.3, gain=0.75)]), 0.15)
    fa, ch = fit(fa, ch)
    y = reverb(fa + ch, impulse(1.6, 0.35, seed=17, bright=0.25), 0.3)
    durs["HUM1"] = save("HUM1", y)
    # the child alone, fainter, as the sun goes out
    solo = stereo(hum(STAR_SONG, octave=0, tempo=1.1, formant=1.35, breath=0.1, shake=0.6, gain=0.6), 0.1)
    durs["HUM1b"] = save("HUM1b", reverb(solo, impulse(2.2, 0.6, seed=21, bright=0.2), 0.5))
    # Ilune: the song returned, pure, with the cathedral of roots around it
    il = hum(STAR_SONG, octave=0, tempo=1.15, formant=1.05, breath=0.03)
    il2 = hum(STAR_SONG, octave=-1, tempo=1.15, formant=0.95, breath=0.0, gain=0.3)
    il, il2 = fit(stereo(il, 0.1), stereo(il2, -0.1))
    durs["HUM2"] = save("HUM2", reverb(il + il2, impulse(4.5, 1.4, seed=13, bright=0.5), 0.65))
    # Asha at the cage: frightened, breaking, then steady on the last note
    a = stereo(hum(STAR_SONG, octave=0, tempo=1.2, formant=1.1, breath=0.09, shake=1.0), 0.0)
    durs["HUM3"] = save("HUM3", reverb(a, impulse(2.0, 0.5, seed=23, bright=0.3), 0.35))
    json.dump(durs, open(os.path.join(V, "durations.json"), "w"), indent=1)
    print({k: durs[k] for k in ("HUM1", "HUM1b", "HUM2", "HUM3")})


if __name__ == "__main__":
    main()
