// YIN fundamental estimate on a mono window
export function yin(x, sr, fmin = 25, fmax = 2500) {
  const W = Math.min(x.length >> 1, Math.floor(sr / fmin) * 2);
  const tmin = Math.floor(sr / fmax), tmax = Math.min(Math.floor(sr / fmin), x.length - W - 1);
  const d = new Float64Array(tmax + 1);
  for (let t = 1; t <= tmax; t++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = x[i] - x[i + t]; s += v * v; }
    d[t] = s;
  }
  let run = 0; const cm = new Float64Array(tmax + 1); cm[0] = 1;
  for (let t = 1; t <= tmax; t++) { run += d[t]; cm[t] = d[t] * t / (run || 1); }
  let best = -1;
  for (let t = tmin; t <= tmax; t++) if (cm[t] < 0.12) { while (t + 1 <= tmax && cm[t + 1] < cm[t]) t++; best = t; break; }
  if (best < 0) { let m = Infinity; for (let t = tmin; t <= tmax; t++) if (cm[t] < m) { m = cm[t]; best = t; } }
  // parabolic refine
  const a = cm[best - 1] ?? cm[best], b = cm[best], c = cm[best + 1] ?? cm[best];
  const sh = (a - c) / (2 * (a - 2 * b + c) || 1);
  return sr / (best + (Math.abs(sh) < 1 ? sh : 0));
}
export const midiOf = (f) => 69 + 12 * Math.log2(f / 440);
