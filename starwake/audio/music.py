"""STARWAKE -- original score.

Composed directly in seconds against the picture, written as a
16-channel General MIDI score and performed by FluidSynth with the
FluidR3 GM soundfont, then given a concert-hall acoustic.

Leitmotifs
  THEME  "Every star is a song"   D major, rising fifth then stepwise fall
  THRONE the Hollow Throne         Phrygian D - Eb - D - A over a 5/4 ostinato
  AURAI  the singers of Veyra      D Lydian: harp and celesta, G# shimmer
  LAMENT Asha's grief              descending cello line in D minor
"""
import os, random, subprocess
import numpy as np
import mido
import soundfile as sf
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "audio")
os.makedirs(OUT, exist_ok=True)
SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
SR = 48000
random.seed(7)

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def n(s):
    """'D4' -> 62, 'F#3' -> 54, 'Bb2' -> 46"""
    name = s[0].upper()
    acc = 0
    i = 1
    while i < len(s) and s[i] in "#b":
        acc += 1 if s[i] == "#" else -1
        i += 1
    return 12 * (int(s[i:]) + 1) + NOTE[name] + acc


def ns(txt):
    return [n(x) for x in txt.split()]


# channel map
STR_HI, STR_LO, TREM, HORN, BRASS, TBN, CHOIR, OOHS, HARP, DRUMS, TIMP, CELE, CELLO, SOLO, PIANO, BASS = range(16)
PROGRAMS = {STR_HI: 48, STR_LO: 49, TREM: 44, HORN: 60, BRASS: 61, TBN: 57, CHOIR: 52, OOHS: 53,
            HARP: 46, TIMP: 47, CELE: 8, CELLO: 42, SOLO: 40, PIANO: 116, BASS: 43}
PAN = {STR_HI: 44, STR_LO: 84, TREM: 36, HORN: 58, BRASS: 70, TBN: 80, CHOIR: 64, OOHS: 64,
       HARP: 30, TIMP: 64, CELE: 96, CELLO: 76, SOLO: 54, PIANO: 60, BASS: 90, DRUMS: 64}
VOL = {STR_HI: 100, STR_LO: 100, TREM: 88, HORN: 96, BRASS: 92, TBN: 96, CHOIR: 92, OOHS: 90,
       HARP: 92, TIMP: 110, CELE: 80, CELLO: 104, SOLO: 100, PIANO: 90, BASS: 104, DRUMS: 100}


class Score:
    def __init__(self):
        self.ev = []   # (t, prio, channel, msg-kwargs)

    def _add(self, t, prio, **kw):
        self.ev.append((max(t, 0.0), prio, kw))

    def prog(self, ch, program, t=0.0):
        self._add(t - 0.01, 0, type="program_change", channel=ch, program=program)

    def cc(self, ch, t, ctl, val):
        self._add(t, 1, type="control_change", channel=ch, control=ctl, value=int(np.clip(val, 0, 127)))

    def expr(self, ch, t0, t1, v0, v1, step=0.04):
        k = max(2, int((t1 - t0) / step))
        for i in range(k + 1):
            a = i / k
            self.cc(ch, t0 + (t1 - t0) * a, 11, v0 + (v1 - v0) * a)

    def note(self, ch, t, dur, pitch, vel, human=True):
        if human:
            t += random.uniform(-0.008, 0.008)
            vel += random.randint(-5, 5)
        vel = int(np.clip(vel, 1, 127))
        self._add(t, 3, type="note_on", channel=ch, note=int(pitch), velocity=vel)
        self._add(t + max(dur, 0.03), 2, type="note_off", channel=ch, note=int(pitch), velocity=0)

    def chord(self, ch, t, dur, pitches, vel, human=True):
        for i, p in enumerate(pitches):
            self.note(ch, t + (0.006 * i if human else 0), dur, p, vel, human)

    def melody(self, ch, t0, bpm, seq, vel, legato=0.98, octave=0, accent=None):
        """seq: list of (note-name or None, beats)"""
        spb = 60.0 / bpm
        t = t0
        for i, (nm, beats) in enumerate(seq):
            if nm:
                v = vel + (accent[i] if accent and i < len(accent) else 0)
                self.note(ch, t, beats * spb * legato, n(nm) + 12 * octave, v)
            t += beats * spb
        return t

    def roll(self, ch, t0, t1, pitch, v0, v1, rate=0.065):
        t = t0
        while t < t1:
            a = (t - t0) / max(t1 - t0, 1e-3)
            self.note(ch, t, rate * 1.4, pitch, v0 + (v1 - v0) * a)
            t += rate * random.uniform(0.9, 1.1)

    def arp(self, ch, t0, t1, pitches, step, vel, pattern=None):
        t, i = t0, 0
        seq = pattern or list(range(len(pitches)))
        while t < t1 - 1e-3:
            self.note(ch, t, step * 2.5, pitches[seq[i % len(seq)]], vel)
            t += step
            i += 1

    def gliss(self, ch, t0, dur, pitches, vel):
        for i, p in enumerate(pitches):
            self.note(ch, t0 + dur * i / len(pitches), dur * 1.5, p, vel)

    def cut(self, t):
        """Hard stop: all notes off everywhere (the moment of impact)."""
        for ch in range(16):
            self._add(t, 2, type="control_change", channel=ch, control=123, value=0)

    def write(self, path):
        mid = mido.MidiFile(ticks_per_beat=480)
        tr = mido.MidiTrack()
        mid.tracks.append(tr)
        tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
        for ch, p in PROGRAMS.items():
            tr.append(mido.Message("program_change", channel=ch, program=p, time=0))
        for ch in range(16):
            tr.append(mido.Message("control_change", channel=ch, control=7, value=VOL.get(ch, 100), time=0))
            tr.append(mido.Message("control_change", channel=ch, control=10, value=PAN.get(ch, 64), time=0))
            tr.append(mido.Message("control_change", channel=ch, control=11, value=110, time=0))
            tr.append(mido.Message("control_change", channel=ch, control=91, value=0, time=0))
            tr.append(mido.Message("control_change", channel=ch, control=93, value=0, time=0))
        ev = sorted(self.ev, key=lambda e: (e[0], e[1]))
        last = 0
        for t, _, kw in ev:
            tick = int(round(t * 960))
            kw = dict(kw)
            typ = kw.pop("type")
            tr.append(mido.Message(typ, time=max(0, tick - last), **kw))
            last = max(last, tick)
        mid.save(path)


