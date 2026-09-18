// ============================================================================
// RANGE — touch.js
// Phone / tablet controls. Left half of the screen: floating movement stick
// (push past 85 % to sprint). Right half: drag to look. Buttons: fire (hold for
// auto), aim toggle, breath hold, reload, charge / cycle, mode, swap weapon,
// crouch, inspect, plus a top bar for menu, slow motion, ballistic computer,
// rangefinder and traces. A scope panel (magnification, turrets) appears when
// the precision rifle is shouldered.
// ============================================================================

export function isTouchDevice() {
  return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function createTouchControls({ canvas, player, vm, hud, settings, actions }) {
  const layer = document.createElement('div'); layer.id = 'touch'; document.body.appendChild(layer);
  layer.innerHTML = `
<div class="tstick" id="tstick"><div class="tknob"></div></div>
<div class="tbar">
  <button data-act="menu">☰</button><button data-act="slowmo">SLOW</button><button data-act="calc">CALC</button><button data-act="lrf">LRF</button><button data-act="traces">TRACE</button><button data-act="help">?</button>
</div>
<div class="tleft">
  <button data-act="swap">SWAP</button><button data-act="mode">MODE</button><button data-act="crouch" class="hold">CROUCH</button><button data-act="inspect">INSPECT</button>
</div>
<div class="tright">
  <div class="trow"><button data-act="charge">CHARGE</button><button data-act="reload">RELOAD</button></div>
  <div class="trow"><button data-act="breath" class="hold">BREATH</button><button data-act="aim" class="toggle">AIM</button></div>
  <button data-act="fire" class="fire hold">FIRE</button>
</div>
<div class="tscope hidden" id="tscope">
  <div class="trow"><button data-act="mag-">MAG −</button><button data-act="mag+">MAG +</button></div>
  <div class="trow"><button data-act="elev-">E −</button><button data-act="elev+">E +</button></div>
  <div class="trow"><button data-act="wind-">W −</button><button data-act="wind+">W +</button></div>
</div>`;
  const stick = layer.querySelector('#tstick'), knob = stick.querySelector('.tknob'), scopePanel = layer.querySelector('#tscope');
  const state = { look: null, move: null, joy: { x: 0, y: 0 }, sprint: false, crouch: false, breath: false };
  const R = 52; // stick radius in px

  // ---- buttons: hold-type buttons fire down/up, toggles flip, taps act on start
  for (const b of layer.querySelectorAll('button')) {
    const act = b.dataset.act;
    const down = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); press(act, true, b); };
    const up = (e) => { e.preventDefault(); e.stopPropagation(); if (!b.classList.contains('toggle')) b.classList.remove('on'); press(act, false, b); };
    b.addEventListener('touchstart', down, { passive: false }); b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
    b.addEventListener('mousedown', down); b.addEventListener('mouseup', up);
  }
  function press(act, down, btn) {
    switch (act) {
      case 'fire': if (down) vm.fireDown(); else vm.fireUp(); break;
      case 'aim': if (down) { player.adsToggle = !player.adsToggle; btn.classList.toggle('on', player.adsToggle); } break;
      case 'breath': state.breath = down; break;
      case 'crouch': state.crouch = down; break;
      case 'reload': if (down) vm.reload(); break;
      case 'charge': if (down) vm.chargeAction(); break;
      case 'mode': if (down) actions.mode(); break;
      case 'swap': if (down) actions.swap(); break;
      case 'inspect': if (down) vm.inspect(); break;
      case 'menu': if (down) actions.menu(); break;
      case 'slowmo': if (down) actions.slowmo(); break;
      case 'calc': if (down) hud.toggleCalc(); break;
      case 'lrf': if (down) hud.setLRF(!hud.state.lrf, null); break;
      case 'traces': if (down) actions.traces(); break;
      case 'help': if (down) hud.toggleHelp(); break;
      case 'mag-': if (down) actions.mag(-1); break;
      case 'mag+': if (down) actions.mag(1); break;
      case 'elev-': if (down) vm.clickTurret('elev', -1); break;
      case 'elev+': if (down) vm.clickTurret('elev', 1); break;
      case 'wind-': if (down) vm.clickTurret('wind', -1); break;
      case 'wind+': if (down) vm.clickTurret('wind', 1); break;
    }
  }

  // ---- canvas touches: stick on the left, look on the right
  const start = (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && !state.move) {
        state.move = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        stick.style.display = 'block'; stick.style.left = (t.clientX - R) + 'px'; stick.style.top = (t.clientY - R) + 'px'; knob.style.transform = 'translate(0px,0px)';
      } else if (!state.look) state.look = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
    e.preventDefault();
  };
  const move = (e) => {
    for (const t of e.changedTouches) {
      if (state.move && t.identifier === state.move.id) {
        let dx = t.clientX - state.move.x0, dy = t.clientY - state.move.y0; const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        state.joy.x = dx / R; state.joy.y = dy / R; state.sprint = d / R > 0.85;
      } else if (state.look && t.identifier === state.look.id) {
        player.mouse.dx += (t.clientX - state.look.x) * 1.35; player.mouse.dy += (t.clientY - state.look.y) * 1.35;
        state.look.x = t.clientX; state.look.y = t.clientY;
      }
    }
    e.preventDefault();
  };
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (state.move && t.identifier === state.move.id) { state.move = null; state.joy.x = state.joy.y = 0; state.sprint = false; stick.style.display = 'none'; }
      else if (state.look && t.identifier === state.look.id) state.look = null;
    }
    e.preventDefault();
  };
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end, { passive: false });
  canvas.addEventListener('touchcancel', end, { passive: false });

  player.touch = state; // player.update reads joy / sprint / crouch / breath from here
  settings.crosshair = true;

  return {
    state, layer,
    show(v) { layer.classList.toggle('hidden', !v); },
    update() { scopePanel.classList.toggle('hidden', !(vm.weapon && vm.weapon.spec.scope)); },
  };
}
