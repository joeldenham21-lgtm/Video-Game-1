// Headless visual check: boots the built index.html on a desktop and a phone profile,
// runs an optional script against window.g, and saves screenshots.
// Usage: node test/shot.mjs [--phone] [--desktop] [--wait=ms] [--eval="js"] [--out=name]
import http from 'http';
import { readFile, mkdir } from 'fs/promises';
import { extname, join } from 'path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.env.SHOTS || join(ROOT, 'test/shots');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const WAIT = +arg('wait', 4000);
const EVAL = arg('eval', '');
const NAME = arg('out', 'shot');
const profiles = [];
if (has('desktop') || !has('phone')) profiles.push({ name: 'desktop', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
if (has('phone')) profiles.push({ name: 'phone', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const d = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'],
});
let failed = false;
for (const prof of profiles) {
  const ctx = await browser.newContext(prof);
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + (e.stack || e.message)));
  await page.goto(`http://localhost:${port}/index.html${arg('query', '')}`);
  await page.waitForTimeout(WAIT);
  if (EVAL) {
    try {
      const r = await page.evaluate(EVAL);
      if (r !== undefined) console.log(`[${prof.name}] eval:`, typeof r === 'string' ? r : JSON.stringify(r));
    } catch (e) { errors.push('[eval] ' + e.message); }
    await page.waitForTimeout(+arg('after', 1500));
  }
  const file = join(OUT, `${NAME}-${prof.name}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => {
    const g = window.g;
    if (!g || !g.renderer) return null;
    const i = g.renderer.gl.info;
    return { mode: g.mode, calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, progs: i.programs?.length, scale: +g.renderer.renderScale.toFixed(2), q: g.renderer.quality };
  });
  console.log(`[${prof.name}] ${file}`, JSON.stringify(info));
  const uniq = [...new Set(errors)].filter(e => !/fonts\.g|ERR_FAILED|net::/.test(e));
  if (uniq.length) { failed = true; console.log(`[${prof.name}] ERRORS:\n  ` + uniq.slice(0, 15).map(e => e.slice(0, 500)).join('\n  ')); }
  await ctx.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
