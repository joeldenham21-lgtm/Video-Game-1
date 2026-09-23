import { renderTrack } from './lib/render.mjs';
const OUT = new URL('./out/', import.meta.url).pathname;
const names = process.argv.slice(2).filter(a => !a.startsWith('--'));
const wav = process.argv.includes('--wav');
for (const n of names) {
  const t = (await import(`./tracks/${n}.mjs?${Date.now()}`)).default;
  const tracks = Array.isArray(t) ? t : [t];
  for (const tr of tracks) console.log(JSON.stringify(renderTrack(tr, OUT, { wav })));
}
