// Keyboard, touch (drag-to-move + on-screen buttons) and gamepad input.
import { clamp } from './math.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.just = new Set();
    this.touch = { active: false, id: -1, lx: 0, ly: 0, dx: 0, dy: 0 };
    this.touchFocus = false;
    this.touchButtons = { bomb: false, over: false, focus: false, pause: false };
    this.anyTouch = false;
    this.gamepad = null;
    this.padPrev = {};
    this.padJust = new Set();
    this.moveScale = 1; // set by main: canvas px -> playfield units

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = norm(e.code);
      if (!this.down.has(k)) this.just.add(k);
      this.down.add(k);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(norm(e.code)));
    addEventListener('blur', () => { this.down.clear(); });

    // Touch / pointer: primary pointer drags the ship (relative), extra fingers on buttons.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.anyTouch = e.pointerType !== 'mouse' || this.anyTouch;
      if (!this.touch.active) {
        this.touch.active = true; this.touch.id = e.pointerId;
        this.touch.lx = e.clientX; this.touch.ly = e.clientY;
        this.just.add('TouchTap');
        try { canvas.setPointerCapture(e.pointerId); } catch {}
      }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.touch.active && e.pointerId === this.touch.id) {
        this.touch.dx += e.clientX - this.touch.lx;
        this.touch.dy += e.clientY - this.touch.ly;
        this.touch.lx = e.clientX; this.touch.ly = e.clientY;
      }
    });
    const up = (e) => {
      if (this.touch.active && e.pointerId === this.touch.id) { this.touch.active = false; this.touch.id = -1; }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('gamepadconnected', (e) => { this.gamepad = e.gamepad.index; });
  }

  bindTouchButton(el, name) {
    const on = (e) => { e.preventDefault(); this.anyTouch = true; this.touchButtons[name] = true; this.just.add('Btn' + name); };
    const off = (e) => { e.preventDefault(); this.touchButtons[name] = false; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  pollGamepad() {
    this.padJust.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    this.pad = gp;
    if (!gp) return;
    gp.buttons.forEach((b, i) => {
      const was = this.padPrev[i];
      if (b.pressed && !was) this.padJust.add(i);
      this.padPrev[i] = b.pressed;
    });
  }

  // --- queries ---
  axis() {
    let x = 0, y = 0;
    if (this.down.has('ArrowLeft') || this.down.has('KeyA')) x -= 1;
    if (this.down.has('ArrowRight') || this.down.has('KeyD')) x += 1;
    if (this.down.has('ArrowUp') || this.down.has('KeyW')) y -= 1;
    if (this.down.has('ArrowDown') || this.down.has('KeyS')) y += 1;
    if (this.pad) {
      const ax = this.pad.axes[0] || 0, ay = this.pad.axes[1] || 0;
      if (Math.abs(ax) > 0.2) x += ax;
      if (Math.abs(ay) > 0.2) y += ay;
      if (this.pad.buttons[14]?.pressed) x -= 1;
      if (this.pad.buttons[15]?.pressed) x += 1;
      if (this.pad.buttons[12]?.pressed) y -= 1;
      if (this.pad.buttons[13]?.pressed) y += 1;
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  consumeTouch() {
    const d = { dx: this.touch.dx * this.moveScale, dy: this.touch.dy * this.moveScale };
    this.touch.dx = 0; this.touch.dy = 0;
    return d;
  }
  get focus() {
    return this.down.has('ShiftLeft') || this.down.has('ShiftRight') || this.touchButtons.focus || this.touchFocus ||
      !!(this.pad && (this.pad.buttons[7]?.pressed || this.pad.buttons[6]?.pressed || this.pad.buttons[5]?.pressed));
  }
  get shootHeld() {
    return this.down.has('KeyZ') || this.down.has('Space') || this.down.has('KeyJ') || !!(this.pad && this.pad.buttons[0]?.pressed);
  }
  bombPressed() { return this.just.has('KeyX') || this.just.has('KeyK') || this.just.has('Btnbomb') || this.padJust.has(1); }
  overPressed() { return this.just.has('KeyC') || this.just.has('KeyL') || this.just.has('Btnover') || this.padJust.has(2) || this.padJust.has(3); }
  pausePressed() { return this.just.has('Escape') || this.just.has('KeyP') || this.just.has('Btnpause') || this.padJust.has(9); }
  confirmPressed() { return this.just.has('Enter') || this.just.has('KeyZ') || this.just.has('Space') || this.padJust.has(0) || this.padJust.has(9); }
  pressed(code) { return this.just.has(code); }
  held(code) { return this.down.has(code); }
  endFrame() { this.just.clear(); }
}
function norm(code) { return code; }
