// In-game HUD (DOM overlay). Positioned world labels are projected from 3D each frame.
import * as THREE from 'three';
import { G } from '../state.js';
import { clamp, formatTime } from '../util.js';
import { WEAPONS, ORDER } from '../game/weapons.js';
import { RANKS } from '../game/style.js';

const TIPS = {
  move: {
    kbm: '<kbd>WASD</kbd> move · <kbd>MOUSE</kbd> aim · <kbd>CLICK</kbd> fire · <kbd>SPACE</kbd> jump',
    touch: 'Left thumb moves · right thumb aims · weapons fire on their own when you\'re on target',
    pad: '<kbd>L</kbd> move · <kbd>R</kbd> aim · <kbd>RT</kbd> fire · <kbd>A</kbd> jump',
  },
  dash: {
    kbm: '<kbd>SHIFT</kbd> dash — you can\'t be hit mid-dash',
    touch: 'Tap <kbd>DASH</kbd> to slip through incoming fire',
    pad: '<kbd>B</kbd> dash — you can\'t be hit mid-dash',
  },
  stagger: {
    kbm: 'Cracked ◆ constructs: press <kbd>F</kbd> to lunge and SHATTER for repair orbs',
    touch: 'Cracked ◆ construct — tap <kbd>PUNCH</kbd> to lunge and SHATTER it for repair orbs',
    pad: 'Cracked ◆ construct — <kbd>RB</kbd> to lunge and SHATTER it for repair orbs',
  },
  pads: {
    kbm: 'Jump pads launch you to high ground · <kbd>SPACE</kbd> ×2 to double jump',
    touch: 'Jump pads launch you to high ground · tap jump twice to double jump',
    pad: 'Jump pads launch you to high ground · <kbd>A</kbd> ×2 to double jump',
  },
  overdrive: {
    kbm: '<kbd>Q</kbd> OVERDRIVE — time slows, your damage rises, no reloads',
    touch: 'Tap <kbd>⚡</kbd> for OVERDRIVE — time slows, no reloads',
    pad: '<kbd>LB</kbd> OVERDRIVE — time slows, no reloads',
  },
  lance: {
    kbm: '<kbd>3</kbd> ARC LANCE — pierces everything in a line · <kbd>RMB</kbd> to scope',
    touch: 'Tap the weapon button to cycle to the ARC LANCE — it pierces every enemy in a line',
    pad: '<kbd>Y</kbd> cycle weapons · the ARC LANCE pierces every enemy in a line',
  },
  nova: {
    kbm: '<kbd>4</kbd> NOVA LAUNCHER — shoot your feet mid-jump to rocket jump',
    touch: 'NOVA LAUNCHER unlocked — splash damage, and a rocket jump if you shoot the floor',
    pad: 'NOVA LAUNCHER unlocked — shoot the floor mid-jump to rocket jump',
  },
  pylons: {
    kbm: 'Destroy the 4 pylons to break the Heart\'s shell',
    touch: 'Destroy the 4 pylons to break the Heart\'s shell',
    pad: 'Destroy the 4 pylons to break the Heart\'s shell',
  },
  melee: {
    kbm: '<kbd>F</kbd> punch — knocks enemy orbs straight back at them',
    touch: 'Tap <kbd>PUNCH</kbd> as an orb arrives to knock it back',
    pad: '<kbd>RB</kbd> punch — knocks enemy orbs straight back at them',
  },
};

