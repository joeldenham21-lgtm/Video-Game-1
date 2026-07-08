// Elderfall smoke test: boots the game headless, captures console errors,
// walks around, opens the weapon wheel, screenshots several times of day.
// Usage: node test/smoke.mjs [--quick]
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname;
const QUICK = process.argv.includes('--quick');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  try {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const data = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('nf');
  }
});
await new Promise(r => server.listen(8931, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 844, height: 390 } }); // phone landscape

const errors = [];
const warnings = [];
page.on('console', m => {
  const t = m.type();
  if (t === 'error') errors.push(m.text());
  else if (t === 'warning') warnings.push(m.text());
});
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8931/?debug', { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.screenshot({ path: 'test/shots/00-title.png' });

await page.click('#btn-new');
console.log('booting...');
await page.waitForTimeout(6000);
await page.screenshot({ path: 'test/shots/01-spawn.png' });

// report boot state
const state = await page.evaluate(() => {
  const g = window.g;
  if (!g) return { ok: false };
  return {
    ok: true,
    playerPos: g.player ? g.player.position.toArray().map(n => +n.toFixed(1)) : null,
    hp: g.player?.stats?.hp,
    dayFrac: +g.time.dayFrac.toFixed(3),
    calls: g.renderer.info.render.calls,
    tris: g.renderer.info.render.triangles,
    enemies: g.enemies?.list?.length,
    interactables: g.interactables.length,
    colliders: g.colliders.length,
  };
});
console.log('STATE:', JSON.stringify(state));

if (!QUICK && state.ok) {
  // walk forward + look around via keyboard/mouse
  await page.mouse.click(422, 195); // focus/pointer lock attempt
  await page.keyboard.down('w');
  await page.waitForTimeout(2500);
  await page.keyboard.up('w');
  await page.screenshot({ path: 'test/shots/02-walked.png' });

  // attack swing
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test/shots/03-attack.png' });

  // different times of day (golden hour, night)
  for (const [name, f] of [['04-sunset', 0.73], ['05-night', 0.0], ['06-dawn', 0.27], ['07-noon', 0.5]]) {
    await page.evaluate((frac) => { window.g.time.dayFrac = frac; }, f);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `test/shots/${name}.png` });
  }

  // teleport to look at village from a hill
  await page.evaluate(() => {
    const g = window.g;
    g.player.position.set(60, 0, 90);
    g.player.yaw = Math.PI * 0.85;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test/shots/08-village.png' });

  const perf = await page.evaluate(() => new Promise(res => {
    let frames = 0; const t0 = performance.now();
    function f() { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res({ fps: +(frames / 3).toFixed(1), calls: window.g.renderer.info.render.calls, tris: window.g.renderer.info.render.triangles }); }
    requestAnimationFrame(f);
  }));
  console.log('PERF:', JSON.stringify(perf));
}

console.log('ERRORS(' + errors.length + '):');
for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e.slice(0, 300));
console.log('WARNINGS(' + warnings.length + '):', [...new Set(warnings)].slice(0, 5).map(w => w.slice(0, 160)));

await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
