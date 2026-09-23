// Timpani principal-tone estimate: the (1,1) mode with its near-harmonic companions at ≈1.5× and ≈2×.
import { fft } from './dsp.mjs';
export function timpaniPitch(w) {
  let pk = 0, pi = 0;
  for (let i = 0; i < w.n; i++) { const a = Math.abs(w.L[i]); if (a > pk) { pk = a; pi = i; } }
  const N = 32768, re = new Float64Array(N), im = new Float64Array(N);
  const st = pi + Math.floor(0.08 * w.sr);
  for (let i = 0; i < N; i++) { const s = st + i; const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); re[i] = s < w.n ? (w.L[s] + w.R[s]) * h : 0; }
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  const at = (f, tol = 0.012) => { const k0 = Math.floor(f * (1 - tol) * N / w.sr), k1 = Math.ceil(f * (1 + tol) * N / w.sr); let m = 0; for (let k = k0; k <= k1; k++) m = Math.max(m, mag[k] || 0); return m; };
  let best = 0, bf = 0;
  for (let f = 65; f <= 260; f *= 1.0015) {
    const s = Math.log1p(at(f) * 50) + 0.8 * Math.log1p(at(f * 1.5) * 50) + 0.7 * Math.log1p(at(f * 2.0) * 50) - 0.6 * Math.log1p(at(f * 0.5) * 50);
    if (s > best) { best = s; bf = f; }
  }
  return 69 + 12 * Math.log2(bf / 440);
}
