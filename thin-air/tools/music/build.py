#!/usr/bin/env python3
"""THIN AIR - original score build.

    python3.12 thin-air/tools/music/build.py              # render every cue
    python3.12 thin-air/tools/music/build.py menu night   # render some cues
    python3.12 thin-air/tools/music/build.py --qa-only    # score checks + MIDI score export (no audio)
    python3.12 thin-air/tools/music/build.py --json-only  # rewrite data/music.json + .import from OGGs

Outputs: assets/audio/music/<cue>.ogg (+ .import with loop flags), data/music.json,
QA pictures/reports in tools/music/_cache/qa/ (git-ignored).
Deterministic: same source -> same audio (fluidsynth stems are cached by MIDI hash).
"""
from __future__ import annotations

import importlib
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, os.path.join(HERE, "cues"))

import dsp  # noqa: E402
import export  # noqa: E402
import qa  # noqa: E402
import render  # noqa: E402

PROJECT = os.path.dirname(os.path.dirname(HERE))           # thin-air/
MUSIC_DIR = os.path.join(PROJECT, "assets", "audio", "music")
SCORE_DIR = os.path.join(HERE, "midi")                      # readable multi-track MIDI scores
DATA_JSON = os.path.join(PROJECT, "data", "music.json")
QA_DIR = os.path.join(HERE, "_cache", "qa")

CUES = ["menu", "explore", "forest", "night", "alpine", "station", "danger", "blizzard", "summit",
        "finale", "stingers"]


def load_cues(names):
    out = []
    for n in names:
        mod = importlib.import_module(n)
        if hasattr(mod, "build_all"):
            out.extend(mod.build_all())
        else:
            out.append(mod.build())
    return out


IMPORT_TMPL = """[remap]

importer="oggvorbisstr"
type="AudioStreamOggVorbis"
{uid}path="res://.godot/imported/{file}-{md5}.oggvorbisstr"

[deps]

source_file="res://assets/audio/music/{file}"
dest_files=["res://.godot/imported/{file}-{md5}.oggvorbisstr"]

[params]

loop={loop}
loop_offset=0
bpm=0
beat_count=0
bar_beats={bar_beats}
"""


def write_import(file: str, loop: bool, bar_beats: int) -> None:
    import hashlib
    path = os.path.join(MUSIC_DIR, file + ".import")
    uid = ""
    if os.path.exists(path):
        m = re.search(r'^uid="([^"]+)"', open(path).read(), re.M)
        if m:
            uid = f'uid="{m.group(1)}"\n'
    md5 = hashlib.md5(f"res://assets/audio/music/{file}".encode()).hexdigest()
    with open(path, "w") as f:
        f.write(IMPORT_TMPL.format(uid=uid, file=file, md5=md5, loop="true" if loop else "false",
                                   bar_beats=bar_beats))


def entry(cue, fname: str, stats: dict) -> dict:
    """data/music.json record. Required by the contract: file, loop, bpm, key, intensity, duration_s."""
    return {
        "file": f"res://assets/audio/music/{fname}",
        "title": cue.title or cue.name.replace("_", " ").title(),
        "kind": cue.kind,                     # loop | oneshot | stinger
        "loop": cue.loop,
        "loop_offset_s": 0.0,
        "bpm": cue.bpm,
        "meter": cue.meter,
        "bars": cue.bars,
        "key": cue.key,
        "intensity": cue.intensity,
        "duration_s": stats["duration_s"],
        "lufs": stats.get("I"),
        "true_peak_db": stats.get("TP"),
        "fade_in_s": 0.0 if cue.kind == "stinger" else (1.5 if cue.intensity >= 0.8 else 4.0),
        "fade_out_s": 0.0 if cue.kind == "stinger" else (2.5 if cue.intensity >= 0.8 else 5.0),
        # musical boundaries (seconds) so a director can switch / cross-fade on phrase starts
        "bar_s": round(cue.sec(cue.meter) - cue.sec(0), 4),
        "phrase_starts_s": [round(cue.sec(b * cue.meter), 3) for b in range(0, cue.bars, 4)],
    }