S = Score()

# chord voicings
V = {
    "D":   (ns("D2 A2 D3"), ns("F#4 A4 D5")),
    "Dadd9": (ns("D2 A2 D3"), ns("F#4 A4 E5")),
    "Dmaj7": (ns("D2 A2 D3"), ns("F#4 A4 C#5")),
    "Dlyd": (ns("D2 A2 D3"), ns("F#4 A4 C#5 G#5")),
    "E/D": (ns("D2 A2 D3"), ns("E4 G#4 B4")),
    "F#m": (ns("F#2 C#3 F#3"), ns("F#4 A4 C#5")),
    "Bm":  (ns("B1 F#2 B2"), ns("F#4 B4 D5")),
    "Bm7": (ns("B1 F#2 B2"), ns("F#4 A4 D5")),
    "G":   (ns("G1 D2 G2"), ns("G4 B4 D5")),
    "Gmaj7": (ns("G1 D2 G2"), ns("F#4 B4 D5")),
    "Gm":  (ns("G1 D2 G2"), ns("G4 Bb4 D5")),
    "D/F#": (ns("F#1 D2 A2"), ns("F#4 A4 D5")),
    "A":   (ns("A1 E2 A2"), ns("E4 A4 C#5")),
    "Asus": (ns("A1 E2 A2"), ns("E4 A4 D5")),
    "Em":  (ns("E2 B2 E3"), ns("E4 G4 B4")),
    "A/C#": (ns("C#2 A2 E3"), ns("E4 A4 C#5")),
    "Dm":  (ns("D2 A2 D3"), ns("F4 A4 D5")),
    "Bb":  (ns("Bb1 F2 Bb2"), ns("F4 Bb4 D5")),
    "C":   (ns("C2 G2 C3"), ns("E4 G4 C5")),
    "F":   (ns("F1 C2 F2"), ns("F4 A4 C5")),
    "Eb":  (ns("Eb2 Bb2 Eb3"), ns("G4 Bb4 Eb5")),
    "A7":  (ns("A1 E2 A2"), ns("E4 G4 C#5")),
}


def pad(t, dur, name, vel=70, lo=True, hi=True, choir=False, choir_vel=None, brass=False, bvel=60):
    lo_n, hi_n = V[name]
    if lo:
        S.chord(STR_LO, t, dur, lo_n, vel)
    if hi:
        S.chord(STR_HI, t, dur, hi_n, vel - 4)
    if choir:
        S.chord(CHOIR, t, dur, [p - 12 for p in hi_n], choir_vel or vel - 8)
    if brass:
        S.chord(BRASS, t, dur, [p - 12 for p in hi_n], bvel)


def progression(t0, spc, names, **kw):
    t = t0
    for nm in names:
        pad(t, spc * 1.02, nm, **kw)
        t += spc
    return t


THEME_A = [("D5", 2), ("A4", 1), ("B4", 1), ("A4", 3), ("F#4", 1), ("G4", 2), ("F#4", 1), ("E4", 1), ("F#4", 4)]
THEME_B = [("D5", 2), ("E5", 1), ("F#5", 1), ("A5", 3), ("G5", 1), ("F#5", 1), ("E5", 1), ("D5", 1), ("C#5", 1), ("D5", 4)]
THEME_LYD = [("D5", 2), ("A4", 1), ("B4", 1), ("A4", 3), ("F#4", 1), ("G#4", 2), ("F#4", 1), ("E4", 1), ("F#4", 4)]
THEME_MIN = [("D5", 2), ("A4", 1), ("Bb4", 1), ("A4", 3), ("F4", 1), ("G4", 2), ("F4", 1), ("E4", 1), ("F4", 4)]
LAMENT = [("A3", 2), ("G3", 1), ("F3", 1), ("E3", 2), ("D3", 2), ("F3", 1), ("E3", 1), ("D3", 1), ("C#3", 1), ("D3", 4)]
AURAI = [("F#5", 2), ("G#5", 1), ("A5", 1), ("E5", 4), ("D5", 2), ("E5", 1), ("F#5", 1), ("C#5", 4)]


def boom(t, vel=120, tam=True):
    """Orchestral impact: timpani, low brass, bass drum, cymbal."""
    S.note(TIMP, t, 1.5, n("D2"), vel)
    S.note(TIMP, t + 0.005, 1.5, n("A1"), vel - 10)
    S.note(DRUMS, t, 2, 35, vel)
    S.note(DRUMS, t, 2, 36, vel - 10)
    if tam:
        S.note(DRUMS, t, 4, 49, vel - 15)
        S.note(DRUMS, t + 0.01, 4, 57, vel - 25)
    S.chord(TBN, t, 1.4, ns("D2 A2"), vel - 5)
    S.chord(BASS, t, 1.8, ns("D1 D2"), vel)


def taiko(t, vel=100):
    S.note(PIANO, t, 1.0, n("C3"), vel)
    S.note(PIANO, t + 0.005, 1.0, n("G2"), vel - 20)


def swell_cymbal(t0, t1, v1=90):
    S.roll(DRUMS, t0, t1, 51, 20, v1, rate=0.09)


def throne_ostinato(t0, t1, bpm, vel0, vel1, octave=0):
    eighth = 30.0 / bpm
    pat = ["D3", "D3", "D3", "Eb3", "D3", "D3", "D3", "C3", "D3", "Eb3"]
    t, i = t0, 0
    while t < t1 - 1e-3:
        a = (t - t0) / max(t1 - t0, 1e-3)
        v = vel0 + (vel1 - vel0) * a + (14 if i % 10 in (0, 5) else 0)
        p = n(pat[i % 10]) + 12 * octave
        S.note(CELLO, t, eighth * 0.8, p, v)
        S.note(BASS, t, eighth * 0.8, p - 12, v - 4)
        t += eighth
        i += 1


def throne_motif(t0, bpm, vel, octave=0):
    return S.melody(TBN, t0, bpm, [("D3", 2), ("Eb3", 1), ("D3", 1), ("A2", 4)], vel, octave=octave)


