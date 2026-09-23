// Menus: title, difficulty, pause, settings, controls, augment draft, death, victory, rotate prompt.
import { G } from '../state.js';
import { saveSettings, saveMeta } from '../game/settings.js';
import { RARITY } from '../game/augments.js';
import { RANKS } from '../game/style.js';
import { formatTime } from '../util.js';

const ICON = {
  bullet: '<path d="M20 6h8l3 8v26H17V14z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M17 32h14" stroke="currentColor" stroke-width="3"/>',
  rate: '<path d="M6 24h10M12 16h14M12 32h14M22 24h20" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M36 17l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3"/>',
  mag: '<rect x="15" y="6" width="18" height="36" rx="2" fill="none" stroke="currentColor" stroke-width="3"/><path d="M19 14h10M19 20h10M19 26h10M19 32h10" stroke="currentColor" stroke-width="2.5"/>',
  crit: '<circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="5" fill="currentColor"/><path d="M24 2v10M24 36v10M2 24h10M36 24h10" stroke="currentColor" stroke-width="3"/>',
  hp: '<path d="M19 6h10v13h13v10H29v13H19V29H6V19h13z" fill="none" stroke="currentColor" stroke-width="3"/>',
  shield: '<path d="M24 4l16 6v12c0 10-7 18-16 22C15 40 8 32 8 22V10z" fill="none" stroke="currentColor" stroke-width="3"/>',
  speed: '<path d="M8 36l10-10M8 26l14-14M18 38l16-16" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M30 10h10v10" fill="none" stroke="currentColor" stroke-width="3"/>',
  magnet: '<path d="M12 8v16a12 12 0 0024 0V8h-8v16a4 4 0 01-8 0V8z" fill="none" stroke="currentColor" stroke-width="3"/>',
  fist: '<path d="M12 28v-9a3 3 0 016 0v-3a3 3 0 016 0v1a3 3 0 016 0v2a3 3 0 016 0v9c0 8-5 12-12 12h-2c-6 0-10-4-10-12z" fill="none" stroke="currentColor" stroke-width="3"/>',
  od: '<path d="M27 4L12 27h11l-3 17 16-24H25z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  dash: '<path d="M6 16h14M4 24h16M6 32h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M26 12l12 12-12 12" fill="none" stroke="currentColor" stroke-width="3.5"/>',
  jump: '<path d="M12 26l12-12 12 12M12 38l12-12 12 12" fill="none" stroke="currentColor" stroke-width="3.5"/>',
  arc: '<path d="M8 10l10 12-6 4 14 14-4-10 8-2L20 8z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  boom: '<circle cx="24" cy="24" r="8" fill="currentColor"/><path d="M24 4v8M24 36v8M4 24h8M36 24h8M10 10l6 6M32 32l6 6M38 10l-6 6M16 32l-6 6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  leech: '<path d="M24 6c8 10 13 17 13 24a13 13 0 01-26 0c0-7 5-14 13-24z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M18 30a6 6 0 006 6" stroke="currentColor" stroke-width="3" fill="none"/>',
  harvest: '<path d="M24 6l6 12 12 2-9 9 2 13-11-6-11 6 2-13-9-9 12-2z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  mirror: '<path d="M8 40L40 8M14 8h26v26" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="14" cy="34" r="5" fill="currentColor"/>',
  wing: '<path d="M4 30c10-2 16-8 20-20 4 12 10 18 20 20-8 2-14 6-20 10-6-4-12-8-20-10z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  blade: '<path d="M6 42L34 14l8-8-2 10-26 28z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  clock: '<circle cx="24" cy="26" r="16" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 16v10l7 5M18 4h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  wave: '<circle cx="24" cy="24" r="5" fill="currentColor"/><circle cx="24" cy="24" r="12" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>',
  fury: '<path d="M24 4c3 8 12 10 12 22a12 12 0 01-24 0c0-6 3-9 5-12 1 5 3 7 5 7 0-7-2-11 2-17z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  heart: '<path d="M24 40S6 29 6 17a9 9 0 0118-3 9 9 0 0118 3c0 12-18 23-18 23z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12 22h7l3-5 4 10 3-5h7" fill="none" stroke="currentColor" stroke-width="2.5"/>',
  storm: '<path d="M10 20a10 10 0 0119-4 8 8 0 019 13H12a6 6 0 01-2-9z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 30l-5 9h6l-3 7" fill="none" stroke="currentColor" stroke-width="3"/>',
  chrono: '<path d="M14 6h20M14 42h20M16 6c0 12 16 12 16 18S16 30 16 42M32 6c0 12-16 12-16 18s16 6 16 18" fill="none" stroke="currentColor" stroke-width="3"/>',
  sing: '<circle cx="24" cy="24" r="6" fill="currentColor"/><path d="M24 6a18 18 0 0118 18M42 24a18 18 0 01-18 18M24 42A18 18 0 016 24M6 24A18 18 0 0124 6" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="10 6"/>',
  phoenix: '<path d="M24 42c-8-6-14-14-14-22 5 3 8 3 10 1-2-6 0-11 4-15 4 4 6 9 4 15 2 2 5 2 10-1 0 8-6 16-14 22z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
};
const svg = (k) => `<svg viewBox="0 0 48 48">${ICON[k] || ICON.crit}</svg>`;

