// Unified input: keyboard + mouse (pointer lock), touch (floating stick, look pad, buttons), gamepad.
import { G } from '../state.js';
import { clamp } from '../util.js';

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'dash', ShiftRight: 'dash', KeyC: 'dash',
  KeyF: 'melee', KeyV: 'melee', KeyE: 'melee',
  KeyQ: 'overdrive', KeyR: 'reload',
  Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3', Digit4: 'weapon4',
  Escape: 'pause', KeyP: 'pause', Tab: 'swapNext',
  Enter: 'confirm',
};

export const ICONS = {
  fire: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 4v10M24 34v10M4 24h10M34 24h10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  jump: '<svg viewBox="0 0 48 48"><path d="M12 28l12-12 12 12M12 38l12-12 12 12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dash: '<svg viewBox="0 0 48 48"><path d="M8 16h14M4 24h18M8 32h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M26 12l12 12-12 12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  melee: '<svg viewBox="0 0 48 48"><path d="M14 30v-9a3 3 0 016 0v-3a3 3 0 016 0v1a3 3 0 016 0v2a3 3 0 016 0v9c0 7-5 11-12 11h-2c-6 0-10-4-10-11z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M6 10l6 5M10 5l4 7M18 3l1 8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
  reload: '<svg viewBox="0 0 48 48"><path d="M36 18a13 13 0 10 1 11" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M38 8v11H27" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  swap: '<svg viewBox="0 0 48 48"><path d="M10 18h26l-7-7M38 30H12l7 7" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  overdrive: '<svg viewBox="0 0 48 48"><path d="M27 4L12 27h11l-3 17 16-24H25z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 48 48"><rect x="13" y="11" width="7" height="26" rx="1.5" fill="currentColor"/><rect x="28" y="11" width="7" height="26" rx="1.5" fill="currentColor"/></svg>',
};

