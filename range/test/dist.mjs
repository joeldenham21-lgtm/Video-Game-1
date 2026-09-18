// Verifies the single-file build (range/dist/range.html) boots from file:// with no server:
// loads it, resumes, fires the carbine, reloads, switches to the rifle and screenshots.
// Usage: node range/test/dist.mjs [outDir]
import { mkdirSync } from 'fs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const OUT = process.argv[2] || 'range/test/shots'; mkdirSync(OUT, { recursive: true });
const file = new URL('../dist/range.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('requestfailed', r => errors.push('REQFAIL ' + r.url().slice(0, 120) + ' ' + r.failure()?.errorText));
const t0 = Date.now();
await page.goto(file + '?lowq', { waitUntil: 'load' });
try { await page.waitForFunction(() => !!window.g, null, { timeout: 120000 }); }
catch (e) { console.log('BOOT FAILED:', e.message.split('\n')[0]); console.log('loading text:', await page.evaluate(() => document.getElementById('loading')?.textContent)); console.log('errors:', errors); await browser.close(); process.exit(1); }
console.log('file:// boot', ((Date.now() - t0) / 1000).toFixed(1), 's', JSON.stringify(await page.evaluate(() => ({ hdr: !!window.__RANGE_HDR__, env: !!window.g.scene.environment, protocol: location.protocol }))));
await page.evaluate(() => { const g = window.g; g.resume(); g.dbg.manual = true; g.advance(1.0); g.player.buttons.r = true; g.vm.state.mode = 'semi'; g.vm.weapon.setSelector('semi'); g.advance(0.8); g.vm.fireDown(); g.advance(0.06); g.render(); });
await page.screenshot({ path: `${OUT}/d01-fire.png`, timeout: 120000 });
await page.evaluate(() => { const g = window.g; g.vm.fireUp(); g.advance(1.0); g.player.buttons.r = false; g.vm.reload(); g.advance(0.8); g.render(); });
await page.screenshot({ path: `${OUT}/d02-reload.png`, timeout: 120000 });
await page.evaluate(() => { const g = window.g; g.advance(2.0); g.vm.equip('bolt'); g.advance(1.2); g.player.buttons.r = true; g.advance(0.9); g.render(); });
await page.screenshot({ path: `${OUT}/d03-scope.png`, timeout: 120000 });
const st = await page.evaluate(() => { const g = window.g; return { weapon: g.vm.id, mag: g.vm.state.magRounds, shot: !!g.projectiles.lastShot, audio: g.audio.ready }; });
console.log('state', JSON.stringify(st));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
