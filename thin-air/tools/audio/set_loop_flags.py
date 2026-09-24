#!/usr/bin/env python3
"""Set `loop=true` in the Godot .import files of every looping asset listed in data/sfx.json (and false for
one-shots), so loops are seamless even outside the Audio autoload (which also enforces it at runtime).
Run after `godot --headless --path thin-air --import`, then import again:

  python3.12 thin-air/tools/audio/set_loop_flags.py && godot --headless --path thin-air --import
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))


def main():
	with open(os.path.join(PROJECT, "data", "sfx.json")) as f:
		data = json.load(f)
	changed = 0
	for sid, e in data.items():
		for res in e.get("files", []):
			imp = os.path.join(PROJECT, res[len("res://"):]) + ".import"
			if not os.path.exists(imp):
				continue
			txt = open(imp).read()
			want = "loop=true" if e.get("loop") else "loop=false"
			new = re.sub(r"^loop=(true|false)$", want, txt, flags=re.M)
			if new != txt:
				open(imp, "w").write(new)
				changed += 1
	print("updated", changed, "import files")


if __name__ == "__main__":
	main()
