// Copy rendered MP3s into the game and write music/manifest.json (loop lengths, stems, sync-marker layout).
import { copyFileSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { PRE, MARK, MARK_AT } from './lib/render.mjs';
const OUT = new URL('./out/', import.meta.url).pathname;
const DEST = new URL('../../music/', import.meta.url).pathname;
mkdirSync(DEST, { recursive: true });
for (const f of readdirSync(DEST)) if (f.endsWith('.mp3')) rmSync(join(DEST, f));
const manifest = { v: Date.now(), mark: MARK, markAt: MARK_AT, pre: PRE, tracks: {}, stingers: {},
  credit: 'Orchestral samples: VS Chamber Orchestra 2 Community Edition and Versilian Community Sample Library (Versilian Studios, CC0).' };
for (const name of ['menu', 'combat', 'combat2', 'boss', 'final', 'victory']) {
  const t = (await import(`./tracks/${name}.mjs`)).default;
  const len = t.bars * t.beats * 60 / t.bpm;
  const stems = {};
  for (const s of t.stems) { const f = t.stems.length > 1 ? `${name}_${s}.mp3` : `${name}.mp3`; copyFileSync(join(OUT, f), join(DEST, f)); stems[s] = f; }
  manifest.tracks[name] = { len, loop: t.loop, bpm: t.bpm, stems };
}
for (const t of (await import('./tracks/stingers.mjs')).default) {
  const f = `${t.name}.mp3`;
  copyFileSync(join(OUT, f), join(DEST, f));
  manifest.stingers[t.name] = f;
}
writeFileSync(join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(Object.keys(manifest.tracks).length, 'tracks,', Object.keys(manifest.stingers).length, 'stingers →', DEST);