# =============================================================== C1  prologue 0-23
S.expr(STR_LO, 0, 7, 20, 100)
S.chord(STR_LO, 0.0, 14.2, ns("D2 A2 D3"), 64)
S.expr(STR_HI, 2.5, 9, 10, 95)
S.chord(STR_HI, 2.5, 11.7, ns("A4 E5"), 52)
S.chord(OOHS, 4.5, 9.8, ns("D4 F#4 A4"), 52)
for t, p in [(1.8, "A5"), (3.1, "E6"), (4.6, "F#6"), (6.0, "D6"), (7.9, "A6"), (9.4, "B5"), (11.2, "E6"), (12.8, "F#6")]:
    S.note(CELE, t, 2.5, n(p), 58)
S.prog(HORN, 60, 0)
S.melody(HORN, 6.4, 72, [("D4", 2), ("A3", 1), ("B3", 1), ("A3", 3.5)], 70)
S.chord(HARP, 5.8, 3, ns("D3 A3 F#4"), 50)
# the Hollow Throne darkens the harmony
S.expr(STR_LO, 14, 23, 90, 115)
for t, lo, hi, ch in [(14.0, "B1 B2", "F#4 B4", "B3 D4 F#4"), (17.0, "G1 G2", "G4 D5", "B3 D4 G4"), (20.0, "G1 G2", "G4 Bb4", "Bb3 D4 G4")]:
    S.chord(STR_LO, t, 3.1, ns(lo), 74)
    S.chord(STR_HI, t, 3.1, ns(hi), 62)
    S.chord(CHOIR, t, 3.1, ns(ch), 58)
S.chord(TBN, 20.0, 3.0, ns("G2 D3"), 52)
S.roll(TIMP, 20.6, 23.0, n("D2"), 30, 100)

# =============================================================== C2  the Starmaw feeds 23-51
throne_ostinato(23.0, 40.0, 96, 70, 102)
S.note(DRUMS, 23.0, 3, 49, 90)
boom(23.0, 110, tam=False)
for k in range(6):
    tb = 23.0 + k * 3.125
    S.note(TIMP, tb, 1.2, n("D2"), 88 + k * 4)
    taiko(tb, 90 + k * 5)
    taiko(tb + 1.875, 70 + k * 5)
throne_motif(26.1, 96, 96)
throne_motif(32.35, 96, 112, octave=-1)
S.melody(BRASS, 32.35, 96, [("D4", 2), ("Eb4", 1), ("D4", 1), ("A3", 4)], 92)
S.chord(CHOIR, 26.0, 7.0, ns("D3 A3"), 70)
S.chord(CHOIR, 33.0, 7.0, ns("D3 Eb3 A3"), 84)
S.expr(HORN, 32.0, 40.0, 40, 120)
S.chord(HORN, 32.0, 8.0, ns("D4 Eb4"), 90)
S.expr(TREM, 34.0, 48.5, 30, 127)
S.chord(TREM, 34.0, 14.5, ns("D5 Eb5 A5"), 88)
# the star dies
S.chord(BASS, 40.0, 11.0, ns("D1"), 90)
S.chord(STR_LO, 40.0, 8.5, ns("D2 Eb2"), 80)
for i, p in enumerate(["D5", "C5", "Bb4", "A4", "G4", "F4", "Eb4", "D4"]):
    S.note(CHOIR, 40.0 + i * 1.05, 1.3, n(p), 70 + i * 3)
S.roll(TIMP, 45.5, 48.5, n("D2"), 40, 115)
S.cut(48.5)
boom(48.5, 127)
S.chord(BASS, 48.52, 3.0, ns("D1"), 100)
S.chord(STR_LO, 48.52, 2.5, ns("D1 D2"), 70)

# =============================================================== C3  the galaxy goes dark 51-59
S.expr(OOHS, 51, 58, 90, 40)
S.chord(OOHS, 51.0, 7.5, ns("A3 D4"), 50)
S.chord(STR_HI, 51.5, 7.0, ns("D6 A6"), 34)
for i, p in enumerate(["D6", "A5", "F5", "D5", "A4"]):
    S.note(CELE, 51.5 + i * 1.3, 2.0, n(p), 50 - i * 5)

# =============================================================== C4  TITLE 59-69
S.expr(TREM, 59.0, 62.2, 30, 127)
S.chord(TREM, 59.0, 3.25, ns("A3 A4"), 90)
S.roll(TIMP, 60.4, 62.2, n("A1"), 30, 110)
S.expr(STR_HI, 59, 62.2, 110, 110)
T = 62.2
boom(T, 127)
S.chord(BRASS, T, 3.4, ns("D3 A3 D4 F#4"), 112)
S.chord(HORN, T, 3.4, ns("A3 D4 F#4"), 110)
S.chord(STR_LO, T, 6.8, ns("D2 A2 D3"), 110)
S.chord(CHOIR, T, 6.8, ns("D4 F#4 A4 D5"), 104)
S.gliss(HARP, T, 0.9, ns("D3 F#3 A3 D4 F#4 A4 D5 F#5 A5 D6"), 90)
S.melody(STR_HI, T, 72, THEME_A[:5], 108, octave=0)
S.melody(HORN, T + 0.02, 72, THEME_A[:5], 96, octave=-1)
S.chord(STR_HI, T + 5.0, 4.0, ns("A4 C#5 E5"), 84)
S.chord(STR_LO, T + 6.8, 3.0, ns("A1 E2 A2"), 80)
S.expr(STR_HI, T + 4, 69, 110, 30)
S.expr(STR_LO, T + 4, 69, 110, 30)
S.expr(CHOIR, T + 4, 69, 110, 20)

# =============================================================== C5  the Hollow Fleet 69-93
for ch in (STR_HI, STR_LO, CHOIR):
    S.expr(ch, 69.0, 69.2, 30, 105)
throne_ostinato(69.0, 82.0, 96, 58, 74)
for k in range(4):
    tb = 69.0 + k * 3.125
    S.note(TIMP, tb, 1.0, n("D2"), 70)
    taiko(tb, 72)
for t in (70.0, 71.2, 72.3, 73.4):
    S.chord(TBN, t, 0.5, ns("D2 Eb2"), 96)
    S.note(DRUMS, t, 1, 35, 90)
