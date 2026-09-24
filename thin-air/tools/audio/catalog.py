"""SFX registry: every generator registers an id with variation count, category and engine metadata.

Category defaults set loudness normalisation (measured on the rendered file) and the runtime attenuation
parameters written to data/sfx.json. Per-id keyword overrides win.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

# target: loudness in LUFS; mode: short (loudest 100 ms), momentary (loudest 400 ms), integrated (loops/beds)
CATEGORIES: dict[str, dict] = {
	"foot":      dict(target=-25.0, mode="short", bus="SFX", max_distance=35.0, unit_size=2.5, pitch_var=0.05, cooldown=0.09, max_voices=6),
	"body":      dict(target=-24.0, mode="momentary", bus="SFX", max_distance=25.0, unit_size=2.0, pitch_var=0.04, cooldown=0.15, max_voices=3),
	"breath":    dict(target=-27.0, mode="momentary", bus="SFX", max_distance=12.0, unit_size=1.5, pitch_var=0.03, cooldown=0.4, max_voices=1),
	"handling":  dict(target=-24.0, mode="momentary", bus="SFX", max_distance=20.0, unit_size=2.0, pitch_var=0.05, cooldown=0.08, max_voices=3),
	"tool":      dict(target=-15.0, mode="short", bus="SFX", max_distance=90.0, unit_size=6.0, pitch_var=0.06, cooldown=0.05, max_voices=4),
	"swing":     dict(target=-21.0, mode="momentary", bus="SFX", max_distance=20.0, unit_size=2.0, pitch_var=0.08, cooldown=0.1, max_voices=3),
	"build":     dict(target=-17.0, mode="short", bus="SFX", max_distance=70.0, unit_size=5.0, pitch_var=0.06, cooldown=0.06, max_voices=4),
	"big":       dict(target=-13.0, mode="momentary", bus="SFX", max_distance=400.0, unit_size=25.0, pitch_var=0.04, cooldown=0.5, max_voices=2),
	"creature":  dict(target=-14.0, mode="momentary", bus="SFX", max_distance=260.0, unit_size=14.0, pitch_var=0.05, cooldown=0.3, max_voices=4),
	"far_call":  dict(target=-14.0, mode="momentary", bus="SFX", max_distance=1400.0, unit_size=60.0, pitch_var=0.04, cooldown=0.8, max_voices=3),
	"bird":      dict(target=-19.0, mode="momentary", bus="Ambience", max_distance=140.0, unit_size=10.0, pitch_var=0.03, cooldown=0.2, max_voices=4),
	"weather":   dict(target=-14.0, mode="momentary", bus="Ambience", max_distance=6000.0, unit_size=400.0, pitch_var=0.05, cooldown=2.0, max_voices=2),
	"loop":      dict(target=-22.0, mode="integrated", bus="SFX", max_distance=40.0, unit_size=4.0, pitch_var=0.0, cooldown=0.0, max_voices=8),
	"loop_big":  dict(target=-18.0, mode="integrated", bus="SFX", max_distance=900.0, unit_size=40.0, pitch_var=0.0, cooldown=0.0, max_voices=2),
	"water_loop": dict(target=-22.0, mode="integrated", bus="Ambience", max_distance=90.0, unit_size=8.0, pitch_var=0.0, cooldown=0.0, max_voices=6),
	"ui":        dict(target=-27.0, mode="short", bus="UI", max_distance=0.0, unit_size=1.0, pitch_var=0.02, cooldown=0.03, max_voices=4),
	"device":    dict(target=-23.0, mode="momentary", bus="SFX", max_distance=15.0, unit_size=1.5, pitch_var=0.0, cooldown=0.1, max_voices=2),
	"radio":     dict(target=-24.0, mode="momentary", bus="SFX", max_distance=15.0, unit_size=1.5, pitch_var=0.02, cooldown=0.1, max_voices=2),
	"amb_event": dict(target=-18.0, mode="momentary", bus="Ambience", max_distance=500.0, unit_size=25.0, pitch_var=0.04, cooldown=0.5, max_voices=3),
	"bed":       dict(target=-24.0, mode="integrated", bus="Ambience", max_distance=0.0, unit_size=1.0, pitch_var=0.0, cooldown=0.0, max_voices=1),
}


@dataclass
class Spec:
	id: str
	fn: Callable
	n: int
	cat: str
	loop: bool = False
	stereo: bool = False
	folder: str = "sfx"
	meta: dict = field(default_factory=dict)
	target: float | None = None
	quality: float = 4.0


REG: dict[str, Spec] = {}


def sfx(sid: str, n: int = 4, cat: str = "tool", loop: bool = False, stereo: bool = False, folder: str = "sfx",
		target: float | None = None, quality: float = 4.0, **meta):
	"""Register a generator fn(r, i) -> np.ndarray for id `sid` with `n` variations."""
	def deco(fn):
		REG[sid] = Spec(sid, fn, n, cat, loop, stereo, folder, meta, target, quality)
		return fn
	return deco
