// Phone emulation test: loads the range with touch controls in a Pixel-sized landscape viewport,
// drives the stick / look / buttons with synthetic touches, checks movement and firing, screenshots.
// Usage: node range/test/mobile.mjs [outDir]
import http from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = process.argv[2] || 'range/test/shots'; mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => { try { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const data = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data); } catch { res.writeHead(404); res.end(); } });
await new Promise(r => server.listen(8939, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const dev = devices['Pixel 5'];
const context = await browser.newContext({ ...dev, viewport: { width: 851, height: 393 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto('http://localhost:8939/range/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.g, null, { timeout: 120000 });
const mode = await page.evaluate(() => ({ touch: document.body.classList.contains('touch'), postfx: window.g.settings.postfx, fov: window.g.settings.fov }));
console.log('mode', JSON.stringify(mode));
await page.screenshot({ path: `${OUT}/m00-menu.png` });
await page.tap('#btn-resume');
await page.waitForTimeout(300);
await page.evaluate(() => { window.g.dbg.manual = true; window.g.advance(0.5); window.g.render(); });
await page.screenshot({ path: `${OUT}/m01-hip.png` });
// synthetic touch helpers
const touchSeq = async (steps) => page.evaluate(async (steps) => {
  const canvas = document.getElementById('game');
  const mk = (type, touches) => { const list = touches.map(t => new Touch({ identifier: t.id, target: canvas, clientX: t.x, clientY: t.y, pageX: t.x, pageY: t.y })); canvas.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : list, changedTouches: list, targetTouches: list, bubbles: true, cancelable: true })); };
  for (const s of steps) { mk(s.type, s.touches); if (s.advance) window.g.advance(s.advance); }
}, steps);
// walk forward with the stick for 1 s, look right 200 px
const before = await page.evaluate(() => window.g.player.pos.toArray().map(n => +n.toFixed(2)));
await touchSeq([{ type: 'touchstart', touches: [{ id: 1, x: 150, y: 300 }] }, { type: 'touchmove', touches: [{ id: 1, x: 150, y: 250 }], advance: 1.0 }, { type: 'touchend', touches: [{ id: 1, x: 150, y: 250 }], advance: 0.3 }]);
await touchSeq([{ type: 'touchstart', touches: [{ id: 2, x: 600, y: 200 }] }, { type: 'touchmove', touches: [{ id: 2, x: 700, y: 200 }], advance: 0.05 }, { type: 'touchend', touches: [{ id: 2, x: 700, y: 200 }], advance: 0.2 }]);
const after = await page.evaluate(() => ({ pos: window.g.player.pos.toArray().map(n => +n.toFixed(2)), yaw: +window.g.player.yaw.toFixed(3) }));
console.log('stick/look', JSON.stringify({ before, after }));
// strafe check with the keyboard mapping (D must move +X)
const strafe = await page.evaluate(() => { const g = window.g; g.player.yaw = 0; const x0 = g.player.pos.x; g.player.keys.right = true; g.advance(0.6); g.player.keys.right = false; g.advance(0.3); return +(g.player.pos.x - x0).toFixed(2); });
console.log('D strafe dx (expect > 0):', strafe);
// buttons: mode → semi, aim, fire (hold), reload
const tapBtn = async (act) => {
  const b = await page.$(`#touch button[data-act="${act}"]`); const box = await b.boundingBox();
  if (!box) { const diag = await page.evaluate((act) => { const el = document.querySelector(`#touch button[data-act="${act}"]`); const cs = getComputedStyle(el); return { layerCls: document.getElementById('touch').className, display: cs.display, vis: cs.visibility, rect: el.getBoundingClientRect().toJSON(), parentDisplay: getComputedStyle(el.parentElement).display, connected: el.isConnected }; }, act); throw new Error('button not visible: ' + act + ' ' + JSON.stringify(diag)); }
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};
await tapBtn('mode'); await tapBtn('aim');
await page.evaluate(() => { window.g.advance(0.8); window.g.render(); });
await page.screenshot({ path: `${OUT}/m02-aim.png` });
const fire = await page.$('#touch button[data-act="fire"]'); const fb = await fire.boundingBox();
await page.evaluate(({ x, y }) => { const b = document.querySelector('#touch button[data-act="fire"]'); const t = new Touch({ identifier: 9, target: b, clientX: x, clientY: y }); b.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true })); window.g.advance(0.062); window.g.render(); }, { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 });
await page.screenshot({ path: `${OUT}/m03-fire.png` });
await page.evaluate(({ x, y }) => { const b = document.querySelector('#touch button[data-act="fire"]'); const t = new Touch({ identifier: 9, target: b, clientX: x, clientY: y }); b.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true })); window.g.advance(0.5); }, { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 });
await tapBtn('reload'); await page.evaluate(() => { window.g.advance(0.7); window.g.render(); });
await page.screenshot({ path: `${OUT}/m04-reload.png` });
await page.evaluate(() => window.g.advance(2.0));
await tapBtn('swap'); await tapBtn('swap'); await page.evaluate(() => { window.g.advance(1.6); window.g.render(); });
await page.screenshot({ path: `${OUT}/m05-bolt.png` });
await tapBtn('aim'); await page.evaluate(() => { window.g.advance(0.8); window.g.render(); }); await page.screenshot({ path: `${OUT}/m05b-scope.png` });
await tapBtn('mag+'); await tapBtn('elev+');
const st = await page.evaluate(() => { const g = window.g; return { weapon: g.vm.id, mode: g.vm.state.mode, mag: g.vm.state.magRounds, chambered: g.vm.state.chambered, ads: g.player.adsToggle, scopeMag: g.vm.state.scopeMag, elev: g.vm.state.elevClicks, lastShot: !!g.projectiles.lastShot }; });
console.log('state', JSON.stringify(st));
await tapBtn('menu'); await page.waitForTimeout(200); await page.screenshot({ path: `${OUT}/m06-menu.png` });
// portrait layout check
await page.setViewportSize({ width: 393, height: 851 }); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/m07-portrait-menu.png` });
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.close();
process.exit(errors.length ? 1 : 0);
