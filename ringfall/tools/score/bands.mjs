import { readWav } from './lib/wav.mjs';
import { fft } from './lib/dsp.mjs';
const N = 8192, bands = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
for (const f of process.argv.slice(2)) {
  const w = readWav(f); const acc = new Float64Array(bands.length); let cnt = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N < w.n; s += N * 4) {
    for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); re[i] = (w.L[s + i] + w.R[s + i]) * 0.5 * h; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const fr = k * w.sr / N, e = re[k] ** 2 + im[k] ** 2; const b = bands.findIndex(c => fr >= c / Math.SQRT2 && fr < c * Math.SQRT2); if (b >= 0) acc[b] += e; }
    cnt++;
  }
  const db = [...acc].map(e => 10 * Math.log10(e / cnt + 1e-20));
  const ref = db[5];
  console.log(f.split('/').pop().padEnd(22), bands.map((b, i) => `${b >= 1000 ? b / 1000 + 'k' : b}:${(db[i] - ref).toFixed(0)}`).join(' '));
}