S.chord(STR_LO, 69.0, 13.0, ns("D2 A2"), 60)
S.chord(CHOIR, 76.0, 6.0, ns("D3 A3"), 54)
# Asha remembers (lament)
S.chord(STR_LO, 82.0, 11.5, ns("D2 A2 F3"), 52)
S.chord(STR_HI, 84.0, 9.5, ns("A4 D5"), 40)
S.melody(CELLO, 82.6, 66, LAMENT, 84)
for t, p in [(82.0, "D4"), (85.6, "F4"), (89.3, "A4"), (91.0, "E4")]:
    S.note(PIANO, t, 3, n(p), 48)
S.prog(PIANO, 0, 81.9)

# =============================================================== C6  orders, the jump 93-129
S.expr(STR_LO, 93, 94, 60, 100)
progression(93.0, 3.0, ["Dm", "Bb", "Gm", "A"], vel=54, hi=True)
for k in range(10):
    S.note(TIMP, 93.4 + k * 1.2, 0.8, n("D2"), 44)
S.chord(STR_LO, 105.0, 10.0, ns("D2 A2"), 60)
S.chord(STR_HI, 105.0, 10.0, ns("A4 D5"), 48)
t = 105.0
while t < 115.0:
    S.note(BASS, t, 0.2, n("D2"), 58)
    t += 0.25
# build to the jump
S.expr(BRASS, 115.0, 123.15, 30, 127)
S.chord(BRASS, 115.0, 8.2, ns("D3 A3 D4"), 90)
t, step = 115.0, 0.25
while t < 123.1:
    S.note(CELLO, t, step * 0.8, n("D3") if int((t - 115) / step) % 2 == 0 else n("A3"), 70 + (t - 115) * 5)
    step = max(0.09, step * 0.985)
    t += step
S.expr(TREM, 118.0, 123.15, 30, 120)
S.chord(TREM, 118.0, 5.2, ns("A4 D5 A5"), 90)
S.roll(TIMP, 121.0, 123.15, n("D2"), 40, 120)
boom(123.15, 124)
S.chord(HORN, 123.15, 1.2, ns("D4 A4"), 110)
S.expr(TREM, 123.2, 129.0, 60, 115)
S.chord(TREM, 123.2, 5.8, ns("D6 A6"), 70)
S.chord(OOHS, 124.0, 5.0, ns("A4 D5"), 60)
swell_cymbal(126.5, 129.0, 90)

S.prog(PIANO, 116, 150.0)   # back to taiko for the storm and the war

# =============================================================== C8  the Veil Reach 129-166
for ch in (STR_HI, STR_LO, CHOIR, HORN):
    S.expr(ch, 129.0, 129.3, 40, 100)
S.gliss(HARP, 129.0, 1.3, ns("D3 E3 F#3 G#3 A3 B3 C#4 D4 E4 F#4 G#4 A4 B4 C#5 D5 E5 F#5 G#5 A5"), 88)
S.note(DRUMS, 129.0, 3, 49, 80)
S.chord(STR_LO, 129.0, 16.0, ns("D2 A2 D3"), 70)
S.chord(STR_HI, 129.0, 8.0, ns("F#4 A4 C#5 G#5"), 64)
S.chord(CHOIR, 129.5, 8.0, ns("D4 A4 E5"), 70)
S.arp(CELE, 131.0, 166.0, ns("D5 A5 E6 G#5 F#5 A5 E6 C#6"), 60 / 66 / 2, 50)
lyd_t = S.melody(HORN, 133.2, 66, THEME_LYD, 84, octave=-1)
S.chord(STR_HI, 137.0, 3.64, ns("F#4 A4 C#5"), 58)
S.chord(STR_HI, 140.6, 3.64, ns("E4 G#4 B4"), 58)
S.chord(STR_LO, 145.0, 12.0, ns("D2 A2"), 58)
progression(145.0, 3.0, ["Dmaj7", "Bm7", "Gmaj7", "A"], vel=52, lo=False)
# the dive: rising
S.expr(TREM, 157.0, 166.0, 30, 124)
for i, p in enumerate(ns("A3 B3 C#4 D4 E4 F#4 G#4 A4 B4 C#5 D5 E5")):
    S.note(TREM, 157.0 + i * 0.75, 0.8, p, 80)
S.chord(CHOIR, 158.0, 8.0, ns("D4 A4"), 62)
S.expr(CHOIR, 158.0, 166.0, 40, 120)
S.roll(TIMP, 163.5, 166.0, n("A1"), 30, 108)
swell_cymbal(163.5, 166.0, 100)

# =============================================================== C9  the lanterntrees 166-180
T0 = 166.0
bpm = 80
spb = 60 / bpm
for ch in (STR_HI, STR_LO, CHOIR, HORN, BRASS):
    S.expr(ch, T0 - 0.05, T0, 110, 115)
S.note(DRUMS, T0, 4, 49, 100)
S.note(TIMP, T0, 1.5, n("D2"), 110)
S.melody(STR_HI, T0, bpm, THEME_A, 110, octave=0)
S.melody(HORN, T0, bpm, THEME_A, 100, octave=-1)
S.melody(SOLO, T0, bpm, THEME_A, 86, octave=1)
for i, name in enumerate(["D", "F#m", "G", "D/F#"]):
    tb = T0 + i * 4 * spb
    lo_n, hi_n = V[name]
    S.chord(STR_LO, tb, 4 * spb, lo_n, 96)
    S.chord(CHOIR, tb, 4 * spb, [p - 12 for p in hi_n], 90)
    S.chord(BRASS, tb, 4 * spb, [p - 12 for p in hi_n], 62)
    S.arp(HARP, tb, tb + 4 * spb, [p - 12 for p in lo_n] + [p for p in hi_n], spb / 2, 64)
    S.note(TIMP, tb, 1.2, lo_n[0] + 12 if lo_n[0] < n("D2") else lo_n[0], 84)
S.chord(STR_HI, 178.0, 2.0, ns("A5"), 100)
S.chord(CHOIR, 178.0, 2.0, ns("E4 A4 D5"), 88)
S.roll(TIMP, 178.4, 180.0, n("A1"), 40, 90)

# =============================================================== C10 the storm, the fall 180-193.5
S.cut(180.0)
for ch in (STR_HI, STR_LO, TREM, BRASS, TBN, CHOIR, HORN):
    S.expr(ch, 180.0, 180.05, 100, 110)
