// Spectrogram PNG (log-frequency, dB colour) for visual inspection of renders.
// node spectro.mjs file.wav out.png [--from=0] [--dur=30] [--w=1400] [--h=420]
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { readWav } from './lib/wav.mjs';
import { fft } from './lib/dsp.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? +a.slice(k.length + 3) : d; };
const [file, outPng] = process.argv.slice(2);
const w = readWav(file);
const from = arg('from', 0), dur = arg('dur', Math.min(30, w.n / w.sr - from)), W = arg('w', 1400), H = arg('h', 420);
const N = 4096, re = new Float64Array(N), im = new Float64Array(N);
const img = Buffer.alloc((W * 3 + 1) * (H + 40));
const fmin = 40, fmax = 16000;
const colour = (v) => { // v 0..1 → dark blue → magenta → orange → white
  const stops = [[0, 0, 8], [40, 10, 90], [150, 30, 140], [240, 110, 40], [255, 230, 150], [255, 255, 255]];
  const x = Math.max(0, Math.min(0.9999, v)) * (stops.length - 1), i = Math.floor(x), f = x - i;
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f));
};
const rmsRow = new Float32Array(W);
for (let x = 0; x < W; x++) {
  const c = Math.floor((from + (x / W) * dur) * w.sr) - N / 2;
  let e = 0;
  for (let i = 0; i < N; i++) { const s = c + i; const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); const v = s >= 0 && s < w.n ? (w.L[s] + w.R[s]) * 0.5 : 0; re[i] = v * h; im[i] = 0; e += v * v; }
  rmsRow[x] = 10 * Math.log10(e / N + 1e-12);
  fft(re, im);
  for (let y = 0; y < H; y++) {
    const f = fmin * Math.pow(fmax / fmin, 1 - y / H);
    const bin = f * N / w.sr, b0 = Math.floor(bin), fr = bin - b0;
    const m = Math.hypot(re[b0], im[b0]) * (1 - fr) + Math.hypot(re[b0 + 1], im[b0 + 1]) * fr;
    const db = 20 * Math.log10(m / (N / 4) + 1e-9);
    const [r, g, b] = colour((db + 90) / 80);
    const o = y * (W * 3 + 1) + 1 + x * 3;
    img[o] = r; img[o + 1] = g; img[o + 2] = b;
  }
  // loudness strip under the spectrogram
  const lv = Math.max(0, Math.min(40, Math.round((rmsRow[x] + 60) / 60 * 40)));
  for (let y = 0; y < 40; y++) { const o = (H + y) * (W * 3 + 1) + 1 + x * 3; const on = 40 - y <= lv; img[o] = on ? 120 : 10; img[o + 1] = on ? 200 : 10; img[o + 2] = on ? 255 : 20; }
}
// octave guides (C notes) and second ticks
for (let y = 0; y < H; y++) {
  const f = fmin * Math.pow(fmax / fmin, 1 - y / H), m = 69 + 12 * Math.log2(f / 440);
  if (Math.abs(m - Math.round(m / 12) * 12) < 0.07) for (let x = 0; x < W; x += 4) { const o = y * (W * 3 + 1) + 1 + x * 3; img[o] = 90; img[o + 1] = 90; img[o + 2] = 90; }
}
for (let s = Math.ceil(from); s < from + dur; s++) { const x = Math.floor((s - from) / dur * W); for (let y = H; y < H + 8; y++) { const o = y * (W * 3 + 1) + 1 + x * 3; img[o] = img[o + 1] = img[o + 2] = 255; } }
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H + 40, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(outPng, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', outPng);
