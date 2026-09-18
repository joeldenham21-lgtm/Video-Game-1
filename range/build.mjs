// Builds range/dist/range.html — a single self-contained file (three.js, Rapier, the HDRI and
// all game code inlined) that runs from a double-click / file:// with no server.
// Usage: node range/build.mjs        (needs esbuild: `npm i -g esbuild`, or set ESBUILD=/path/to/esbuild)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'dist'); mkdirSync(out, { recursive: true });

function findEsbuild() {
  const cands = [process.env.ESBUILD, join(root, 'node_modules/.bin/esbuild'), join(here, 'node_modules/.bin/esbuild')].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return 'npx'; // falls back to `npx esbuild`
}
const esb = findEsbuild();
const args = [join(here, 'src/main.js'), '--bundle', '--format=iife', '--target=es2020', '--minify', '--charset=utf8', `--alias:three=${join(root, 'vendor/three.module.js')}`, '--log-level=warning'];
const js = esb === 'npx' ? execFileSync('npx', ['--yes', 'esbuild@0.24.2', ...args], { maxBuffer: 1 << 28 }).toString() : execFileSync(esb, args, { maxBuffer: 1 << 28 }).toString();

const hdrPath = join(here, 'assets', process.env.RANGE_HDR || 'quarry_01_1k.hdr');
const hdrB64 = existsSync(hdrPath) ? readFileSync(hdrPath).toString('base64') : null;
let html = readFileSync(join(here, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/m, () => '');
const inline = (hdrB64 ? `<script>window.__RANGE_HDR__='data:application/octet-stream;base64,${hdrB64}';</script>\n` : '') + `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`;
// function replacement: the bundle contains `$&`-style sequences that String.replace would otherwise expand
html = html.replace('<script type="module" src="./src/main.js"></script>', () => inline);
html = html.replace('<title>RANGE — ballistics &amp; gun-handling sandbox</title>', '<title>RANGE — ballistics &amp; gun-handling sandbox (single file)</title>');
const target = join(out, 'range.html');
writeFileSync(target, html);
console.log(`wrote ${target}  (${(html.length / 1048576).toFixed(2)} MB; js ${(js.length / 1048576).toFixed(2)} MB, hdr ${hdrB64 ? (hdrB64.length / 1048576).toFixed(2) + ' MB' : 'none'})`);