t = 180.0
while t < 183.3:
    k = int((t - 180.0) / 0.107)
    S.note(CELLO, t, 0.09, n("D3") if k % 2 == 0 else n("D2") + 12, 88)
    S.note(BASS, t, 0.09, n("D2"), 84)
    t += 0.107
for i, name in enumerate(["Dm", "Bb"]):
    S.chord(BRASS, 180.0 + i * 1.71, 0.4, [p - 12 for p in V[name][1]], 108)
    taiko(180.0 + i * 1.71, 110)
S.chord(TREM, 180.0, 3.35, ns("D6 Eb6"), 86)
boom(183.35, 127)
S.chord(BRASS, 183.35, 1.0, ns("D3 Eb3 A3 Bb3"), 120)
S.chord(HORN, 183.35, 1.0, ns("D4 Eb4 A4"), 120)
for i in range(40):
    S.note(TREM, 183.4 + i * 0.1, 0.12, n("D6") - i, 100 - i)
S.roll(TIMP, 184.5, 187.5, n("D2"), 70, 110)
S.chord(HORN, 185.0, 2.5, ns("D4 C4"), 100)
S.expr(TREM, 187.5, 191.9, 50, 127)
S.chord(TREM, 187.5, 4.4, ns("D4 Eb4 E4 F4 A5 Bb5"), 96)
S.chord(CHOIR, 187.5, 4.4, ns("D4 Eb4 A4"), 90)
S.chord(BASS, 187.5, 4.4, ns("D1"), 100)
S.cut(191.9)

# =============================================================== C11 night on Veyra 193.5-258.5
for ch in range(16):
    S.expr(ch, 193.4, 193.5, 110, 110)
S.expr(OOHS, 196.0, 202.0, 20, 90)
S.chord(OOHS, 196.0, 9.0, ns("A3 E4"), 46)
for t, p in [(197.5, "D6"), (199.8, "A5"), (202.6, "E6"), (204.4, "G#5")]:
    S.note(HARP, t, 3, n(p), 44)
# the Aurai emerge
S.arp(CELE, 205.5, 217.5, ns("D5 A5 E6 G#5 F#5 A5"), 0.42, 40)
S.expr(CHOIR, 206.5, 212.5, 20, 105)
S.chord(CHOIR, 206.5, 11.0, ns("D4 A4 E5 G#5"), 64)
S.chord(STR_LO, 207.0, 11.0, ns("D2 A2"), 48)
S.gliss(HARP, 211.0, 1.4, ns("D4 E4 F#4 G#4 A4 B4 C#5 D5 E5 F#5 G#5 A5"), 60)
# face to face
S.chord(STR_LO, 217.5, 14.0, ns("D2 A2"), 46)
S.chord(STR_HI, 217.5, 8.0, ns("F#4 A4 E5"), 40)
S.chord(STR_HI, 225.5, 5.5, ns("E4 G#4 B4"), 40)
S.prog(SOLO, 73, 217.0)
S.melody(SOLO, 225.0, 60, [("F#5", 1.5), ("G#5", .5), ("A5", 1), ("E5", 2.5)], 66)
# the walk: a world that sings to its star
progression(231.0, 3.25, ["D", "Bm7", "Gmaj7", "A"], vel=50, choir=True, choir_vel=44)
S.arp(HARP, 231.0, 244.0, ns("D3 A3 F#4 A4 D5 A4 F#4 A3"), 0.4, 46)
# Asha's confession: the lament
S.chord(STR_LO, 244.0, 10.0, ns("D2 A2 F3"), 48)
S.chord(STR_HI, 246.0, 8.0, ns("A4 D5"), 36)
S.melody(CELLO, 250.8, 70, [("A3", 1.5), ("G3", .5), ("F3", 1), ("E3", 1), ("D3", 2)], 80)
S.note(CELE, 253.4, 3, n("A5"), 56)
S.chord(STR_HI, 254.0, 4.5, ns("F#4 A4 D5"), 44)
S.chord(STR_LO, 254.0, 4.5, ns("D2 A2"), 46)
S.gliss(HARP, 256.0, 1.0, ns("D4 F#4 A4 D5 F#5 A5"), 50)

# =============================================================== C13 the chamber 258.5-276.5
S.prog(SOLO, 40, 258.0)
hymn = ["D", "A/C#", "Bm", "G", "D/F#", "Em", "A"]
t = 258.5
for i, nm in enumerate(hymn):
    lo_n, hi_n = V[nm]
    S.chord(CHOIR, t, 2.45, [p - 12 for p in hi_n], 58 + i * 4)
    S.chord(STR_LO, t, 2.45, lo_n, 50 + i * 4)
    t += 2.3
for tt, p in [(259.5, "A6"), (261.8, "F#6"), (264.2, "E6"), (266.9, "D6"), (269.0, "A6")]:
    S.note(CELE, tt, 2.5, n(p), 46)
S.expr(STR_HI, 270.5, 274.9, 30, 125)
S.chord(STR_HI, 270.5, 4.5, ns("E5 A5 C#6"), 84)
S.expr(BRASS, 271.5, 274.9, 20, 115)
S.chord(BRASS, 271.5, 3.4, ns("A3 E4 A4"), 80)
S.roll(TIMP, 272.8, 274.9, n("A1"), 30, 104)
swell_cymbal(272.5, 274.9, 90)
T = 274.9
S.chord(STR_HI, T, 1.8, ns("D5 F#5 A5 D6"), 110)
S.chord(CHOIR, T, 1.8, ns("D4 F#4 A4 D5"), 100)
S.chord(STR_LO, T, 1.8, ns("D2 A2 D3"), 100)
S.gliss(HARP, T, 0.8, ns("D4 F#4 A4 D5 F#5 A5 D6 F#6"), 88)
S.note(DRUMS, T, 3, 49, 90)
S.note(TIMP, T, 1.5, n("D2"), 100)

# =============================================================== C14 the vision 276.5-295.5
for ch in (STR_HI, STR_LO, CHOIR, BRASS):
    S.expr(ch, 276.4, 276.5, 110, 110)
