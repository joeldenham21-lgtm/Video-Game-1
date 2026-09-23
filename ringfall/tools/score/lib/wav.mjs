// Minimal WAV reader/writer: PCM 16/24/32-bit int and 32-bit float, mono/stereo → Float32 [L, R]
import { readFileSync, writeFileSync } from 'fs';

export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF: ' + path);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(p + 8), ch: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') data = [p + 8, Math.min(len, buf.length - p - 8)];
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('bad wav ' + path);
  let tag = fmt.tag;
  if (tag === 0xfffe) tag = fmt.bits === 32 && false ? 3 : 1; // extensible: assume PCM unless float flagged below
  const bps = fmt.bits / 8, n = Math.floor(data[1] / (bps * fmt.ch));
  const L = new Float32Array(n), R = new Float32Array(n);
  const off = data[0];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < Math.min(2, fmt.ch); c++) {
      const q = off + (i * fmt.ch + c) * bps;
      let v;
      if (fmt.tag === 3) v = buf.readFloatLE(q);
      else if (fmt.bits === 16) v = buf.readInt16LE(q) / 32768;
      else if (fmt.bits === 24) v = ((buf[q] | (buf[q + 1] << 8) | (buf[q + 2] << 16)) << 8 >> 8) / 8388608;
      else if (fmt.bits === 32) v = buf.readInt32LE(q) / 2147483648;
      else if (fmt.bits === 8) v = (buf[q] - 128) / 128;
      (c === 0 ? L : R)[i] = v;
    }
    if (fmt.ch === 1) R[i] = L[i];
  }
  return { sr: fmt.sr, L, R, n };
}

export function writeWav(path, L, R, sr = 44100) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  writeFileSync(path, b);
}
