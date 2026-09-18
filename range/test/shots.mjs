// Screenshot harness: serves the repo root, opens range/test/viewer.html for each weapon and
// saves views into the scratchpad. Usage: node range/test/shots.mjs [outDir] [weapons...]
import http from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = process.argv[2] || 'range/test/shots';
const WEAPONS = process.argv.length > 3 ? process.argv.slice(3) : ['ar15', 'pistol', 'bolt'];
mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  try { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const data = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(8932, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
const views = process.env.VIEWS ? process.env.VIEWS.split(',') : ['side', 'side_r', 'q34', 'top', 'port', 'grip', 'muzzle', 'optic', 'rear', 'ads'];
for (const w of WEAPONS) {
  const extra = process.env.QS ? '&' + process.env.QS : '';
  await page.goto(`http://localhost:8932/range/test/viewer.html?w=${w}${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  for (const v of views) {
    const info = await page.evaluate((v) => window.snap(v), v);
    await page.screenshot({ path: `${OUT}/${w}-${v}.png` });
    if (v === views[0]) console.log(w, JSON.stringify(info), JSON.stringify(await page.evaluate(() => window.sunInfo || null)));
  }
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.close();