export function createInput(canvas, touchRoot) {
  const keys = new Set();
  const edges = new Set();
  const held = { fire: false, ads: false, jump: false, dash: false, melee: false, overdrive: false, reload: false };
  const state = {
    move: { x: 0, y: 0 },
    lookX: 0, lookY: 0,
    source: G.isTouch ? 'touch' : 'kbm',
    pointerLocked: false,
    lockFailed: false,
    enabled: false,        // gameplay input active
    held,
    pressed: (a) => edges.has(a),
    isHeld: (a) => !!held[a],
  };

  // ---------------- keyboard ----------------
  const setSource = (s) => {
    if (state.source !== s) {
      state.source = s;
      G.events.emit('inputSource', s);
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) { if (KEYMAP[e.code] && state.enabled) e.preventDefault(); return; }
    const a = KEYMAP[e.code];
    keys.add(e.code);
    setSource('kbm');
    if (a) {
      edges.add(a);
      if (a in held) held[a] = true;
      if (state.enabled && (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow'))) e.preventDefault();
    }
    G.audio?.unlock();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    const a = KEYMAP[e.code];
    if (a && a in held) {
      // only release if no other key maps to it
      let still = false;
      for (const k of keys) if (KEYMAP[k] === a) still = true;
      if (!still) held[a] = false;
    }
  });
  window.addEventListener('blur', () => {
    keys.clear();
    for (const k in held) held[k] = false;
    if (state.enabled) G.events.emit('focusLost');
  });

  // ---------------- mouse ----------------
  let dragLook = false;
  let lastTouch = -1e9;
  canvas.addEventListener('mousedown', (e) => {
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    if (performance.now() - lastTouch < 900) return; // compatibility mouse event from a tap
    setSource('kbm');
    G.audio?.unlock();
    if (!state.enabled) return;
    if (!state.pointerLocked && !state.lockFailed) { requestLock(); }
    if (!state.pointerLocked && state.lockFailed) dragLook = true;
    if (e.button === 0) held.fire = true;
    if (e.button === 2) held.ads = true;
    if (e.button === 1) edges.add('melee');
    if (e.button === 3) edges.add('melee');
    if (e.button === 4) edges.add('dash');
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) held.fire = false;
    if (e.button === 2) held.ads = false;
    dragLook = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    if (!state.enabled) return;
    if (state.pointerLocked || dragLook) {
      const s = (G.settings?.mouseSens ?? 1) * 0.0022;
      // clamp absurd deltas some browsers emit on lock
      const mx = clamp(e.movementX || 0, -300, 300), my = clamp(e.movementY || 0, -300, 300);
      state.lookX -= mx * s;
      state.lookY -= my * s * (G.settings?.invertY ? -1 : 1);
    }
  });
  window.addEventListener('wheel', (e) => {
    if (!state.enabled) return;
    if (e.deltaY > 0) edges.add('swapNext'); else if (e.deltaY < 0) edges.add('swapPrev');
  }, { passive: true });

  // Pointer lock can fail for two reasons: the frame forbids it (fall back to drag-to-look),
  // or the browser's cooldown after Esc (just try again on the next click).
  let everLocked = false, lockFails = 0;
  function lockFailedOnce() {
    lockFails++;
    if (!everLocked && lockFails >= 2) state.lockFailed = true;
  }
  function requestLock() {
    if (!canvas.requestPointerLock) { state.lockFailed = true; return; }
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        // retry without raw input (unsupported on some platforms)
        try {
          const p2 = canvas.requestPointerLock();
          if (p2 && p2.catch) p2.catch(lockFailedOnce);
        } catch { lockFailedOnce(); }
      });
    } catch { lockFailedOnce(); }
  }
  let selfUnlock = false; // unlocks we asked for (menus) must not read as "player pressed Esc"
  document.addEventListener('pointerlockchange', () => {
    const was = state.pointerLocked;
    state.pointerLocked = document.pointerLockElement === canvas;
    if (state.pointerLocked) { everLocked = true; lockFails = 0; state.lockFailed = false; selfUnlock = false; }
    if (was && !state.pointerLocked) {
      if (!selfUnlock && state.enabled) G.events.emit('pointerUnlocked');
      selfUnlock = false;
    }
  });
  document.addEventListener('pointerlockerror', lockFailedOnce);
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { lastTouch = performance.now(); setSource('touch'); } }, { capture: true });

  // ---------------- touch ----------------
  const touch = buildTouchUI(touchRoot);
  const pointers = new Map(); // id -> { kind, ... }
  let stick = null;           // { id, ox, oy, x, y }
  const lookPointers = new Set();

  function minDim() { return Math.min(window.innerWidth, window.innerHeight); }

  touchRoot.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    setSource('touch');
    G.audio?.unlock();
    if (!state.enabled) return;
    const btn = e.target.closest ? e.target.closest('[data-btn]') : null;
    touchRoot.setPointerCapture?.(e.pointerId);
    const W = window.innerWidth;
    const left = G.settings?.leftHanded ? e.clientX > W * 0.58 : e.clientX < W * 0.42;
    if (btn) {
      const name = btn.dataset.btn;
      pointers.set(e.pointerId, { kind: 'btn', name, el: btn, lx: e.clientX, ly: e.clientY, t: e.timeStamp });
      btn.classList.add('down');
      pressTouch(name, true);
      if (name === 'fire') lookPointers.add(e.pointerId);
    } else if (left && !stick) {
      stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, { kind: 'stick' });
      touch.showStick(stick.ox, stick.oy);
    } else {
      pointers.set(e.pointerId, { kind: 'look', lx: e.clientX, ly: e.clientY, t: e.timeStamp });
      lookPointers.add(e.pointerId);
      touch.lookUsed();
    }
  }, { passive: false });

  touchRoot.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return;
    const p = pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick' && stick) {
      stick.x = e.clientX; stick.y = e.clientY;
      const R = Math.max(46, minDim() * 0.11);
      let dx = stick.x - stick.ox, dy = stick.y - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R * 1.25) { // drag the base along
        const k = (d - R * 1.25) / d;
        stick.ox += dx * k; stick.oy += dy * k;
        dx = stick.x - stick.ox; dy = stick.y - stick.oy;
      }
      touch.moveStick(stick.ox, stick.oy, stick.x, stick.y, R);
    } else if (lookPointers.has(e.pointerId)) {
      const dx = e.clientX - p.lx, dy = e.clientY - p.ly;
      const dtm = Math.max(1, e.timeStamp - p.t);
      p.lx = e.clientX; p.ly = e.clientY; p.t = e.timeStamp;
      const speed = Math.hypot(dx, dy) / dtm; // px per ms
      const accel = 1 + 0.55 * clamp((speed - 0.4) / 1.6, 0, 1);
      const s = (G.settings?.touchSens ?? 1) * 2.6 / minDim() * accel;
      state.lookX -= dx * s;
      state.lookY -= dy * s * (G.settings?.invertY ? -1 : 1) * 0.85;
    }
  }, { passive: false });

  const endPointer = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    lookPointers.delete(e.pointerId);
    if (p.kind === 'stick') { stick = null; touch.hideStick(); }
    if (p.kind === 'btn') { p.el.classList.remove('down'); pressTouch(p.name, false); }
  };
  touchRoot.addEventListener('pointerup', endPointer);
  touchRoot.addEventListener('pointercancel', endPointer);
  touchRoot.addEventListener('lostpointercapture', endPointer);

  function pressTouch(name, down) {
    const map = { fire: 'fire', jump: 'jump', dash: 'dash', melee: 'melee', reload: 'reload', overdrive: 'overdrive' };
    if (map[name]) {
      held[map[name]] = down;
      if (down) edges.add(map[name]);
    }
    if (name === 'swap' && down) edges.add('swapNext');
    if (name === 'pause' && down) edges.add('pause');
    if (down) vibrate(8);
  }

  function releaseAllTouch() {
    for (const [, p] of pointers) if (p.kind === 'btn') { p.el.classList.remove('down'); pressTouch(p.name, false); }
    pointers.clear(); lookPointers.clear(); stick = null; touch.hideStick();
  }

  // ---------------- gamepad ----------------
  let prevButtons = [];
  const PAD = { 0: 'jump', 1: 'dash', 2: 'reload', 3: 'swapNext', 4: 'overdrive', 5: 'melee', 9: 'pause', 10: 'dash', 11: 'melee', 12: 'weapon1', 15: 'weapon2', 13: 'weapon3', 14: 'weapon4' };
  let padMove = { x: 0, y: 0 };
  function pollGamepad(dt) {
    padMove.x = padMove.y = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { gp = p; break; }
    if (!gp) return;
    const dz = (x, y, d = 0.16) => {
      const m = Math.hypot(x, y);
      if (m < d) return [0, 0];
      const k = (Math.min(1, (m - d) / (1 - d))) / m;
      return [x * k, y * k];
    };
    const [lx, ly] = dz(gp.axes[0] || 0, gp.axes[1] || 0);
    const [rx, ry] = dz(gp.axes[2] || 0, gp.axes[3] || 0, 0.13);
    const any = lx || ly || rx || ry || gp.buttons.some(b => b.pressed);
    if (any) setSource('pad');
    if (state.source !== 'pad') { prevButtons = gp.buttons.map(b => b.pressed); return; }
    padMove.x = lx; padMove.y = -ly;
    const mag = Math.hypot(rx, ry);
    const curve = mag > 0 ? Math.pow(mag, 1.8) / mag : 0;
    const s = (G.settings?.padSens ?? 1) * 3.4 * dt;
    state.lookX -= rx * curve * s * (mag > 0.95 ? 1.35 : 1);
    state.lookY -= ry * curve * s * 0.8 * (G.settings?.invertY ? -1 : 1);
    held.fire = gp.buttons[7]?.value > 0.35;
    held.ads = gp.buttons[6]?.value > 0.35;
    gp.buttons.forEach((b, i) => {
      const a = PAD[i];
      if (!a) return;
      if (b.pressed && !prevButtons[i]) { edges.add(a); if (a === 'jump') held.jump = true; }
      if (!b.pressed && prevButtons[i] && a === 'jump') held.jump = false;
      if (a === 'melee') held.melee = b.pressed;
      if (a === 'dash' && i === 1) held.dash = b.pressed;
    });
    prevButtons = gp.buttons.map(b => b.pressed);
  }

  function vibrate(ms) {
    if (!G.settings?.haptics) return;
    try {
      if (state.source === 'touch') navigator.vibrate && navigator.vibrate(ms);
      else if (state.source === 'pad') {
        const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(p => p && p.connected);
        const k = Math.min(1, ms / 40);
        gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms * 2, strongMagnitude: k * 0.8, weakMagnitude: 0.3 + k * 0.5 })?.catch?.(() => {});
      }
    } catch { /* ignore */ }
  }

  // ---------------- per-frame ----------------
  function update(dt) {
    pollGamepad(dt);
    let x = 0, y = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (x || y) { const m = Math.hypot(x, y); x /= m; y /= m; }
    if (stick) {
      const R = Math.max(46, minDim() * 0.11);
      let sx = (stick.x - stick.ox) / R, sy = -(stick.y - stick.oy) / R;
      const m = Math.hypot(sx, sy);
      if (m < 0.12) { sx = sy = 0; }
      else {
        const k = Math.min(1, (m - 0.12) / 0.78) / m;
        sx *= k; sy *= k;
      }
      x += sx; y += sy;
    }
    x += padMove.x; y += padMove.y;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    state.move.x = x; state.move.y = y;
  }

  function endFrame() {
    edges.clear();
    state.lookX = 0; state.lookY = 0;
  }

  function setEnabled(on) {
    state.enabled = on;
    if (!on) {
      for (const k in held) held[k] = false;
      releaseAllTouch();
      dragLook = false;
    }
    touch.setActive(on && state.source === 'touch');
  }

  G.events.on('inputSource', (s) => touch.setActive(state.enabled && s === 'touch'));

  Object.assign(state, {
    update, endFrame, setEnabled, requestLock, vibrate, touch,
    exitLock() { if (document.pointerLockElement) { selfUnlock = true; document.exitPointerLock?.(); } },
  });
  return state;
}

