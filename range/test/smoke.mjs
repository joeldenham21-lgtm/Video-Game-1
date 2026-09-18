// RANGE smoke test: boots the game headless (SwiftShader), drives it through the debug API
// (window.g), fires each weapon, reloads, cycles the bolt, opens the scope, and screenshots.
// Usage: node range/test/smoke.mjs [outDir]
import http from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = process.argv[2] || 'range/test/shots'; mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  try { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const data = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(8935, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [], warnings = [];
page.on('console', m => { const t = m.type(); if (t === 'error') errors.push(m.text()); else if (t === 'warning') warnings.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
const t0 = Date.now();
await page.goto('http://localhost:8935/range/index.html?nopost&lowq', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.g, null, { timeout: 120000 });
await page.evaluate(() => window.g.world.envReady);
console.log('hdri', JSON.stringify(await page.evaluate(() => ({ sunElevDeg: +(window.g.world.sunElevation * 180 / Math.PI).toFixed(1), sunDir: window.g.world.sunDir.toArray().map(n => +n.toFixed(2)) }))));
console.log('booted in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.screenshot({ path: `${OUT}/s00-menu.png` });
await page.evaluate(() => { window.g.resume(); window.g.settings.timeScale = 1; window.g.dbg.manual = true; });
const adv = (sec) => page.evaluate((sec) => window.g.advance(sec), sec);
const shot = async (name) => { await page.evaluate(() => window.g.render()); try { await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 }); } catch (e) { console.log('screenshot failed', name, e.message.split('\n')[0]); } };
await adv(1.0); await shot('s01-hip');
const info = await page.evaluate(() => { const g = window.g; return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, targets: g.targets.targets.length, pos: g.camera.position.toArray().map(n => +n.toFixed(2)), paused: g.paused }; });
console.log('scene', JSON.stringify(info));
// ADS with the AR, fire 3 rounds semi, then a burst on auto
await page.evaluate(() => { const g = window.g; g.player.buttons.r = true; g.vm.state.mode = 'semi'; g.vm.weapon.setSelector('semi'); });
await adv(0.8); await shot('s02-ads-ar');
await page.evaluate(() => window.g.vm.fireDown()); await adv(0.062); await shot('s03-fire-flash');
await page.evaluate(() => window.g.vm.fireUp()); await adv(0.35);
for (let i = 0; i < 2; i++) { await page.evaluate(() => window.g.vm.fireDown()); await adv(0.09); await page.evaluate(() => window.g.vm.fireUp()); await adv(0.4); }
await adv(1.2); await shot('s04-after-3');
let st = await page.evaluate(() => { const g = window.g; return { mag: g.vm.state.magRounds, chambered: g.vm.state.chambered, cycleMs: g.vm.recoil.lastCycleMs.toFixed(1), last: g.projectiles.lastShot && { dist: +g.projectiles.lastShot.dist.toFixed(1), tof: +g.projectiles.lastShot.tof.toFixed(3), impacts: g.projectiles.lastShot.impacts.map(i => ({ name: i.name, target: i.target, dist: +i.dist.toFixed(1), v: +i.speed.toFixed(0), outcome: i.outcome, depth: i.depth && +(i.depth * 1000).toFixed(0) })) } }; });
console.log('after 3 semi', JSON.stringify(st));
await page.evaluate(() => { const g = window.g; g.vm.state.mode = 'auto'; g.vm.weapon.setSelector('auto'); g.vm.fireDown(); });
await adv(0.55); await shot('s05-auto'); await page.evaluate(() => window.g.vm.fireUp()); await adv(0.5);
st = await page.evaluate(() => { const g = window.g; return { mag: g.vm.state.magRounds, chambered: g.vm.state.chambered, cycleMs: g.vm.recoil.lastCycleMs.toFixed(1), bullets: g.projectiles.bullets.length, viewClimb: +g.vm.viewClimb.pitch.toFixed(4) }; });
console.log('after auto burst', JSON.stringify(st));
// slow motion + fire → brass & streak visible
await page.evaluate(() => { const g = window.g; g.settings.timeScale = 0.08; g.vm.slowmo = 0.08; g.vm.state.mode = 'semi'; g.vm.weapon.setSelector('semi'); g.vm.fireDown(); });
await page.evaluate(() => window.g.advance(0.09, 1 / 90)); await page.evaluate(() => window.g.vm.fireUp()); await page.evaluate(() => window.g.advance(0.03, 1 / 90)); await shot('s06-slowmo');
await page.evaluate(() => { const g = window.g; g.settings.timeScale = 1; g.vm.slowmo = 1; g.player.buttons.r = false; });
await adv(1.0);
// reload mid-way
await page.evaluate(() => window.g.vm.reload()); await adv(0.7); await shot('s07-reload-ar'); await adv(1.3); await shot('s07b-reload-ar2'); await adv(1.0);
st = await page.evaluate(() => { const g = window.g; return { mag: g.vm.state.magRounds, chambered: g.vm.state.chambered, busy: g.vm.busy }; });
console.log('after reload', JSON.stringify(st));
// inspect close-up
await page.evaluate(() => window.g.vm.inspect()); await adv(1.0); await shot('s07c-inspect'); await adv(1.6); await shot('s07d-inspect2'); await adv(1.2);
// pistol
await page.evaluate(() => { window.g.vm.equip('pistol'); }); await adv(0.9); await shot('s08-pistol-hip');
await page.evaluate(() => { window.g.player.buttons.r = true; }); await adv(0.6); await shot('s09-pistol-ads');
for (let i = 0; i < 3; i++) { await page.evaluate(() => window.g.vm.fireDown()); await adv(0.08); await page.evaluate(() => window.g.vm.fireUp()); await adv(0.3); }
await adv(0.6); await shot('s10-pistol-fired'); await adv(3.0);
st = await page.evaluate(() => { const g = window.g; return { mag: g.vm.state.magRounds, chambered: g.vm.state.chambered, slideCycleMs: g.vm.recoil.lastCycleMs.toFixed(1), last: g.projectiles.lastShot && g.projectiles.lastShot.impacts.map(i => ({ name: i.name, target: i.target, dist: +i.dist.toFixed(1), outcome: i.outcome })) }; });
console.log('pistol', JSON.stringify(st));
await page.evaluate(() => { window.g.player.buttons.r = false; window.g.vm.reload(); }); await adv(0.75); await shot('s11-pistol-reload'); await adv(1.5);
// bolt rifle + scope
await page.evaluate(() => { window.g.vm.equip('bolt'); }); await adv(1.0); await shot('s12-bolt-hip');
await page.evaluate(() => { window.g.player.buttons.r = true; window.g.player.pitch = 0.0; window.g.player.yaw = 0.0; }); await adv(0.9); await shot('s13-scope');
await page.evaluate(() => { window.g.player.pitch = 0.006; }); await adv(0.25); await shot('s13b-scope-up');
await page.evaluate(() => { window.g.player.pitch = 0.0; window.g.vm.fireDown(); }); await adv(0.09); await page.evaluate(() => window.g.vm.fireUp()); await adv(1.6); await shot('s14-scope-fired');
await page.evaluate(() => window.g.vm.chargeAction()); await adv(0.6); await shot('s15-bolt-cycle'); await adv(1.0);
// turrets + ammo cycling + press check
await page.evaluate(() => { const g = window.g; g.vm.clickTurret('elev', 5); g.vm.clickTurret('wind', -3); g.vm.cycleAmmo(); g.vm.pressCheck(); }); await adv(0.5); await shot('s15b-presscheck'); await adv(1.5);
st = await page.evaluate(() => { const g = window.g; return { ammo: g.vm.state.ammoId, elev: g.vm.state.elevClicks, wind: g.vm.state.windClicks, zeroAngleMrad: +(g.vm.zeroAngle * 1000).toFixed(3), holderRot: [+g.vm.holder.rotation.x.toFixed(5), +g.vm.holder.rotation.y.toFixed(5)] }; });
console.log('turrets/ammo', JSON.stringify(st));
st = await page.evaluate(() => { const g = window.g; const s = g.projectiles.lastShot; return { mag: g.vm.state.magRounds, chambered: g.vm.state.chambered, impacts: s && s.impacts.map(i => ({ name: i.name, target: i.target, dist: +i.dist.toFixed(1), tof: +i.tof.toFixed(3), v: +i.speed.toFixed(0), outcome: i.outcome })), tof: s && +s.tof.toFixed(3), dist: s && +s.dist.toFixed(1) }; });
console.log('bolt shot', JSON.stringify(st));
// ballistic computer + LRF + traces
await page.evaluate(() => { const g = window.g; g.player.buttons.r = false; g.hud.toggleCalc(); g.hud.setLRF(true, null); g.settings.traces = true; g.effects.setShowTraces(true); });
await adv(0.5); await shot('s16-calc');
await page.evaluate(() => { const g = window.g; g.hud.toggleCalc(); g.hud.toggleHelp(); }); await adv(0.1); await shot('s17-help');
const perf = await page.evaluate(async () => { const g = window.g; g.hud.toggleHelp(); const t0 = performance.now(); let n = 0; while (performance.now() - t0 < 1500) { g.step(1 / 60); n++; } const simMs = (performance.now() - t0) / n; const t1 = performance.now(); for (let i = 0; i < 3; i++) g.render(); const renderMs = (performance.now() - t1) / 3; return { simMsPerStep: +simMs.toFixed(2), renderMs: +renderMs.toFixed(0), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles }; });
console.log('perf (swiftshader)', JSON.stringify(perf));
console.log('warnings:', warnings.length ? warnings.slice(0, 5) : 'none');
console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close(); server.close();
process.exit(errors.length ? 1 : 0);
