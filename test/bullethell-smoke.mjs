// Hollow Choir smoke test: boots the single-file build (bullethell/index.html) headless, captures console errors,
// drives every stage (waves + boss) with an invulnerable auto-moving pilot,
// and screenshots each world and boss. Usage: node test/bullethell-smoke.mjs [--quick]
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const QUICK = process.argv.includes('--quick');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try { let p = req.url.split('?')[0]; if (p.endsWith('/')) p += 'index.html'; const data = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(8942, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + e.stack));
await page.goto('http://localhost:8942/bullethell/?debug', { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.screenshot({ path: 'test/bh-shots/00-title.png' });
// menu flow
await page.click('button.primary'); await page.waitForTimeout(150); await page.screenshot({ path: 'test/bh-shots/01-difficulty.png' });
await page.click('button.card.primary'); await page.waitForTimeout(150); await page.screenshot({ path: 'test/bh-shots/02-ships.png' });
await page.click('button.card.primary'); await page.waitForTimeout(300);
await page.screenshot({ path: 'test/bh-shots/03-stage1-start.png' });

// drive: run N ticks with invulnerable, wandering pilot. Returns state summary.
const drive = (ticks, opts = {}) => page.evaluate(({ ticks, opts }) => {
  const g = window.g; const p = g.player; g.player.invulnDebug = true;
  let maxBullets = 0, maxParts = 0;
  for (let i = 0; i < ticks; i++) {
    if (g.state !== 'playing') break;
    // wander toward a target under the boss/enemies, random jitter
    const tx = (g.boss ? g.boss.x : g.W / 2) + Math.sin(g.t * 1.3) * 160, ty = g.H - 160 + Math.sin(g.t * 0.7) * 80;
    p.x += Math.sign(tx - p.x) * Math.min(4, Math.abs(tx - p.x)); p.y += Math.sign(ty - p.y) * Math.min(3, Math.abs(ty - p.y));
    if (opts.bombEvery && i % opts.bombEvery === opts.bombEvery - 1) { p.bombs = Math.max(p.bombs, 1); p.tryBomb(); }
    if (opts.over && p.over >= 1 && p.overActive <= 0) p.startOverdrive();
    if (opts.killBoss && g.boss && !g.boss.entering && g.boss.dying <= 0 && g.boss.t > (opts.phaseSeconds || 8)) g.boss.hp = 0;
    if (opts.dps && g.boss && !g.boss.entering && g.boss.dying <= 0) g.boss.damage(opts.dps / 60);
    g.tick(1 / 60);
    maxBullets = Math.max(maxBullets, g.bullets.length); maxParts = Math.max(maxParts, g.fx.parts.length);
  }
  g.render();
  return { state: g.state, t: +g.t.toFixed(1), score: Math.floor(g.score), bullets: g.bullets.length, maxBullets, maxParts, enemies: g.enemies.length, boss: g.boss ? g.boss.name + ' p' + g.boss.pi + ' hp' + Math.floor(g.boss.hp) : null, bossState: g.bossState, lives: p.lives, power: p.power, graze: p.graze, ui: g.ui.screen };
}, { ticks, opts });

const summary = [];
const stages = QUICK ? [0] : [0, 1, 2, 3, 4, 5, 6];
for (const si of stages) {
  if (si > 0) {
    await page.evaluate((si) => { window.g.startRun({ diff: si % 2 ? 'lunatic' : 'normal', ship: ['vesper', 'lance', 'wraith'][si % 3], stage: si, practice: true }); }, si);
    await page.waitForTimeout(100);
  }
  // waves: ~1/3 in, screenshot
  let r = await drive(60 * 30, { over: true }); console.log(`stage ${si + 1} waves@30s`, JSON.stringify(r));
  await page.screenshot({ path: `test/bh-shots/s${si + 1}-a-waves.png` });
  r = await drive(60 * 60, { over: true, bombEvery: 60 * 25 }); console.log(`stage ${si + 1} waves@90s`, JSON.stringify(r));
  await page.screenshot({ path: `test/bh-shots/s${si + 1}-b-waves.png` });
  // boss: let phases run for a while at real damage then force through
  r = await drive(60 * 12, { over: true }); console.log(`stage ${si + 1} boss intro`, JSON.stringify(r));
  await page.screenshot({ path: `test/bh-shots/s${si + 1}-c-boss.png` });
  let guard = 0;
  while (r.state === 'playing' && guard++ < 40) {
    r = await drive(60 * 10, { over: true, dps: 90, killBoss: true, phaseSeconds: 9, bombEvery: 60 * 7 });
    console.log(`stage ${si + 1} boss loop`, JSON.stringify(r));
    if (guard === 2) await page.screenshot({ path: `test/bh-shots/s${si + 1}-d-boss2.png` });
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test/bh-shots/s${si + 1}-e-results.png` });
  summary.push({ stage: si + 1, ...r });
  if (r.state !== 'results') { console.log('!! stage did not reach results', si + 1); }
  else if (si === 0 && !QUICK) {
    // exercise relic flow once on the real run
    await page.click('button.primary'); await page.waitForTimeout(150); await page.screenshot({ path: 'test/bh-shots/s1-f-relic.png' });
    await page.click('button.card'); await page.waitForTimeout(200);
    const st = await page.evaluate(() => ({ state: window.g.state, stage: window.g.stageIdx, relics: [...window.g.player.relics] }));
    console.log('after relic', JSON.stringify(st));
    if (st.state !== 'playing' || st.stage !== 1) errors.push('relic flow failed: ' + JSON.stringify(st));
  }
}
// game over + victory screens
await page.evaluate(() => { const g = window.g; g.startRun({ diff: 'normal', ship: 'lance', stage: 6, practice: false }); g.player.lives = 0; g.player.invulnDebug = false; });
await page.evaluate(() => { const g = window.g; for (let i = 0; i < 300; i++) { g.player.hit({}); g.tick(1 / 60); if (g.state !== 'playing') break; } g.render(); });
await page.waitForTimeout(150); await page.screenshot({ path: 'test/bh-shots/z1-gameover.png' });
console.log('gameover state', await page.evaluate(() => window.g.state));
await page.evaluate(() => { const g = window.g; g.state = 'playing'; g.ui.hide(); g.victory(); });
await page.waitForTimeout(150); await page.screenshot({ path: 'test/bh-shots/z2-victory.png' });
await page.evaluate(() => window.g.quitToTitle()); await page.waitForTimeout(100);
await page.click('#ui .menu button:nth-child(2)'); await page.waitForTimeout(150); await page.screenshot({ path: 'test/bh-shots/z3-practice.png' });
// pause
await page.evaluate(() => { const g = window.g; g.startRun({ diff: 'novice', ship: 'wraith', stage: 2, practice: true }); g.pause(); });
await page.waitForTimeout(150); await page.screenshot({ path: 'test/bh-shots/z4-pause.png' });

console.log('\nSUMMARY'); for (const s of summary) console.log(JSON.stringify(s));
console.log('\nERRORS', errors.length); for (const e of [...new Set(errors)].slice(0, 20)) console.log(' -', e);
await browser.close(); server.close();
process.exit(errors.length ? 1 : 0);
