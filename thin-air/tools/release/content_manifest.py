#!/usr/bin/env python3
"""Content pack bookkeeping for the small Android build ("Android Lite", see src/autoload/content.gd).

The Lite preset in export_presets.cfg excludes the heavy media folders; those files ship in a separate pack
(ThinAir-content.pck) that the app downloads on first launch. This tool:

  id     print a content id: a hash of every file the Lite build leaves out (plus its .import sidecar) and
         the Godot version, so a new pack is only published when the media actually change.
  info   describe an exported pack: {"id", "size", "sha256"} as JSON on stdout.
  write  write data/content_manifest.json (what the Lite APK reads) from an info JSON and a release tag.

Usage (from thin-air/):
  python3 tools/release/content_manifest.py id --godot "$(godot --version)"
  python3 tools/release/content_manifest.py info build/content/ThinAir-content.pck --id ID > content.json
  python3 tools/release/content_manifest.py write content.json --repo owner/name --tag thin-air-content-ID
"""
import argparse
import configparser
import fnmatch
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PRESETS = os.path.join(ROOT, "export_presets.cfg")
MANIFEST = os.path.join(ROOT, "data", "content_manifest.json")
LITE, FULL = "Android Lite", "Android"


def _presets():
    cp = configparser.RawConfigParser(strict=False)
    cp.read(PRESETS)
    out = {}
    for sec in cp.sections():
        if sec.startswith("preset.") and sec.count(".") == 1:
            out[cp.get(sec, "name").strip('"')] = {k: v.strip('"') for k, v in cp.items(sec)}
    return out


def heavy_patterns():
    """Exclude patterns the Lite preset adds on top of the full Android preset."""
    p = _presets()
    split = lambda s: [x.strip() for x in s.split(",") if x.strip()]
    base = set(split(p[FULL]["exclude_filter"]))
    return [x for x in split(p[LITE]["exclude_filter"]) if x not in base]


def heavy_files():
    pats = heavy_patterns()
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        # Godot skips hidden folders and folders with a .gdignore; build/ output is never content
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d != "build"
                             and not os.path.exists(os.path.join(dirpath, d, ".gdignore")))
        for f in sorted(filenames):
            if f.endswith(".import") or f.endswith(".uid"):
                continue
            rel = f if rel_dir == "." else f"{rel_dir}/{f}"
            if any(fnmatch.fnmatch(rel.lower(), x.lower()) for x in pats):
                out.append(rel)
    return out


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def content_id(godot_version):
    h = hashlib.sha256()
    h.update(f"godot {godot_version.strip()}\n".encode())
    h.update(("patterns " + ",".join(heavy_patterns()) + "\n").encode())
    n = 0
    for rel in heavy_files():
        h.update(f"{rel} {_sha(os.path.join(ROOT, rel))}\n".encode())
        imp = os.path.join(ROOT, rel + ".import")
        if os.path.exists(imp):
            h.update(f"{rel}.import {_sha(imp)}\n".encode())
        n += 1
    print(f"content_id: {n} files", file=sys.stderr)
    return h.hexdigest()[:12]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("id")
    a.add_argument("--godot", required=True, help="output of `godot --version`")
    a = sub.add_parser("info")
    a.add_argument("pack")
    a.add_argument("--id", required=True)
    a = sub.add_parser("write")
    a.add_argument("info")
    a.add_argument("--repo", required=True, help="owner/name of the GitHub repository")
    a.add_argument("--tag", required=True, help="release tag that holds ThinAir-content.pck")
    a.add_argument("--asset", default="ThinAir-content.pck")
    a.add_argument("--out", default=MANIFEST)
    args = ap.parse_args()
    if args.cmd == "id":
        print(content_id(args.godot))
    elif args.cmd == "info":
        print(json.dumps({"id": args.id, "size": os.path.getsize(args.pack), "sha256": _sha(args.pack)}))
    elif args.cmd == "write":
        info = json.load(open(args.info))
        info["urls"] = [f"https://github.com/{args.repo}/releases/download/{args.tag}/{args.asset}"]
        with open(args.out, "w") as fh:
            json.dump(info, fh)
            fh.write("\n")
        print(json.dumps(info))


if __name__ == "__main__":
    main()