export function createHud(root) {
  const el = document.createElement('div');
  el.className = 'hud off';
  el.innerHTML = `
    <div class="xh"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="d"></i><i class="ring"></i></div>
    <div class="hm"><i></i><i></i><i></i><i></i></div>
    <div class="reload-tag">RELOADING</div>
    <div class="dmgdir">${'<i></i>'.repeat(6)}</div>
    <div class="offs">${'<i></i>'.repeat(10)}</div>
    <div class="labels"></div>
    <div class="vitals">
      <div class="vit-row"><span class="hp">100</span><span class="sh">50</span><span class="lbl">HULL · SHIELD</span></div>
      <div class="bar shbar"><b></b><i></i></div>
      <div class="bar hpbar"><b></b><i></i><span class="ticks"></span></div>
      <div class="pips"><span class="lbl">DASH</span></div>
      <div class="odm"><span class="lbl">OVERDRIVE</span><div class="bar"><i></i></div></div>
    </div>
    <div class="wpn"><div class="ammo mono">36<small>/36</small></div><div class="name">PULSE CARBINE</div><div class="slots"></div></div>
    <div class="topc"><div class="wave-info mono"></div><div class="boss"><div class="bname"></div><div class="bar"><i></i></div><div class="sub"></div></div></div>
    <div class="score"><div class="pts mono">0</div><div class="lbl">SCORE</div></div>
    <div class="style empty"><div class="rank">D</div><div class="rname">DECENT</div><div class="sbar"><i></i></div><div class="feed"></div></div>
    <div class="ann"><h2></h2><p></p></div>
    <div class="card"><div class="k"></div><h1></h1><div class="rule"></div></div>
    <div class="newfoe"><div class="k">NEW HOSTILE</div><div class="n"></div></div>
    <div class="subs"><div class="who">VESPER</div><div class="txt"></div></div>
    <div class="tip"></div>
    <div class="warp"></div>
    <div class="fps" hidden></div>
  `;
  root.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const xh = $('.xh'), hm = $('.hm'), reloadTag = $('.reload-tag');
  const dirEls = [...el.querySelectorAll('.dmgdir i')].map(e => ({ e, t: 0, a: 0 }));
  const offEls = [...el.querySelectorAll('.offs i')];
  const labels = $('.labels');
  const hpEl = $('.vit-row .hp'), shEl = $('.vit-row .sh');
  const hpBar = $('.hpbar'), hpFill = $('.hpbar > i'), hpLag = $('.hpbar > b'), shFill = $('.shbar > i'), shLag = $('.shbar > b');
  const pips = $('.pips'), odm = $('.odm'), odFill = $('.odm .bar > i');
  const ammoEl = $('.wpn .ammo'), wname = $('.wpn .name'), slots = $('.wpn .slots');
  const waveInfo = $('.wave-info'), bossEl = $('.boss'), bossName = $('.boss .bname'), bossFill = $('.boss .bar > i'), bossBar = $('.boss .bar'), bossSub = $('.boss .sub');
  const scoreEl = $('.score .pts');
  const styleEl = $('.style'), rankEl = $('.style .rank'), rnameEl = $('.style .rname'), sbar = $('.style .sbar i'), feedEl = $('.style .feed');
  const ann = $('.ann'), card = $('.card'), newfoe = $('.newfoe'), subs = $('.subs'), subTxt = $('.subs .txt'), subWho = $('.subs .who'), tipEl = $('.tip');
  const warpEl = $('.warp'), fpsEl = $('.fps');

  // pools for projected labels
  const dnPool = [];
  for (let i = 0; i < 26; i++) { const d = document.createElement('div'); d.className = 'dn'; labels.appendChild(d); dnPool.push({ el: d, t: 0 }); }
  const stgPool = [];
  for (let i = 0; i < 8; i++) { const d = document.createElement('div'); d.className = 'stg'; d.innerHTML = '<b></b><span>SHATTER</span>'; labels.appendChild(d); stgPool.push(d); }

  const v = new THREE.Vector3();
  let lastAmmoKey = '', lastHp = -1, lastSh = -1, lastScore = -1, lastPips = '', lastOd = -1, odReady = false;
  let subQueue = [], subT = 0, subLine = '', subChar = 0, subDelay = 0;
  let tipT = 0; const tipsShown = new Set();
  let fpsAcc = 0, fpsN = 0, fpsT = 0;
  let bossState = { on: false };
  const touch = () => G.input?.source === 'touch';

  function project(x, y, z) {
    v.set(x, y, z).project(G.camera);
    const W = window.innerWidth, H = window.innerHeight;
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, behind: v.z > 1, ndcX: v.x, ndcY: v.y };
  }

  function buildSlots() {
    slots.innerHTML = ORDER.map(id => `<span data-w="${id}" class="${G.weapons.owned.includes(id) ? '' : 'locked'}">${WEAPONS[id].key} ${WEAPONS[id].short}</span>`).join('');
  }

  const H = {
    el,
    show(on) { el.classList.toggle('off', !on); },
    setAmmo(ammo, mag, reloading) {
      const od = G.player.odActive > 0;
      const key = `${ammo}/${mag}/${reloading}/${od}`;
      if (key === lastAmmoKey) return;
      lastAmmoKey = key;
      ammoEl.innerHTML = od ? '∞<small>OVERDRIVE</small>' : `${ammo}<small>/${mag}</small>`;
      ammoEl.classList.toggle('low', !od && ammo <= Math.ceil(mag * 0.25));
      reloadTag.classList.toggle('on', reloading);
      const sw = G.input?.touch?.buttons.swap;
      if (sw) sw.querySelector('.ammo').textContent = od ? '∞' : reloading ? '···' : `${ammo}/${mag}`;
    },
    weaponChanged() {
      const def = G.weapons.def;
      wname.textContent = def.name;
      buildSlots();
      slots.querySelectorAll('span').forEach(s => s.classList.toggle('on', s.dataset.w === def.id));
      xh.classList.remove('carbine', 'scatter', 'lance', 'nova');
      xh.classList.add(def.id);
      lastAmmoKey = '';
    },
    hitmarker(kind) {
      hm.className = 'hm';
      void hm.offsetWidth;
      hm.className = 'hm show ' + kind;
    },
    damageNumber(x, y, z, amount, crit) {
      if (!G.settings.damageNumbers || amount < 1) return;
      const p = dnPool.find(d => d.t <= 0) || dnPool[0];
      p.t = 0.8; p.x = x + (Math.random() - 0.5) * 0.3; p.y = y; p.z = z + (Math.random() - 0.5) * 0.3; p.vy = 1.6;
      p.el.textContent = Math.round(amount);
      p.el.className = 'dn' + (crit ? ' crit' : '');
      p.el.style.display = 'block';
    },
    damageFrom(pos) {
      const pl = G.player;
      const dx = pos.x - pl.pos.x, dz = pos.z - pl.pos.z;
      const s = Math.sin(pl.yaw), c = Math.cos(pl.yaw);
      // project onto the player's right (cos, -sin) and forward (-sin, -cos) axes
      const rel = Math.atan2(dx * c - dz * s, -dx * s - dz * c);
      const d = dirEls.find(d => d.t <= 0) || dirEls[0];
      d.t = 1; d.a = rel;
      d.e.style.transform = `rotate(${rel}rad)`;
    },
    announce(title, sub = '', kind = '') {
      ann.querySelector('h2').textContent = title;
      ann.querySelector('p').textContent = sub;
      ann.className = 'ann';
      void ann.offsetWidth;
      ann.className = 'ann show ' + kind;
    },
    floorCard(n, def) {
      const sector = def.sector === 3 ? 'ENDLESS' : `SECTOR ${def.sector}`;
      card.querySelector('.k').textContent = `${sector} · FLOOR ${n}`;
      card.querySelector('h1').textContent = def.title;
      card.className = 'card';
      void card.offsetWidth;
      card.className = 'card show';
      waveInfo.innerHTML = `FLOOR <b>${n}</b> · ${def.title}`;
      bossEl.classList.remove('on');
    },
    waveBanner(i, n) {
      const f = G.run.floor;
      waveInfo.innerHTML = `FLOOR <b>${f}</b> · WAVE <b>${i}/${n}</b>`;
      if (i > 1) H.announce(`WAVE ${i}`, i === n ? 'FINAL WAVE' : 'INCOMING', '');
    },
    newHostile(name) {
      newfoe.querySelector('.n').textContent = name;
      newfoe.className = 'newfoe';
      void newfoe.offsetWidth;
      newfoe.className = 'newfoe show';
    },
    subtitle(who, lines, delay = 0) {
      for (const l of lines) subQueue.push({ who, text: l });
      if (!subLine) subDelay = delay;
    },
    tip(key, dur = 6) {
      const t = TIPS[key];
      if (!t) return;
      tipEl.innerHTML = t[G.input.source] || t.kbm;
      tipEl.classList.add('on');
      tipT = dur;
    },
    tipOnce(key, dur) {
      if (tipsShown.has(key)) return;
      tipsShown.add(key);
      H.tip(key, dur);
    },
    resetTips() { tipsShown.clear(); },
    pulse(kind) {
      el.classList.add('pulse-' + kind);
      setTimeout(() => el.classList.remove('pulse-' + kind), 220);
    },
    flashShieldBreak() { shLag.style.transform = 'scaleX(0)'; },
    styleRankUp(rank) {
      styleEl.classList.remove('bump'); void styleEl.offsetWidth; styleEl.classList.add('bump');
      if (rank.l.length >= 1 && RANKS.indexOf(rank) >= 4) G.audio?.play('uiConfirm', { volume: 0.6 });
    },
    styleChanged() {},
    warpTransition() {
      warpEl.className = 'warp'; void warpEl.offsetWidth; warpEl.className = 'warp on';
      setTimeout(() => { warpEl.className = 'warp'; }, 1200);
    },
    bossBar(on, name = '', frac = 1, phases = [], sub = '') {
      if (!on) { bossEl.classList.remove('on'); bossState.on = false; return; }
      if (!bossState.on || bossState.name !== name) {
        bossEl.classList.add('on');
        bossName.textContent = name;
        bossBar.querySelectorAll('.ph').forEach(p => p.remove());
        for (const ph of phases) { const t = document.createElement('span'); t.className = 'ph'; t.style.left = (ph * 100) + '%'; bossBar.appendChild(t); }
        bossState = { on: true, name };
      }
      bossFill.style.transform = `scaleX(${clamp(frac, 0, 1)})`;
      if (bossState.sub !== sub) { bossSub.textContent = sub; bossState.sub = sub; }
    },
    clearTransient() {
      subQueue = []; subLine = ''; subs.classList.remove('on');
      tipEl.classList.remove('on');
      for (const d of dnPool) { d.t = 0; d.el.style.display = 'none'; }
      for (const s of stgPool) s.style.display = 'none';
      for (const o of offEls) o.style.display = 'none';
    },

    update(dt) {
      const pl = G.player, W = G.weapons;
      if (!pl) return;
      el.classList.toggle('touch', touch());
      const Wd = window.innerWidth, Hd = window.innerHeight;
      // crosshair spread (radians → px at screen)
      const fovR = G.camera.fov * Math.PI / 180;
      const px = Math.tan(W.spreadNow) / Math.tan(fovR / 2) * (Hd / 2);
      xh.style.setProperty('--s', `${clamp(px + 4, 4, 70).toFixed(1)}px`);
      xh.classList.toggle('target', !!(pl.assistTarget || W.autoTarget));
      xh.classList.toggle('auto', !!W.autoTarget);
      xh.classList.toggle('hidden', pl.ads > 0.6 && W.current === 'lance' ? false : false);

      // vitals
      const hp = Math.ceil(pl.hp), sh = Math.ceil(pl.shield);
      if (hp !== lastHp) {
        hpEl.textContent = hp;
        const f = clamp(pl.hp / pl.maxHp, 0, 1);
        hpFill.style.transform = `scaleX(${f})`;
        hpLag.style.transform = `scaleX(${f})`;
        hpBar.classList.toggle('low', f < 0.3);
        lastHp = hp;
      }
      if (sh !== lastSh) {
        shEl.textContent = sh;
        const f = clamp(pl.shield / pl.maxShield, 0, 1);
        shFill.style.transform = `scaleX(${f})`;
        shLag.style.transform = `scaleX(${f})`;
        lastSh = sh;
      }
      const pipKey = `${pl.maxDash}/${pl.dashCharges}/${Math.round(pl.dashCool * 10)}`;
      if (pipKey !== lastPips) {
        lastPips = pipKey;
        let h = '<span class="lbl">DASH</span>';
        for (let i = 0; i < pl.maxDash; i++) {
          const on = i < pl.dashCharges;
          const fill = !on && i === pl.dashCharges ? (pl.dashCool / 1.2 * 100).toFixed(0) : 0;
          h += `<i class="${on ? 'on' : ''}"><s style="width:${fill}%"></s></i>`;
        }
        pips.innerHTML = h;
        const tb = G.input?.touch?.buttons;
        if (tb) tb.dash.querySelector('.pips').innerHTML = Array.from({ length: pl.maxDash }, (_, i) => `<b class="${i < pl.dashCharges ? 'on' : ''}"></b>`).join('');
      }
      const od = Math.round(pl.od);
      if (od !== lastOd) {
        lastOd = od;
        odFill.style.transform = `scaleX(${od / 100})`;
        const ready = od >= 100 && pl.odActive <= 0;
        if (ready !== odReady) {
          odReady = ready;
          odm.classList.toggle('ready', ready);
          G.input?.touch?.buttons.overdrive.classList.toggle('ready', ready);
          if (ready) { H.tipOnce('overdrive'); G.story?.say('overdrive', { once: true }); }
        }
        const ring = G.input?.touch?.buttons.overdrive.querySelector('.ring');
        if (ring) ring.style.setProperty('--p', `${od}%`);
      }
      const tbm = G.input?.touch?.buttons;
      if (tbm) {
        tbm.fire.classList.toggle('auto', !!G.settings.autoFire);
        const mc = tbm.melee.querySelector('.cool');
        mc.style.setProperty('--p', `${clamp(W.meleeCool / 0.5, 0, 1) * 100}%`);
      }

      // score & style
      const S = G.style;
      if (S) {
        if (S.score !== lastScore) { scoreEl.textContent = S.score.toLocaleString('en-US'); lastScore = S.score; }
        const r = RANKS[S.rank];
        const active = S.rank > 0 || S.bar > 1;
        styleEl.classList.toggle('empty', !active);
        if (active) {
          if (rankEl.textContent !== r.l) { rankEl.textContent = r.l; rnameEl.textContent = r.name; styleEl.style.color = r.color; }
          sbar.style.transform = `scaleX(${clamp(S.bar / 100, 0, 1)})`;
          const html = S.feed.map(f => `<div class="${f.gold ? 'gold' : ''}" style="opacity:${Math.min(1, f.t)}">${f.label}<em>+${f.pts}</em></div>`).join('');
          if (feedEl._h !== html) { feedEl.innerHTML = html; feedEl._h = html; }
        }
      }

      // damage direction
      for (const d of dirEls) {
        if (d.t > 0) { d.t -= dt * 1.2; d.e.style.opacity = Math.max(0, d.t); }
      }

      // damage numbers
      for (const d of dnPool) {
        if (d.t <= 0) continue;
        d.t -= dt;
        d.y += d.vy * dt; d.vy *= Math.exp(-3 * dt);
        const p = project(d.x, d.y, d.z);
        if (d.t <= 0 || p.behind) { d.el.style.display = 'none'; if (d.t <= 0) continue; }
        else d.el.style.display = 'block';
        const s = d.t > 0.65 ? 1 + (d.t - 0.65) * 3 : 1;
        d.el.style.transform = `translate3d(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px, 0) translate(-50%, -50%) scale(${s.toFixed(2)})`;
        d.el.style.opacity = Math.min(1, d.t * 3);
      }

      // stagger markers + off-screen threats
      let si = 0, oi = 0;
      const enemies = G.enemies?.list || [];
      const cx = Wd / 2, cy = Hd / 2;
      const eye = G.camera.position;
      const threats = [];
      for (const e of enemies) {
        if (!e.alive || e.warp > 0) continue;
        const p = project(e.aimPoint.x, e.aimPoint.y + e.radius + 0.5, e.aimPoint.z);
        const onScreen = !p.behind && p.x > 0 && p.x < Wd && p.y > 0 && p.y < Hd;
        if (e.staggered && onScreen && si < stgPool.length) {
          const s = stgPool[si++];
          const dist = e.pos.distanceTo(eye);
          s.style.display = 'block';
          s.style.transform = `translate3d(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px, 0) translate(-50%, -100%)`;
          s.querySelector('span').style.opacity = dist < 10.5 ? 1 : 0;
        }
        if (!onScreen) threats.push({ e, p, d: e.pos.distanceTo(eye) });
      }
      for (; si < stgPool.length; si++) stgPool[si].style.display = 'none';
      threats.sort((a, b) => (b.e.state === 'aim') - (a.e.state === 'aim') || a.d - b.d);
      for (const t of threats) {
        if (oi >= offEls.length) break;
        // direction in camera space
        v.copy(t.e.aimPoint).applyMatrix4(G.camera.matrixWorldInverse);
        let ang = Math.atan2(v.x, v.y);
        if (v.z > 0 && Math.abs(v.x) < 0.001) ang = Math.PI;
        const rx = Wd * 0.44, ry = Hd * 0.42;
        const x = cx + Math.sin(ang) * rx, y = cy - Math.cos(ang) * ry;
        const o = offEls[oi++];
        o.style.display = 'block';
        o.className = t.e.state === 'aim' ? 'lancer' : '';
        const sc = clamp(1.4 - t.d / 40, 0.6, 1.3);
        o.style.transform = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0) translate(-50%, -50%) rotate(${ang}rad) scale(${sc.toFixed(2)})`;
      }
      for (; oi < offEls.length; oi++) offEls[oi].style.display = 'none';

      // subtitles
      if (subDelay > 0) subDelay -= dt;
      else if (subLine) {
        subT -= dt;
        subChar += dt * 55;
        const shown = subLine.slice(0, Math.floor(subChar));
        if (subTxt._s !== shown) { subTxt.textContent = shown; subTxt._s = shown; }
        if (subT <= 0) { subLine = ''; subs.classList.remove('on'); subDelay = 0.25; }
      } else if (subQueue.length) {
        const s = subQueue.shift();
        subLine = s.text; subChar = 0; subT = Math.max(2.8, s.text.length * 0.06) + 0.6;
        subWho.textContent = s.who;
        subs.classList.add('on');
        G.audio?.play('uiHover', { volume: 0.4 });
      }
      if (tipT > 0) { tipT -= dt; if (tipT <= 0) tipEl.classList.remove('on'); }

      // fps
      if (G.settings.showFps) {
        fpsAcc += dt; fpsN++; fpsT += dt;
        if (fpsT > 0.5) {
          fpsEl.hidden = false;
          const i = G.renderer.gl.info.render;
          fpsEl.textContent = `${(fpsN / fpsAcc).toFixed(0)} FPS · ${Math.round(G.renderer.renderScale * 100)}% · ${G.renderer.quality} · ${i.calls} calls`;
          fpsAcc = 0; fpsN = 0; fpsT = 0;
        }
      } else fpsEl.hidden = true;
    },
  };
  return H;
}
