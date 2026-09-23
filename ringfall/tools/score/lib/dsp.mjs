// DSP toolkit for the offline orchestral renderer: FFT, stereo convolution, biquads,
// hall impulse response, K-weighted loudness, peak limiter.

// ---------------------------------------------------------------- FFT
const tables = new Map();
function tab(n) {
  let t = tables.get(n);
  if (t) return t;
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0, x = i;
    for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  t = { rev, cos, sin };
  tables.set(n, t);
  return t;
}

export function fft(re, im, inverse = false) {
  const n = re.length, { rev, cos, sin } = tab(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0, ti = 0; k < half; k++, ti += step) {
        const wr = cos[ti], wi = sgn * sin[ti];
        const a = s + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Stereo convolution by overlap-add: yL = xL * hL, yR = xR * hR.
// Two real channels ride in one complex FFT.
export function convolveStereo(xL, xR, hL, hR, outLen = xL.length + hL.length - 1) {
  const hn = Math.max(hL.length, hR.length);
  let N = 1; while (N < hn * 2) N <<= 1;
  const B = N - hn + 1;
  // IR spectra
  const HLr = new Float64Array(N), HLi = new Float64Array(N), HRr = new Float64Array(N), HRi = new Float64Array(N);
  HLr.set(hL); HRr.set(hR);
  fft(HLr, HLi); fft(HRr, HRi);
  const yL = new Float32Array(outLen), yR = new Float32Array(outLen);
  const zr = new Float64Array(N), zi = new Float64Array(N);
  for (let s = 0; s < xL.length; s += B) {
    zr.fill(0); zi.fill(0);
    const m = Math.min(B, xL.length - s);
    for (let i = 0; i < m; i++) { zr[i] = xL[s + i]; zi[i] = xR[s + i]; }
    fft(zr, zi);
    // split Z into A (left) and B (right), multiply, recombine as A·HL + i·B·HR
    const wr = new Float64Array(N), wi = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const nk = (N - k) & (N - 1);
      const ar = (zr[k] + zr[nk]) * 0.5, ai = (zi[k] - zi[nk]) * 0.5;
      const br = (zi[k] + zi[nk]) * 0.5, bi = -(zr[k] - zr[nk]) * 0.5;
      const pr = ar * HLr[k] - ai * HLi[k], pi = ar * HLi[k] + ai * HLr[k];
      const qr = br * HRr[k] - bi * HRi[k], qi = br * HRi[k] + bi * HRr[k];
      wr[k] = pr - qi; wi[k] = pi + qr;
    }
    fft(wr, wi, true);
    const lim = Math.min(N, outLen - s);
    for (let i = 0; i < lim; i++) { yL[s + i] += wr[i]; yR[s + i] += wi[i]; }
  }
  return [yL, yR];
}

// ---------------------------------------------------------------- biquads (RBJ cookbook)
export function biquad(type, f, sr, q = 0.707, gainDb = 0) {
  const w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w);
  const A = Math.pow(10, gainDb / 40), alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'peak') { b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; }
  else if (type === 'ls' || type === 'hs') {
    const s = 2 * Math.sqrt(A) * alpha, sg = type === 'ls' ? -1 : 1;
    b0 = A * ((A + 1) + sg * (A - 1) * cw + s);
    b1 = -2 * sg * A * ((A - 1) + sg * (A + 1) * cw);
    b2 = A * ((A + 1) + sg * (A - 1) * cw - s);
    a0 = (A + 1) - sg * (A - 1) * cw + s;
    a1 = 2 * sg * ((A - 1) - sg * (A + 1) * cw);
    a2 = (A + 1) - sg * (A - 1) * cw - s;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
export function filterInPlace(x, c) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
  return x;
}
// eq: [['hp', 40], ['hs', 8000, 0.7, -2], ['peak', 300, 1, -2], ['lp', 12000]]
export function eqStereo(L, R, eq, sr) {
  for (const [type, f, q = 0.707, g = 0] of eq) {
    const c = biquad(type, f, sr, q, g);
    filterInPlace(L, c); filterInPlace(R, c);
  }
}

// ---------------------------------------------------------------- random
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  next.gauss = () => { let u = 0, v = 0; while (!u) u = next(); while (!v) v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return next;
}