const DIFFS = [
  { id: 'recruit', name: 'RECRUIT', chip: 'RELAXED', color: '#6dff9a', desc: 'Enemies hit softer and fall faster. One backup frame per sector.' },
  { id: 'veteran', name: 'VETERAN', chip: 'INTENDED', color: '#7fe6ff', desc: 'The fight as designed. Fast, fair, and it will punish standing still.' },
  { id: 'nightmare', name: 'NIGHTMARE', chip: 'BRUTAL', color: '#ff5a7a', desc: 'More of them, tougher, and they hit much harder. No second chances.' },
];

const LOGO = `
<div class="logo">
  <svg class="ring-back" viewBox="0 0 1000 300" preserveAspectRatio="none" style="z-index:0"><defs><linearGradient id="rg1" x1="0" x2="1"><stop offset="0" stop-color="#ffb547" stop-opacity="0"/><stop offset=".5" stop-color="#ffb547" stop-opacity=".55"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></linearGradient></defs><path d="M -10 190 A 520 64 -4 0 1 1010 150" fill="none" stroke="url(#rg1)" stroke-width="2"/></svg>
  <div class="word">RINGFALL</div>
  <svg class="ring-front" viewBox="0 0 1000 300" preserveAspectRatio="none" style="z-index:2"><defs><linearGradient id="rg2" x1="0" x2="1"><stop offset="0" stop-color="#ffd08a" stop-opacity="0"/><stop offset=".45" stop-color="#ffd08a" stop-opacity="1"/><stop offset="1" stop-color="#ffd08a" stop-opacity="0"/></linearGradient><filter id="gl"><feGaussianBlur stdDeviation="3"/></filter></defs><path d="M -10 190 A 520 64 -4 0 0 1010 150" fill="none" stroke="url(#rg2)" stroke-width="7" filter="url(#gl)" opacity=".7"/><path d="M -10 190 A 520 64 -4 0 0 1010 150" fill="none" stroke="url(#rg2)" stroke-width="2.5"/></svg>
  <div class="tag">HALCYON RING HAS FALLEN <b>SILENT</b></div>
</div>`;