def ogg_samples(path: str) -> int:
    import subprocess
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                        "stream=duration_ts", "-of", "csv=p=0", path], capture_output=True, text=True)
    return int(r.stdout.strip())


def main(argv):
    qa_only = "--qa-only" in argv
    json_only = "--json-only" in argv
    names = [a for a in argv if not a.startswith("--")] or CUES
    os.makedirs(QA_DIR, exist_ok=True)
    os.makedirs(MUSIC_DIR, exist_ok=True)
    cues = load_cues(names)
    data = {}
    if os.path.exists(DATA_JSON):
        with open(DATA_JSON) as f:
            data = json.load(f)
    failures = 0
    for cue in cues:
        t0 = time.time()
        print(f"== {cue.name} ({cue.title or cue.key})")
        rep = qa.check_score(cue)
        for line in rep:
            print("   " + line)
        os.makedirs(SCORE_DIR, exist_ok=True)
        export.export_score_midi(cue, os.path.join(SCORE_DIR, f"{cue.name}.mid"))
        if qa_only:
            continue
        fname = f"{cue.name}.ogg"
        ogg = os.path.join(MUSIC_DIR, fname)
        if json_only:
            stats = dsp.ebur128(ogg)
            stats["duration_s"] = round(ogg_samples(ogg) / 44100.0, 3)
            write_import(fname, cue.loop, cue.meter)
            data[cue.name] = entry(cue, fname, stats)
            continue
        stats = render.render_cue(cue, ogg)
        write_import(fname, cue.loop, cue.meter)
        # QA pictures
        master_wav = os.path.join(render.CACHE, f"{cue.name}_master.wav")
        sr, x = dsp.read_wav(master_wav)
        marks = [cue.sec(b * cue.meter * 4) for b in range(0, cue.bars // 4 + 1)]
        qa.envelope_png(x, sr, os.path.join(QA_DIR, f"{cue.name}_env.png"), marks,
                        f"{cue.name}  I={stats.get('I')} LUFS  TP={stats.get('TP')}  (marks every 4 bars)")
        qa.spectrogram(master_wav, os.path.join(QA_DIR, f"{cue.name}_spec.png"), cue.name)
        seam = qa.seam_report(ogg) if cue.loop else ""
        with open(os.path.join(QA_DIR, f"{cue.name}.txt"), "w") as f:
            f.write("\n".join(rep) + "\n")
            f.write(json.dumps(stats, indent=1) + "\n")
            if seam:
                f.write("LOOP " + seam + "\n")
        if seam:
            print("   LOOP " + seam)
        print("   stems (LUFS in mix): " + ", ".join(f"{k} {v}" for k, v in stats["stems"].items()))
        tp_ok = stats.get("TP", 0) <= -1.0
        i_ok = abs(stats.get("I", -99) - cue.target_lufs) <= 0.6
        if not (tp_ok and i_ok):
            failures += 1
            print(f"   !! mastering target missed (I {stats.get('I')} / TP {stats.get('TP')})")
        data[cue.name] = entry(cue, fname, stats)
        print(f"   done in {time.time() - t0:.0f}s")
    if not qa_only:
        # merge into the file as it is NOW (another build may have written other cues meanwhile)
        fresh = {}
        if os.path.exists(DATA_JSON):
            with open(DATA_JSON) as f:
                fresh = json.load(f)
        fresh.update({c.name: data[c.name] for c in cues if c.name in data})
        data = fresh
        order = CUES[:-1]
        ordered = {k: data[k] for k in order if k in data}
        ordered.update({k: v for k, v in sorted(data.items()) if k not in ordered})
        os.makedirs(os.path.dirname(DATA_JSON), exist_ok=True)
        with open(DATA_JSON, "w") as f:
            json.dump(ordered, f, indent=2)
            f.write("\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
