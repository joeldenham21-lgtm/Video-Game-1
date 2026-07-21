// Desktop visual verification: bloom night, rain, letterbox dialogue, photo-mode HUD-off
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { chromium } from 'playwright-core';
const ROOT = '/home/user/Video-Game-1';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.bin':'application/octet-stream' };
const server = http.createServer(async (req,res)=>{ try{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; const d=await readFile(join(ROOT,p)); res.writeHead(200,{'Content-Type':MIME[extname(p)]||'application/octet-stream'}); res.end(d);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(8944,r));
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await b.newPage({ viewport:{width:1600,height:900} });
const errs=[];
page.on('pageerror', e=>errs.push(String(e).slice(0,200)));
page.on('console', m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
await page.goto('http://localhost:8944/?debug'); await page.waitForTimeout(600);
await page.click('#btn-new'); await page.waitForTimeout(14000);
console.log('postfx active:', await page.evaluate(()=>!!(window.g.postfx&&window.g.postfx.render)), '| weather:', await page.evaluate(()=>window.g.weather.state));
// night bloom
await page.evaluate(()=>{ window.g.time.dayFrac=0.0; });
await page.waitForTimeout(1500);
await page.screenshot({path:'test/shots/d1-night-bloom.png'});
// golden hour
await page.evaluate(()=>{ window.g.time.dayFrac=0.72; });
await page.waitForTimeout(1500);
await page.screenshot({path:'test/shots/d2-golden.png'});
// dialogue letterbox: find a Talk interactable and trigger it
const talked = await page.evaluate(()=>{
  const t = window.g.interactables.find(i=>/Talk/.test(i.label||''));
  if (!t) return false;
  window.g.player.position.set(t.pos.x+1.5, t.pos.y||8, t.pos.z+1.5);
  t.onInteract();
  return true;
});
await page.waitForTimeout(1600);
if (talked) await page.screenshot({path:'test/shots/d3-dialogue-cinema.png'});
await page.keyboard.press('Escape'); await page.waitForTimeout(900);
// rain
await page.evaluate(()=>{ const w=window.g.weather; if (w.force) w.force('storm'); else { window.g.flags.dayCount=2; } });
await page.waitForTimeout(4000);
await page.screenshot({path:'test/shots/d4-weather.png'});
console.log('weather now:', await page.evaluate(()=>window.g.weather.state), '| errors:', errs.length, errs.slice(0,4));
await b.close(); server.close();
