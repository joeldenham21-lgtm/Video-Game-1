"""Audio file IO: float WAV, OGG Vorbis (ffmpeg libvorbis), reading, spectrogram PNGs (sox)."""
from __future__ import annotations

import os
import subprocess
import tempfile

import numpy as np
from scipy.io import wavfile

from .dsp import SR


def write_wav(path: str, x: np.ndarray, sr: int = SR, bits: int = 24) -> None:
	os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
	y = np.clip(x, -1.0, 1.0)
	if bits == 16:
		wavfile.write(path, sr, (y * 32767).astype(np.int16))
	else:
		wavfile.write(path, sr, y.astype(np.float32))


def read_wav(path: str) -> tuple[np.ndarray, int]:
	sr, d = wavfile.read(path)
	if d.dtype == np.int16:
		d = d.astype(np.float64) / 32768.0
	elif d.dtype == np.int32:
		d = d.astype(np.float64) / 2147483648.0
	else:
		d = d.astype(np.float64)
	return d, sr


def read_any(path: str, sr: int = SR, channels: int | None = None) -> np.ndarray:
	"""Decode any audio file via ffmpeg to float64 at sr."""
	cmd = ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-acodec", "pcm_f32le", "-ar", str(sr)]
	if channels:
		cmd += ["-ac", str(channels)]
	cmd += ["-"]
	raw = subprocess.run(cmd, check=True, capture_output=True).stdout
	a = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
	if channels and channels > 1:
		a = a.reshape(-1, channels)
	elif channels is None:
		# probe channels
		pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
			"stream=channels", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
		ch = int(pr or "1")
		if ch > 1:
			a = a.reshape(-1, ch)
	return a


def write_ogg(path: str, x: np.ndarray, quality: float = 4.0, sr: int = SR) -> None:
	"""Encode float signal to OGG Vorbis 44.1 kHz. Mono if x.ndim == 1 else stereo."""
	os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
	with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
		tmp = tf.name
	try:
		write_wav(tmp, x, sr, bits=24)
		ch = 1 if x.ndim == 1 else x.shape[1]
		subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-ac", str(ch), "-ar", str(sr), "-c:a", "libvorbis",
			"-q:a", str(quality), "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", path], check=True)
	finally:
		os.unlink(tmp)


def write_ogg_checked(path: str, x: np.ndarray, quality: float = 4.0, ceiling_db: float = -1.0, sr: int = SR) -> float:
	"""write_ogg, then decode and re-measure the true peak: lossy coding can overshoot the pre-encode ceiling
	by 0.5-1 dB on dense material. If it does, trim the gain and re-encode. Returns the gain applied."""
	from .loud import true_peak_db
	g = 1.0
	ch = 1 if x.ndim == 1 else x.shape[1]
	for _ in range(4):
		write_ogg(path, x * g, quality, sr)
		tp = true_peak_db(read_any(path, sr, ch))
		if tp <= ceiling_db:
			break
		g *= 10.0 ** ((ceiling_db - 0.15 - tp) / 20.0)
	return g


def spectrogram_png(wav_or_ogg: str, png: str, title: str = "", width: int = 900, height: int = 300,
		zmax_db: int = 100) -> None:
	os.makedirs(os.path.dirname(png) or ".", exist_ok=True)
	subprocess.run(["sox", wav_or_ogg, "-n", "remix", "-", "spectrogram", "-x", str(width), "-y", str(height),
		"-z", str(zmax_db), "-t", title[:60], "-o", png], check=True, capture_output=True)


def ebur128(path: str) -> dict:
	"""ffmpeg ebur128 summary: integrated I (LUFS), LRA, true peak (dBTP)."""
	p = subprocess.run(["ffmpeg", "-nostats", "-v", "info", "-i", path, "-filter_complex", "ebur128=peak=true",
		"-f", "null", "-"], capture_output=True, text=True)
	out = {"I": None, "LRA": None, "TP": None}
	txt = p.stderr
	summ = txt[txt.rfind("Summary:"):] if "Summary:" in txt else txt
	for line in summ.splitlines():
		s = line.strip()
		if s.startswith("I:"):
			out["I"] = float(s.split()[1])
		elif s.startswith("LRA:"):
			out["LRA"] = float(s.split()[1])
		elif s.startswith("Peak:"):
			out["TP"] = float(s.split()[1])
	return out
