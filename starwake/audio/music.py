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


# ---------------------------------------------------------------- themes
# THE STAR SONG: four notes a father teaches his daughter. Everything grows from it.
STAR = [("F#4", 1), ("A4", 1), ("E5", 2), ("D5", 4)]
# STARWAKE: the main theme -- the star song, then a heroic leap, then the star song home.
MAIN = [("F#4", 1), ("A4", 1), ("E5", 2),                    # the star song rises...
        ("D5", 3), ("A4", 1/3), ("B4", 1/3), ("C#5", 1/3),   # ...lands, triplet pickup
        ("D5", 1), ("E5", 1), ("B5", 2),                      # the leap
        ("A5", 4),
        ("G5", 1), ("F#5", 1), ("E5", 1), ("D5", 1),
        ("C#5", 2), ("B4", 1/3), ("C#5", 1/3), ("D5", 1/3), ("E5", 1),
        ("F#5", 1), ("A5", 1), ("E5", 2),                     # the star song again, an octave up
        ("D5", 4)]
MAIN_CH = ["Dadd9", "D", "G", "D/F#", "Em", "A", "Bm", "D"]   # one chord per bar
MAIN_MIN = [("F4", 1), ("A4", 1), ("E5", 2), ("D5", 3), ("A4", 1/3), ("Bb4", 1/3), ("C5", 1/3),
            ("D5", 1), ("E5", 1), ("Bb5", 2), ("A5", 4)]
AURAI = [("F#5", 2), ("G#5", 1), ("A5", 1), ("E5", 4), ("D5", 2), ("E5", 1), ("F#5", 1), ("C#5", 4)]
NIM = [("A5", .5), ("C#6", .5), ("E6", .5), ("D6", 1.5)]      # Nim's little giggle


def theme(t0, bpm, vel=104, bars=8, orch="full", octave=0):
    """The main theme with its harmony, orchestrated at one of several weights."""
    spb = 60 / bpm
    seq = MAIN
    if bars < 8:
        acc, out = 0, []
        for nm, bt in MAIN:
            if acc >= bars * 4 - 1e-6:
                break
            out.append((nm, bt))
            acc += bt
        seq = out
    S.melody(STR_HI, t0, bpm, seq, vel, octave=octave)
    if orch in ("full", "brass"):
        S.melody(HORN, t0, bpm, seq, vel - 6, octave=octave - 1)
    if orch == "full":
        S.melody(SOLO, t0, bpm, seq, vel - 20, octave=octave + 1)
        S.melody(CHOIR, t0, bpm, seq, vel - 12, octave=octave)
    if orch == "brass":
        S.melody(BRASS, t0, bpm, seq, vel, octave=octave - 1)
    for i in range(bars):
        tb = t0 + i * 4 * spb
        lo_n, hi_n = V[MAIN_CH[i]]
        S.chord(STR_LO, tb, 4 * spb, lo_n, vel - 14)
        if orch == "full":
            S.chord(BRASS, tb, 4 * spb, [p - 12 for p in hi_n], vel - 36)
            S.chord(OOHS, tb, 4 * spb, [p - 12 for p in hi_n], vel - 30)
            S.chord(TBN, tb, 4 * spb, lo_n[1:], vel - 40)
        S.arp(HARP, tb, tb + 4 * spb, [p - 12 for p in lo_n] + hi_n, spb / 2, vel - 40)
        S.note(TIMP, tb, 1.2, n("D2") if MAIN_CH[i] in ("D", "Dadd9", "D/F#") else n("A1"), vel - 20)
        if i in (0, 4) and orch == "full":
            S.note(DRUMS, tb, 4, 49, vel - 10)
    return t0 + bars * 4 * spb


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


def reset(t, chans=(STR_HI, STR_LO, CHOIR, HORN, BRASS, TBN, OOHS, SOLO, TREM, CELLO, BASS), v=110):
    for ch in chans:
        S.expr(ch, t - 0.05, t, v, v)


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


# =============================================================== PROLOGUE 0-23
S.expr(STR_LO, 0, 7, 20, 100)
S.chord(STR_LO, 0.0, 14.2, ns("D2 A2 D3"), 64)
S.expr(STR_HI, 2.5, 9, 10, 95)
S.chord(STR_HI, 2.5, 11.7, ns("A4 E5"), 52)
S.chord(OOHS, 4.5, 9.8, ns("D4 F#4 A4"), 52)
for t, p in [(1.8, "A5"), (3.1, "E6"), (4.6, "F#6"), (6.0, "D6"), (7.9, "A6"), (9.4, "B5"), (11.2, "E6"), (12.8, "F#6")]:
    S.note(CELE, t, 2.5, n(p), 58)