S.expr(TREM, 276.5, 283.5, 30, 122)
S.chord(TREM, 276.5, 7.4, ns("D5 Eb5 E5 F5"), 90)
S.chord(CHOIR, 277.0, 7.0, ns("D3 Eb3 Ab3"), 76)
S.chord(BASS, 276.5, 12.0, ns("D1"), 84)
for k in range(9):
    S.note(TIMP, 276.8 + k * 0.8, 0.6, n("D2"), 70 + k * 4)
S.expr(TREM, 283.6, 284.1, 122, 0)
S.chord(STR_LO, 284.0, 4.6, ns("D2 A2 F3"), 56)
S.melody(SOLO, 284.2, 64, [("A5", 1.5), ("G5", .5), ("F5", 1), ("E5", 1), ("D5", 1.8)], 84)
# a song can break any cage
S.chord(STR_LO, 288.5, 7.0, ns("D2 A2 D3"), 54)
S.chord(STR_HI, 288.5, 7.0, ns("F#4 A4 D5"), 46)
S.melody(HORN, 290.0, 66, [("D4", 2), ("A3", 1), ("B3", 1), ("A3", 3)], 74)

# =============================================================== C16 the Starmaw arrives 295.5-319.5
S.roll(TIMP, 295.5, 296.7, n("D2"), 30, 110)
S.roll(BASS, 295.5, 296.7, n("D1"), 40, 100, rate=0.05)
boom(296.7, 127)
S.chord(TBN, 296.7, 3.0, ns("D2 Eb2 A2"), 124)
S.chord(BRASS, 296.7, 3.0, ns("D3 Eb3 A3"), 118)
S.chord(CHOIR, 296.7, 6.0, ns("D3 Eb3 A3"), 96)
throne_ostinato(297.5, 317.0, 96, 72, 96)
for k in range(7):
    tb = 297.5 + k * 3.125
    taiko(tb, 96)
    taiko(tb + 1.875, 76)
    S.note(TIMP, tb, 1.0, n("D2"), 84)
throne_motif(299.0, 96, 104)
throne_motif(305.25, 96, 112, octave=-1)
S.melody(BRASS, 305.25, 96, [("D4", 2), ("Eb4", 1), ("D4", 1), ("A3", 4)], 96)
S.expr(TREM, 309.0, 318.5, 30, 124)
S.chord(TREM, 309.0, 9.5, ns("D5 Eb5 A5 Bb5"), 90)
S.chord(CHOIR, 309.0, 9.5, ns("D4 Eb4 A4"), 80)
S.expr(TREM, 318.5, 319.5, 124, 0)

# =============================================================== C17 sing with us 319.5-341.5
for ch in (STR_HI, STR_LO, CHOIR, HORN, BRASS, OOHS):
    S.expr(ch, 319.4, 319.5, 110, 110)
S.expr(OOHS, 319.5, 325.5, 20, 110)
S.chord(OOHS, 319.5, 7.0, ns("D4 A4"), 64)
S.expr(CHOIR, 326.0, 341.0, 70, 127)
S.melody(CHOIR, 326.0, 62, THEME_A, 96)
S.melody(OOHS, 326.0, 62, THEME_A, 70, octave=-1)
spb = 60 / 62
for i, nm in enumerate(["D", "F#m", "G", "D/F#"]):
    tb = 326.0 + i * 4 * spb
    lo_n, hi_n = V[nm]
    S.chord(STR_LO, tb, 4 * spb, lo_n, 64 + i * 10)
    S.chord(STR_HI, tb, 4 * spb, hi_n, 54 + i * 10)
    S.arp(HARP, tb, tb + 4 * spb, [p - 12 for p in lo_n] + hi_n, spb / 2, 56 + i * 6)
S.roll(TIMP, 334.5, 337.0, n("A1"), 30, 112)
swell_cymbal(334.5, 337.0, 100)
T = 337.0
boom(T, 120)
S.melody(BRASS, T, 88, [("A4", 1), ("D5", 1), ("F#5", 1), ("A5", 3)], 116)
S.melody(HORN, T, 88, [("A3", 1), ("D4", 1), ("F#4", 1), ("A4", 3)], 110)
S.chord(STR_LO, T, 4.5, ns("D2 A2 D3"), 110)
S.chord(STR_HI, T + 2.0, 2.5, ns("D5 F#5 A5"), 104)
S.chord(CHOIR, T, 4.5, ns("D4 F#4 A4 D5"), 104)

# =============================================================== C18 battle 341.5-370.5
bpm = 132
spb = 60 / bpm
bar = 4 * spb
bars = int((370.5 - 341.5) / bar)
loop_min = ["Dm", "Bb", "C", "A"]
loop_maj = ["D", "G", "A", "D"]
ost = {"Dm": "D3 D3 F3 D3 G3 D3 F3 E3", "Bb": "Bb2 Bb2 D3 Bb2 F3 Bb2 D3 C3", "C": "C3 C3 E3 C3 G3 C3 E3 D3",
       "A": "A2 A2 C#3 A2 E3 A2 C#3 E3", "D": "D3 D3 F#3 D3 A3 D3 F#3 E3", "G": "G2 G2 B2 G2 D3 G2 B2 A2"}
for b in range(bars + 1):
    tb = 341.5 + b * bar
    if tb >= 370.5:
        break
    major = tb >= 364.0
    nm = (loop_maj if major else loop_min)[b % 4]
    for i, p in enumerate(ns(ost[nm])):
        S.note(CELLO, tb + i * spb / 2, spb / 2 * 0.8, p, 84 + (12 if i == 0 else 0))
        S.note(BASS, tb + i * spb / 2, spb / 2 * 0.8, p - 12, 80)
    lo_n, hi_n = V[nm]
    S.chord(STR_HI, tb, bar, hi_n, 70)
    S.chord(STR_LO, tb, bar, lo_n, 64)
    taiko(tb, 104)
    taiko(tb + 2 * spb, 88)
    S.note(TIMP, tb, 0.6, n("D2") if nm in ("Dm", "D") else lo_n[0] + 12, 90)
    S.note(DRUMS, tb + 3.5 * spb, 0.2, 38, 70)
    S.note(DRUMS, tb + 3.75 * spb, 0.2, 38, 80)
    if tb >= 352.5 and not major:
        S.chord(TBN, tb, spb * 1.5, [p for p in lo_n[:2]], 96)
