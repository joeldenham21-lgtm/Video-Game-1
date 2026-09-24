"""Log-frequency spectrogram + waveform PNG renderer (PIL only) for visual QA of generated audio."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import signal

from .dsp import SR

_FONT = None


def _font():
	global _FONT
	if _FONT is None:
		try:
			_FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
		except OSError:
			_FONT = ImageFont.load_default()
	return _FONT


def _cmap(v: np.ndarray) -> np.ndarray:
	"""v in 0..1 -> RGB (inferno-like)."""
	stops = np.array([[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21],
		[250, 193, 39], [252, 255, 164]], float)
	x = np.clip(v, 0, 1) * (len(stops) - 1)
	i = np.minimum(x.astype(int), len(stops) - 2)
	f = (x - i)[..., None]
	return (stops[i] * (1 - f) + stops[i + 1] * f).astype(np.uint8)


def render(x: np.ndarray, path: str, title: str = "", width: int = 900, height: int = 260, fmin: float = 30.0,
		fmax: float = 20000.0, dyn_db: float = 75.0) -> None:
	m = x if x.ndim == 1 else np.mean(x, axis=1)
	dur = len(m) / SR
	nfft = 2048 if dur > 1.5 else 1024
	if len(m) < nfft * 2:
		m = np.concatenate([m, np.zeros(nfft * 2 - len(m))])
	hop = min(nfft // 2, max(16, int(len(m) / width)))
	f, t, Z = signal.stft(m, fs=SR, nperseg=nfft, noverlap=max(0, nfft - hop), boundary=None, padded=True)
	P = 20 * np.log10(np.abs(Z) + 1e-10)
	P -= max(P.max(), -200)
	# log-frequency resample
	spec_h = height
	fl = np.geomspace(fmin, fmax, spec_h)
	rows = np.empty((spec_h, P.shape[1]))
	for j in range(P.shape[1]):
		rows[:, j] = np.interp(fl, f, P[:, j])
	img = (rows + dyn_db) / dyn_db
	img = img[::-1]
	rgb = _cmap(img)
	sp = Image.fromarray(rgb).resize((width, spec_h), Image.BILINEAR)
	# waveform strip
	wf_h = 60
	W = Image.new("RGB", (width, wf_h), (10, 10, 16))
	d = ImageDraw.Draw(W)
	cols = np.array_split(np.abs(m), width)
	for k, c in enumerate(cols):
		if len(c):
			a = float(np.max(c))
			r_ = float(np.sqrt(np.mean(c ** 2)))
			d.line([(k, wf_h / 2 - a * wf_h / 2), (k, wf_h / 2 + a * wf_h / 2)], fill=(70, 110, 170))
			d.line([(k, wf_h / 2 - r_ * wf_h / 2), (k, wf_h / 2 + r_ * wf_h / 2)], fill=(150, 200, 255))
	lm = 44
	canvas = Image.new("RGB", (width + lm, wf_h + spec_h + 34), (0, 0, 0))
	canvas.paste(W, (lm, 18))
	canvas.paste(sp, (lm, 18 + wf_h))
	d = ImageDraw.Draw(canvas)
	d.text((lm, 2), f"{title}   {dur:.2f}s", fill=(230, 230, 230), font=_font())
	for hz in [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]:
		if fmin <= hz <= fmax:
			y = 18 + wf_h + int((1 - np.log(hz / fmin) / np.log(fmax / fmin)) * (spec_h - 1))
			d.line([(lm - 4, y), (lm, y)], fill=(200, 200, 200))
			lab = f"{hz // 1000}k" if hz >= 1000 else str(hz)
			d.text((2, y - 6), lab, fill=(200, 200, 200), font=_font())
	# time ticks
	step = 0.05 if dur < 0.6 else 0.1 if dur < 1.5 else 0.5 if dur < 6 else 2.0 if dur < 30 else 10.0
	tt = 0.0
	while tt <= dur:
		xpx = lm + int(tt / dur * (width - 1))
		d.line([(xpx, 18 + wf_h + spec_h), (xpx, 18 + wf_h + spec_h + 4)], fill=(200, 200, 200))
		d.text((xpx + 1, 18 + wf_h + spec_h + 4), f"{tt:g}", fill=(160, 160, 160), font=_font())
		tt += step
	canvas.save(path)
