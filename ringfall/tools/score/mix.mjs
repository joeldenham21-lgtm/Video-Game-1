import { readWav, writeWav } from './lib/wav.mjs';
const [out, ...ins] = process.argv.slice(2);
const ws = ins.map(f => readWav(f));
const n = Math.min(...ws.map(w => w.n));
const L = new Float32Array(n), R = new Float32Array(n);
for (const w of ws) for (let i = 0; i < n; i++) { L[i] += w.L[i]; R[i] += w.R[i]; }
writeWav(out, L, R, 44100);