S.melody(HORN, 6.6, 66, STAR, 70, octave=-1)          # the star song, first heard, far away
S.chord(HARP, 5.8, 3, ns("D3 A3 F#4"), 50)
S.expr(STR_LO, 14, 23, 90, 115)
for t, lo, hi, ch in [(14.0, "B1 B2", "F#4 B4", "B3 D4 F#4"), (17.0, "G1 G2", "G4 D5", "B3 D4 G4"), (20.0, "G1 G2", "G4 Bb4", "Bb3 D4 G4")]:
    S.chord(STR_LO, t, 3.1, ns(lo), 74)
    S.chord(STR_HI, t, 3.1, ns(hi), 62)
    S.chord(CHOIR, t, 3.1, ns(ch), 58)
S.chord(TBN, 20.0, 3.0, ns("G2 D3"), 52)
S.roll(TIMP, 20.6, 23.0, n("D2"), 30, 100)

# =============================================================== the Starmaw feeds 23-40
throne_ostinato(23.0, 39.6, 96, 70, 100)
S.note(DRUMS, 23.0, 3, 49, 90)
boom(23.0, 110, tam=False)
for k in range(6):
    tb = 23.0 + k * 3.125
    if tb > 39:
        break
    S.note(TIMP, tb, 1.2, n("D2"), 88 + k * 4)
    taiko(tb, 90 + k * 5)
    taiko(tb + 1.875, 70 + k * 5)
throne_motif(26.1, 96, 96)
throne_motif(32.35, 96, 110, octave=-1)
S.melody(BRASS, 32.35, 96, [("D4", 2), ("Eb4", 1), ("D4", 1), ("A3", 4)], 90)
S.chord(CHOIR, 26.0, 7.0, ns("D3 A3"), 70)
S.chord(CHOIR, 33.0, 6.8, ns("D3 Eb3 A3"), 82)
S.expr(TREM, 34.0, 39.6, 30, 110)
S.chord(TREM, 34.0, 5.8, ns("D5 Eb5 A5"), 84)
S.cut(39.9)

# =============================================================== KESSAR, twenty years ago 40-81
reset(40.0)
S.expr(STR_LO, 40.0, 44.0, 30, 80)
S.chord(STR_LO, 40.0, 11.2, ns("D2 A2"), 50)
S.chord(STR_HI, 41.0, 10.0, ns("A5"), 36)
for k in range(5):
    S.note(HARP, 40.5 + k * 2.2, 3, n("D3"), 44)          # a distant bell, tolling
S.note(CELE, 47.4, 2.5, n("A5"), 40)
# the father speaks: warm, sad
S.chord(STR_LO, 51.0, 5.0, ns("D2 A2 D3"), 50)
S.chord(STR_HI, 51.0, 5.0, ns("F#4 A4"), 42)
S.chord(STR_LO, 56.0, 3.0, ns("B1 F#2 B2"), 48)
S.chord(STR_HI, 56.0, 3.0, ns("F#4 B4"), 40)
S.chord(STR_LO, 59.0, 2.8, ns("G1 D2 G2"), 46)
S.chord(STR_HI, 59.0, 2.8, ns("G4 B4"), 38)
# under the humming: only a held D, so the song stands alone
S.expr(STR_LO, 61.6, 68.0, 60, 40)
S.chord(STR_LO, 61.6, 7.0, ns("D2 A2"), 40)
S.chord(STR_HI, 63.5, 4.5, ns("D5"), 26)
# the sun goes out
S.chord(STR_LO, 68.2, 6.5, ns("D2 A2 F3"), 44)
throne_ostinato(69.5, 74.8, 80, 30, 60, octave=-1)
for i, p in enumerate(["A6", "F6", "D6", "A5", "F5", "D5"]):
    S.note(CELE, 69.2 + i * 0.9, 1.6, n(p), 44 - i * 3)
S.expr(TREM, 71.0, 75.0, 20, 115)
S.chord(TREM, 71.0, 4.1, ns("D5 Eb5 F5"), 80)
S.chord(CHOIR, 72.0, 3.1, ns("D4 F4 A4"), 70)
S.cut(75.1)
S.chord(BASS, 75.2, 5.0, ns("D1"), 70)
S.expr(STR_HI, 75.6, 81.0, 60, 0)
S.chord(STR_HI, 75.6, 5.4, ns("D6"), 50)              # one high thread of violin, fading into snow

# =============================================================== the cold spreads 81-100
reset(81.0)
progression(81.0, 2.75, ["Dm", "Bb", "Gm", "A"], vel=62, choir=True, choir_vel=56)
S.melody(CELLO, 81.5, 60, [("A3", 1.5), ("G3", .5), ("F3", 1), ("E3", 2), ("D3", 3)], 76)
progression(92.0, 2.0, ["Dm", "Bb", "C", "A"], vel=52, lo=True)
S.expr(TREM, 97.0, 100.0, 30, 127)
S.chord(TREM, 97.0, 3.1, ns("A3 A4"), 90)
S.roll(TIMP, 98.2, 100.0 + 3.2, n("A1"), 30, 110)
swell_cymbal(100.0, 103.2, 110)

