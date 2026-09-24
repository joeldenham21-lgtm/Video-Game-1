"""Render a Cue: per-part MIDI -> fluidsynth stems -> mix -> master -> OGG Vorbis."""
from __future__ import annotations

import concurrent.futures as cf
import hashlib
import json
import math
import os
import subprocess

import numpy as np

import dsp
from midi import MidiTrack, fix_overlaps, write_file
from score import Cue, Part
from theory import RANGES

SF = "/usr/share/sounds/sf3/MuseScore_General_Full.sf3"
SR = 48000
PRE = 2.0            # seconds of pre-roll at the start of every rendered timeline
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(HERE, "_cache")
KEYBOARD = {"piano", "mellow_piano", "ep", "ep_detuned", "harp", "celesta", "vibes", "glock"}
DYN_EXTRA = 0.7      # exponent of the CC11 curve that rides along with CC2


def _gauss(rng, sd: float, clip: float) -> float:
    return max(-clip, min(clip, rng.gauss(0.0, sd)))


# ------------------------------------------------------------------------------------ MIDI
def part_to_midi(part: Part) -> tuple[bytes, float, str]:
    cue = part.cue
    rng = part.rng()
    tr = MidiTrack(channel=9 if part.drum else 0)
    tr.program(0.0, part.program, part.bank)
    tr.cc(0.0, 7, 100)
    tr.cc(0.0, 10, 64)
    tr.cc(0.0, 91, 0)
    tr.cc(0.0, 93, 0)
    tr.cc(0.0, 64, 0)
    # dynamics controller curve. "Expr." presets take CC2 (level + timbre, only ~8 dB between p and
    # f); CC11 is driven alongside it to widen the range to an orchestral ~25 dB pp..ff.
    if part.dyn_cc:
        pts = sorted(part.dyn_pts, key=lambda p: p[0])
        if not pts:
            pts = [(0.0, 78.0)]

        def emit(t, v):
            tr.cc(t, part.dyn_cc, v)
            if part.dyn_cc == 2:
                tr.cc(t, 11, 127.0 * (max(0.0, v) / 127.0) ** DYN_EXTRA)

        emit(0.0, pts[0][1])
        last_v = None
        for (b0, v0), (b1, v1) in zip(pts, pts[1:]):
            steps = max(1, int((b1 - b0) * 12))
            for k in range(steps):
                b = b0 + (b1 - b0) * k / steps
                v = int(round(v0 + (v1 - v0) * k / steps))
                if v != last_v:
                    emit(PRE + cue.sec(b), v)
                    last_v = v
        emit(PRE + cue.sec(pts[-1][0]), pts[-1][1])
    # notes
    raw = []
    hs = part.human_ms / 1000.0
    keyboard = part.preset in KEYBOARD
    for n in part.notes:
        dur_b = n.dur
        t_on = PRE + cue.sec(n.beat)
        if "'" in n.art or "^" in n.art:
            t_off = t_on + (cue.sec(n.beat + dur_b) - cue.sec(n.beat)) * 0.42
        else:
            extra = part.legato + (0.12 if "_" in n.art else 0.0)
            t_off = PRE + cue.sec(n.beat + dur_b + extra)
        jitter = _gauss(rng, hs * 0.55, hs * 1.4)
        if n.roll:
            jitter = abs(jitter) * 0.3 + n.roll * part.roll_ms / 1000.0
        elif keyboard and n.chord > 1:
            jitter = (-0.006 if n.top else 0.004) + _gauss(rng, 0.004, 0.009)
        vel = n.vel + _gauss(rng, part.vel_rand, part.vel_rand * 2)
        if keyboard and n.chord > 1:
            vel += 5 if n.top else -4
        t0 = t_on + jitter - part.attack_ms / 1000.0
        raw.append((t0, max(0.02, t_off - t0), n.pitch, max(1, min(127, vel))))
    for (t, d, p, v) in fix_overlaps(raw):
        tr.note(t, d, p, v)
    for (down, up) in part.pedals:
        tr.cc(PRE + cue.sec(down) + 0.045, 64, 127)
        tr.cc(PRE + cue.sec(up) - 0.015, 64, 0)
    for (b, num, val) in part.cc_events:
        tr.cc(PRE + cue.sec(b), num, val)
    end = PRE + cue.sec(part.last_beat()) + part.tail_s
    tr.extend_to(end)
    os.makedirs(os.path.join(CACHE, "midi"), exist_ok=True)
    path = os.path.join(CACHE, "midi", f"{cue.name}__{part.name}.mid")
    blob = write_file(path, [tr])
    return blob, end, path


def stem_key(blob: bytes) -> str:
    return hashlib.sha1(blob + SF.encode() + b"v3").hexdigest()[:16]