S.melody(HORN, 343.3, bpm / 2, THEME_MIN, 100, octave=-1)
S.melody(BRASS, 353.0, bpm / 2, THEME_MIN[:5], 104, octave=-1)
S.note(DRUMS, 364.0, 3, 49, 110)
boom(364.0, 118)
S.melody(BRASS, 364.0, bpm / 2, THEME_A[:5], 118, octave=-1)
S.melody(HORN, 364.0, bpm / 2, THEME_A[:5], 112, octave=-1)
S.melody(STR_HI, 364.0, bpm / 2, THEME_A[:5], 104)
for t in (365.1, 365.8):
    S.note(DRUMS, t, 1.5, 35, 118)
    S.note(TIMP, t, 1.0, n("D2"), 110)

# =============================================================== C19 into the core 370.5-387.5
t, step = 370.5, 0.11
while t < 379.4:
    k = int((t - 370.5) / 0.11)
    S.note(CELLO, t, 0.09, ns("D3 A3 F3 A3")[k % 4], 86)
    S.note(BASS, t, 0.09, n("D2"), 80)
    t += step
S.expr(TREM, 370.5, 379.4, 40, 124)
for i, p in enumerate(ns("D4 E4 F4 G4 A4 Bb4 C5 D5 E5 F5 G5 A5")):
    S.note(TREM, 370.5 + i * 0.74, 0.8, p, 90)
for t in (370.5, 372.3, 374.1, 375.9, 377.7):
    S.chord(BRASS, t, 0.4, ns("D3 A3 D4"), 104)
    taiko(t, 100)
S.cut(379.45)
S.expr(STR_HI, 379.5, 379.6, 60, 90)
S.chord(STR_HI, 379.5, 5.0, ns("A5 D6"), 48)
S.chord(CHOIR, 379.8, 4.0, ns("D4 A4"), 46)
S.note(SOLO, 383.8, 1.6, n("A5"), 60)
S.expr(STR_HI, 384.6, 387.5, 40, 127)
S.chord(STR_HI, 384.6, 2.95, ns("A4 D5 A5"), 90)
S.expr(CHOIR, 384.6, 387.5, 40, 127)
S.chord(CHOIR, 384.6, 2.95, ns("A3 D4 A4"), 88)
S.gliss(HARP, 384.7, 1.2, ns("A3 D4 F#4 A4 D5 F#5 A5 D6"), 80)
S.roll(TIMP, 385.9, 387.5, n("A1"), 50, 122)
swell_cymbal(385.6, 387.5, 110)

# =============================================================== C20 STARWAKE 387.5-427.5
for ch in (STR_HI, STR_LO, CHOIR, HORN, BRASS, TBN, OOHS, SOLO):
    S.expr(ch, 387.45, 387.5, 110, 118)
T = 387.5
boom(T, 127)
S.chord(BRASS, T, 1.0, ns("D3 A3 D4 F#4"), 120)
bpm = 76
spb = 60 / bpm
T1 = 388.3
S.melody(STR_HI, T1, bpm, THEME_A + THEME_B, 112)
S.melody(HORN, T1, bpm, THEME_A + THEME_B, 104, octave=-1)
S.melody(CHOIR, T1, bpm, THEME_A + THEME_B, 96)
S.melody(SOLO, T1, bpm, THEME_A + THEME_B, 84, octave=1)
for i, nm in enumerate(["D", "F#m", "G", "D/F#", "Bm", "G", "A", "D"]):
    tb = T1 + i * 4 * spb
    lo_n, hi_n = V[nm]
    S.chord(STR_LO, tb, 4 * spb, lo_n, 104)
    S.chord(BRASS, tb, 4 * spb, [p - 12 for p in hi_n], 76)
    S.chord(OOHS, tb, 4 * spb, [p - 12 for p in hi_n], 78)
    S.chord(TBN, tb, 4 * spb, lo_n[1:], 70)
    S.arp(HARP, tb, tb + 4 * spb, [p - 12 for p in lo_n] + hi_n, spb / 2, 72)
    S.note(TIMP, tb, 1.2, n("D2") if nm in ("D", "D/F#") else n("A1"), 92)
    if i in (0, 4):
        S.note(DRUMS, tb, 4, 49, 104)
T2 = T1 + 32 * spb
S.expr(STR_HI, T2, 427.0, 110, 40)
S.expr(STR_LO, T2, 427.0, 110, 40)
S.expr(CHOIR, T2, 427.0, 110, 30)
S.chord(STR_LO, T2, 427.0 - T2, ns("D2 A2 D3"), 80)
S.chord(STR_HI, T2, 6.0, ns("F#4 A4 D5"), 70)
S.chord(STR_HI, T2 + 6, 427.0 - T2 - 6, ns("G4 B4 D5"), 62)
S.chord(CHOIR, T2, 427.0 - T2, ns("D4 F#4 A4"), 70)
S.melody(HORN, 418.0, 66, [("D4", 2), ("A3", 1), ("B3", 1), ("A3", 4)], 70)
for t, p in [(416.5, "A6"), (419.0, "F#6"), (421.5, "D6"), (424.0, "E6")]:
    S.note(CELE, t, 2.5, n(p), 50)

# =============================================================== C21 epilogue 427.5-447.5
for ch in (STR_HI, STR_LO, CHOIR, HORN):
    S.expr(ch, 427.4, 427.5, 100, 100)
S.prog(PIANO, 0, 427.0)
S.melody(PIANO, 427.8, 60, [("A4", 1.5), ("G4", .5), ("F4", 1), ("E4", 1.5), ("D4", 2)], 60)
S.chord(PIANO, 427.8, 3, ns("D3 A3"), 44)
t = progression(431.0, 2.25, ["Bb", "F", "C", "Gm"], vel=48, choir=False)
S.chord(STR_LO, t, 3.0, ns("A1 E2 A2"), 56)
S.chord(STR_HI, t, 3.0, ns("E4 A4 C#5"), 50)
S.arp(HARP, 437.5, 442.5, ns("D4 F#4 A4 D5 F#5 A5"), 0.28, 50)
for t, p in [(438.0, "A6"), (439.4, "F#6"), (440.8, "D6"), (441.9, "A5")]:
    S.note(CELE, t, 2.0, n(p), 52)