# =============================================================== TITLE 100-110
T = 103.2
reset(T - 0.05)
boom(T, 127)
S.chord(BRASS, T, 3.4, ns("D3 A3 D4 F#4"), 112)
S.chord(STR_LO, T, 6.5, ns("D2 A2 D3"), 110)
S.chord(CHOIR, T, 6.5, ns("D4 F#4 A4 D5"), 104)
S.gliss(HARP, T, 0.9, ns("D3 F#3 A3 D4 F#4 A4 D5 F#5 A5 D6"), 90)
S.melody(BRASS, T, 72, MAIN[:4], 118, octave=-1)
S.melody(HORN, T, 72, MAIN[:4], 110, octave=-1)
S.melody(STR_HI, T, 72, MAIN[:4], 106)
S.expr(STR_HI, T + 4, 110, 110, 30)
S.expr(STR_LO, T + 4, 110, 110, 30)
S.expr(CHOIR, T + 4, 110, 110, 20)

# =============================================================== the Hollow Fleet 110-135
reset(110.0)
throne_ostinato(110.0, 123.0, 96, 56, 72)
for k in range(4):
    tb = 110.0 + k * 3.125
    S.note(TIMP, tb, 1.0, n("D2"), 70)
    taiko(tb, 72)
for t in (111.0, 112.2, 113.3, 114.4):
    S.chord(TBN, t, 0.5, ns("D2 Eb2"), 96)
    S.note(DRUMS, t, 1, 35, 90)
S.chord(STR_LO, 110.0, 13.0, ns("D2 A2"), 58)
# Asha remembers: the star song, on a lonely oboe
S.prog(SOLO, 68, 122.8)
S.chord(STR_LO, 123.0, 12.0, ns("D2 A2 F#3"), 48)
S.chord(STR_HI, 125.0, 10.0, ns("A4 D5"), 36)
S.melody(SOLO, 124.2, 56, STAR, 76)
S.melody(SOLO, 131.4, 56, [("F#4", 1), ("A4", 1), ("E5", 1.5)], 62)   # it doesn't resolve

# =============================================================== orders, the jump 135-171
S.prog(SOLO, 40, 134.8)
S.expr(STR_LO, 135, 136, 60, 100)
progression(135.0, 3.0, ["Dm", "Bb", "Gm", "A"], vel=54)
for k in range(10):
    S.note(TIMP, 135.4 + k * 1.2, 0.8, n("D2"), 44)
S.chord(STR_LO, 147.0, 10.0, ns("D2 A2"), 58)
S.chord(STR_HI, 147.0, 10.0, ns("A4 D5"), 46)
t = 147.0
while t < 157.0:
    S.note(BASS, t, 0.2, n("D2"), 56)
    t += 0.25
S.expr(BRASS, 157.0, 165.15, 30, 127)
S.chord(BRASS, 157.0, 8.2, ns("D3 A3 D4"), 90)
t, step = 157.0, 0.25
while t < 165.1:
    S.note(CELLO, t, step * 0.8, n("D3") if int((t - 157) / step) % 2 == 0 else n("A3"), 70 + (t - 157) * 5)
    step = max(0.09, step * 0.985)
    t += step
S.expr(TREM, 160.0, 165.15, 30, 120)
S.chord(TREM, 160.0, 5.2, ns("A4 D5 A5"), 90)
S.roll(TIMP, 163.0, 165.15, n("D2"), 40, 120)
boom(165.15, 124)
S.chord(HORN, 165.15, 1.2, ns("D4 A4"), 110)
S.expr(TREM, 165.2, 171.0, 60, 115)
S.chord(TREM, 165.2, 5.8, ns("D6 A6"), 70)
S.chord(OOHS, 166.0, 5.0, ns("A4 D5"), 60)

# =============================================================== her face, then the Veil Reach 171-214
# on her face: the music holds its breath
S.expr(TREM, 171.0, 177.0, 70, 40)
S.chord(TREM, 171.0, 6.0, ns("E6 A6"), 60)
S.arp(CELE, 172.0, 177.0, ns("E6 A6 E6 G#6"), 0.35, 40)
S.chord(OOHS, 172.0, 5.0, ns("A4 E5"), 52)
# the reveal
T = 177.0
reset(T - 0.05, (STR_HI, STR_LO, CHOIR, HORN))
S.gliss(HARP, T, 1.3, ns("D3 E3 F#3 G#3 A3 B3 C#4 D4 E4 F#4 G#4 A4 B4 C#5 D5 E5 F#5 G#5 A5"), 92)
S.note(DRUMS, T, 3, 49, 84)
S.note(TIMP, T, 1.5, n("D2"), 90)
S.chord(STR_LO, T, 16.0, ns("D2 A2 D3"), 74)
S.chord(STR_HI, T, 8.0, ns("F#4 A4 C#5 G#5"), 70)
S.chord(CHOIR, T + 0.3, 8.0, ns("D4 A4 E5"), 76)
S.chord(BRASS, T, 4.0, ns("D3 A3 E4"), 64)
S.arp(CELE, T + 1.0, 214.0, ns("D5 A5 E6 G#5 F#5 A5 E6 C#6"), 60 / 66 / 2, 50)
S.melody(HORN, T + 2.0, 60, STAR + [("C#5", 2), ("E5", 2), ("D5", 4)], 88, octave=-1)
S.chord(STR_HI, T + 8.0, 8.0, ns("E4 G#4 B4"), 58)
progression(193.0, 3.0, ["Dmaj7", "Bm7", "Gmaj7", "A"], vel=50, lo=True)
S.expr(TREM, 205.0, 214.0, 30, 124)
for i, p in enumerate(ns("A3 B3 C#4 D4 E4 F#4 G#4 A4 B4 C#5 D5 E5")):
    S.note(TREM, 205.0 + i * 0.75, 0.8, p, 80)