def fluid_render(midi_path: str, blob: bytes) -> np.ndarray:
    h = stem_key(blob)
    os.makedirs(os.path.join(CACHE, "stems"), exist_ok=True)
    wav = os.path.join(CACHE, "stems", f"{h}.wav")
    if not os.path.exists(wav):
        tmp = wav + ".tmp.wav"
        subprocess.run(["fluidsynth", "-ni", "-g", "0.5", "-r", str(SR), "-O", "float", "-T", "wav",
                        "-o", "synth.reverb.active=0", "-o", "synth.chorus.active=0",
                        "-o", "synth.polyphony=1024", "-F", tmp, SF, midi_path],
                       check=True, capture_output=True)
        os.replace(tmp, wav)
    _, x = dsp.read_wav(wav)
    return x


# ------------------------------------------------------------------------------ calibration
_CAL_PATH = os.path.join(CACHE, "calibration.json")


def calibration(part: Part) -> float:
    """dB offset that brings this preset's mf note to a common RMS reference (-24 dBFS)."""
    key = f"{part.bank}:{part.program}:{int(part.drum)}"
    cal = {}
    if os.path.exists(_CAL_PATH):
        with open(_CAL_PATH) as f:
            cal = json.load(f)
    if key in cal:
        return cal[key]
    lo, hi = RANGES.get(part.range_key, (48, 72))
    pitch = 38 if part.drum else int((lo + hi) / 2)
    tr = MidiTrack(channel=9 if part.drum else 0)
    tr.program(0, part.program, part.bank)
    tr.cc(0, 7, 100)
    tr.cc(0, 11, 127)
    if part.dyn_cc:
        tr.cc(0, part.dyn_cc, 78)
        if part.dyn_cc == 2:
            tr.cc(0, 11, 127.0 * (78 / 127.0) ** DYN_EXTRA)
    tr.note(0.2, 2.0, pitch, 80)
    tr.extend_to(3.0)
    os.makedirs(os.path.join(CACHE, "midi"), exist_ok=True)
    mp = os.path.join(CACHE, "midi", f"cal_{part.bank}_{part.program}_{int(part.drum)}.mid")
    blob = write_file(mp, [tr])
    x = fluid_render(mp, blob)
    seg = x[int(0.25 * SR): int(2.2 * SR)]
    rms = math.sqrt(float(np.mean(seg ** 2)) + 1e-12)
    val = -24.0 - dsp.to_db(rms)
    cal[key] = round(val, 2)
    os.makedirs(CACHE, exist_ok=True)
    with open(_CAL_PATH, "w") as f:
        json.dump(cal, f, indent=1, sort_keys=True)
    return cal[key]