export function createMenus(root) {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  root.appendChild(layer);
  const rotate = document.createElement('div');
  rotate.className = 'rotate';
  rotate.innerHTML = '<div><div class="ph"></div><p>ROTATE TO LANDSCAPE</p><p style="font-size:12px;color:var(--muted);margin-top:8px;letter-spacing:.1em">RINGFALL plays best sideways with both thumbs.</p><button id="rot-dismiss">PLAY IN PORTRAIT</button></div>';
  root.appendChild(rotate);
  let portraitOk = false;
  rotate.querySelector('#rot-dismiss').addEventListener('click', () => { portraitOk = true; rotate.classList.remove('on'); });

  let current = null;       // current screen name
  let backFn = null;        // Esc/B handler
  let focusables = [];
  let focusIdx = 0;

  function mount(html, opts = {}) {
    layer.innerHTML = `<div class="menu ${opts.dim === false ? '' : 'dim'}">${html}</div>`;
    layer.style.pointerEvents = 'auto';
    current = opts.name || 'menu';
    backFn = opts.back || null;
    focusables = [...layer.querySelectorAll('.btn, .aug')];
    focusIdx = 0;
    const m = layer.firstElementChild;
    m.addEventListener('pointerover', (e) => {
      const b = e.target.closest('.btn, .aug');
      if (b && !b._hov) { b._hov = true; G.audio?.play('uiHover', { volume: 0.35 }); setTimeout(() => { b._hov = false; }, 120); }
    });
    return m;
  }
  function on(sel, fn) {
    const e = layer.querySelector(sel);
    if (e) e.addEventListener('click', (ev) => { ev.preventDefault(); G.audio?.init(); G.audio?.play('uiClick', { volume: 0.6 }); fn(ev); });
    return e;
  }
  function hide() {
    layer.innerHTML = '';
    layer.style.pointerEvents = 'none';
    current = null; backFn = null; focusables = [];
  }

  function statsHtml(list) {
    return `<div class="stats">${list.map(([v, k]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>`;
  }

  // ---------------- title ----------------
  function showTitle() {
    const m = G.meta;
    const cp = m.checkpoint;
    const canFs = G.isTouch && document.fullscreenEnabled && !document.fullscreenElement;
    mount(`
      <div class="title-wrap">
        <div>${LOGO}
          <div class="title-meta"><span>BEST FLOOR <b>${m.bestFloor || '—'}</b></span><span>RUNS <b>${m.runs}</b></span><span>VICTORIES <b>${m.wins}</b></span>${m.bestScore ? `<span>HIGH SCORE <b>${m.bestScore.toLocaleString('en-US')}</b></span>` : ''}</div>
        </div>
        <div class="panel title-menu">
          <div class="kick">UNIT SEVEN · REACTIVATED</div>
          <button class="btn primary" id="t-play">DESCEND<small>Start a new run · 10 floors, 2 bosses</small><span class="arrow">▶</span></button>
          ${cp ? `<button class="btn" id="t-cont">RESUME AT THE GARDEN<small>Floor 6 · ${cp.difficulty.toUpperCase()} · ${cp.augments.length} augments kept</small></button>` : ''}
          <div class="row2" style="margin-top:8px"><button class="btn" id="t-set">SETTINGS</button><button class="btn" id="t-ctl">CONTROLS</button></div>
          ${canFs ? '<button class="btn" id="t-fs">FULLSCREEN<small>Recommended on phones</small></button>' : ''}
        </div>
      </div>
      <div class="title-foot">${G.isTouch ? 'LANDSCAPE · BOTH THUMBS · HEADPHONES' : 'MOUSE + KEYBOARD OR CONTROLLER · HEADPHONES RECOMMENDED'}</div>
    `, { name: 'title', dim: false });
    layer.firstElementChild.style.background = 'linear-gradient(90deg, rgba(3,5,10,.82) 0%, rgba(3,5,10,.35) 55%, rgba(3,5,10,.6) 100%)';
    on('#t-play', () => showDifficulty());
    on('#t-cont', () => { start(cp.difficulty, true); });
    on('#t-set', () => showSettings(showTitle));
    on('#t-ctl', () => showControls(showTitle));
    on('#t-fs', () => { requestFullscreen(); setTimeout(showTitle, 300); });
  }

  function showDifficulty() {
    mount(`
      <div class="panel">
        <div class="kick">CHOOSE YOUR DESCENT</div>
        <h3>DIFFICULTY</h3>
        <div class="diff">
          ${DIFFS.map(d => `<button class="btn ${d.id === 'veteran' ? 'primary' : ''}" data-d="${d.id}" style="--c:${d.color}"><b style="color:${d.color}">${d.name}</b><span class="chip" style="color:${d.color}">${d.chip}</span><small>${d.desc}</small></button>`).join('')}
        </div>
        <button class="btn" id="d-back" style="margin-top:14px">BACK</button>
      </div>`, { name: 'difficulty', back: showTitle });
    layer.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => { G.audio?.init(); G.audio?.play('uiConfirm'); start(b.dataset.d, false); }));
    on('#d-back', showTitle);
    focusIdx = 1; focusables[1]?.classList.add('focus');
  }

  function requestFullscreen() {
    try {
      const el = document.documentElement;
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
      if (p && p.then) p.then(() => { try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* ignore */ } }).catch(() => {});
    } catch { /* ignore */ }
  }

  function start(difficulty, checkpoint) {
    hide();
    G.audio?.init();
    if (G.input.source === 'kbm') G.input.requestLock();
    G.events.emit('startRun', { difficulty, checkpoint });
  }

  // ---------------- pause ----------------
  function showPause() {
    const r = G.run;
    const augs = G.augments.list;
    mount(`
      <div class="panel">
        <div class="kick">FLOOR ${r.floor} · ${formatTime(r.time)} · ${r.difficulty.toUpperCase()}</div>
        <h3>PAUSED</h3>
        ${statsHtml([[G.player.kills, 'KILLS'], [G.style.score.toLocaleString('en-US'), 'SCORE'], [RANKS[G.style.peak].l, 'PEAK STYLE']])}
        ${augs.length ? `<div class="owned" style="justify-content:flex-start">${augs.map(id => `<span>${nameOf(id)}</span>`).join('')}</div>` : ''}
        <button class="btn primary" id="p-resume">RESUME<span class="arrow">▶</span></button>
        <div class="row2" style="margin-top:8px"><button class="btn" id="p-set">SETTINGS</button><button class="btn" id="p-ctl">CONTROLS</button></div>
        <button class="btn danger" id="p-quit">ABANDON RUN</button>
        <div id="p-confirm"></div>
      </div>`, { name: 'pause', back: () => G.events.emit('resume') });
    on('#p-resume', () => G.events.emit('resume'));
    on('#p-set', () => showSettings(showPause));
    on('#p-ctl', () => showControls(showPause));
    on('#p-quit', () => {
      const c = layer.querySelector('#p-confirm');
      c.innerHTML = '<div class="confirm">Abandon this run? Everything since your last checkpoint is lost.<div class="row2" style="margin-top:10px"><button class="btn danger" id="p-yes">ABANDON</button><button class="btn" id="p-no">KEEP PLAYING</button></div></div>';
      focusables = [...layer.querySelectorAll('.btn, .aug')];
      on('#p-yes', () => G.events.emit('quitToTitle'));
      on('#p-no', () => { c.innerHTML = ''; focusables = [...layer.querySelectorAll('.btn, .aug')]; });
    });
  }

  let augNames = null;
  function nameOf(id) {
    if (!augNames) augNames = Object.fromEntries((G.augmentDefs || []).map(a => [a.id, a.name]));
    return augNames[id] || id;
  }

  // ---------------- settings ----------------
  function showSettings(back) {
    const s = G.settings;
    const range = (id, label, min, max, step, fmt = (v) => v) => `<label>${label}<span class="v" id="v-${id}">${fmt(s[id])}</span><input type="range" id="s-${id}" min="${min}" max="${max}" step="${step}" value="${s[id]}"></label>`;
    const toggle = (id, label) => `<label>${label}<span class="toggle ${s[id] ? 'on' : ''}" id="s-${id}" role="switch" tabindex="0" aria-checked="${!!s[id]}"></span></label>`;
    const select = (id, label, opts) => `<label>${label}<select id="s-${id}">${opts.map(([v, t]) => `<option value="${v}" ${String(s[id]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    const pct = (v) => Math.round(v * 100) + '%';
    const x = (v) => (+v).toFixed(2) + '×';
    mount(`
      <div class="panel">
        <div class="kick">CONFIGURATION</div>
        <h3>SETTINGS</h3>
        <div class="set">
          <h4>AIM</h4>
          ${range('mouseSens', 'Mouse sensitivity', 0.2, 3, 0.05, x)}
          ${range('touchSens', 'Touch look sensitivity', 0.3, 3, 0.05, x)}
          ${range('padSens', 'Controller sensitivity', 0.3, 3, 0.05, x)}
          ${select('aimAssist', 'Aim assist (touch & controller)', [[0, 'Off'], [1, 'Standard'], [1.6, 'Strong']])}
          ${toggle('autoFire', 'Auto-fire on touch')}
          ${toggle('invertY', 'Invert look up/down')}
          <h4>TOUCH</h4>
          ${toggle('leftHanded', 'Left-handed layout')}
          ${toggle('haptics', 'Vibration')}
          <h4>VIDEO</h4>
          ${select('quality', 'Graphics quality', [['auto', 'Auto (adaptive)'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']])}
          ${range('fov', 'Field of view', 80, 115, 1, (v) => v + '°')}
          ${range('shake', 'Screen shake', 0, 1.5, 0.05, pct)}
          ${toggle('damageNumbers', 'Damage numbers')}
          ${toggle('showFps', 'Show frame rate')}
          <h4>AUDIO</h4>
          ${range('musicVol', 'Music', 0, 1, 0.05, pct)}
          ${range('sfxVol', 'Effects', 0, 1, 0.05, pct)}
        </div>
        <button class="btn primary" id="s-done" style="margin-top:14px">DONE</button>
      </div>`, { name: 'settings', back });
    const fmts = { mouseSens: x, touchSens: x, padSens: x, fov: (v) => v + '°', shake: pct, musicVol: pct, sfxVol: pct };
    layer.querySelectorAll('input[type=range]').forEach(inp => inp.addEventListener('input', () => {
      const id = inp.id.slice(2);
      s[id] = +inp.value;
      layer.querySelector('#v-' + id).textContent = fmts[id](s[id]);
      apply(id);
    }));
    layer.querySelectorAll('.toggle').forEach(t => {
      const flip = () => {
        const id = t.id.slice(2);
        s[id] = !s[id];
        t.classList.toggle('on', s[id]); t.setAttribute('aria-checked', s[id]);
        G.audio?.play('uiClick', { volume: 0.5 });
        apply(id);
      };
      t.addEventListener('click', flip);
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    });
    layer.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => {
      const id = sel.id.slice(2);
      s[id] = id === 'aimAssist' ? +sel.value : sel.value;
      apply(id);
    }));
    on('#s-done', () => { saveSettings(); back(); });
  }

  function apply(id) {
    const s = G.settings;
    if (id === 'quality') {
      const q = s.quality === 'auto' ? (G.isTouch ? 'medium' : 'high') : s.quality;
      G.renderer.setQuality(q, s.quality === 'auto');
    }
    if (id === 'musicVol' || id === 'sfxVol') G.audio?.setVolumes({ music: s.musicVol, sfx: s.sfxVol });
    if (id === 'leftHanded') document.getElementById('touch').classList.toggle('lefty', s.leftHanded);
    saveSettings();
  }

  // ---------------- controls ----------------
  function showControls(back, tab = G.input.source === 'touch' ? 'touch' : G.input.source === 'pad' ? 'pad' : 'kbm') {
    const T = {
      kbm: [['Move', 'W A S D'], ['Aim', 'Mouse'], ['Fire', 'Left click'], ['Scope', 'Right click'], ['Jump / double jump', 'Space'], ['Dash', 'Shift'], ['Punch / shatter / deflect', 'F or E'], ['Overdrive', 'Q'], ['Reload', 'R'], ['Weapons', '1 – 4 · wheel'], ['Pause', 'Esc']],
      touch: [['Move', 'Left thumb, anywhere'], ['Aim', 'Right thumb drag'], ['Fire', 'Automatic on target · or hold ◎'], ['Jump', '⌃⌃ button'], ['Dash', '≫ button'], ['Punch / shatter', '✊ button'], ['Overdrive', '⚡ when charged'], ['Weapons', '⇄ button'], ['Reload', '↻ button'], ['Pause', 'top-left']],
      pad: [['Move', 'Left stick'], ['Aim', 'Right stick'], ['Fire', 'RT'], ['Scope', 'LT'], ['Jump', 'A'], ['Dash', 'B / L3'], ['Punch / shatter', 'RB / R3'], ['Overdrive', 'LB'], ['Reload', 'X'], ['Next weapon', 'Y'], ['Pause', 'Start']],
    };
    mount(`
      <div class="panel" style="width:min(640px,100%)">
        <div class="kick">FIELD MANUAL</div>
        <h3>CONTROLS</h3>
        <div class="tabs"><button data-t="kbm" class="${tab === 'kbm' ? 'on' : ''}">KEYBOARD</button><button data-t="touch" class="${tab === 'touch' ? 'on' : ''}">TOUCH</button><button data-t="pad" class="${tab === 'pad' ? 'on' : ''}">CONTROLLER</button></div>
        <div class="ctl">${T[tab].map(([a, k]) => `<div><span>${a}</span><kbd>${k}</kbd></div>`).join('')}</div>
        <p style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:14px">Shoot constructs until they crack <b style="color:#ffcf6b">◆</b>, then punch them to SHATTER for repair orbs. Punch incoming orbs to send them back. Dash makes you briefly untouchable.</p>
        <button class="btn primary" id="c-done" style="margin-top:12px">DONE</button>
      </div>`, { name: 'controls', back });
    layer.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => { G.audio?.play('uiClick', { volume: 0.5 }); showControls(back, b.dataset.t); }));
    on('#c-done', back);
  }

  // ---------------- augment draft ----------------
  let augCb = null;
  function showAugments(choices, info, cb) {
    augCb = cb;
    const owned = G.augments.list;
    const cards = choices.map((a, i) => {
      const r = RARITY[a.rarity];
      const stacks = G.augments.owned[a.id] || 0;
      return `<button class="aug" data-id="${a.id}" style="--rc:${r.color}"><span class="key">${i + 1}</span><div class="rar">${r.label}</div><div class="ico">${svg(a.icon)}</div><h4>${a.name}</h4><p>${a.desc}</p>${a.max > 1 ? `<div class="stack">${stacks ? `OWNED ×${stacks} · ` : ''}STACKS TO ${a.max}</div>` : ''}</button>`;
    }).join('');
    const weapon = info.weapon ? `<div class="unlock">NEW WEAPON ACQUIRED — ${info.weapon === 'lance' ? 'ARC LANCE [3]' : 'NOVA LAUNCHER [4]'}</div>` : '';
    mount(`
      <div class="aug-wrap">
        <div class="kick">FLOOR ${info.floor} ${info.boss ? 'BOSS DESTROYED' : 'CLEARED'}</div>
        <h2>CHOOSE AN AUGMENT</h2>
        <div class="sub">Your frame can integrate one upgrade before the next descent.</div>
        ${weapon}
        <div class="augs">${cards}</div>
        ${owned.length ? `<div class="owned">${owned.map(id => `<span>${nameOf(id)}</span>`).join('')}</div>` : ''}
      </div>`, { name: 'augment' });
    layer.querySelectorAll('.aug').forEach(b => b.addEventListener('click', () => pickAug(b.dataset.id)));
  }
  function pickAug(id) {
    if (!augCb) return;
    const cb = augCb; augCb = null;
    const el = layer.querySelector(`.aug[data-id="${id}"]`);
    if (el) { el.style.transform = 'scale(1.05)'; el.style.borderColor = '#fff'; }
    setTimeout(() => { hide(); cb(id); if (G.weapons.owned.includes('lance') && id) {} }, 260);
  }

  // ---------------- end screens ----------------
  function runStats() {
    const r = G.run;
    const acc = G.weapons.shotsFired ? Math.round(G.weapons.shotsHit / G.weapons.shotsFired * 100) + '%' : '—';
    return statsHtml([[r.floor, 'FLOOR'], [G.player.kills, 'KILLS'], [r.shatters, 'SHATTERS'], [formatTime(r.time), 'TIME'], [acc, 'ACCURACY'], [G.style.score.toLocaleString('en-US'), 'SCORE']]);
  }
  function showDeath() {
    const r = G.run;
    const cp = G.meta.checkpoint;
    const canCp = cp && r.floor >= 6 && cp.difficulty === r.difficulty;
    const peak = RANKS[G.style.peak];
    mount(`
      <div class="panel end dead" style="width:min(620px,100%)">
        <div class="kick">UNIT SEVEN · SIGNAL LOST</div>
        <h1>FRAME DESTROYED</h1>
        <div class="rankbig" style="color:${peak.color}">${peak.l}</div>
        <div class="kick" style="margin:2px 0 0">PEAK STYLE · ${peak.name}</div>
        ${runStats()}
        <p class="quote">"Frame lost. I've got your pattern — we go again."</p>
        ${canCp ? '<button class="btn primary" id="e-cp">RETRY FROM THE GARDEN<small>Floor 6 with your saved augments</small></button>' : ''}
        <div class="row2" style="margin-top:8px"><button class="btn ${canCp ? '' : 'primary'}" id="e-new">NEW RUN</button><button class="btn" id="e-title">TITLE</button></div>
      </div>`, { name: 'death' });
    on('#e-cp', () => start(r.difficulty, true));
    on('#e-new', () => start(r.difficulty, false));
    on('#e-title', () => G.events.emit('quitToTitle'));
  }
  function showVictory() {
    const peak = RANKS[G.style.peak];
    mount(`
      <div class="panel end win" style="width:min(620px,100%)">
        <div class="kick">HALCYON RING · CORE</div>
        <h1>THE CHOIR IS SILENT</h1>
        <div class="rankbig" style="color:${peak.color}">${peak.l}</div>
        ${runStats()}
        <p class="quote">"...Listen. Silence. Real silence. Thank you, Seven." — VESPER</p>
        <button class="btn primary" id="v-endless">KEEP DESCENDING<small>Endless mode · the echoes get stronger</small></button>
        <button class="btn" id="v-title">TITLE</button>
      </div>`, { name: 'victory' });
    on('#v-endless', () => { hide(); G.events.emit('endless'); });
    on('#v-title', () => G.events.emit('quitToTitle'));
  }

  // ---------------- keyboard / gamepad navigation ----------------
  function moveFocus(d) {
    if (!focusables.length) return;
    focusables[focusIdx]?.classList.remove('focus');
    focusIdx = (focusIdx + d + focusables.length) % focusables.length;
    const f = focusables[focusIdx];
    f.classList.add('focus');
    f.scrollIntoView?.({ block: 'nearest' });
    G.audio?.play('uiHover', { volume: 0.35 });
  }
  function activate() {
    const f = focusables[focusIdx];
    if (f) f.click();
  }
  window.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') && !['Escape'].includes(e.key)) return;
    if (current === 'augment' && ['1', '2', '3'].includes(e.key)) {
      const cards = layer.querySelectorAll('.aug');
      const c = cards[+e.key - 1];
      if (c) pickAug(c.dataset.id);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); moveFocus(-1); }
    else if (e.key === 'Enter' && focusables[focusIdx]?.classList.contains('focus')) { e.preventDefault(); activate(); }
    else if (e.key === 'Escape' && backFn && current !== 'pause') { e.preventDefault(); backFn(); }
  });
  let padPrev = [];
  function update() {
    // portrait prompt on phones
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    rotate.classList.toggle('on', G.isTouch && portrait && !portraitOk);
    if (!current) { padPrev = []; return; }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find(p => p && p.connected);
    if (!gp) return;
    const b = gp.buttons.map(x => x.pressed);
    const edge = (i) => b[i] && !padPrev[i];
    const ay = gp.axes[1] || 0, ax = gp.axes[0] || 0;
    const stick = Math.abs(ay) > 0.6 ? Math.sign(ay) : Math.abs(ax) > 0.6 ? Math.sign(ax) : 0;
    if (edge(13) || edge(15) || (stick > 0 && !padPrev.stick)) moveFocus(1);
    if (edge(12) || edge(14) || (stick < 0 && !padPrev.stick)) moveFocus(-1);
    if (edge(0)) activate();
    if (edge(1) && backFn) backFn();
    if (edge(9) && current === 'pause') G.events.emit('resume');
    padPrev = b; padPrev.stick = stick !== 0;
  }

  return {
    showTitle, showDifficulty, showPause, showSettings, showControls, showAugments, showDeath, showVictory, hide, update, requestFullscreen,
    get open() { return !!current; }, get current() { return current; },
  };
}