function buildTouchUI(root) {
  root.innerHTML = '';
  const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };
  const stickBase = el('stick-base');
  const stickKnob = el('stick-knob');
  stickBase.appendChild(stickKnob);
  const stickHint = el('stick-hint', '<span>MOVE</span>');
  const lookHint = el('look-hint', '<span>DRAG TO AIM</span>');
  root.append(stickHint, lookHint, stickBase);
  const buttons = {};
  const defs = [
    ['fire', 'btn-fire'], ['jump', 'btn-jump'], ['dash', 'btn-dash'], ['melee', 'btn-melee'],
    ['reload', 'btn-reload'], ['swap', 'btn-swap'], ['overdrive', 'btn-overdrive'], ['pause', 'btn-pause'],
  ];
  for (const [name, cls] of defs) {
    const b = el('tbtn ' + cls, `<i>${ICONS[name]}</i>`);
    b.dataset.btn = name;
    if (name === 'dash') b.appendChild(el('pips'));
    if (name === 'swap') b.appendChild(el('ammo'));
    if (name === 'overdrive') b.appendChild(el('ring'));
    if (name === 'melee') b.appendChild(el('cool'));
    root.appendChild(b);
    buttons[name] = b;
  }
  return {
    buttons,
    showStick(x, y) { stickBase.style.display = 'block'; stickBase.style.transform = `translate(${x}px, ${y}px)`; stickKnob.style.transform = 'translate(-50%, -50%)'; stickHint.classList.add('gone'); },
    moveStick(ox, oy, x, y, R) {
      stickBase.style.transform = `translate(${ox}px, ${oy}px)`;
      let dx = x - ox, dy = y - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    },
    hideStick() { stickBase.style.display = 'none'; },
    setActive(on) { root.classList.toggle('active', !!on); },
    hideHints() { stickHint.classList.add('gone'); lookHint.classList.add('gone'); },
    lookUsed() { lookHint.classList.add('gone'); },
    showHints() { stickHint.classList.remove('gone'); lookHint.classList.remove('gone'); },
  };
}