# ------------------------------------------------------------------------------------ mix
def render_cue(cue: Cue, out_ogg: str, log=print) -> dict:
    loop_len = int(round(cue.loop_seconds() * SR)) if cue.loop else None
    # 1) MIDI + stems
    midis = {name: part_to_midi(p) for name, p in cue.parts.items()}
    for p in cue.parts.values():
        calibration(p)  # serial: fills the shared cache file safely
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        futs = {name: ex.submit(fluid_render, m[2], m[0]) for name, m in midis.items()}
        stems = {name: f.result() for name, f in futs.items()}
    body_s = cue.sec(cue.length_beats)
    end_s = PRE + body_s + cue.tail_s
    for name, (_, end, _) in midis.items():
        end_s = max(end_s, end)
    n = int((end_s + cue.rt60 * 1.3) * SR)
    if cue.loop:
        n = max(n, int(PRE * SR) + loop_len + int(cue.rt60 * 1.4 * SR))
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    stem_levels = {}

    def place(name, x, gain_db, hp, lp, shelf, peaks, pos, width, send_amt, dry_db, predelay_ms=0.0, echo_cfg=None):
        y = np.zeros((n, 2))
        m = min(n, len(x))
        y[:m] = x[:m]
        y *= dsp.db(gain_db)
        y = dsp.eq(y, SR, hp=hp, lp=lp, shelf=shelf, peaks=peaks)
        y = dsp.pan(y, pos, width)
        if echo_cfg:
            y = dsp.echo(y, echo_cfg[0], echo_cfg[1], echo_cfg[2], SR)
        stem_levels[name] = y
        dry[:] += y * dsp.db(dry_db)
        s = y * send_amt
        if predelay_ms:
            s = dsp.delay(s, predelay_ms / 1000.0, SR)
        send[:] += s

    for name, p in cue.parts.items():
        g = calibration(p) + p.gain_db
        place(name, stems[name], g, p.hp, p.lp, p.shelf, p.peaks, p.pan, p.width, p.send, p.dry_db,
              p.predelay_ms, p.delay)
    for layer in cue.synths:
        x = layer.render(cue, SR, n, PRE, loop_len)
        place(layer.name, x, layer.gain_db - 12.0, layer.hp, layer.lp, None, None, layer.pan, layer.width,
              layer.send, layer.dry_db)

    ir = dsp.make_ir(SR, cue.rt60, cue.predelay_ms, cue.ir_seed, cue.ir_brightness)
    wet = dsp.convolve(send, ir) * dsp.db(cue.wet_db)
    mix = dry + wet
    me = cue.master_eq or {}
    mix = dsp.eq(mix, SR, hp=me.get("hp", 24), lp=me.get("lp"), shelf=me.get("shelf"), peaks=me.get("peaks"))

    pre_n = int(PRE * SR)
    if cue.loop:
        mix = dsp.fold_loop(mix, pre_n, loop_len)
        stem_views = {k: dsp.fold_loop(v, pre_n, loop_len) for k, v in stem_levels.items()}
    else:
        stop = min(len(mix), pre_n + int((body_s + cue.tail_s) * SR))
        mix = mix[pre_n:stop]
        stem_views = {k: v[pre_n:stop] for k, v in stem_levels.items()}

    # 2) master: bus compression -> loudness -> true-peak limiting
    c = cue.comp
    pre_gain = cue.target_lufs - dsp.lufs(mix, SR)       # bus at its final loudness
    mix *= dsp.db(pre_gain)
    if cue.leveler:
        # slow 'leveler' (seconds-long attack/release) narrows the macro-dynamics of long one-shots
        lv = cue.leveler
        mix = dsp.compress(mix, SR, cue.target_lufs + lv["threshold_db"], lv["ratio"], lv["attack_ms"],
                           lv["release_ms"], knee_db=10.0, circular=cue.loop)
        mix *= dsp.db(cue.target_lufs - dsp.lufs(mix, SR))
    # threshold is relative to the programme loudness: only the loudest passages are touched
    mix = dsp.compress(mix, SR, cue.target_lufs + c["threshold_db"], c["ratio"], c["attack_ms"],
                       c["release_ms"], circular=cue.loop)
    if not cue.loop:
        # trim silence after the music has died away, then a short protective fade
        env = np.max(np.abs(mix), axis=1)
        thr = np.max(env) * dsp.db(-66)
        last = int(np.nonzero(env > thr)[0][-1]) if np.any(env > thr) else len(mix) - 1
        mix = mix[: min(len(mix), last + int(0.3 * SR))]
        f = int(max(0.3, cue.fade_out_s) * SR)
        if cue.max_s and len(mix) > int(cue.max_s * SR):
            # stingers: the reverb tail is faded into the length cap instead of ringing on
            mix = mix[: int(cue.max_s * SR)]
            f = int(max(f / SR, 2.5) * SR)
        f = min(f, len(mix))
        mix[-f:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, f)))[:, None]
    ceiling = -1.4
    for _ in range(3):
        cur = dsp.lufs(mix, SR)
        mix *= dsp.db(cue.target_lufs - cur)
        mix = dsp.limit(mix, SR, ceiling_db=ceiling, circular=cue.loop)
    # 3) 44.1 kHz, encode, verify with ffmpeg ebur128
    out = dsp.resample(mix, SR, 44100, periodic=cue.loop)
    os.makedirs(os.path.dirname(out_ogg), exist_ok=True)
    wav_tmp = os.path.join(CACHE, f"{cue.name}_master.wav")
    meas = {}
    for attempt in range(4):
        dsp.write_wav(wav_tmp, out, 44100)
        dsp.encode_ogg(wav_tmp, out_ogg, 6)
        meas = dsp.ebur128(out_ogg)
        tp_ok = meas.get("TP", 0.0) <= -1.0
        i_ok = abs(meas.get("I", -99) - cue.target_lufs) <= 0.5
        if tp_ok and i_ok:
            break
        adj = 0.0
        if not i_ok:
            adj += cue.target_lufs - meas.get("I", cue.target_lufs)
        if not tp_ok or meas.get("TP", -99) + adj > -1.0:
            # keep peaks safe even if that costs a little loudness
            adj = min(adj, -1.15 - meas.get("TP", -1.0))
        out = out * dsp.db(adj)
    stats = dict(meas)
    stats["duration_s"] = round(len(out) / 44100.0, 3)
    stats["loop_samples_44k"] = len(out) if cue.loop else None
    stats["stems"] = {}
    for k, v in stem_views.items():
        vv = v * dsp.db(pre_gain)
        stats["stems"][k] = round(dsp.lufs(vv, SR), 1) if np.any(vv) else None
    log(f"  {cue.name}: I={meas.get('I')} LUFS  TP={meas.get('TP')} dBTP  LRA={meas.get('LRA')}  "
        f"dur={stats['duration_s']}s")
    return stats
