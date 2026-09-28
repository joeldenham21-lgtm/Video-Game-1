"""Render every shot in the timeline that has no output yet (or those named).

usage: python render/queue.py [SHOT ...]
"""
import os, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from timeline import SHOTS  # noqa: E402

want = sys.argv[1:] or list(SHOTS)
for sid in want:
    out = os.path.join(ROOT, "build", "shots", f"{sid}.mp4")
    if os.path.exists(out) and len(sys.argv) == 1:
        continue
    t0 = time.time()
    r = subprocess.run([sys.executable, os.path.join(HERE, "render.py"), sid], capture_output=True, text=True)
    status = "ok" if r.returncode == 0 else "FAILED\n" + r.stderr[-2000:]
    print(f"[{time.strftime('%H:%M:%S')}] {sid} {SHOTS[sid]['dur']:.1f}s -> {time.time() - t0:.0f}s {status}", flush=True)
