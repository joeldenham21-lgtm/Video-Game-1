"""STARWAKE -- conform and master.

Joins the rendered shots in story order, lays in the final mix
(loudness-normalised to -16 LUFS, -1.5 dBTP), attaches the subtitle
track, and writes the release files:

  build/STARWAKE_master.mp4   1920x804 H.264 high quality
  build/STARWAKE.mp4          1280x536 release under 95 MB for the repository

The final grade is applied here, film-lab style: a gently bleached,
contrasty print look with cool shadows and warm highlights, red
halation blooming around the brightest light, and a whisper of gate
weave, as if the picture had been threaded through a projector.
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from timeline import SHOTS, TOTAL  # noqa: E402

B = os.path.join(ROOT, "build")


def run(cmd):
    print(" ".join(cmd[:6]), "...")
    subprocess.run(cmd, check=True)


def main():
    missing = [s for s in SHOTS if not os.path.exists(os.path.join(B, "shots", f"{s}.mp4"))]
    if missing:
        sys.exit(f"missing shots: {missing}")
    lst = os.path.join(B, "shots.txt")
    with open(lst, "w") as f:
        for s in SHOTS:
            f.write(f"file 'shots/{s}.mp4'\n")
    picture = os.path.join(B, "picture.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", picture])

    audio = os.path.join(B, "audio", "mix.wav")
    srt = os.path.join(B, "starwake.srt")
    meta = ["-metadata", "title=STARWAKE", "-metadata", "comment=An original short film. Every frame raymarched, every sound synthesized.",
            "-metadata:s:s:0", "language=eng", "-metadata:s:a:0", "language=eng"]
    loud = "loudnorm=I=-16:TP=-1.5:LRA=11"
    grade = ("format=gbrp,split[a][b];"
             "[b]curves=all='0/0 0.62/0 1/1',gblur=sigma=14,colorchannelmixer=rr=1:gg=0.38:bb=0.18[h];"
             "[a][h]blend=all_mode=screen:all_opacity=0.22,format=yuv444p,"
             "eq=contrast=1.05:saturation=0.9:gamma=0.985,"
             "colorbalance=rs=-0.006:bs=0.01:rh=0.02:gh=0.006:bh=-0.015,"
             "crop=iw-6:ih-4:3+1.4*sin(n*1.31)*sin(n*0.17):2+0.9*sin(n*0.93+1.0),"
             "scale=1920:804:flags=lanczos,format=yuv420p")
    master = os.path.join(B, "STARWAKE_master.mp4")
    graded = os.path.join(B, "picture_graded.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", picture, "-vf", grade,
         "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", graded])
    picture = graded
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", picture, "-i", audio, "-i", srt,
         "-map", "0:v", "-map", "1:a", "-map", "2:s",
         "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-tune", "grain", "-pix_fmt", "yuv420p",
         "-profile:v", "high", "-movflags", "+faststart",
         "-af", loud, "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
         "-c:s", "mov_text", *meta, "-t", f"{TOTAL:.3f}", master])

    # release copy under GitHub's 100 MB limit: two-pass to a bitrate budget
    target_mb = 92
    abr = 160
    vbr = int(target_mb * 8 * 1024 / TOTAL - abr)
    rel = os.path.join(B, "STARWAKE.mp4")
    small = "scale=1280:536:flags=lanczos,hqdn3d=1.2:1.2:3:3"
    common = ["-i", picture, "-vf", small, "-c:v", "libx264", "-preset", "slow", "-b:v", f"{vbr}k", "-pix_fmt", "yuv420p",
              "-profile:v", "high", "-tune", "film"]
    run(["ffmpeg", "-y", "-loglevel", "error", *common, "-pass", "1", "-passlogfile", os.path.join(B, "x264"), "-an", "-f", "mp4", os.devnull])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", picture, "-i", audio, "-i", srt,
         "-map", "0:v", "-map", "1:a", "-map", "2:s", "-vf", small,
         "-c:v", "libx264", "-preset", "slow", "-b:v", f"{vbr}k", "-pix_fmt", "yuv420p", "-profile:v", "high", "-tune", "film",
         "-pass", "2", "-passlogfile", os.path.join(B, "x264"), "-movflags", "+faststart",
         "-af", loud, "-c:a", "aac", "-b:a", f"{abr}k", "-ar", "48000",
         "-c:s", "mov_text", *meta, "-t", f"{TOTAL:.3f}", rel])
    for p in (master, rel):
        print(p, f"{os.path.getsize(p) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
