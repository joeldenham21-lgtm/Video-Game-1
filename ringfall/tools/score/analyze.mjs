// Listening substitute: per-bar chroma (which pitch classes sound), RMS contour, loop-seam continuity.
// node analyze.mjs out/test.wav --bpm=70 --beats=4 [--pre=0.3] [--loop]
import { readWav } from './lib/wav.mjs';
import { fft } from './lib/dsp.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? +a.slice(k.length + 3) : d; };
const file = process.argv[2];
const w = readWav(file);
const bpm = arg('bpm', 120), beats = arg('beats', 4), pre = arg('pre', 0.3), loopLen = arg('len', 0);
const barSec = 60 / bpm * beats;
const N = 16384;
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const re = new Float64Array(N), im = new Float64Array(N);
const start = Math.floor(pre * w.sr);
const bars = Math.floor((w.n - start) / w.sr / barSec);
const lines = [];
for (let b = 0; b < bars; b++) {
  const chroma = new Float64Array(12);
  let rms = 0, cnt = 0;
  for (let k = 0; k < beats; k++) {
    const s = start + Math.floor((b * barSec + (k + 0.5) * barSec / beats) * w.sr) - N / 2;
    if (s < 0 || s + N > w.n) continue;
    for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); re[i] = (w.L[s + i] + w.R[s + i]) * h; im[i] = 0; rms += re[i] * re[i]; cnt++; }
    fft(re, im);
    for (let bin = 4; bin < N / 2; bin++) {
      const f = bin * w.sr / N;
      if (f < 55 || f > 2000) continue;
      const mag = Math.hypot(re[bin], im[bin]);
      const m = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(m) % 12) + 12) % 12;
      chroma[pc] += mag * mag / Math.sqrt(f); // favour fundamentals
    }
  }
  const tot = chroma.reduce((a, c) => a + c, 0) || 1;
  const top = [...chroma].map((c, i) => [c / tot, i]).sort((a, b) => b[0] - a[0]).slice(0, 4).filter(x => x[0] > 0.07);
  lines.push(`bar ${String(b + 1).padStart(2)}  ${(10 * Math.log10(rms / Math.max(1, cnt) + 1e-12)).toFixed(0).padStart(4)} dB  ${top.map(([c, i]) => PC[i] + ':' + (c * 100).toFixed(0)).join(' ')}`);
}
console.log(lines.join('\n'));
if (loopLen) {
  // seam: last samples of the loop vs first samples after loopStart
  const a = start, b = start + Math.round(loopLen * w.sr); // pass the exact loop length (bars*beats*60/bpm)
  let dSeam = 0, dTyp = 0;
  for (let i = -32; i < 32; i++) {
    const x0 = i < 0 ? w.L[b + i] : w.L[a + i], x1 = i + 1 < 0 ? w.L[b + i + 1] : w.L[a + i + 1];
    if (i === -1) dSeam = Math.abs(w.L[a] - w.L[b - 1]);
    dTyp += Math.abs(x1 - x0);
  }
  console.log(`seam step ${dSeam.toFixed(4)} vs typical ${(dTyp / 64).toFixed(4)}  (loop ${loopLen}s)`);
  let e0 = 0, e1 = 0; const W = Math.floor(0.25 * w.sr);
  for (let i = 0; i < W; i++) { e0 += w.L[b - 1 - i] ** 2; e1 += w.L[a + i] ** 2; }
  console.log(`energy 250ms before/after seam: ${(10 * Math.log10(e0 / W)).toFixed(1)} / ${(10 * Math.log10(e1 / W)).toFixed(1)} dB`);
}
