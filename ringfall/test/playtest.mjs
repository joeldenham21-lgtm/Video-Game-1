// Automated playtest: a bot plays RINGFALL in headless Chromium, picking augments and fighting through floors.
// Usage: node test/playtest.mjs [--phone] [--floor=N] [--seconds=S] [--god] [--shots=every_s] [--diff=veteran]
import http from 'http';
import { readFile, mkdir } from 'fs/promises';
import { extname, join } from 'path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.env.SHOTS || join(ROOT, 'test/shots');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const PHONE = has('phone');
const SECONDS = +arg('seconds', 90);
const FLOOR = +arg('floor', 1);
const SHOT_EVERY = +arg('shots', 15);
const DIFF = arg('diff', 'veteran');
const TAG = arg('tag', PHONE ? 'phone' : 'desk');

await mkdir(OUT, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const d = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': extname(p) === '.html' ? 'text/html' : 'text/javascript' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext(PHONE
  ? { viewport: { width: 740, height: 360 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + (e.stack || e.message)));
await page.goto(`http://localhost:${port}/index.html?debug&sim=${arg('sim', 6)}`);
await page.waitForFunction(() => window.g && window.g.mode === 'title', null, { timeout: 60000 });
await page.evaluate(({ diff, floor, god }) => {
  const g = window.g;
  g.settings.quality = 'low';
  g.renderer.setQuality('low', false);
  g.events.emit('startRun', { difficulty: diff, checkpoint: false });
  if (god) g.debug.god(true);
  if (floor > 1) g.debug.floor(floor);
  // --- bot brain, runs every frame
  const keys = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  let strafe = 'KeyD', strafeT = 0, jumpT = 1, dashT = 2, lastFloor = 0;
  window.__bot = { floors: [], picks: [], deaths: 0, maxEnemies: 0, frames: 0, slow: 0 };
  function tick(dt) {
    const dtm = dt * 1000;
    const B = window.__bot;
    B.frames++;
    if (g.mode === 'augment') {
      const card = document.querySelector('.aug');
      if (card && !card._clicked) { card._clicked = true; B.picks.push(card.dataset.id); setTimeout(() => card.click(), 400); }
      return;
    }
    if (g.mode === 'dead') {
      B.deaths++;
      const b = document.querySelector('#e-new');
      if (b && !b._c) { b._c = true; b.click(); }
      return;
    }
    if (g.mode !== 'playing') return;
    if (g.run && g.run.floor !== lastFloor) { lastFloor = g.run.floor; B.floors.push({ floor: lastFloor, t: Math.round(g.run.time) }); }
    const pl = g.player;
    B.maxEnemies = Math.max(B.maxEnemies, g.enemies.alive);
    // pick a target: staggered first, then nearest with line of sight
    let best = null, bd = 1e9;
    const eye = pl.eyePos.clone();
    for (const e of g.enemies.list) {
      if (!e.alive || e.warp > 0) continue;
      let d = e.aimPoint.distanceTo(eye);
      if (e.staggered) d -= 15;
      if (e.type === 'pylon') d -= 5;
      if (d < bd) { bd = d; best = e; }
    }
    g.input.held.fire = false;
    if (best) {
      const t = best.aimPoint;
      const dx = t.x - eye.x, dy = t.y - eye.y, dz = t.z - eye.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
      pl.yaw += wrap(yaw - pl.yaw) * 0.25;
      pl.pitch += (pitch - pl.pitch) * 0.25;
      g.input.held.fire = true;
      if (best.staggered && bd < -6) { keys('KeyF', true); keys('KeyF', false); }
      // weapon choice
      const dist = best.aimPoint.distanceTo(eye);
      const want = dist < 9 ? 'Digit2' : best.type === 'brute' || best.def.boss ? (g.weapons.owned.includes('nova') ? 'Digit4' : 'Digit3') : dist > 25 && g.weapons.owned.includes('lance') ? 'Digit3' : 'Digit1';
      if (Math.random() < 0.02) { keys(want, true); keys(want, false); }
    }
    // movement: circle strafe + jumps + dashes
    strafeT -= dtm / 1000; jumpT -= dtm / 1000; dashT -= dtm / 1000;
    if (strafeT <= 0) { keys(strafe, false); strafe = Math.random() < 0.5 ? 'KeyA' : 'KeyD'; keys(strafe, true); strafeT = 1 + Math.random() * 2; keys('KeyW', Math.random() < 0.4); keys('KeyS', false); }
    if (Math.hypot(pl.pos.x, pl.pos.z) > g.arena.bounds - 8) { keys('KeyW', true); }
    if (jumpT <= 0) { keys('Space', true); setTimeout(() => keys('Space', false), 60); jumpT = 1.5 + Math.random() * 3; }
    if (dashT <= 0) { keys('ShiftLeft', true); setTimeout(() => keys('ShiftLeft', false), 60); dashT = 2 + Math.random() * 3; }
    if (pl.od >= 100 && Math.random() < 0.05) { keys('KeyQ', true); keys('KeyQ', false); }
  }
  g.debugHook = tick;
}, { diff: DIFF, floor: FLOOR, god: has('god') });

const t0 = Date.now();
let shot = 0;
while ((Date.now() - t0) / 1000 < SECONDS) {
  await page.waitForTimeout(SHOT_EVERY * 1000);
  const s = await page.evaluate(() => {
    const g = window.g;
    return { mode: g.mode, floor: g.run?.floor, wave: g.director.waveIdx + 1, state: g.director.state, alive: g.enemies.alive, hp: Math.round(g.player.hp), sh: Math.round(g.player.shield),
      kills: g.player.kills, score: g.style.score, rank: g.style.rank, t: Math.round(g.run?.time || 0), calls: g.renderer.gl.info.render.calls, boss: g.boss.active ? Math.round(g.boss.hpFrac * 100) : null,
      augs: g.augments.list.length, weap: g.weapons.current, bot: window.__bot };
  });
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, JSON.stringify({ ...s, bot: undefined }), 'floors:', JSON.stringify(s.bot.floors.map(f => f.floor)), 'deaths:', s.bot.deaths);
  if (arg('probe', '')) console.log('  probe:', await page.evaluate(arg('probe', '')).catch(e => 'ERR ' + e.message));
  await page.screenshot({ path: join(OUT, `play-${TAG}-${String(shot++).padStart(2, '0')}.png`) });
}
const bot = await page.evaluate(() => window.__bot);
console.log('BOT:', JSON.stringify(bot));
const uniq = [...new Set(errors)].filter(e => !/fonts\.g|ERR_FAILED|net::/.test(e));
console.log(`ERRORS (${uniq.length}):\n  ` + uniq.slice(0, 20).map(e => e.slice(0, 600)).join('\n  '));
await browser.close();
server.close();
process.exit(uniq.length ? 1 : 0);
