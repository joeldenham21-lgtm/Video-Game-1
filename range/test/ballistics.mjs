// Sanity checks for the exterior/terminal ballistics against published data.
// Usage: node range/test/ballistics.mjs
import * as B from '../src/ballistics.js';
import { CARTRIDGES, muzzleVelocity } from '../src/cartridges.js';

const fmt = (n, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);
let fails = 0;
function expectNear(label, val, lo, hi) {
  const ok = val >= lo && val <= hi;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${fmt(val, 3)}  (expected ${lo}..${hi})`);
}

function card(id, barrelIn, zeroRange, sightHeight, envOpts = {}) {
  const c = CARTRIDGES[id];
  const mv = muzzleVelocity(c, barrelIn);
  const massKg = c.bulletMassG / 1000, diameterM = c.diameterMm / 1000;
  const atm = B.STD_ATMOSPHERE;
  const zeroAngle = B.solveZeroAngle({ massKg, diameterM, bc: c.bc, model: c.model, mv, sightHeight, zeroRange, atm });
  const env = B.makeEnv({ atm, ...envOpts });
  const sg = B.millerStability({ massG: c.bulletMassG, diameterMm: c.diameterMm, lengthMm: c.lengthMm, twistMm: envOpts.twistMm || 177.8, velocity: mv, atm });
  const rows = B.rangeCard({ massKg, diameterM, bc: c.bc, model: c.model, mv, sightHeight, zeroAngle, env, maxRange: 850, step: 50, sg });
  return { c, mv, zeroAngle, sg, rows };
}

console.log('--- 5.56 M855 from 14.5" (M4), 100 m zero, sight 66 mm, 1:7 twist, 10 mph full-value crosswind');
{
  const t0 = performance.now();
  const { mv, zeroAngle, sg, rows } = card('556_m855', 14.5, 100, 0.066, { wind: [4.47, 0, 0], twistMm: 177.8 });
  console.log(`  mv=${fmt(mv, 0)} m/s  zeroAngle=${fmt(zeroAngle * 1000, 3)} mrad  SG=${fmt(sg)}  (${fmt(performance.now() - t0, 1)} ms)`);
  for (const r of rows) console.log(`  ${String(r.range).padStart(4)} m  drop ${fmt(r.drop * 100, 1).padStart(7)} cm  drift ${fmt(r.drift * 100, 1).padStart(6)} cm  v ${fmt(r.v, 0)} m/s  E ${fmt(r.e, 0)} J  tof ${fmt(r.tof, 3)} s`);
  const r300 = rows.find(r => r.range === 300), r100 = rows.find(r => r.range === 100), r500 = rows.find(r => r.range === 500);
  expectNear('M855 v@100m (m/s)', r100.v, 780, 830);
  expectNear('M855 drop@300m (cm, 100m zero)', r300.drop * 100, -46, -30);
  expectNear('M855 drop@500m (cm)', r500.drop * 100, -220, -160);
  expectNear('M855 10mph drift@300m (cm)', r300.drift * 100, 20, 40); // published ~1 mil at 300
  expectNear('M855 SG (1:7)', sg, 2.2, 4.0);
}

console.log('--- .308 M118LR from 24", 100 m zero, sight 45 mm, 1:10 twist, no wind');
{
  const { mv, zeroAngle, sg, rows } = card('308_m118lr', 24, 100, 0.045, { twistMm: 254 });
  console.log(`  mv=${fmt(mv, 0)} m/s  zeroAngle=${fmt(zeroAngle * 1000, 3)} mrad  SG=${fmt(sg)}`);
  for (const r of rows) console.log(`  ${String(r.range).padStart(4)} m  drop ${fmt(r.drop * 100, 1).padStart(7)} cm  drift ${fmt(r.drift * 100, 1).padStart(6)} cm  v ${fmt(r.v, 0)} m/s  tof ${fmt(r.tof, 3)} s`);
  const r500 = rows.find(r => r.range === 500), r800 = rows.find(r => r.range === 800);
  expectNear('M118LR drop@500m (cm)', r500.drop * 100, -230, -180);
  expectNear('M118LR v@800m (m/s)', r800.v, 350, 460);
  expectNear('M118LR spin drift@800m (cm, right)', r800.drift * 100, 10, 30);
}

console.log('--- 9mm 124gr from 4.5", 25 m zero, sight 13 mm');
{
  const { mv, rows } = card('9mm_124', 4.49, 25, 0.013, { twistMm: 250 });
  console.log(`  mv=${fmt(mv, 0)} m/s`);
  for (const r of rows.filter(r => r.range <= 200)) console.log(`  ${String(r.range).padStart(4)} m  drop ${fmt(r.drop * 100, 1).padStart(7)} cm  v ${fmt(r.v, 0)} m/s  tof ${fmt(r.tof, 3)} s`);
  const r100 = rows.find(r => r.range === 100);
  expectNear('9mm drop@100m (cm, 25m zero)', r100.drop * 100, -35, -20);
}

console.log('--- terminal: Poncelet penetration');
{
  const m556 = CARTRIDGES['556_m855'], m9 = CARTRIDGES['9mm_124'];
  const A = d => Math.PI * (d / 2000) ** 2;
  const p1 = B.penetration({ massKg: m556.bulletMassG / 1000, area: A(m556.diameterMm), v0: 900, material: B.MATERIALS.pine });
  const p2 = B.penetration({ massKg: m556.bulletMassG / 1000, area: A(m556.diameterMm), v0: 900, material: B.MATERIALS.soil });
  const p3 = B.penetration({ massKg: m556.bulletMassG / 1000, area: A(m556.diameterMm), v0: 900, material: B.MATERIALS.ar500, thickness: 0.0095 });
  const p4 = B.penetration({ massKg: m556.bulletMassG / 1000, area: A(m556.diameterMm), v0: 900, material: B.MATERIALS.steel, thickness: 0.006 });
  const p5 = B.penetration({ massKg: m9.bulletMassG / 1000, area: A(m9.diameterMm), v0: 360, material: B.MATERIALS.pine });
  const p6 = B.penetration({ massKg: m9.bulletMassG / 1000, area: A(m9.diameterMm), v0: 360, material: B.MATERIALS.steel, thickness: 0.006 });
  const p7 = B.penetration({ massKg: m556.bulletMassG / 1000, area: A(m556.diameterMm), v0: 900, material: B.MATERIALS.plywood, thickness: 0.012 });
  console.log(`  5.56@900 pine stop depth ${fmt(p1.depth * 100, 1)} cm; soil ${fmt(p2.depth * 100, 1)} cm; 3/8" AR500 stopped=${p3.stopped} (${fmt(p3.depth * 1000, 1)} mm); 6mm mild steel stopped=${p4.stopped} vExit=${fmt(p4.vExit, 0)}`);
  console.log(`  9mm@360 pine stop depth ${fmt(p5.depth * 100, 1)} cm; 6mm mild steel stopped=${p6.stopped} (${fmt(p6.depth * 1000, 1)} mm); 5.56 through 12mm plywood vExit=${fmt(p7.vExit, 0)}`);
  expectNear('5.56 pine depth (cm)', p1.depth * 100, 20, 60);
  expectNear('5.56 soil depth (cm)', p2.depth * 100, 15, 40);
  expectNear('5.56 vs 3/8 AR500 stopped', p3.stopped ? 1 : 0, 1, 1);
  expectNear('5.56 vs 6mm mild steel penetrates', p4.stopped ? 0 : 1, 1, 1);
  expectNear('9mm vs 6mm mild steel stopped', p6.stopped ? 1 : 0, 1, 1);
  expectNear('5.56 through plywood keeps most velocity', p7.vExit, 800, 895);
}

console.log('--- ricochet');
{
  const c = CARTRIDGES['556_m855'];
  const mk = (ang) => {
    const p = B.makeProjectile({ massKg: c.bulletMassG / 1000, diameterM: c.diameterMm / 1000, bc: c.bc, model: 'G7', pos: [0, 0, 0], vel: [0, -900 * Math.sin(ang), -900 * Math.cos(ang)] });
    return B.impactOutcome(p, [0, 1, 0], B.MATERIALS.ar500, 0.0095, () => 0.5);
  };
  const shallow = mk(10 * Math.PI / 180), steep = mk(70 * Math.PI / 180);
  console.log(`  10° grazing on AR500: ${shallow.type} vExit=${fmt(shallow.vExit || 0, 0)} dir=${shallow.dir?.map(x => fmt(x, 2))}`);
  console.log(`  70° grazing on AR500: ${steep.type}`);
  expectNear('shallow ricochets', shallow.type === 'ricochet' ? 1 : 0, 1, 1);
  expectNear('steep stops', steep.type === 'stop' ? 1 : 0, 1, 1);
  expectNear('ricochet leaves surface (dir.y>0)', shallow.dir[1], 0.0001, 1);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
