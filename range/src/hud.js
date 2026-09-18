// ============================================================================
// RANGE — hud.js
// DOM overlay: ammo/weapon state, rangefinder + wind, shot report, ballistic
// computer (range card under the live atmosphere), target scoring, messages,
// settings menu with environment sliders, controls help.
// ============================================================================
import * as B from './ballistics.js';
import { muzzleVelocity } from './cartridges.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const f = (n, d = 1) => (n == null || Number.isNaN(n)) ? '–' : n.toFixed(d);

export function createHUD(root, settings, callbacks) {
  root.innerHTML = '';
  const ammo = el('div', 'panel ammo'); root.appendChild(ammo);
  const top = el('div', 'panel topline'); root.appendChild(top);
  const report = el('div', 'panel report'); root.appendChild(report);
  const calc = el('div', 'panel calc hidden'); root.appendChild(calc);
  const msgs = el('div', 'msgs'); root.appendChild(msgs);
  const cross = el('div', 'crosshair'); root.appendChild(cross);
  const slow = el('div', 'slowmo hidden', 'SLOW MOTION'); root.appendChild(slow);
  const help = el('div', 'panel help hidden'); root.appendChild(help);
  help.innerHTML = `<h3>Controls</h3>
<div class="cols"><div>
<b>LMB</b> fire (hold: auto) · <b>RMB</b> aim<br><b>WASD</b> move · <b>Shift</b> sprint / hold breath (aiming)<br><b>C</b> crouch · <b>Q / E</b> lean (cants the rifle)<br>
<b>R</b> reload · <b>X</b> charge / cycle bolt · <b>Z</b> press check<br><b>V</b> safety / fire mode · <b>B</b> ammo type (next mag)<br><b>F</b> inspect · <b>1 2 3</b> weapons<br>
</div><div>
<b>[ ]</b> elevation turret · <b>; '</b> windage turret<br><b>Wheel</b> scope magnification<br><b>N</b> laser rangefinder · <b>H</b> ballistic computer<br>
<b>L</b> shot traces · <b>T</b> slow motion · <b>P</b> hearing protection<br><b>K</b> reset targets · <b>F1</b> this help · <b>Esc</b> settings
</div></div>`;
  const last = { shot: null, target: null };
  const state = { lrf: false, lrfDist: null, calcOpen: false, lastCalcKey: '' };

  function message(text, ms = 2500) { const m = el('div', 'msg', text); msgs.appendChild(m); setTimeout(() => m.classList.add('fade'), ms - 600); setTimeout(() => m.remove(), ms); }

  function updateAmmo(vm) {
    if (!vm.weapon) return; const s = vm.state, w = vm.weapon.spec, c = vm.cart;
    const mode = s.mode.toUpperCase();
    ammo.innerHTML = `<div class="wname">${w.name}</div><div class="rounds"><span class="big">${s.magRounds}</span><span class="ch">${s.chambered ? '+1' : (vm.recoil?.held ? ' open' : ' empty')}</span></div>
<div class="sub">${c.short} · ${f(vm.mv, 0)} m/s · ${w.fireModes.length > 1 || w.id === 'bolt' ? '<b>' + mode + '</b>' : mode}${s.dustOpen ? '' : ''}</div>
<div class="sub small">zero ${s.zeroRange} m${w.scope ? ` · ${f(vm.state.scopeMag, 0)}× · E ${(s.elevClicks * w.scope.clickMrad).toFixed(1)} mil W ${(s.windClicks * w.scope.clickMrad).toFixed(1)} mil` : ''} · ${settings.earPro ? 'ear pro ON' : 'ear pro OFF'}</div>`;
    cross.style.display = settings.crosshair && vm.adsT < 0.3 ? 'block' : 'none';
    slow.classList.toggle('hidden', settings.timeScale > 0.9);
  }
  function updateTop(vm, env, wind) {
    const wsp = Math.hypot(wind[0], wind[2]); const wdir = Math.atan2(wind[0], -wind[2]);
    const lrf = state.lrf && state.lrfDist ? `<span class="lrf">◎ ${f(state.lrfDist, 0)} m</span>` : '';
    let hold = '';
    if (state.lrf && state.lrfDist && vm.card) {
      const row = interp(vm.card, state.lrfDist);
      if (row) hold = `<span class="hold">hold ${row.drop <= 0 ? '↑' : '↓'} ${f(Math.abs(row.drop) / state.lrfDist * 1000, 1)} mil · wind ${row.drift >= 0 ? '←' : '→'} ${f(Math.abs(row.drift) / state.lrfDist * 1000, 1)} mil · ${f(row.tof, 2)} s</span>`;
    }
    top.innerHTML = `${lrf}${hold}<span class="wind">wind ${f(wsp, 1)} m/s <span class="arrow" style="transform:rotate(${(wdir * 180 / Math.PI).toFixed(0)}deg)">➜</span></span><span class="atm">${f(env.atm.tempC, 0)} °C · ${f(env.atm.p, 0)} hPa · ρ ${f(env.atm.rho, 3)}</span>`;
  }
  function interp(card, d) {
    if (!card || !card.length) return null;
    for (let i = 1; i < card.length; i++) { if (card[i].range >= d) { const a = card[i - 1], b = card[i]; const k = (d - a.range) / (b.range - a.range); const r = {}; for (const key of ['drop', 'drift', 'v', 'e', 'tof', 'mach']) r[key] = a[key] + (b[key] - a[key]) * k; r.range = d; return r; } }
    return card[card.length - 1];
  }
  function shotReport(shot) {
    last.shot = shot;
    if (!shot) { report.innerHTML = ''; return; }
    const imp = shot.impacts[0];
    let html = `<div class="title">last shot · ${shot.cart.short}</div>`;
    if (imp) {
      html += `<div>${imp.target || imp.name} at <b>${f(imp.dist, 1)} m</b> · ${f(imp.tof * 1000, 0)} ms · ${f(imp.speed, 0)} m/s · ${f(imp.energy, 0)} J</div>`;
      html += `<div>${imp.outcome}${imp.depth != null ? ` (${f(imp.depth * 1000, 0)} mm)` : ''} · ${f(imp.grazingDeg, 0)}° · ${imp.material}</div>`;
      if (shot.impacts.length > 1) html += `<div class="small">then: ${shot.impacts.slice(1).map(i => `${i.name} ${f(i.dist, 0)} m (${i.outcome})`).join(' → ')}</div>`;
    } else html += `<div>no impact within ${f(shot.dist, 0)} m</div>`;
    if (last.target) html += `<div class="small">${last.target}</div>`;
    report.innerHTML = html;
  }
  function targetReport(t, info) {
    if (t.kind === 'paper') {
      const hits = t.hits.slice(-5); let es = 0;
      for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) es = Math.max(es, Math.hypot(hits[i].dx - hits[j].dx, hits[i].dy - hits[j].dy));
      const moa = hits.length > 1 ? (es / 100) / t.dist / B.MOA : 0;
      last.target = `${t.name}: ${info.dx >= 0 ? 'R' : 'L'} ${f(Math.abs(info.dx), 1)} cm, ${info.dy >= 0 ? 'U' : 'D'} ${f(Math.abs(info.dy), 1)} cm${hits.length > 1 ? ` · last ${hits.length}: ${f(es, 1)} cm = ${f(moa, 2)} MOA` : ''}`;
    } else last.target = `${t.name} · HIT · ${f(info.energy, 0)} J`;
    if (last.shot) shotReport(last.shot);
  }
  function updateCalc(vm, envOpts, force) {
    if (!state.calcOpen || !vm.weapon) return;
    const key = [vm.state.ammoId, vm.state.zeroRange, vm.state.elevClicks, vm.state.windClicks, JSON.stringify(envOpts)].join('|');
    if (key === state.lastCalcKey && !force) return; state.lastCalcKey = key;
    const w = vm.weapon.spec, c = vm.cart; const atm = B.atmosphere(envOpts.atm); const env = B.makeEnv({ ...envOpts, atm });
    const mv = muzzleVelocity(c, w.barrelIn);
    const sg = B.millerStability({ massG: c.bulletMassG, diameterMm: c.diameterMm, lengthMm: c.lengthMm, twistMm: w.twistMm, velocity: mv, atm });
    const click = w.scope ? w.scope.clickMrad * B.MRAD : 0.5 * B.MOA;
    const card = B.rangeCard({ massKg: c.bulletMassG / 1000, diameterM: c.diameterMm / 1000, bc: c.bc, model: c.model, mv, sightHeight: w.sightHeight, zeroAngle: vm.zeroAngle + vm.state.elevClicks * click, env, maxRange: 820, step: 25, sg });
    // windage clicks shift the LOS horizontally → equivalent lateral offset
    for (const r of card) r.drift -= Math.tan(vm.state.windClicks * click) * r.range * -1;
    vm.card = card;
    let rows = '';
    for (const r of card) if (r.range % 50 === 0 && r.range > 0) rows += `<tr><td>${r.range}</td><td>${f(r.drop * 100, 1)}</td><td>${f(r.drop / r.range * 1000, 2)}</td><td>${f(r.drift * 100, 1)}</td><td>${f(r.drift / r.range * 1000, 2)}</td><td>${f(r.v, 0)}</td><td>${f(r.e, 0)}</td><td>${f(r.tof, 3)}</td><td>${f(r.mach, 2)}</td></tr>`;
    calc.innerHTML = `<h3>Ballistic computer</h3>
<div class="small">${w.name} · ${c.name}<br>MV ${f(mv, 0)} m/s (${w.barrelIn}" barrel) · BC ${c.bc} ${c.model} · SG ${f(sg, 2)} (1:${(w.twistMm / 25.4).toFixed(0)}") · sight ${f(w.sightHeight * 1000, 0)} mm · zero ${vm.state.zeroRange} m (std. atmosphere)<br>
${f(atm.tempC, 0)} °C · ${f(atm.p, 0)} hPa · RH ${f(atm.humidity * 100, 0)} % · ρ ${f(atm.rho, 3)} kg/m³ · c ${f(atm.c, 0)} m/s · wind ${f(Math.hypot(envOpts.wind[0], envOpts.wind[2]), 1)} m/s · lat ${envOpts.latitudeDeg}° az ${envOpts.azimuthDeg}° · Coriolis ${envOpts.coriolis ? 'on' : 'off'} · spin drift ${envOpts.spinDrift ? 'on' : 'off'}</div>
<table><tr><th>m</th><th>drop cm</th><th>mil</th><th>drift cm</th><th>mil</th><th>m/s</th><th>J</th><th>tof s</th><th>Mach</th></tr>${rows}</table>
<div class="small">drop: + above / − below the line of sight · drift: + right (wind + spin drift + Coriolis)</div>`;
  }

  // ---------------------------------------------------------------- settings menu
  const menu = document.getElementById('menu');
  const form = menu.querySelector('#settings');
  const defs = [
    ['windSpeed', 'Wind speed (m/s)', 0, 15, 0.5], ['windDir', 'Wind from (° clockwise from downrange)', 0, 360, 5], ['tempC', 'Temperature (°C)', -25, 45, 1], ['altitudeM', 'Altitude (m)', 0, 3000, 50], ['humidity', 'Humidity (%)', 0, 100, 5],
    ['latitudeDeg', 'Latitude (°)', -90, 90, 5], ['azimuthDeg', 'Range azimuth (° from north)', 0, 359, 5], ['zeroRange', 'Zero distance (m)', 25, 300, 25], ['fov', 'Field of view (°)', 55, 90, 1], ['sensitivity', 'Mouse sensitivity', 0.5, 3, 0.1],
  ];
  const toggles = [['coriolis', 'Coriolis'], ['spinDrift', 'Spin drift'], ['earPro', 'Hearing protection'], ['crosshair', 'Hip crosshair'], ['traces', 'Shot traces'], ['postfx', 'Post-processing (bloom)'], ['gusts', 'Wind gusts']];
  form.innerHTML = defs.map(([k, label, min, max, step]) => `<label>${label}<span class="val" data-val="${k}">${settings[k]}</span><input type="range" name="${k}" min="${min}" max="${max}" step="${step}" value="${settings[k]}"></label>`).join('') +
    '<div class="toggles">' + toggles.map(([k, label]) => `<label class="tog"><input type="checkbox" name="${k}" ${settings[k] ? 'checked' : ''}> ${label}</label>`).join('') + '</div>';
  form.addEventListener('input', (e) => {
    const t = e.target; if (!t.name) return;
    settings[t.name] = t.type === 'checkbox' ? t.checked : parseFloat(t.value);
    const v = form.querySelector(`[data-val="${t.name}"]`); if (v) v.textContent = t.value;
    callbacks.onSettings?.(t.name);
  });
  menu.querySelector('#btn-resume').addEventListener('click', () => callbacks.onResume?.());
  menu.querySelector('#btn-reset').addEventListener('click', () => callbacks.onResetTargets?.());

  return {
    message, updateAmmo, updateTop, shotReport, targetReport, updateCalc, state,
    toggleCalc() { state.calcOpen = !state.calcOpen; calc.classList.toggle('hidden', !state.calcOpen); state.lastCalcKey = ''; },
    toggleHelp() { help.classList.toggle('hidden'); },
    setLRF(on, dist) { state.lrf = on; state.lrfDist = dist; },
    showMenu(v) { menu.classList.toggle('hidden', !v); },
    syncSettings() { for (const [k] of defs) { const i = form.querySelector(`[name="${k}"]`); if (i) { i.value = settings[k]; const v = form.querySelector(`[data-val="${k}"]`); if (v) v.textContent = settings[k]; } } for (const [k] of toggles) { const i = form.querySelector(`[name="${k}"]`); if (i) i.checked = !!settings[k]; } },
  };
}