S.chord(CHOIR, 206.0, 8.0, ns("D4 A4"), 62)
S.expr(CHOIR, 206.0, 214.0, 40, 120)
S.roll(TIMP, 211.5, 214.0, n("A1"), 30, 108)
swell_cymbal(211.5, 214.0, 100)

# =============================================================== the lanterntrees 214-228
reset(213.95, (STR_HI, STR_LO, CHOIR, HORN, BRASS, TBN, OOHS, SOLO))
t_end = theme(214.0, 76, vel=108, bars=4, orch="full")
S.chord(STR_HI, t_end, 228.0 - t_end, ns("A5 E6"), 90)
S.chord(CHOIR, t_end, 228.0 - t_end, ns("E4 A4 D5"), 84)
S.roll(TIMP, t_end, 228.0, n("A1"), 40, 92)

# =============================================================== the storm, the fall 228-241.5
S.cut(228.0)
reset(228.0, (STR_HI, STR_LO, TREM, BRASS, TBN, CHOIR, HORN, CELLO, BASS))
t = 228.0
while t < 231.3:
    k = int((t - 228.0) / 0.107)
    S.note(CELLO, t, 0.09, n("D3") if k % 2 == 0 else n("D2") + 12, 88)
    S.note(BASS, t, 0.09, n("D2"), 84)
    t += 0.107
for i, name in enumerate(["Dm", "Bb"]):
    S.chord(BRASS, 228.0 + i * 1.71, 0.4, [p - 12 for p in V[name][1]], 108)
    taiko(228.0 + i * 1.71, 110)
S.chord(TREM, 228.0, 3.35, ns("D6 Eb6"), 86)
boom(231.35, 127)
S.chord(BRASS, 231.35, 1.0, ns("D3 Eb3 A3 Bb3"), 120)
S.chord(HORN, 231.35, 1.0, ns("D4 Eb4 A4"), 120)
for i in range(40):
    S.note(TREM, 231.4 + i * 0.1, 0.12, n("D6") - i, 100 - i)
S.roll(TIMP, 232.5, 235.5, n("D2"), 70, 110)
S.chord(HORN, 233.0, 2.5, ns("D4 C4"), 100)
S.expr(TREM, 235.5, 239.9, 50, 127)
S.chord(TREM, 235.5, 4.4, ns("D4 Eb4 E4 F4 A5 Bb5"), 96)
S.chord(CHOIR, 235.5, 4.4, ns("D4 Eb4 A4"), 90)
S.chord(BASS, 235.5, 4.4, ns("D1"), 100)
S.cut(239.9)

# =============================================================== night; Nim 241.5-288
for ch in range(16):
    S.expr(ch, 241.4, 241.5, 110, 110)
S.expr(OOHS, 244.0, 250.0, 20, 90)
S.chord(OOHS, 244.0, 9.0, ns("A3 E4"), 44)
for t, p in [(245.5, "D6"), (247.8, "A5"), (250.6, "E6")]:
    S.note(HARP, t, 3, n(p), 42)
# Nim: pizzicato curiosity, a flute that giggles
S.prog(SOLO, 73, 253.0)
S.prog(CELLO, 45, 253.0)
for t, p in [(253.8, "D4"), (254.3, "A3"), (256.0, "E4"), (256.4, "C#4"), (258.4, "F#4"), (258.8, "D4"), (261.0, "A4"), (261.4, "E4")]:
    S.note(CELLO, t, 0.3, n(p), 70)
S.melody(SOLO, 255.8, 150, NIM, 72)
S.melody(SOLO, 260.4, 150, NIM[:3] + [("A6", 1.5)], 76)
S.note(CELE, 257.0, 1.5, n("E6"), 50)
S.prog(CELLO, 42, 262.3)
# the Aurai emerge
S.arp(CELE, 262.5, 274.5, ns("D5 A5 E6 G#5 F#5 A5"), 0.42, 40)
S.expr(CHOIR, 263.5, 269.5, 20, 105)
S.chord(CHOIR, 263.5, 11.0, ns("D4 A4 E5 G#5"), 64)
S.chord(STR_LO, 264.0, 11.0, ns("D2 A2"), 48)
S.gliss(HARP, 268.0, 1.4, ns("D4 E4 F#4 G#4 A4 B4 C#5 D5 E5 F#5 G#5 A5"), 60)
S.chord(STR_LO, 274.5, 13.5, ns("D2 A2"), 44)
S.chord(STR_HI, 274.5, 8.0, ns("F#4 A4 E5"), 38)
S.chord(STR_HI, 282.5, 5.5, ns("E4 G#4 B4"), 38)
S.melody(SOLO, 282.2, 60, [("F#5", 1.5), ("G#5", .5), ("A5", 1), ("E5", 2.5)], 62)

