"""ITU-R BS.1770-4 loudness (K-weighting, gating), momentary max, and oversampled true peak."""
from __future__ import annotations

import math

import numpy as np
from scipy import signal

from .dsp import SR, db


def _kweight_coeffs(fs: int):
	# RBJ-style re-derivation of the BS.1770 pre-filter (high shelf) and RLB high-pass for any fs.
	G, Q, fc = 3.99984385397, 0.7071752369554193, 1681.9744509555319
	K = math.tan(math.pi * fc / fs)
	Vh = 10 ** (G / 20)
	Vb = Vh ** 0.499666774155
	a0 = 1 + K / Q + K * K
	b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
	a1 = [1.0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
	Q2, fc2 = 0.5003270373253953, 38.13547087613982
	K = math.tan(math.pi * fc2 / fs)
	b2 = [1.0, -2.0, 1.0]
	a2 = [1.0, 2 * (K * K - 1) / (1 + K / Q2 + K * K), (1 - K / Q2 + K * K) / (1 + K / Q2 + K * K)]
	return b1, a1, b2, a2


def _kfilter(x: np.ndarray, fs: int = SR) -> np.ndarray:
	b1, a1, b2, a2 = _kweight_coeffs(fs)
	y = signal.lfilter(b1, a1, x, axis=0)
	return signal.lfilter(b2, a2, y, axis=0)


def _block_power(x: np.ndarray, win: float, hop: float, fs: int = SR) -> np.ndarray:
	if x.ndim == 1:
		x = x[:, None]
	y = _kfilter(x, fs)
	n = int(win * fs)
	h = int(hop * fs)
	if len(y) < n:
		y = np.concatenate([y, np.zeros((n - len(y), y.shape[1]))])
	sq = np.sum(y * y, axis=1)  # channel weights 1.0 (L/R)
	c = np.concatenate([[0.0], np.cumsum(sq)])
	starts = np.arange(0, len(y) - n + 1, h)
	return (c[starts + n] - c[starts]) / n


def integrated_lufs(x: np.ndarray, fs: int = SR) -> float:
	z = _block_power(x, 0.4, 0.1, fs)
	with np.errstate(divide="ignore"):
		l = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
	z1 = z[l > -70]
	if len(z1) == 0:
		return -70.0
	rel = -0.691 + 10 * math.log10(np.mean(z1)) - 10
	z2 = z[(l > -70) & (l > rel)]
	if len(z2) == 0:
		return -70.0
	return -0.691 + 10 * math.log10(np.mean(z2))


def momentary_max_lufs(x: np.ndarray, fs: int = SR) -> float:
	z = _block_power(x, 0.4, 0.05, fs)
	return float(-0.691 + 10 * math.log10(max(np.max(z), 1e-20)))


def short_peak_lufs(x: np.ndarray, fs: int = SR) -> float:
	"""Loudness of the loudest 100 ms (for very short one-shots)."""
	z = _block_power(x, 0.1, 0.025, fs)
	return float(-0.691 + 10 * math.log10(max(np.max(z), 1e-20)))


def true_peak_db(x: np.ndarray) -> float:
	y = signal.resample_poly(x, 4, 1, axis=0)
	return 20 * math.log10(max(np.max(np.abs(y)), 1e-12))


def normalize_loudness(x: np.ndarray, target: float, mode: str = "momentary", ceiling_db: float = -1.0,
		max_limit_db: float = 3.0) -> np.ndarray:
	"""Scale to target loudness (mode: integrated|momentary|short), limiting at most `max_limit_db` of peaks
	(transient-heavy sounds end up quieter than target rather than squashed). True-peak ceiling enforced."""
	if mode == "integrated":
		cur = integrated_lufs(x)
	elif mode == "short":
		cur = short_peak_lufs(x)
	else:
		cur = momentary_max_lufs(x)
	gain_db = target - cur
	tp = true_peak_db(x) + gain_db
	if tp > ceiling_db + max_limit_db:
		gain_db -= tp - (ceiling_db + max_limit_db)
	y = x * db(gain_db)
	if true_peak_db(y) > ceiling_db:
		y = limit(y, ceiling_db)
	return y


def limit(x: np.ndarray, ceiling_db: float = -1.0, release: float = 0.05) -> np.ndarray:
	"""Look-ahead peak limiter (gain computed on 4x oversampled peaks)."""
	c = db(ceiling_db) * 0.95
	a = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=1)
	# true-peak: 4x oversampled signal, max per original sample
	up = signal.resample_poly(x, 4, 1, axis=0)
	up = np.abs(up) if up.ndim == 1 else np.max(np.abs(up), axis=1)
	m = min(len(a), len(up) // 4)
	a[:m] = np.maximum(a[:m], up[:m * 4].reshape(-1, 4).max(axis=1))
	need = np.minimum(1.0, c / np.maximum(a, 1e-12))
	# look-ahead: min filter over 2 ms then smooth release
	la = max(1, int(0.002 * SR))
	from scipy.ndimage import minimum_filter1d
	g = minimum_filter1d(need, size=2 * la + 1)
	# release smoothing (causal one-pole on the rising side only)
	coef = math.exp(-1.0 / (release * SR))
	out = np.empty_like(g)
	s = 1.0
	for i in range(len(g)):
		v = g[i]
		s = v if v < s else coef * s + (1 - coef) * v
		out[i] = s
	out = np.minimum(out, g)
	return (x.T * out).T if x.ndim == 2 else x * out
