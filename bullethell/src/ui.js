// DOM menus: title, difficulty, ship select, practice, options, scores, how-to,
// pause, stage results, relic choice, game over, victory.
import { SHIPS, RELICS } from './player.js';
import { LEVELS } from './levels.js';
import { fmtNum, fmtTime } from './math.js';

export const DIFFS = [
  { id: 'novice', name: 'Novice', desc: 'Fewer, slower bullets. 5 lives. Learn the worlds.', count: 0.6, speed: 0.82, hp: 0.8, lives: 5, bombs: 3 },
  { id: 'normal', name: 'Normal', desc: 'The intended experience. 3 lives.', count: 1, speed: 1, hp: 1, lives: 3, bombs: 3 },
  { id: 'lunatic', name: 'Lunatic', desc: 'Dense, fast, relentless. 2 lives. For the deranged.', count: 1.45, speed: 1.18, hp: 1.2, lives: 2, bombs: 2 },
];

export class UI {
  constructor(g, root) { this.g = g; this.root = root; this.screen = null; this.sel = { diff: 'normal', ship: 'vesper', stage: 0 }; }
  hide() { this.root.innerHTML = ''; this.root.classList.remove('on'); this.screen = null; }
  show(name, data) {
    this.screen = name; this.root.classList.add('on');
    this.root.innerHTML = '';
    const el = document.createElement('div'); el.className = 'screen ' + name; this.root.appendChild(el);
    this['s_' + name](el, data || {});
    const first = el.querySelector('button.primary') || el.querySelector('button');
    if (first && !this.g.input.anyTouch) first.focus();
  }
  btn(label, fn, cls = '') { const b = document.createElement('button'); b.className = cls; b.innerHTML = label; b.addEventListener('click', () => { this.g.audio.init(); this.g.audio.sfx(cls.includes('back') ? 'back' : 'confirm'); fn(); }); b.addEventListener('mouseenter', () => this.g.audio.sfx('select')); return b; }
  h(el, tag, html, cls) { const e = document.createElement(tag); e.innerHTML = html; if (cls) e.className = cls; el.appendChild(e); return e; }