# =============================================================== the song comes back 288-306.5
S.chord(STR_HI, 288.3, 6.8, ns("D6"), 24)              # a held breath while Ilune hums
S.expr(STR_LO, 295.4, 305.8, 30, 118)
S.expr(STR_HI, 295.4, 305.8, 30, 118)
S.expr(CHOIR, 297.0, 305.8, 20, 110)
t = 295.6
for nm, dur in [("D", 2.6), ("Bm", 2.6), ("G", 2.6), ("A", 1.6)]:
    lo_n, hi_n = V[nm]
    S.chord(STR_LO, t, dur * 1.02, lo_n, 70)
    S.chord(STR_HI, t, dur * 1.02, hi_n, 64)
    S.chord(CHOIR, t, dur * 1.02, [p - 12 for p in hi_n], 58)
    t += dur
S.melody(HORN, 297.4, 58, STAR, 78, octave=-1)
S.chord(STR_HI, 304.6, 2.2, ns("F#4 A4 D5 F#5"), 90)   # "a father, and a child"
S.chord(STR_LO, 304.6, 2.2, ns("D2 A2 D3"), 88)
S.gliss(HARP, 304.6, 1.0, ns("D4 F#4 A4 D5 F#5 A5"), 70)

# =============================================================== walk, confession 306.5-334
reset(306.4, (STR_HI, STR_LO, CHOIR))
progression(306.5, 3.25, ["D", "Bm7", "Gmaj7", "A"], vel=48, choir=True, choir_vel=42)
S.arp(HARP, 306.5, 319.5, ns("D3 A3 F#4 A4 D5 A4 F#4 A3"), 0.4, 44)
S.chord(STR_LO, 319.5, 10.0, ns("D2 A2 F3"), 46)
S.chord(STR_HI, 321.5, 8.0, ns("A4 D5"), 34)
S.prog(SOLO, 40, 318.0)
S.melody(CELLO, 326.8, 70, [("A3", 1.5), ("G3", .5), ("F3", 1), ("E3", 1), ("D3", 2)], 78)
S.note(CELE, 328.9, 3, n("A5"), 54)
S.chord(STR_HI, 329.5, 4.5, ns("F#4 A4 D5"), 42)
S.chord(STR_LO, 329.5, 4.5, ns("D2 A2"), 44)
S.gliss(HARP, 331.5, 1.0, ns("D4 F#4 A4 D5 F#5 A5"), 48)

# =============================================================== the chamber 334-352
hymn = ["D", "A/C#", "Bm", "G", "D/F#", "Em", "A"]
t = 334.0
for i, nm in enumerate(hymn):
    lo_n, hi_n = V[nm]
    S.chord(CHOIR, t, 2.45, [p - 12 for p in hi_n], 58 + i * 4)
    S.chord(STR_LO, t, 2.45, lo_n, 50 + i * 4)
    t += 2.3
for tt, p in [(335.0, "A6"), (337.3, "F#6"), (339.7, "E6"), (342.4, "D6"), (344.5, "A6")]:
    S.note(CELE, tt, 2.5, n(p), 46)
S.expr(STR_HI, 346.0, 350.4, 30, 125)
S.chord(STR_HI, 346.0, 4.5, ns("E5 A5 C#6"), 84)
S.expr(BRASS, 347.0, 350.4, 20, 115)
S.chord(BRASS, 347.0, 3.4, ns("A3 E4 A4"), 80)
S.roll(TIMP, 348.3, 350.4, n("A1"), 30, 104)
swell_cymbal(348.0, 350.4, 90)
T = 350.4
S.chord(STR_HI, T, 1.8, ns("D5 F#5 A5 D6"), 110)
S.chord(CHOIR, T, 1.8, ns("D4 F#4 A4 D5"), 100)
S.chord(STR_LO, T, 1.8, ns("D2 A2 D3"), 100)
S.gliss(HARP, T, 0.8, ns("D4 F#4 A4 D5 F#5 A5 D6 F#6"), 88)
S.note(DRUMS, T, 3, 49, 90)
S.note(TIMP, T, 1.5, n("D2"), 100)

# =============================================================== the vision 352-371
reset(351.95, (STR_HI, STR_LO, CHOIR, BRASS))
S.expr(TREM, 352.0, 359.0, 30, 122)
S.chord(TREM, 352.0, 7.4, ns("D5 Eb5 E5 F5"), 90)
S.chord(CHOIR, 352.5, 7.0, ns("D3 Eb3 Ab3"), 76)
S.chord(BASS, 352.0, 12.0, ns("D1"), 84)
for k in range(9):
    S.note(TIMP, 352.3 + k * 0.8, 0.6, n("D2"), 70 + k * 4)
