#!/usr/bin/env bash
# Renders the vegetation QA scene (or any scene) to a PNG sequence and keeps the last frame.
# usage: thin-air/tools/vegetation/render.sh OUT.png FRAMES METHOD [SCENE] -- [scene args...]
#   METHOD: forward_plus | mobile
#   SCENE defaults to res://scenes/dev/vegetation_test.tscn
set -u
OUT="$1"; FRAMES="$2"; METHOD="$3"; shift 3
SCENE="res://scenes/dev/vegetation_test.tscn"
if [ "${1:-}" != "--" ] && [ -n "${1:-}" ]; then SCENE="$1"; shift; fi
[ "${1:-}" = "--" ] && shift
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$HERE/../.." && pwd)"
pgrep Xvfb >/dev/null || (Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 &)
sleep 0.5
TMPD="$(mktemp -d)"
DISPLAY=:99 timeout 1500 godot --path "$PROJ" --rendering-method "$METHOD" --write-movie "$TMPD/f.png" \
	--fixed-fps 30 --quit-after "$FRAMES" --resolution 1280x720 "$SCENE" -- "$@" 2>&1 \
	| grep -E "PERF|ERROR|SCRIPT ERROR|Parse Error|Invalid|VEG" | grep -v "^$" | head -40
LAST="$(ls "$TMPD"/f*.png 2>/dev/null | sort | tail -1)"
if [ -n "$LAST" ]; then cp "$LAST" "$OUT"; echo "wrote $OUT ($(ls "$TMPD" | wc -l) frames)"; else echo "no frames"; fi
rm -rf "$TMPD"