// ---------------------------------------------------------------- hall impulse response
// Decorrelated stereo noise tail with band-dependent decay, pre-delay and a cluster of early reflections.
export function hallIR(sr, o = {}) {
  const { len = 3.6, pre = 0.02, rtLow = 3.1, rtMid = 2.5, rtHigh = 1.3, erCount = 18, erSpread = 0.075, seed = 7, damp = 7500 } = o;
  const n = Math.floor(len * sr), P = Math.floor(pre * sr);
  const out = [];
  for (let c = 0; c < 2; c++) {
    const r = rng(seed * 31 + c * 977);
    const lo = new Float32Array(n), mid = new Float32Array(n), hi = new Float32Array(n);
    for (let i = P; i < n; i++) { const g = r.gauss(); lo[i] = g; mid[i] = g; hi[i] = g; }
    filterInPlace(lo, biquad('lp', 280, sr, 0.6));
    filterInPlace(hi, biquad('hp', 3800, sr, 0.6));
    const cl = biquad('hp', 280, sr, 0.6), ch = biquad('lp', 3800, sr, 0.6);
    filterInPlace(mid, cl); filterInPlace(mid, ch);
    const h = new Float32Array(n);
    for (let i = P; i < n; i++) {
      const t = (i - P) / sr;
      const fade = Math.min(1, t / 0.06); // smooth tail onset
      h[i] = fade * (lo[i] * Math.exp(-6.91 * t / rtLow) * 1.1 + mid[i] * Math.exp(-6.91 * t / rtMid) + hi[i] * Math.exp(-6.91 * t / rtHigh) * 0.7);
    }
    filterInPlace(h, biquad('lp', damp, sr, 0.5));
    // early reflections
    for (let k = 0; k < erCount; k++) {
      const t = 0.006 + Math.pow(r(), 0.8) * erSpread;
      const idx = Math.floor((pre * 0.5 + t) * sr);
      const g = (0.9 - t / erSpread * 0.6) * (r() < 0.5 ? -1 : 1) * 1.6;
      for (let j = 0; j < 24 && idx + j < n; j++) h[idx + j] += g * Math.exp(-j / 5) * 0.4;
    }
    out.push(h);
  }
  // energy normalise (same scale for both channels)
  let e = 0; for (const h of out) for (let i = 0; i < n; i++) e += h[i] * h[i];
  const k = 1 / Math.sqrt(e / 2);
  for (const h of out) for (let i = 0; i < n; i++) h[i] *= k;
  return out;
}

// ---------------------------------------------------------------- loudness (BS.1770 style, gated)
export function lufs(L, R, sr) {
  const kL = Float32Array.from(L), kR = Float32Array.from(R);
  const s1 = biquad('hs', 1681, sr, 0.71, 4), s2 = biquad('hp', 38, sr, 0.5);
  for (const x of [kL, kR]) { filterInPlace(x, s1); filterInPlace(x, s2); }
  const blk = Math.floor(0.4 * sr), hop = Math.floor(0.1 * sr), ms = [];
  for (let s = 0; s + blk <= kL.length; s += hop) {
    let a = 0;
    for (let i = s; i < s + blk; i++) a += kL[i] * kL[i] + kR[i] * kR[i];
    ms.push(a / blk);
  }
  const L_ = (m) => -0.691 + 10 * Math.log10(m + 1e-12);
  let g = ms.filter(m => L_(m) > -70);
  if (!g.length) return { integrated: -70, momentaryMax: -70 };
  const rel = L_(g.reduce((a, b) => a + b, 0) / g.length) - 10;
  g = g.filter(m => L_(m) > rel);
  const max = Math.max(...ms.map(L_));
  return { integrated: L_(g.reduce((a, b) => a + b, 0) / g.length), momentaryMax: max };
}

export function peak(L, R) { let p = 0; for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > p) p = a; } return p; }

// ---------------------------------------------------------------- dynamics
// Gentle feed-forward compressor (RMS detector, soft knee) then a look-ahead peak limiter.
export function compress(L, R, sr, { thresh = -18, ratio = 2, attack = 0.03, release = 0.25, knee = 6, makeup = 0 } = {}) {
  const aA = Math.exp(-1 / (attack * sr)), aR = Math.exp(-1 / (release * sr));
  let env = 0;
  for (let i = 0; i < L.length; i++) {
    const x = (L[i] * L[i] + R[i] * R[i]) * 0.5;
    env = x > env ? aA * env + (1 - aA) * x : aR * env + (1 - aR) * x;
    const db = 10 * Math.log10(env + 1e-12);
    let over = db - thresh, red = 0;
    if (over > knee / 2) red = over * (1 - 1 / ratio);
    else if (over > -knee / 2) red = (over + knee / 2) ** 2 / (2 * knee) * (1 - 1 / ratio);
    const g = Math.pow(10, (makeup - red) / 20);
    L[i] *= g; R[i] *= g;
  }
}
export function limit(L, R, sr, { ceiling = -1, look = 0.003, release = 0.15 } = {}) {
  const c = Math.pow(10, ceiling / 20), la = Math.max(2, Math.floor(look * sr)), aR = Math.exp(-1 / (release * sr));
  const n = L.length, need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); need[i] = a > c ? c / a : 1; }
  // centred running minimum (window 2·la+1) via a monotonic deque
  const m = new Float32Array(n), dq = new Int32Array(n);
  let h = 0, t = 0;
  for (let j = 0; j < n + la; j++) {
    if (j < n) { while (t > h && need[dq[t - 1]] >= need[j]) t--; dq[t++] = j; }
    const i = j - la;
    if (i >= 0) { while (dq[h] < i - la) h++; m[i] = need[dq[h]]; }
  }
  // box average over the look-ahead makes the gain ramp smooth and still reach the minimum at each peak
  const half = la >> 1, pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + m[i];
  let s = 1;
  for (let i = 0; i < n; i++) {
    const a0 = Math.max(0, i - half), a1 = Math.min(n, i + half + 1);
    const a = (pre[a1] - pre[a0]) / (a1 - a0);
    s = a < s ? a : aR * s + (1 - aR) * a;
    L[i] *= s; R[i] *= s;
  }
}