S.expr(TREM, 359.1, 359.6, 122, 0)
S.chord(STR_LO, 359.5, 4.6, ns("D2 A2 F#3"), 56)
S.melody(SOLO, 359.7, 60, STAR, 84, octave=1)          # the star song, on one violin: that's my sun
S.chord(STR_LO, 364.0, 7.0, ns("D2 A2 D3"), 54)
S.chord(STR_HI, 364.0, 7.0, ns("F#4 A4 D5"), 46)
S.melody(HORN, 365.6, 66, STAR[:3], 76, octave=-1)

# =============================================================== the Starmaw arrives 371-395
S.roll(TIMP, 371.0, 372.2, n("D2"), 30, 110)
S.roll(BASS, 371.0, 372.2, n("D1"), 40, 100, rate=0.05)
boom(372.2, 127)
S.chord(TBN, 372.2, 3.0, ns("D2 Eb2 A2"), 124)
S.chord(BRASS, 372.2, 3.0, ns("D3 Eb3 A3"), 118)
S.chord(CHOIR, 372.2, 6.0, ns("D3 Eb3 A3"), 96)
throne_ostinato(373.0, 393.0, 96, 72, 96)
for k in range(6):
    tb = 373.0 + k * 3.125
    taiko(tb, 96)
    taiko(tb + 1.875, 76)
    S.note(TIMP, tb, 1.0, n("D2"), 84)
throne_motif(374.5, 96, 104)
throne_motif(380.75, 96, 112, octave=-1)
S.melody(BRASS, 380.75, 96, [("D4", 2), ("Eb4", 1), ("D4", 1), ("A3", 4)], 96)
S.expr(TREM, 385.0, 394.0, 30, 124)
S.chord(TREM, 385.0, 9.0, ns("D5 Eb5 A5 Bb5"), 90)
S.chord(CHOIR, 385.0, 9.0, ns("D4 Eb4 A4"), 80)
S.expr(TREM, 394.0, 395.0, 124, 0)

# =============================================================== sing with us; the fighter rises 395-417
reset(394.95, (STR_HI, STR_LO, CHOIR, HORN, BRASS, OOHS))
S.expr(OOHS, 395.0, 401.0, 20, 110)
S.chord(OOHS, 395.0, 7.0, ns("D4 A4"), 64)
S.expr(CHOIR, 402.4, 417.0, 70, 127)
theme(402.4, 64, vel=96, bars=4, orch="strings")
S.melody(CHOIR, 402.4, 64, MAIN[:13], 96)
S.roll(TIMP, 410.3, 412.5, n("A1"), 30, 112)
swell_cymbal(410.3, 412.5, 100)
T = 412.5
boom(T, 120)
S.melody(BRASS, T, 88, [("A4", 1/3), ("B4", 1/3), ("C#5", 1/3), ("D5", 1), ("E5", 1), ("B5", 2), ("A5", 3)], 118)
S.melody(HORN, T, 88, [("A3", 1/3), ("B3", 1/3), ("C#4", 1/3), ("D4", 1), ("E4", 1), ("B4", 2), ("A4", 3)], 110)
S.chord(STR_LO, T, 4.5, ns("G1 D2 G2"), 110)
S.chord(STR_LO, T + 3.0, 1.5, ns("D2 A2 D3"), 110)
S.chord(CHOIR, T, 4.5, ns("D4 G4 B4 D5"), 104)

# =============================================================== the march 417-446.5
bpm = 132
spb = 60 / bpm
bar = 4 * spb
ost = {"Dm": "D3 D3 F3 D3 G3 D3 F3 E3", "Bb": "Bb2 Bb2 D3 Bb2 F3 Bb2 D3 C3", "C": "C3 C3 E3 C3 G3 C3 E3 D3",
       "A": "A2 A2 C#3 A2 E3 A2 C#3 E3", "D": "D3 D3 F#3 D3 A3 D3 F#3 E3", "G": "G2 G2 B2 G2 D3 G2 B2 A2"}
loop_min = ["Dm", "Bb", "C", "A"]
loop_maj = ["D", "G", "A", "D"]
b = 0
while True:
    tb = 417.0 + b * bar
    if tb >= 446.4:
        break
    major = tb >= 440.6
    nm = (loop_maj if major else loop_min)[b % 4]
    for i, p in enumerate(ns(ost[nm])):
        S.note(CELLO, tb + i * spb / 2, spb / 2 * 0.8, p, 84 + (12 if i == 0 else 0))
        S.note(BASS, tb + i * spb / 2, spb / 2 * 0.8, p - 12, 80)
    lo_n, hi_n = V[nm]
    S.chord(STR_HI, tb, bar, hi_n, 66)
    S.chord(STR_LO, tb, bar, lo_n, 62)
    taiko(tb, 100)
    taiko(tb + 2 * spb, 84)
    S.note(TIMP, tb, 0.6, n("D2") if nm in ("Dm", "D") else lo_n[0] + 12, 90)
    # the snare: a march
    for k, v in ((0, 70), (1.5, 60), (2, 74), (3, 66), (3.5, 60), (3.75, 72)):
        S.note(DRUMS, tb + k * spb, 0.15, 38, v)
    if tb >= 428.8 and not major:
        S.chord(TBN, tb, spb * 1.5, lo_n[:2], 96)
    b += 1