  s_title(el) {
    const g = this.g, d = g.save;
    this.h(el, 'div', 'A BULLET HELL IN SEVEN VERSES', 'kicker');
    this.h(el, 'h1', 'HOLLOW<br><span>CHOIR</span>');
    this.h(el, 'div', 'Seven worlds. One song. Silence it.', 'tag');
    const m = this.h(el, 'div', '', 'menu');
    m.appendChild(this.btn('BEGIN THE DESCENT', () => this.show('difficulty'), 'primary'));
    m.appendChild(this.btn('PRACTICE' + (d.unlocked > 1 ? ` <small>${d.unlocked}/7 WORLDS</small>` : ' <small>clear a world to unlock</small>'), () => this.show('practice'), d.unlocked > 1 ? '' : 'dim'));
    m.appendChild(this.btn('HOW TO PLAY', () => this.show('how')));
    m.appendChild(this.btn('HIGH SCORES', () => this.show('scores')));
    m.appendChild(this.btn('OPTIONS', () => this.show('options')));
    const best = Math.max(0, ...['novice', 'normal', 'lunatic'].flatMap((k) => (d.hiscores[k] || []).map((e) => e.score)));
    this.h(el, 'div', (best ? `BEST ${fmtNum(best)} · ` : '') + (d.clears.normal ? 'THE CHOIR HAS BEEN SILENCED · ' : '') + 'Z/SPACE fire · SHIFT focus · X bomb · C overdrive', 'foot');
  }
  s_difficulty(el) {
    this.h(el, 'h2', 'CHOOSE YOUR SUFFERING');
    const list = this.h(el, 'div', '', 'cards');
    for (const df of DIFFS) {
      const c = this.btn(`<b>${df.name.toUpperCase()}</b><span>${df.desc}</span>${df.id === 'lunatic' ? '<i>★ true ending score bonus</i>' : ''}`, () => { this.sel.diff = df.id; this.show('ship'); }, 'card ' + (df.id === 'normal' ? 'primary' : ''));
      list.appendChild(c);
    }
    el.appendChild(this.btn('BACK', () => this.show('title'), 'back'));
  }
  s_ship(el) {
    this.h(el, 'h2', 'CHOOSE YOUR HULL');
    const list = this.h(el, 'div', '', 'cards ships');
    for (const s of SHIPS) {
      const c = this.btn(`<b style="color:${s.color}">${s.name}</b><em>${s.role}</em><span>${s.desc}</span><small>${s.bomb}</small>`, () => { this.sel.ship = s.id; this.g.startRun({ diff: this.sel.diff, ship: s.id, stage: this.sel.practice ? this.sel.stage : 0, practice: !!this.sel.practice }); }, 'card ' + (s.id === 'vesper' ? 'primary' : ''));
      list.appendChild(c);
    }
    el.appendChild(this.btn('BACK', () => this.show(this.sel.practice ? 'practice' : 'difficulty'), 'back'));
  }
  s_practice(el) {
    const d = this.g.save;
    this.h(el, 'h2', 'PRACTICE A WORLD');
    this.h(el, 'p', 'Any world you have reached. Practice runs never post a high score.', 'sub');
    const list = this.h(el, 'div', '', 'stages');
    LEVELS.forEach((L, i) => {
      const locked = i >= d.unlocked;
      const b = this.btn(`<b>${i + 1}</b><span>${locked ? '???' : L.name}</span><em>${locked ? 'locked' : L.sub}</em>`, () => { if (locked) return; this.sel.stage = i; this.sel.practice = true; this.show('difficulty'); }, 'stage ' + (locked ? 'dim' : ''));
      b.style.setProperty('--c', L.pal.accent); list.appendChild(b);
    });
    el.appendChild(this.btn('BACK', () => { this.sel.practice = false; this.show('title'); }, 'back'));
  }
  s_how(el) {
    this.h(el, 'h2', 'HOW TO PLAY');
    this.h(el, 'div', `
      <p><b>Move</b> — arrows / WASD, left stick, or drag anywhere on touch.</p>
      <p><b>Fire</b> — automatic (or hold Z / SPACE). <b>Focus</b> — hold SHIFT: slow precise movement, shows your tiny <i>hitbox</i>. Only that dot can be hit.</p>
      <p><b>Bomb</b> — X. Clears the screen, makes you briefly invulnerable. Press within a heartbeat of being hit to <i>death-bomb</i> instead of dying.</p>
      <p><b>Graze</b> — let bullets skim past your hull without touching the dot. Every graze fills the <b>Overdrive</b> meter and raises your chain.</p>
      <p><b>Overdrive</b> — C when the meter is full. Bullets slow to a crawl and your damage spikes for several seconds. It is your fourth resource: use it.</p>
      <p><b>Chain</b> — the ×multiplier grows with kills and grazes and halves when you die. Cancelled bullets and boss phases pay out through it.</p>
      <p><b>Bosses</b> — each phase has a health bar and a timer. Clear it before the timer for a bonus; do it without being hit or bombing and it is <i>silenced</i> for 1.5×.</p>
      <p><b>Relics</b> — after each world you choose one of three permanent upgrades for the run.</p>
      <p><b>Every world has a rule.</b> Cover. Mirrors. Spores. Lasers. Gravity. Time. Rhythm. Read the tip when you arrive.</p>`, 'howtext');
    el.appendChild(this.btn('BACK', () => this.show('title'), 'back'));
  }
  s_scores(el) {
    const d = this.g.save;
    this.h(el, 'h2', 'HIGH SCORES');
    const tabs = this.h(el, 'div', '', 'tabs');
    const table = this.h(el, 'div', '', 'table');
    const render = (k) => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      const L = d.hiscores[k] || [];
      table.innerHTML = L.length ? L.map((e, i) => `<div class="row"><span>${i + 1}</span><b>${fmtNum(e.score)}</b><em>${e.ship}</em><i>${e.cleared ? 'CLEAR' : 'W' + e.stage}</i><small>${e.date}</small></div>`).join('') : '<div class="row empty">no scores yet</div>';
    };
    for (const df of DIFFS) { const b = this.btn(df.name.toUpperCase(), () => render(df.id)); b.dataset.k = df.id; tabs.appendChild(b); }
    render('normal');
    const s = d.stats;
    this.h(el, 'p', `${s.runs} runs · ${fmtNum(s.kills)} kills · ${s.bosses} bosses silenced · ${fmtNum(s.graze)} grazes · ${fmtTime(s.playtime)} played`, 'sub');
    el.appendChild(this.btn('BACK', () => this.show('title'), 'back'));
  }
  s_options(el, data) {
    const g = this.g, o = g.save.options;
    this.h(el, 'h2', 'OPTIONS');
    const box = this.h(el, 'div', '', 'opts');
    const slider = (label, key) => { const r = document.createElement('label'); r.innerHTML = `<span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${o[key]}"><b>${Math.round(o[key] * 100)}%</b>`; const inp = r.querySelector('input'); inp.addEventListener('input', () => { o[key] = +inp.value; r.querySelector('b').textContent = Math.round(o[key] * 100) + '%'; g.applyOptions(); }); inp.addEventListener('change', () => g.audio.sfx('select')); box.appendChild(r); };
    const toggle = (label, key) => { const b = this.btn(`<span>${label}</span><b>${o[key] ? 'ON' : 'OFF'}</b>`, () => { o[key] = !o[key]; b.querySelector('b').textContent = o[key] ? 'ON' : 'OFF'; g.applyOptions(); }, 'toggle'); box.appendChild(b); };
    slider('Music', 'music'); slider('Sound', 'sfx');
    toggle('Auto-fire', 'autofire'); toggle('Screen shake', 'shake'); toggle('Always show hitbox', 'hitbox'); toggle('Heavy particles', 'fx');
    const row = this.h(el, 'div', '', 'row2');
    row.appendChild(this.btn('FULLSCREEN', () => { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (d.requestFullscreen) d.requestFullscreen(); }));
    row.appendChild(this.btn('ERASE SAVE', () => { if (confirm('Erase all scores, unlocks and options?')) { g.eraseSave(); this.show('options', data); } }, 'danger'));
    el.appendChild(this.btn('BACK', () => { g.saveData(); data.from === 'pause' ? this.show('pause') : this.show('title'); }, 'back'));
  }
  s_pause(el) {
    const g = this.g;
    this.h(el, 'h2', 'PAUSED');
    this.h(el, 'p', `World ${g.stageIdx + 1} · ${g.levelDef.name}<br><small>${g.levelDef.tip}</small>`, 'sub');
    const m = this.h(el, 'div', '', 'menu');
    m.appendChild(this.btn('RESUME', () => g.resume(), 'primary'));
    m.appendChild(this.btn('RESTART WORLD', () => g.restartStage()));
    m.appendChild(this.btn('OPTIONS', () => this.show('options', { from: 'pause' })));
    m.appendChild(this.btn('ABANDON RUN', () => g.quitToTitle(), 'danger'));
  }
  s_results(el, r) {
    const g = this.g;
    this.h(el, 'div', `WORLD ${r.num} SILENCED`, 'kicker');
    this.h(el, 'h2', r.name);
    const t = this.h(el, 'div', '', 'stats');
    const row = (k, v, cls = '') => this.h(t, 'div', `<span>${k}</span><b>${v}</b>`, 'srow ' + cls);
    row('Time', fmtTime(r.time)); row('Kills', r.kills); row('Grazes', r.graze); row('Deaths', r.deaths); row('Bombs used', r.bombs);
    row('Clear bonus', '+' + fmtNum(r.bonus), 'hi');
    if (r.noMiss) row('NO MISS', '+' + fmtNum(r.noMissBonus), 'gold');
    if (r.noBomb) row('NO BOMB', '+' + fmtNum(r.noBombBonus), 'gold');
    row('Score', fmtNum(r.score), 'total');
    el.appendChild(this.btn(r.practice ? 'RETURN TO TITLE' : r.last ? 'THE FINAL VERSE' : 'CHOOSE A RELIC', () => g.afterResults(), 'primary'));
  }
  s_relic(el, data) {
    const g = this.g;
    this.h(el, 'h2', 'CHOOSE A RELIC');
    this.h(el, 'p', 'One permanent gift for the rest of the run.', 'sub');
    const list = this.h(el, 'div', '', 'cards');
    for (const r of data.choices) list.appendChild(this.btn(`<b>${r.name.toUpperCase()}</b><span>${r.desc}</span>`, () => g.pickRelic(r.id), 'card'));
  }
  s_gameover(el, data) {
    const g = this.g;
    this.h(el, 'div', 'THE SONG GOES ON', 'kicker');
    this.h(el, 'h2', 'SILENCED');
    const t = this.h(el, 'div', '', 'stats');
    this.h(t, 'div', `<span>Score</span><b>${fmtNum(g.score)}</b>`, 'srow total');
    this.h(t, 'div', `<span>Reached</span><b>World ${g.stageIdx + 1} · ${g.levelDef.name}</b>`, 'srow');
    if (data.rank >= 0) this.h(t, 'div', `<span>High score</span><b>#${data.rank + 1} on ${g.diffName}</b>`, 'srow gold');
    const m = this.h(el, 'div', '', 'menu');
    if (g.practice) m.appendChild(this.btn('RETRY WORLD', () => g.restartStage(), 'primary'));
    else m.appendChild(this.btn(`CONTINUE <small>score resets · ${g.continues} used</small>`, () => g.continueRun(), 'primary'));
    m.appendChild(this.btn('RETURN TO TITLE', () => g.quitToTitle()));
  }
  s_victory(el, data) {
    const g = this.g;
    this.h(el, 'div', 'THE CHOIR IS SILENT', 'kicker');
    this.h(el, 'h2', 'REQUIEM');
    this.h(el, 'div', `<p>The song stops. For the first time in a thousand years the seven worlds hear nothing at all, and in that nothing something like morning begins.</p><p>The pilot cuts the engines and listens to it.</p>`, 'story');
    const t = this.h(el, 'div', '', 'stats');
    this.h(t, 'div', `<span>Final score</span><b>${fmtNum(g.score)}</b>`, 'srow total');
    this.h(t, 'div', `<span>Difficulty</span><b>${g.diffName}</b>`, 'srow');
    this.h(t, 'div', `<span>Deaths</span><b>${g.player.stats.deaths}</b>`, 'srow');
    this.h(t, 'div', `<span>Continues</span><b>${g.continues}</b>`, 'srow');
    this.h(t, 'div', `<span>Time</span><b>${fmtTime(g.runTime)}</b>`, 'srow');
    if (data.rank >= 0) this.h(t, 'div', `<span>High score</span><b>#${data.rank + 1} on ${g.diffName}</b>`, 'srow gold');
    this.h(el, 'div', `<b>HOLLOW CHOIR</b><br>design · code · art · music: generated live in your browser<br>no assets, no engine, no mercy<br><br>${g.diffName === 'Lunatic' ? 'You cleared Lunatic. There is nothing above you now.' : 'Lunatic awaits.'}`, 'credits');
    el.appendChild(this.btn('RETURN TO TITLE', () => g.quitToTitle(), 'primary'));
  }
}