S.expr(STR_HI, 442.6, 445.5, 50, 115)
S.chord(STR_HI, 442.6, 5.0, ns("F#4 A4 D5 F#5"), 76)
S.chord(STR_LO, 442.6, 5.0, ns("D2 A2 D3"), 72)
S.expr(CHOIR, 442.6, 445.5, 40, 110)
S.chord(CHOIR, 442.6, 5.0, ns("D4 F#4 A4"), 70)
S.melody(HORN, 444.9, 66, [("D4", 1.5), ("A3", .75), ("B3", .75)], 72)

# =============================================================== C22 end title & credits 447.5-503.5
S.expr(TREM, 447.5, 450.9, 30, 127)
S.chord(TREM, 447.5, 3.4, ns("A3 A4 A5"), 90)
S.roll(TIMP, 448.8, 450.9, n("A1"), 30, 118)
swell_cymbal(448.6, 450.9, 110)
for ch in (STR_HI, STR_LO, CHOIR, HORN, BRASS, TBN, OOHS, SOLO):
    S.expr(ch, 450.85, 450.9, 110, 118)
T = 450.9
boom(T, 127)
bpm = 76
spb = 60 / bpm
S.melody(STR_HI, T, bpm, THEME_A + THEME_B, 110)
S.melody(HORN, T, bpm, THEME_A + THEME_B, 104, octave=-1)
S.melody(CHOIR, T, bpm, THEME_A + THEME_B, 90)
for i, nm in enumerate(["D", "F#m", "G", "D/F#", "Bm", "G", "A", "D"]):
    tb = T + i * 4 * spb
    lo_n, hi_n = V[nm]
    S.chord(STR_LO, tb, 4 * spb, lo_n, 100)
    S.chord(BRASS, tb, 4 * spb, [p - 12 for p in hi_n], 72)
    S.chord(TBN, tb, 4 * spb, lo_n[1:], 64)
    S.arp(HARP, tb, tb + 4 * spb, [p - 12 for p in lo_n] + hi_n, spb / 2, 66)
    S.note(TIMP, tb, 1.2, n("D2") if nm in ("D", "D/F#") else n("A1"), 88)
    if i in (0, 4):
        S.note(DRUMS, tb, 4, 49, 96)
T3 = T + 32 * spb   # ~476.2: the Aurai remember
S.prog(SOLO, 73, T3 - 0.2)
S.arp(CELE, T3, T3 + 14, ns("D5 A5 E6 G#5 F#5 A5 E6 C#6"), 60 / 66 / 2, 46)
S.melody(SOLO, T3 + 0.5, 66, AURAI, 76)
S.chord(STR_LO, T3, 14.0, ns("D2 A2 D3"), 60)
S.chord(STR_HI, T3, 7.0, ns("F#4 A4 C#5"), 54)
S.chord(STR_HI, T3 + 7, 7.0, ns("E4 G#4 B4"), 54)
S.chord(CHOIR, T3, 14.0, ns("D4 A4"), 52)
T4 = T3 + 14.0   # ~490: last phrase, home
S.prog(SOLO, 40, T4 - 0.2)
S.melody(STR_HI, T4, 70, THEME_B, 100)
S.melody(HORN, T4, 70, THEME_B, 94, octave=-1)
for i, nm in enumerate(["Bm", "G", "A", "D"]):
    tb = T4 + i * 4 * 60 / 70
    lo_n, hi_n = V[nm]
    S.chord(STR_LO, tb, 4 * 60 / 70, lo_n, 90)
    S.chord(CHOIR, tb, 4 * 60 / 70, [p - 12 for p in hi_n], 84)
    S.arp(HARP, tb, tb + 4 * 60 / 70, [p - 12 for p in lo_n] + hi_n, 60 / 70 / 2, 60)
TEND = T4 + 12 * 60 / 70
S.chord(STR_LO, TEND, 503.4 - TEND, ns("D2 A2 D3"), 96)
S.chord(STR_HI, TEND, 503.4 - TEND, ns("F#4 A4 D5 F#5"), 90)
S.chord(CHOIR, TEND, 503.4 - TEND, ns("D4 F#4 A4 D5"), 86)
S.chord(BRASS, TEND, 503.4 - TEND, ns("D3 A3 F#4"), 64)
S.note(TIMP, TEND, 2, n("D2"), 90)
S.note(DRUMS, TEND, 5, 49, 80)
for ch in (STR_LO, STR_HI, CHOIR, BRASS):
    S.expr(ch, TEND + 1, 503.4, 110, 0)


def hall_ir(seconds=3.4, decay=1.25, seed=3):
    rng = np.random.default_rng(seed)
    nn = int(seconds * SR)
    t = np.arange(nn) / SR
    ir = np.zeros((nn, 2))
    for c in range(2):
        noise = rng.standard_normal(nn)
        lo = signal.sosfilt(signal.butter(2, 1500, "low", fs=SR, output="sos"), noise)
        hi = noise - lo
        ir[:, c] = lo * np.exp(-t / decay) + 0.45 * hi * np.exp(-t / (decay * 0.3))
    pre = int(0.022 * SR)
    ir = np.vstack([np.zeros((pre, 2)), ir])
    ir[pre:pre + int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))[:, None]
    return ir / np.sqrt((ir ** 2).sum(axis=0).mean())


def main():
    mid = os.path.join(OUT, "score.mid")
    raw = os.path.join(OUT, "score_dry.wav")
    S.write(mid)
    subprocess.run(["fluidsynth", "-ni", "-q", "-F", raw, "-r", str(SR), "-g", "0.45",
                    "-R", "0", "-C", "0", "-o", "synth.polyphony=512", SF2, mid], check=True)
    x, sr = sf.read(raw)
    assert sr == SR
    # tame sub rumble, gentle air
    x = signal.sosfilt(signal.butter(2, 28, "high", fs=SR, output="sos"), x, axis=0)
    ir = hall_ir()
    wet = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)
    y = x * 0.72 + wet * 0.2
    y /= np.abs(y).max() / 0.89
    sf.write(os.path.join(OUT, "score.wav"), y.astype(np.float32), SR, subtype="FLOAT")
    print("score:", len(y) / SR, "s")


if __name__ == "__main__":
    main()