# Asha's march: the theme in dotted brass rhythm, minor, defiant
S.melody(HORN, 419.0, bpm / 2, MAIN_MIN[:8], 100, octave=-1)
S.melody(BRASS, 429.4, bpm / 2, MAIN_MIN, 104, octave=-1)
# Jax! the major-key fanfare
S.note(DRUMS, 440.6, 3, 49, 112)
boom(440.6, 118)
S.melody(BRASS, 440.6, bpm / 2, MAIN[:11], 118, octave=-1)
S.melody(HORN, 440.6, bpm / 2, MAIN[:11], 112, octave=-1)
S.melody(STR_HI, 440.6, bpm / 2, MAIN[:11], 104)
for t in (441.1, 441.8):
    S.note(DRUMS, t, 1.5, 35, 118)
    S.note(TIMP, t, 1.0, n("D2"), 110)

# =============================================================== into the core 446.5-476.2
t, step = 446.5, 0.11
while t < 455.4:
    k = int((t - 446.5) / 0.11)
    S.note(CELLO, t, 0.09, ns("D3 A3 F3 A3")[k % 4], 86)
    S.note(BASS, t, 0.09, n("D2"), 80)
    t += step
S.expr(TREM, 446.5, 455.4, 40, 124)
for i, p in enumerate(ns("D4 E4 F4 G4 A4 Bb4 C5 D5 E5 F5 G5 A5")):
    S.note(TREM, 446.5 + i * 0.74, 0.8, p, 90)
for t in (446.5, 448.3, 450.1, 451.9, 453.7):
    S.chord(BRASS, t, 0.4, ns("D3 A3 D4"), 104)
    taiko(t, 100)
S.cut(455.45)
reset(455.5, (STR_HI, STR_LO, CHOIR, OOHS, HORN, SOLO))
S.chord(STR_HI, 455.5, 5.0, ns("A5 D6"), 44)
# "Remember me?" -- silence -- she hums, and the caged suns answer each note
for t_on, name, dur in ((462.5, "D", 1.0), (463.46, "F#m", 1.0), (464.42, "A", 1.7), (466.1, "D", 4.0)):
    lo_n, hi_n = V[name]
    S.expr(STR_HI, t_on, t_on + 0.6, 30, 80 + (30 if t_on > 466 else 0))
    S.chord(STR_HI, t_on, dur, hi_n, 60 + (25 if t_on > 466 else 0))
    S.chord(OOHS, t_on, dur, [p - 12 for p in hi_n], 50 + (25 if t_on > 466 else 0))
    S.note(CELE, t_on, 2.0, hi_n[-1] + 12, 56)
S.expr(CHOIR, 466.1, 470.0, 40, 120)
S.chord(CHOIR, 466.1, 4.5, ns("D4 F#4 A4 D5"), 80)
S.chord(STR_LO, 466.1, 6.0, ns("D2 A2 D3"), 80)
S.note(SOLO, 470.2, 1.4, n("A5"), 56)
# the Heartseed flies
S.expr(STR_HI, 473.3, 476.2, 40, 127)
S.chord(STR_HI, 473.3, 2.95, ns("A4 D5 A5"), 90)
S.expr(CHOIR, 473.3, 476.2, 40, 127)
S.chord(CHOIR, 473.3, 2.95, ns("A3 D4 A4"), 88)
S.gliss(HARP, 473.4, 1.2, ns("A3 D4 F#4 A4 D5 F#5 A5 D6"), 80)
S.roll(TIMP, 474.6, 476.2, n("A1"), 50, 122)
swell_cymbal(474.3, 476.2, 110)

# =============================================================== STARWAKE 476.2-516.2
reset(476.15, (STR_HI, STR_LO, CHOIR, HORN, BRASS, TBN, OOHS, SOLO))
boom(476.2, 127)
S.chord(BRASS, 476.2, 1.0, ns("D3 A3 D4 F#4"), 120)
t_end = theme(477.0, 76, vel=112, bars=8, orch="full")
# Kessar rekindles: the father's song, warm and whole
S.expr(STR_HI, t_end, 516.0, 110, 50)
S.expr(STR_LO, t_end, 516.0, 110, 50)
S.chord(STR_LO, t_end, 516.0 - t_end, ns("D2 A2 D3"), 76)
S.chord(STR_HI, t_end, 6.0, ns("F#4 A4 D5"), 66)
S.chord(STR_HI, t_end + 6, 516.0 - t_end - 6, ns("G4 B4 D5"), 60)
S.chord(CHOIR, t_end, 516.0 - t_end, ns("D4 F#4 A4"), 66)
S.melody(HORN, 506.0, 60, STAR, 80, octave=-1)
for t, p in [(505.0, "A6"), (507.5, "F#6"), (510.0, "D6"), (512.5, "E6")]:
    S.note(CELE, t, 2.5, n(p), 50)

