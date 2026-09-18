// First-person screenshots of the viewmodel in various handling states.
// Usage: node range/test/fpshots.mjs outDir [weapon]
import http from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = process.argv[2] || 'range/test/shots'; mkdirSync(OUT, { recursive: true });
const WEAPONS = process.argv.length > 3 ? process.argv.slice(3) : ['ar15', 'pistol', 'bolt'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => { try { const p = decodeURIComponent(req.url.split('?')[0]); const data = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data); } catch { res.writeHead(404); res.end(); } });
await new Promise(r => server.listen(8933, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + e.stack));
const SCRIPT = process.env.SCRIPT; // optional custom
for (const w of WEAPONS) {
  await page.goto(`http://localhost:8933/range/test/fpview.html?w=${w}${process.env.QS ? '&' + process.env.QS : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
  const shot = async (name, run) => { await page.evaluate(run); if (only && !only.includes(name)) return; await page.evaluate(() => window.render()); await page.screenshot({ path: `${OUT}/${w}-${name}.png` }); };
  await shot('hip', () => { window.step(1.0); });
  await shot('ads', () => { window.input.ads = true; window.step(1.2); });
  await shot('fire', () => { window.vm.state.mode = 'semi'; window.vm.fireDown(); window.step(0.075); window.vm.fireUp(); });
  await shot('fire2', () => { window.step(0.03); });
  await shot('fire3', () => { window.step(0.25); });
  await shot('reload1', () => { window.input.ads = false; window.step(0.5); window.vm.reload(); window.step(0.42); });
  await shot('reload2', () => { window.step(0.55); });
  await shot('reload3', () => { window.step(0.42); });
  await shot('reload4', () => { window.step(0.35); });
  await shot('reload5', () => { window.step(0.30); });
  await shot('charge1', () => { window.step(1.5); window.vm.chargeAction(); window.step(0.35); });
  await shot('charge2', () => { window.step(0.28); });
  await shot('charge3', () => { window.step(0.30); });
  await shot('inspect', () => { window.step(1.5); window.vm.inspect(); window.step(1.0); });
  await shot('inspect2', () => { window.step(1.6); });
  const l = await page.evaluate(() => ({ log: window.log.slice(0, 60), state: JSON.parse(JSON.stringify(window.vm.state)) }));
  console.log(w, JSON.stringify(l));
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.close();
