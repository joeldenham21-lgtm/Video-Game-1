// HOLLOW CHOIR — boot, game loop, state machine, collisions, stage flow.
import { TAU, PI, clamp, lerp, dist2, RNG, rgba, fmtNum } from './math.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { FX } from './fx.js';
import { BulletPool } from './bullets.js';
import { Items } from './items.js';
import { Player, SHIPS, RELICS } from './player.js';
import { Enemy } from './enemies.js';
import { LEVELS } from './levels.js';
import { BOSS_FACTORIES } from './bosses.js';
import { makeBackground } from './backgrounds.js';
import { drawHUD } from './hud.js';
import { UI, DIFFS } from './ui.js';
import * as Save from './save.js';

const STEP = 1 / 60;
const EXTENDS = [200000, 600000, 1200000, 2000000, 3500000, 6000000];

class Game {
  constructor() {
    this.W = 540; this.H = 900;
    this.canvas = document.getElementById('game'); this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.input = new Input(this.canvas); this.audio = new AudioEngine(); this.fx = new FX();
    this.save = Save.load(); this.options = this.save.options;
    this.params = new URLSearchParams(location.search); this.debug = this.params.has('debug');
    this.state = 'title'; this.time = 0; this.rng = new RNG(1234);
    this.bullets = new BulletPool(true); this.pbullets = new BulletPool(false); this.items = new Items();
    this.enemies = []; this.lasers = []; this.boss = null; this.banners = []; this.dialogue = [];
    this.bulletTime = 1; this.bombTimer = 0; this.echoSlow = 0; this.sunder = null;
    this.score = 0; this.dispScore = 0; this.mult = 1; this.maxMult = 8; this.hiScore = 0;
    this.levelDef = LEVELS[0]; this.pal = LEVELS[0].pal; this.level = null; this.bg = makeBackground('ember', this);
    this.stageIdx = 0; this.diff = DIFFS[1]; this.diffName = 'Normal'; this.practice = false; this.tipT = 0;
    this.ui = new UI(this, document.getElementById('ui'));
    this.touchEl = document.getElementById('touch');
    for (const k of ['bomb', 'over', 'pause']) this.input.bindTouchButton(document.getElementById('tb-' + k), k);
    const tf = document.getElementById('tb-focus');
    tf.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.touchFocus = !this.input.touchFocus; tf.classList.toggle('on', this.input.touchFocus); });
    addEventListener('resize', () => this.resize()); this.resize();
    addEventListener('pointerdown', () => this.audio.init(), { once: false });
    addEventListener('keydown', () => this.audio.init(), { once: true });
    addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    this.applyOptions();
    this.player = new Player(this, 'vesper');
    this.ui.show('title');
    this.last = performance.now(); this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
    if (this.debug) window.g = this;
  }
  resize() {
    const dpr = Math.min(innerWidth < 700 ? 1.5 : 2, devicePixelRatio || 1);
    const s = Math.min(innerWidth / this.W, innerHeight / this.H);
    this.scale = s;
    this.canvas.width = Math.round(this.W * s * dpr); this.canvas.height = Math.round(this.H * s * dpr);
    this.canvas.style.width = Math.round(this.W * s) + 'px'; this.canvas.style.height = Math.round(this.H * s) + 'px';
    this.ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
    this.input.moveScale = 1.35 / s;
  }
  applyOptions() {
    const o = this.options;
    this.audio.setVolumes(o.music, o.sfx); this.fx.enabled = o.fx; this.fx.shakeScale = o.shake ? 1 : 0;
    Save.save(this.save);
  }
  saveData() { Save.save(this.save); }
  eraseSave() { Save.reset(); this.save = Save.load(); this.options = this.save.options; this.applyOptions(); }

  // ------------------------------------------------------------ run flow
  startRun({ diff, ship, stage, practice }) {
    this.diff = DIFFS.find((d) => d.id === diff) || DIFFS[1]; this.diffName = this.diff.name; this.practice = practice;
    this.player = new Player(this, ship); this.player.lives = this.diff.lives; this.player.bombs = this.diff.bombs; this.player.maxBombs = this.diff.bombs;
    this.score = 0; this.dispScore = 0; this.mult = 1; this.continues = 0; this.runTime = 0; this.extendIdx = 0;
    this.hiScore = (this.save.hiscores[this.diff.id] || [])[0]?.score || 0;
    this.save.stats.runs++; this.saveData();
    this.audio.init();
    this.startStage(stage);
  }
  startStage(idx) {
    this.stageIdx = idx; this.levelDef = LEVELS[idx]; this.pal = this.levelDef.pal;
    document.documentElement.style.setProperty('--acc', this.pal.accent);
    this.clearWorld();
    this.level = this.levelDef.mechanic(); if (this.level.init) this.level.init(this);
    this.bg = makeBackground(this.levelDef.id, this);
    this.rng = new RNG(1000 + idx * 77);
    this.events = this.levelDef.script(this).sort((a, b) => a.t - b.t); this.evi = 0; this.t = 0;
    this.bossState = 'none'; this.bossT = 0; this.boss = null; this.bossDying = false;
    this.stageStats = { t0: 0, kills: this.player.stats.kills, graze: this.player.stats.graze, deaths: this.player.stats.deaths, bombs: this.player.stats.bombs };
    this.player.reset(true); this.player.phoenixUsed = false;
    this.tipT = 6; this.time = 0;
    this.banner(`STAGE ${idx + 1}`, this.levelDef.name + ' — ' + this.levelDef.sub, 4, false);
    for (const [s, l] of this.levelDef.intro) this.say(s, l);
    this.audio.playSong(this.levelDef.music);
    this.ui.hide(); this.state = 'playing';
    this.touchEl.classList.toggle('on', this.input.anyTouch || (navigator.maxTouchPoints > 0 && innerWidth < 1100));
  }
  clearWorld() {
    this.bullets.clear(this, false); this.pbullets.clear(this, false); this.items.clear(); this.enemies.length = 0; this.lasers.length = 0;
    this.fx.clear(); this.banners.length = 0; this.dialogue.length = 0; this.bulletTime = 1; this.bombTimer = 0; this.echoSlow = 0; this.sunder = null; this.onBounce = null;
    this.audio.setBoss(false);
  }
  restartStage() { this.player.lives = this.diff.lives; this.player.bombs = this.diff.bombs; this.player.power = Math.max(1, this.player.power); this.mult = 1; if (this.practice) this.score = 0; this.startStage(this.stageIdx); }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.audio.muted = true; this.ui.show('pause'); }
  resume() { this.ui.hide(); this.state = 'playing'; this.audio.muted = false; this.input.just.clear(); }
  quitToTitle() { this.state = 'title'; this.audio.muted = false; this.audio.stopSong(); this.clearWorld(); this.boss = null; this.touchEl.classList.remove('on'); this.ui.show('title'); document.documentElement.style.setProperty('--acc', '#ff8c42'); }
  gameOver() {
    this.state = 'gameover'; this.audio.setBoss(false);
    const rank = this.practice ? -1 : this.postScore(false);
    this.saveData(); this.ui.show('gameover', { rank });
  }
  continueRun() { this.continues++; this.score = 0; this.dispScore = 0; this.mult = 1; this.player.lives = this.diff.lives; this.player.bombs = this.diff.bombs; this.player.respawn(); this.player.invuln = 4; this.ui.hide(); this.state = 'playing'; this.fx.text(this.W / 2, this.H / 2, 'CONTINUE', '#fff', { size: 30, life: 1.5 }); }
  postScore(cleared) {
    const d = this.save; d.stats.kills += this.player.stats.kills; d.stats.deaths += this.player.stats.deaths; d.stats.graze += this.player.stats.graze; d.stats.playtime += this.runTime;
    if (this.continues > 0 && !cleared) return -1;
    return Save.addScore(d, this.diff.id, { score: Math.floor(this.score), stage: this.stageIdx + 1, ship: this.player.ship.name, cleared, date: new Date().toISOString().slice(0, 10) });
  }
  onBossDefeated(boss) {
    this.save.stats.bosses++; this.audio.setBoss(false);
    this.bossState = 'done'; this.bossT = 0; this.bossDying = false;
    if (!this.practice) { this.save.unlocked = Math.max(this.save.unlocked, Math.min(7, this.stageIdx + 2)); this.saveData(); }
    else { this.save.unlocked = Math.max(this.save.unlocked, Math.min(7, this.stageIdx + 2)); this.saveData(); }
  }
  finishStage() {
    const p = this.player, s = this.stageStats;
    const time = this.t, deaths = p.stats.deaths - s.deaths, bombs = p.stats.bombs - s.bombs;
    const bonus = 20000 * (this.stageIdx + 1) + Math.max(0, 200 - time) * 100;
    const noMiss = deaths === 0, noBomb = bombs === 0, noMissBonus = 50000 * (this.stageIdx + 1), noBombBonus = 30000 * (this.stageIdx + 1);
    this.addScore(bonus + (noMiss ? noMissBonus : 0) + (noBomb ? noBombBonus : 0), false);
    this.state = 'results'; this.audio.setBoss(false);
    this.ui.show('results', { num: this.stageIdx + 1, name: this.levelDef.name, time, kills: p.stats.kills - s.kills, graze: p.stats.graze - s.graze, deaths, bombs, bonus, noMiss, noBomb, noMissBonus, noBombBonus, score: Math.floor(this.score), practice: this.practice, last: this.stageIdx === LEVELS.length - 1 });
  }
  afterResults() {
    if (this.practice) { this.quitToTitle(); return; }
    if (this.stageIdx === LEVELS.length - 1) { this.victory(); return; }
    const pool = RELICS.filter((r) => !this.player.relics.has(r.id));
    const choices = []; const rng = new RNG(Date.now() & 0xffff);
    while (choices.length < 3 && pool.length) choices.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
    this.ui.show('relic', { choices });
  }
  pickRelic(id) { this.player.applyRelic(id); this.audio.sfx('relic'); this.startStage(this.stageIdx + 1); }
  victory() {
    this.state = 'victory'; this.audio.stopSong();
    if (this.diff.id === 'lunatic') this.addScore(1000000, false);
    this.save.clears[this.diff.id]++; const rank = this.postScore(true); this.saveData();
    this.ui.show('victory', { rank });
  }

  // ------------------------------------------------------------ helpers used by entities
  spawnEnemy(type, x, y, o) { const e = new Enemy(this, type, x, y, o); this.enemies.push(e); return e; }
  nearestEnemy(x, y) {
    let best = null, bd = 1e12;
    for (const e of this.enemies) { if (e.y < -20) continue; const d = dist2(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
    if (this.boss && !this.boss.entering && this.boss.dying <= 0) { const d = dist2(x, y, this.boss.x, this.boss.y); if (d < bd) best = this.boss; }
    return best;
  }
  addScore(v, useMult) { const s = v * (useMult ? this.mult : 1); this.score += s; if (this.extendIdx < EXTENDS.length && this.score >= EXTENDS[this.extendIdx] && !this.practice) { this.extendIdx++; this.player.lives++; this.audio.sfx('extend'); this.fx.text(this.W / 2, this.H * 0.5, 'EXTEND', '#ff7ad9', { size: 32, life: 2 }); } }
  onBulletCancel(b) { this.addScore(6, true); if (this.fx.parts.length < 900) this.fx.parts.push({ x: b.x, y: b.y, vx: 0, vy: -40, life: 0.4, t: 0, color: '#ffffff', size: 3, drag: 0, grav: 0, shape: 'dot' }); }
  collectItem(it) {
    const p = this.player;
    if (it.type === 'score') { const h = 1 + (1 - it.y / this.H) * 0.8; this.addScore(100 * h * (p.relics.has('greed') ? 1.4 : 1), true); this.mult = Math.min(this.maxMult, this.mult + 0.003); this.audio.sfx('pickup'); }
    else if (it.type === 'big') { this.addScore(2000 * (p.relics.has('greed') ? 1.4 : 1), true); this.fx.text(it.x, it.y, '+' + fmtNum(2000 * this.mult), '#ffd84f', { size: 12 }); this.audio.sfx('pickup'); }
    else if (it.type === 'power') { if (p.power < 4) { p.power++; this.fx.text(p.x, p.y - 30, 'POWER ' + p.power, '#ff5a5a', { size: 14 }); if (p.power === 4) this.fx.text(p.x, p.y - 48, 'MAX', '#fff', { size: 16 }); } else this.addScore(1000, true); this.audio.sfx('power'); }
    else if (it.type === 'bomb') { if (p.bombs < p.maxBombs) { p.bombs++; this.fx.text(p.x, p.y - 30, 'BOMB +1', '#7dff8a', { size: 14 }); } else this.addScore(3000, true); this.audio.sfx('power'); }
    else if (it.type === 'life') { p.lives++; this.fx.text(p.x, p.y - 30, 'EXTEND', '#ff7ad9', { size: 18 }); this.audio.sfx('extend'); }
  }
  damageEnemy(e, dmg, x, y) { e.damage(dmg, x, y); }
  damageBoss(b, dmg) { b.damage(dmg); }
  onPlayerDeath() { if (this.boss) this.boss.hitsThisPhase++; }
  banner(text, sub, dur, small) { this.banners.push({ text, sub, dur, t: 0, small }); }
  say(speaker, text) { this.dialogue.push({ speaker, text, t: 0, dur: 1.2 + text.length * 0.045 }); }

  // ------------------------------------------------------------ loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.last) / 1000; this.last = now; if (dt > 0.1) dt = 0.1;
    this.acc += dt;
    const speed = this.debug && this.input.held('KeyF') ? 4 : 1;
    let n = 0;
    while (this.acc >= STEP && n < 4 * speed) { this.tick(STEP); this.acc -= STEP; n++; }
    this.render();
  }
  tick(dt) {
    const inp = this.input; inp.pollGamepad();
    if (this.state === 'playing') {
      if (inp.pausePressed()) { this.pause(); inp.endFrame(); return; }
      this.runTime += dt;
      if (this.debug) this.debugKeys();
      this.update(dt);
    } else if (this.state === 'paused') {
      if (inp.pausePressed()) this.resume();
    } else if (this.state === 'title') {
      this.time += dt; this.bg.update(dt); this.fx.update(dt);
      if (inp.pressed('TouchTap') && this.ui.screen === 'title') { /* first tap just inits audio */ }
    } else { this.time += dt; this.fx.update(dt); this.bg.update(dt); }
    inp.endFrame();
  }
  debugKeys() {
    const inp = this.input;
    if (inp.pressed('F1')) { this.player.invulnDebug = !this.player.invulnDebug; this.fx.text(this.W / 2, 400, 'INVULN ' + (this.player.invulnDebug ? 'ON' : 'OFF'), '#fff'); }
    if (inp.pressed('F2')) { this.t = Math.max(this.t, this.levelDef.bossAt); this.evi = this.events.length; }
    if (inp.pressed('F3') && this.boss) this.boss.hp = 0;
    if (inp.pressed('F4')) { this.bossState = 'done'; this.bossT = 3; this.boss = null; }
    if (inp.pressed('F6')) this.player.power = 4;
    if (this.player.invulnDebug) this.player.invuln = Math.max(this.player.invuln, 0.5);
  }
  update(dt) {
    const p = this.player;
    this.time += dt;
    if (this.fx.hitstop > 0) { this.fx.update(dt); return; }
    this.t += dt; if (this.tipT > 0) this.tipT -= dt;
    // scripted events
    while (this.evi < this.events.length && this.events[this.evi].t <= this.t) this.events[this.evi++].fn(this);
    // boss flow
    this.updateBossFlow(dt);
    // slow effects
    if (this.echoSlow > 0) { this.echoSlow -= dt; this.bulletTime = Math.min(this.bulletTime, 0.5); if (this.echoSlow <= 0 && p.overActive <= 0) this.bulletTime = 1; }
    if (this.bombTimer > 0) this.bombTimer -= dt;
    // entities
    this.bg.update(dt); if (this.level.update) this.level.update(this, dt);
    const spdMul = this.level.playerSpeedMul ? this.level.playerSpeedMul(p) : 1;
    const ss = p.ship.speed, fs = p.ship.focusSpeed; p.ship.speed = ss * spdMul; p.ship.focusSpeed = fs * spdMul; p.update(dt); p.ship.speed = ss; p.ship.focusSpeed = fs;
    for (let i = this.enemies.length - 1; i >= 0; i--) { const e = this.enemies[i]; e.update(dt); if (e.dead) this.enemies.splice(i, 1); }
    if (this.boss) { this.boss.update(dt); if (this.boss.dead) this.boss = null; }
    this.bullets.update(this, dt); this.pbullets.update(this, dt); this.items.update(this, dt);
    for (let i = this.lasers.length - 1; i >= 0; i--) { const L = this.lasers[i]; L.update(this, dt); if (L.dead) this.lasers.splice(i, 1); }
    this.collide(dt);
    p.resolveHit();
    this.fx.update(dt);
    // chain decay
    this.chainT = (this.chainT || 0) + dt;
    if (this.mult > 1 && this.chainT > 2.5) this.mult = Math.max(1, this.mult - 0.05 * dt);
    this.dispScore = this.dispScore + (this.score - this.dispScore) * Math.min(1, dt * 8); if (this.score - this.dispScore < 1) this.dispScore = this.score;
    for (let i = this.banners.length - 1; i >= 0; i--) { const b = this.banners[i]; b.t += dt; if (b.t >= b.dur) this.banners.splice(i, 1); }
    if (this.dialogue.length) { const d = this.dialogue[0]; d.t += dt; if (d.t < 0.05) this.audio.sfx('talk'); if (d.t >= d.dur) this.dialogue.shift(); }
  }
  updateBossFlow(dt) {
    const L = this.levelDef;
    if (this.bossState === 'none' && this.t >= L.bossAt && this.evi >= this.events.length) {
      this.bossState = 'intro'; this.bossT = 0;
      for (const [s, l] of L.bossIntro) this.say(s, l);
      this.audio.sfx('warn');
      this.banner('WARNING', 'something is singing', 2.5, false);
    } else if (this.bossState === 'intro') {
      this.bossT += dt;
      if (this.bossT > 2.8) {
        this.bossState = 'fight'; this.boss = BOSS_FACTORIES[L.boss](this); this.audio.setBoss(true);
        this.banner(this.boss.name, this.boss.title, 3.5, false);
      }
    } else if (this.bossState === 'done') {
      this.bossT += dt;
      if (this.bossT === dt) this.banner('SILENCED', L.name + ' is quiet', 3, false);
      if (this.bossT > 3.6) { this.bossState = 'finished'; this.finishStage(); }
    }
  }
  collide(dt) {
    const p = this.player, W = this.W, H = this.H;
    // player bullets vs enemies / boss
    const PL = this.pbullets.list;
    for (let i = PL.length - 1; i >= 0; i--) {
      const b = PL[i]; let hit = false;
      for (const e of this.enemies) {
        if (e.t < 0.05 || e.noHit || e === b.lastHit) continue;
        const rr = e.r + b.r; if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
          this.fx.spark(b.x, b.y, b.ang + PI, 1, '#fff', { spd: 80, life: 0.15 }); this.audio.sfx('hit');
          if (e.damage(b.dmg, b.x, b.y) === false) { hit = true; break; }
          b.lastHit = e; if (b.pierce > 0) { b.pierce--; } else { hit = true; } break;
        }
      }
      const B = this.boss;
      if (!hit && B && !B.entering && B.dying <= 0 && b.lastHit !== B) {
        const boxes = B.hitboxes || [{ x: B.x, y: B.y, r: B.r }];
        for (const hb of boxes) { const rr = hb.r + b.r; if (dist2(b.x, b.y, hb.x, hb.y) < rr * rr) { B.damage(b.dmg); this.fx.spark(b.x, b.y, b.ang + PI, 1, '#fff', { spd: 80, life: 0.15 }); this.audio.sfx('bosshit'); b.lastHit = B; if (b.pierce > 0) b.pierce--; else hit = true; break; } }
      }
      if (hit) { this.pbullets.free.push(b); PL[i] = PL[PL.length - 1]; PL.pop(); }
    }
    if (p.dead) return;
    // enemy bullets vs player (hit + graze)
    const L = this.bullets.list, gr = p.grazeRadius, hr = p.r;
    for (let i = 0; i < L.length; i++) {
      const b = L[i]; if (b.delay > 0) continue;
      const d2 = dist2(b.x, b.y, p.x, p.y);
      let rr = hr + b.r * (b.kind === 'needle' || b.kind === 'knife' ? 0.7 : 0.85);
      if (d2 < rr * rr) { p.hit(b); continue; }
      if (!b.grazed && d2 < (gr + b.r) * (gr + b.r)) { b.grazed = true; p.addGraze(b); }
    }
    // lasers
    for (const Lz of this.lasers) if (Lz.hitsPoint(p.x, p.y, hr)) { p.hit(Lz); break; }
    // bodies
    for (const e of this.enemies) { const rr = e.r * 0.75 + hr; if (e.type !== 'echo' && dist2(e.x, e.y, p.x, p.y) < rr * rr) { p.hit(e); break; } }
    const B = this.boss;
    if (B && !B.entering && B.dying <= 0) { const boxes = B.hitboxes || [{ x: B.x, y: B.y, r: B.r }]; for (const hb of boxes) { const rr = hb.r * 0.7 + hr; if (dist2(hb.x, hb.y, p.x, p.y) < rr * rr) { p.hit(B); break; } } }
  }

  // ------------------------------------------------------------ render
  render() {
    const ctx = this.ctx, W = this.W, H = this.H, fx = this.fx;
    ctx.save();
    ctx.translate(fx.shakeX, fx.shakeY);
    this.bg.draw(ctx);
    if (this.state === 'title' || this.state === 'victory') {
      // ambient title particles
      fx.draw(ctx);
      if (this.state === 'title' && Math.random() < 0.15) fx.parts.push({ x: Math.random() * W, y: H + 10, vx: (Math.random() - 0.5) * 30, vy: -60 - Math.random() * 80, life: 4, t: 0, color: this.pal.accent, size: 2.5, drag: 0, grav: 0, shape: 'dot' });
      ctx.restore(); return;
    }
    if (this.level.drawBack) this.level.drawBack(ctx, this);
    this.items.draw(ctx, this);
    for (const e of this.enemies) e.draw(ctx);
    if (this.boss) this.boss.draw(ctx);
    if (this.sunder) { const s = this.sunder; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rgba(this.player.ship.color, 0.35); ctx.fillRect(s.x - s.w / 2, 0, s.w, s.y); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(s.x - s.w / 5, 0, s.w / 2.5, s.y); ctx.globalCompositeOperation = 'source-over'; }
    ctx.globalCompositeOperation = 'lighter'; this.pbullets.draw(ctx, this); ctx.globalCompositeOperation = 'source-over';
    this.player.draw(ctx);
    for (const Lz of this.lasers) Lz.draw(ctx);
    this.bullets.draw(ctx, this);
    if (this.level.drawFront) this.level.drawFront(ctx, this);
    fx.draw(ctx);
    if (fx.flash > 0) { ctx.globalAlpha = fx.flash * 0.6; ctx.fillStyle = fx.flashColor; ctx.fillRect(-20, -20, W + 40, H + 40); ctx.globalAlpha = 1; }
    ctx.restore();
    drawHUD(ctx, this);
    if (this.debug) { ctx.fillStyle = '#0f0'; ctx.font = '11px monospace'; ctx.textAlign = 'left'; ctx.fillText(`t=${this.t.toFixed(1)} b=${this.bullets.length} e=${this.enemies.length} p=${fx.parts.length} ${this.bossState} F1 invuln F2 boss F3 phase F4 skip F hold=fast`, 12, H - 32); }
  }
}

new Game();