# =============================================================== the rooftop, at dawn 516.2-526.2
reset(516.1, (STR_HI, STR_LO, CHOIR))
S.prog(PIANO, 0, 516.0)
S.chord(STR_LO, 516.2, 10.0, ns("D2 A2 D3"), 50)
S.chord(STR_HI, 517.0, 9.2, ns("F#4 A4"), 42)
S.melody(PIANO, 517.4, 58, STAR, 64, octave=1)         # the child's song, simply, once more
S.chord(PIANO, 517.4, 4, ns("D3 A3"), 44)
S.chord(PIANO, 521.5, 4, ns("D3 F#3 A3"), 42)

# =============================================================== epilogue 526.2-550.2
S.melody(PIANO, 526.5, 60, [("A4", 1.5), ("G4", .5), ("F#4", 1), ("E4", 1.5), ("D4", 2)], 56)
t = progression(529.8, 2.25, ["Bm", "G", "D", "A"], vel=46)
S.gliss(HARP, 540.0, 1.2, ns("D4 F#4 A4 D5 F#5 A5 D6 F#6"), 62)    # Nim: look!
S.arp(CELE, 540.2, 544.2, ns("D6 A6 F#6 A6"), 0.25, 48)
S.expr(STR_HI, 544.8, 547.5, 50, 115)
S.chord(STR_HI, 544.8, 5.0, ns("F#4 A4 D5 F#5"), 76)
S.chord(STR_LO, 544.8, 5.0, ns("D2 A2 D3"), 72)
S.expr(CHOIR, 544.8, 547.5, 40, 110)
S.chord(CHOIR, 544.8, 5.0, ns("D4 F#4 A4"), 70)
S.prog(SOLO, 73, 545.5)
S.melody(SOLO, 546.7, 150, NIM, 70)
S.melody(HORN, 547.6, 60, STAR, 74, octave=-1)

# =============================================================== end title & credits 550.2-606.2
S.expr(TREM, 550.2, 553.6, 30, 127)
S.chord(TREM, 550.2, 3.4, ns("A3 A4 A5"), 90)
S.roll(TIMP, 551.5, 553.6, n("A1"), 30, 118)
swell_cymbal(551.3, 553.6, 110)
reset(553.55, (STR_HI, STR_LO, CHOIR, HORN, BRASS, TBN, OOHS, SOLO))
S.prog(SOLO, 40, 553.0)
boom(553.6, 127)
t_end = theme(553.6, 76, vel=110, bars=8, orch="full")
T3 = t_end
S.prog(SOLO, 73, T3 - 0.2)
S.arp(CELE, T3, T3 + 13, ns("D5 A5 E6 G#5 F#5 A5 E6 C#6"), 60 / 66 / 2, 46)
S.melody(SOLO, T3 + 0.5, 66, AURAI, 76)
S.chord(STR_LO, T3, 13.0, ns("D2 A2 D3"), 60)
S.chord(STR_HI, T3, 6.5, ns("F#4 A4 C#5"), 54)
S.chord(STR_HI, T3 + 6.5, 6.5, ns("E4 G#4 B4"), 54)
S.chord(CHOIR, T3, 13.0, ns("D4 A4"), 52)
T4 = T3 + 13.0
S.prog(SOLO, 40, T4 - 0.2)
S.melody(STR_HI, T4, 60, STAR, 96)
S.melody(HORN, T4, 60, STAR, 90, octave=-1)
S.melody(CHOIR, T4, 60, STAR, 84)
for i, nm in enumerate(["Bm", "G", "A", "D"]):
    tb = T4 + i * 2.0
    lo_n, hi_n = V[nm]
    S.chord(STR_LO, tb, 2.0, lo_n, 88)
    S.arp(HARP, tb, tb + 2.0, [p - 12 for p in lo_n] + hi_n, 0.25, 58)
TEND = T4 + 8.0
S.chord(STR_LO, TEND, 606.0 - TEND, ns("D2 A2 D3"), 96)
S.chord(STR_HI, TEND, 606.0 - TEND, ns("F#4 A4 D5 F#5"), 90)
S.chord(CHOIR, TEND, 606.0 - TEND, ns("D4 F#4 A4 D5"), 86)
S.chord(BRASS, TEND, 606.0 - TEND, ns("D3 A3 F#4"), 64)
S.note(TIMP, TEND, 2, n("D2"), 90)
S.note(DRUMS, TEND, 5, 49, 80)
for ch in (STR_LO, STR_HI, CHOIR, BRASS):
    S.expr(ch, TEND + 1, 606.0, 110, 0)


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
