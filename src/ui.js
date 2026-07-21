// ============================================================================
// ELDERFALL — ui.js
// ALL DOM / CSS / input. Floating touch joystick + drag-look, action buttons,
// full desktop bindings, weapon wheel, compass, bars, banners, toasts,
// dialogue, journal, pause menu, death screen.
// createUI(g) → { update(dt), input, openDialogue(npc, tree), closeDialogue(),
//                 showBanner(title, sub) }
// Only imports: './core.js' (no three.js needed here — all math is 2D).
// ============================================================================
import {
  POIS, clamp, lerp, smoothstep, hash2, makeRng,
  terrainHeight, biomeAt, BIOME, WATER_LEVEL,
} from './core.js';

export function createUI(g) {
  // ==========================================================================
  // Settings (persisted)
  // ==========================================================================
  let userSens = parseFloat(localStorage.getItem('elderfall_sens') || '1') || 1;
  let invertY = localStorage.getItem('elderfall_invy') === '1';
  const TOUCH_SENS = 0.0035;   // rad per px (touch drag)
  const MOUSE_SENS = 0.0022;   // rad per px (pointer lock)
  const IS_COARSE = matchMedia('(pointer: coarse)').matches;

  const hud = document.getElementById('hud');
  const canvas = g.canvas;

  // ==========================================================================
  // Small helpers
  // ==========================================================================
  const wrap360 = (a) => ((a % 360) + 360) % 360;
  const angDiff = (a, b) => ((a - b + 540) % 360) - 180; // shortest signed diff
  const sfx = (name) => { if (g.audio && g.audio.play) g.audio.play(name); };
  const click = () => sfx('uiClick');

  // ==========================================================================
  // CSS — one style tag, everything scoped under #hud
  // ==========================================================================
  const style = document.createElement('style');
  style.textContent = `
#hud{--gold:#d9b46a;--gold2:#a3813f;--goldhi:#ffd873;--parch:#e8dcc0;--ink:#332614;
  font-family:Georgia,'Times New Roman',serif;color:var(--parch);
  -webkit-text-size-adjust:none;}
#hud,#hud *{box-sizing:border-box;-webkit-user-select:none;user-select:none;
  -webkit-tap-highlight-color:transparent;}
#hud .ef-rule{height:1px;margin:10px auto;width:82%;
  background:linear-gradient(90deg,transparent,var(--gold2) 28%,var(--gold) 50%,var(--gold2) 72%,transparent);}

/* ---------- vignettes / flashes ---------- */
#ef-vig{position:absolute;inset:0;pointer-events:none;
  box-shadow:inset 0 0 110px 24px rgba(0,0,0,.4);}
#ef-lowhp{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:radial-gradient(ellipse at center,transparent 38%,rgba(150,8,8,.55) 100%);}
#ef-lowhp.on{animation:ef-pulse 1.5s ease-in-out infinite;}
@keyframes ef-pulse{0%,100%{opacity:.28}50%{opacity:.62}}
#ef-dmg{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:radial-gradient(ellipse at center,transparent 40%,rgba(165,12,12,.6) 100%);}
#ef-flash{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1.1s ease;
  background:radial-gradient(circle at 50% 45%,rgba(255,224,140,.55),rgba(255,200,80,.14) 55%,transparent 78%);}
#ef-pdodge{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:radial-gradient(ellipse at center,transparent 42%,rgba(255,205,90,.4) 80%,rgba(255,185,60,.62) 100%);}

/* ---------- counter-window cue (⚔ above crosshair) ---------- */
#ef-counter{position:absolute;left:50%;top:calc(50% - 52px);opacity:0;pointer-events:none;
  font-size:26px;color:var(--goldhi);will-change:transform,opacity;
  transform:translateX(-50%) scale(.6);transition:opacity .12s ease,transform .12s ease;
  text-shadow:0 0 14px rgba(255,216,115,.95),0 1px 3px #000;}
#ef-counter.on{opacity:1;animation:ef-cpulse .42s ease-in-out infinite alternate;}
@keyframes ef-cpulse{from{transform:translateX(-50%) scale(1)}to{transform:translateX(-50%) scale(1.25)}}

/* ---------- compass ---------- */
#ef-compass{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));left:50%;
  transform:translateX(-50%);width:min(62vw,440px);height:30px;overflow:hidden;pointer-events:none;
  background:linear-gradient(180deg,rgba(12,9,6,.5),rgba(12,9,6,.24));
  border-top:1px solid rgba(217,180,106,.4);border-bottom:1px solid rgba(217,180,106,.4);
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);
  mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);}
#ef-ticks{position:absolute;inset:0;opacity:.5;
  background-image:linear-gradient(90deg,rgba(232,220,192,.55) 0,rgba(232,220,192,.55) 1px,transparent 1px);
  background-repeat:repeat-x;}
.ef-c{position:absolute;top:0;left:50%;height:100%;display:flex;flex-direction:column;
  align-items:center;justify-content:center;pointer-events:none;will-change:transform;
  text-shadow:0 1px 3px rgba(0,0,0,.9);white-space:nowrap;}
.ef-c.maj{font-size:16px;color:var(--gold);letter-spacing:.05em;}
.ef-c.min{font-size:10px;color:rgba(232,220,192,.75);}
.ef-c.poi{font-size:11px;color:#cfa85e;}
.ef-c.mark{font-size:13px;color:var(--goldhi);text-shadow:0 0 7px rgba(255,210,90,.9),0 1px 3px #000;}
.ef-c.mark .d{font-size:8px;color:rgba(255,216,115,.85);letter-spacing:.04em;margin-top:-2px;}
.ef-c.ef-clamped .d{display:none;}

/* ---------- boss bar ---------- */
#ef-boss{position:absolute;top:calc(50px + env(safe-area-inset-top,0px));left:50%;
  transform:translateX(-50%);width:min(72vw,520px);text-align:center;opacity:0;
  transition:opacity .5s ease;pointer-events:none;}
#ef-boss.on{opacity:1;}
#ef-boss .n{font-size:15px;letter-spacing:.28em;color:#f2e6c6;text-transform:uppercase;
  text-shadow:0 1px 4px #000,0 0 14px rgba(180,40,20,.5);margin-bottom:4px;}
#ef-boss .b{height:9px;background:linear-gradient(180deg,rgba(8,5,4,.8),rgba(24,12,8,.8));
  border:1px solid rgba(217,180,106,.55);border-radius:3px;overflow:hidden;
  box-shadow:0 2px 8px rgba(0,0,0,.6),inset 0 1px 2px rgba(0,0,0,.7);}
#ef-bossf{height:100%;transform-origin:0 50%;transition:transform .25s ease-out;
  background:linear-gradient(180deg,#c14434,#711b10);}

/* ---------- crosshair / hitmarkers ---------- */
#ef-cross{position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;
  border-radius:50%;background:rgba(242,232,208,.92);box-shadow:0 0 3px rgba(0,0,0,.9);
  transition:transform .18s ease,background .18s ease,box-shadow .18s ease;pointer-events:none;}
#ef-cross.on{transform:scale(2);background:var(--goldhi);box-shadow:0 0 9px rgba(255,216,115,.95);}
.ef-hit{position:absolute;left:50%;top:50%;width:24px;height:24px;margin:-12px 0 0 -12px;
  pointer-events:none;opacity:0;--hs:1;}
.ef-hit i{position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;
  background:#f5ecd2;box-shadow:0 0 3px rgba(0,0,0,.8);}
.ef-hit i:first-child{transform:rotate(45deg);}
.ef-hit i:last-child{transform:rotate(-45deg);}
.ef-hit.kill{--hs:1.55;}
.ef-hit.kill i{background:#ffb26a;box-shadow:0 0 6px rgba(255,120,40,.8);}
.ef-hit.go{animation:ef-hitm .32s ease-out forwards;}
@keyframes ef-hitm{0%{opacity:.95;transform:scale(var(--hs))}100%{opacity:0;transform:scale(calc(var(--hs)*.5))}}

/* ---------- stats (bottom-left) ---------- */
#ef-stats{position:absolute;left:calc(16px + env(safe-area-inset-left,0px));
  bottom:calc(16px + env(safe-area-inset-bottom,0px));width:min(230px,36vw);pointer-events:none;}
#ef-statrow{display:flex;align-items:center;gap:10px;margin-bottom:3px;
  font-size:13px;text-shadow:0 1px 2px #000;}
#ef-lvl{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 35% 30%,rgba(70,52,28,.95),rgba(26,18,10,.95));
  border:1px solid var(--gold2);color:var(--gold);font-size:13px;
  box-shadow:0 2px 5px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,230,170,.25);}
.ef-cnt{display:flex;align-items:center;gap:4px;color:var(--parch);}
.ef-cnt svg{filter:drop-shadow(0 1px 1px rgba(0,0,0,.7));}
.ef-bar{position:relative;height:9px;margin-top:6px;border-radius:3px;overflow:hidden;
  background:linear-gradient(180deg,rgba(8,6,4,.78),rgba(22,15,9,.78));
  border:1px solid rgba(217,180,106,.42);
  box-shadow:0 1px 4px rgba(0,0,0,.55),inset 0 1px 2px rgba(0,0,0,.65);
  transition:opacity .8s ease,transform .8s ease;}
.ef-bar.hp{height:12px;}
.ef-bar.hide{opacity:0;transform:translateX(-12px);}
.ef-fill{position:absolute;inset:0;transform-origin:0 50%;transition:transform .22s ease-out;}
.ef-bar.hp .ef-fill{background:linear-gradient(180deg,#a23b45,#8e2f38 42%,#6c2129);}
.ef-bar.st .ef-fill{background:linear-gradient(180deg,#6f8c49,#5f7a3d 42%,#485e2d);}
.ef-bar.mn .ef-fill{background:linear-gradient(180deg,#48688c,#3d5a7a 42%,#2e4560);}
#ef-xp{height:3px;margin-top:7px;border-radius:2px;overflow:hidden;background:rgba(10,7,4,.65);
  border:1px solid rgba(217,180,106,.25);}
#ef-xpf{height:100%;transform-origin:0 50%;transition:transform .3s ease;
  background:linear-gradient(90deg,var(--gold2),var(--goldhi));}

/* ---------- interact pill ---------- */
#ef-pill{position:absolute;left:50%;bottom:calc(148px + env(safe-area-inset-bottom,0px));
  transform:translateX(-50%) translateY(10px);padding:9px 20px;border-radius:22px;
  background:linear-gradient(180deg,rgba(46,34,20,.93),rgba(26,18,11,.93));
  border:1px solid var(--gold2);font-size:15px;letter-spacing:.06em;white-space:nowrap;
  box-shadow:0 3px 12px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,230,170,.18);
  opacity:0;transition:opacity .22s ease,transform .22s ease;pointer-events:none;}
#ef-pill.on{opacity:1;transform:translateX(-50%);pointer-events:auto;cursor:pointer;}
#ef-pill .key{display:inline-block;border:1px solid var(--gold2);border-radius:4px;
  padding:0 6px;margin-right:9px;font-size:12px;color:var(--gold);}
#hud.ef-touchmode #ef-pill .key{display:none;}

/* ---------- touch controls ---------- */
#ef-touch{position:absolute;inset:0;pointer-events:none;display:none;}
#ef-touch.on{display:block;}
.ef-tbtn{position:absolute;pointer-events:auto;display:flex;flex-direction:column;gap:1px;
  align-items:center;justify-content:center;border-radius:50%;touch-action:none;cursor:pointer;
  background:radial-gradient(circle at 35% 28%,rgba(66,50,30,.82),rgba(24,17,10,.86));
  border:1px solid rgba(217,180,106,.55);color:var(--parch);
  font-size:9px;letter-spacing:.16em;text-shadow:0 1px 2px #000;
  box-shadow:0 3px 10px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,230,170,.2);
  transition:transform .08s ease,box-shadow .15s ease,border-color .15s ease;}
.ef-tbtn svg{width:26px;height:26px;}
.ef-tbtn.down{transform:scale(.9);
  background:radial-gradient(circle at 35% 28%,rgba(122,92,46,.9),rgba(42,30,15,.9));}
.ef-tbtn.lit{border-color:var(--goldhi);color:var(--goldhi);
  box-shadow:0 0 14px rgba(255,216,115,.4),0 3px 10px rgba(0,0,0,.45);}
#ef-b-att{width:78px;height:78px;right:calc(20px + env(safe-area-inset-right,0px));
  bottom:calc(58px + env(safe-area-inset-bottom,0px));}
#ef-b-att svg{width:34px;height:34px;}
#ef-b-blk{width:58px;height:58px;right:calc(108px + env(safe-area-inset-right,0px));
  bottom:calc(30px + env(safe-area-inset-bottom,0px));}
#ef-b-jmp{width:58px;height:58px;right:calc(30px + env(safe-area-inset-right,0px));
  bottom:calc(152px + env(safe-area-inset-bottom,0px));}
#ef-b-dgd{width:54px;height:54px;right:calc(118px + env(safe-area-inset-right,0px));
  bottom:calc(106px + env(safe-area-inset-bottom,0px));}
#ef-b-whl{width:52px;height:52px;right:calc(96px + env(safe-area-inset-right,0px));
  bottom:calc(184px + env(safe-area-inset-bottom,0px));}
.ef-tbtn.dim{opacity:.45;}
.ef-qbtn{width:40px;height:40px;font-size:7px;letter-spacing:.1em;}
.ef-qbtn svg{width:18px;height:18px;}
#ef-b-tch{right:calc(152px + env(safe-area-inset-right,0px));
  bottom:calc(170px + env(safe-area-inset-bottom,0px));}
#ef-b-pot{right:calc(152px + env(safe-area-inset-right,0px));
  bottom:calc(218px + env(safe-area-inset-bottom,0px));}
.ef-qbadge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;
  border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:10px;
  color:var(--parch);background:linear-gradient(180deg,#7a2a1e,#4a140c);
  border:1px solid var(--gold2);box-shadow:0 1px 3px rgba(0,0,0,.6);pointer-events:none;}
#ef-b-spr{width:52px;height:52px;left:calc(26px + env(safe-area-inset-left,0px));
  bottom:calc(170px + env(safe-area-inset-bottom,0px));}
.ef-corner{position:absolute;pointer-events:auto;width:40px;height:40px;border-radius:9px;
  display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:none;
  top:calc(12px + env(safe-area-inset-top,0px));color:var(--gold);
  background:linear-gradient(180deg,rgba(40,30,18,.85),rgba(22,16,10,.85));
  border:1px solid rgba(217,180,106,.5);box-shadow:0 2px 8px rgba(0,0,0,.5);
  transition:transform .08s ease;}
.ef-corner.down{transform:scale(.9);}
.ef-corner svg{width:22px;height:22px;}
#ef-b-jrn{right:calc(64px + env(safe-area-inset-right,0px));}
#ef-b-pse{right:calc(14px + env(safe-area-inset-right,0px));}

/* ---------- joystick ---------- */
#ef-joy{position:absolute;left:0;top:0;width:132px;height:132px;margin:-66px 0 0 -66px;
  border-radius:50%;border:1.5px solid rgba(217,180,106,.5);pointer-events:none;opacity:0;
  background:radial-gradient(circle,rgba(20,14,8,.2) 30%,rgba(20,14,8,.5));
  transition:opacity .15s ease;will-change:transform;}
#ef-joy.on{opacity:1;}
#ef-joy-nub{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;
  border-radius:50%;border:1px solid var(--gold2);will-change:transform;
  background:radial-gradient(circle at 35% 28%,rgba(96,72,40,.95),rgba(36,26,14,.95));
  box-shadow:0 2px 8px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,230,170,.25);}

/* ---------- weapon wheel ---------- */
#ef-wheel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity .16s ease;
  background:radial-gradient(circle at 50% 50%,rgba(8,6,4,.2) 25%,rgba(8,6,4,.72));}
#ef-wheel.on{opacity:1;}
#ef-wheel.sticky{pointer-events:auto;}
#ef-wheel svg{width:min(80vmin,380px);height:min(80vmin,380px);
  filter:drop-shadow(0 5px 18px rgba(0,0,0,.65));}
.ef-seg{fill:rgba(30,22,13,.85);stroke:rgba(217,180,106,.45);stroke-width:1.5;
  transition:fill .1s ease;pointer-events:none;}
#ef-wheel.on .ef-seg{pointer-events:auto;}
.ef-seg.on{fill:rgba(102,76,37,.94);stroke:var(--goldhi);}
.ef-wicon{stroke:#e8d9a8;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}
.ef-wgrp{pointer-events:none;transition:opacity .12s;}
.ef-wgrp.sel .ef-wicon{stroke:#fff0c8;}
.ef-wgrp.dim{opacity:.38;}
.ef-wcnt{fill:#cbb98f;font-size:11px;text-anchor:middle;font-family:Georgia,serif;}
#ef-whub{fill:rgba(18,13,8,.92);stroke:rgba(217,180,106,.55);stroke-width:1.5;}
#ef-wname{fill:var(--gold);font-size:15px;letter-spacing:2px;text-anchor:middle;
  font-family:Georgia,serif;text-transform:uppercase;}

/* ---------- banner ---------- */
#ef-banner{position:absolute;top:20%;left:0;right:0;text-align:center;pointer-events:none;opacity:0;}
#ef-banner.on{animation:ef-ban 3.2s ease forwards;}
@keyframes ef-ban{0%{opacity:0;transform:translateY(8px) scale(.985)}12%{opacity:1;transform:none}
  78%{opacity:1}100%{opacity:0}}
#ef-banner .t{font-size:clamp(24px,4.6vw,40px);letter-spacing:.24em;color:#f2e6c6;font-weight:400;
  text-shadow:0 2px 14px rgba(0,0,0,.9),0 0 26px rgba(217,180,106,.35);}
#ef-banner .s{margin-top:4px;font-style:italic;letter-spacing:.2em;color:var(--gold);
  font-size:clamp(12px,2.4vw,15px);text-shadow:0 1px 4px #000;}

/* ---------- toasts ---------- */
#ef-toasts{position:absolute;right:calc(14px + env(safe-area-inset-right,0px));
  top:calc(64px + env(safe-area-inset-top,0px));width:min(64vw,300px);pointer-events:none;
  display:flex;flex-direction:column;gap:8px;align-items:flex-end;}
.ef-toast{max-width:100%;padding:8px 12px;border-radius:4px;font-size:13px;
  background:linear-gradient(180deg,rgba(40,30,18,.94),rgba(24,17,10,.94));
  border:1px solid rgba(217,180,106,.5);border-left:3px solid var(--gold);
  box-shadow:0 3px 10px rgba(0,0,0,.5);opacity:0;transform:translateX(16px);
  transition:opacity .3s ease,transform .3s ease;}
.ef-toast.on{opacity:1;transform:none;}
.ef-toast .t{color:var(--gold);letter-spacing:.08em;font-size:11px;text-transform:uppercase;}
.ef-toast .s{color:var(--parch);margin-top:2px;line-height:1.35;}

/* ---------- dialogue ---------- */
#ef-dlg{position:absolute;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));
  transform:translateX(-50%) translateY(14px);width:min(94vw,640px);padding:14px 18px 16px;
  border-radius:8px;border:1px solid var(--gold2);opacity:0;pointer-events:none;
  background:linear-gradient(180deg,rgba(35,26,16,.96),rgba(20,14,9,.97));
  box-shadow:0 8px 30px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,230,170,.15);
  transition:opacity .25s ease,transform .25s ease;}
#ef-dlg.on{opacity:1;transform:translateX(-50%);pointer-events:auto;}
#ef-dlg-name{color:var(--gold);letter-spacing:.16em;font-size:13px;text-transform:uppercase;
  margin-bottom:6px;}
#ef-dlg-text{font-size:16px;line-height:1.5;color:var(--parch);min-height:3em;}
#ef-dlg-ch{margin-top:10px;display:flex;flex-direction:column;gap:6px;opacity:0;
  pointer-events:none;transition:opacity .2s ease;}
#ef-dlg-ch.on{opacity:1;pointer-events:auto;}
.ef-choice{text-align:left;font-family:inherit;font-size:15px;color:#e6d5ac;cursor:pointer;
  background:rgba(217,180,106,.07);border:1px solid rgba(217,180,106,.3);border-radius:4px;
  padding:9px 12px;transition:background .12s ease,border-color .12s ease;}
.ef-choice:hover,.ef-choice:active{background:rgba(217,180,106,.2);border-color:var(--gold);}

/* ---------- center panels ---------- */
.ef-cpanel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.97);
  width:min(92vw,470px);max-height:min(84dvh,580px);overflow-y:auto;touch-action:pan-y;
  padding:20px 24px 24px;border-radius:10px;border:1px solid var(--gold2);
  background:linear-gradient(160deg,#251b10,#160f08);opacity:0;pointer-events:none;
  box-shadow:0 12px 44px rgba(0,0,0,.7),inset 0 0 60px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,230,170,.14);
  transition:opacity .22s ease,transform .22s ease;}
.ef-cpanel.on{opacity:1;transform:translate(-50%,-50%) scale(1);pointer-events:auto;}
.ef-cpanel h2{font-weight:400;letter-spacing:.26em;text-align:center;color:#f2e6c6;
  font-size:21px;margin:2px 0 4px;}
.ef-x{position:absolute;top:10px;right:12px;width:30px;height:30px;display:flex;cursor:pointer;
  align-items:center;justify-content:center;color:var(--gold2);font-size:18px;border-radius:6px;
  border:1px solid transparent;transition:color .15s,border-color .15s;}
.ef-x:hover{color:var(--goldhi);border-color:var(--gold2);}
.ef-mbtn{display:block;width:100%;font-family:inherit;font-size:15px;letter-spacing:.16em;
  color:#f0e4c4;text-transform:uppercase;cursor:pointer;margin:8px 0;padding:11px 0;
  background:linear-gradient(180deg,rgba(90,66,38,.9),rgba(52,38,22,.9));
  border:1px solid var(--gold2);border-radius:5px;
  box-shadow:inset 0 1px 0 rgba(255,230,170,.22);
  transition:transform .1s ease,box-shadow .15s ease;}
.ef-mbtn:hover{box-shadow:0 0 14px rgba(217,180,106,.25),inset 0 1px 0 rgba(255,230,170,.22);}
.ef-mbtn:active{transform:scale(.97);}
.ef-mbtn.warn{color:#ffb0a0;border-color:#a05038;}
.ef-mbtn[disabled]{opacity:.4;pointer-events:none;}
.ef-mrow{display:flex;align-items:center;justify-content:space-between;margin:13px 2px;
  font-size:14px;letter-spacing:.06em;color:#cbb98f;}
.ef-sbtn{font-family:inherit;font-size:13px;letter-spacing:.12em;color:var(--gold);cursor:pointer;
  background:rgba(217,180,106,.08);border:1px solid var(--gold2);border-radius:4px;padding:5px 16px;
  transition:background .12s ease;}
.ef-sbtn:active,.ef-sbtn:hover{background:rgba(217,180,106,.2);}
#ef-pause input[type=range]{width:52%;accent-color:var(--gold);pointer-events:auto;touch-action:none;}
#ef-p-note{text-align:center;font-size:12px;font-style:italic;color:#9a8a68;margin-top:8px;min-height:15px;}

/* ---------- journal (parchment) ---------- */
#ef-journal{background:linear-gradient(165deg,#e9dcbd,#d6c294);color:var(--ink);border-color:#8a6f3c;
  box-shadow:0 12px 44px rgba(0,0,0,.7),inset 0 0 70px rgba(120,90,40,.25);}
#ef-journal h2{color:#4a3517;}
#ef-journal .ef-x{color:#7a5f30;}
#ef-journal h3{font-size:13px;letter-spacing:.22em;color:#6b4f22;text-transform:uppercase;
  margin:16px 0 6px;border-bottom:1px solid rgba(107,79,34,.35);padding-bottom:3px;font-weight:400;}
#ef-journal .q{margin:7px 0;}
#ef-journal .q .n{font-size:16px;color:#3a2a12;}
#ef-journal .q .o{font-size:13.5px;font-style:italic;color:#5c4520;margin-top:1px;}
#ef-journal .done{color:#6d5c3a;text-decoration:line-through;font-size:14px;margin:4px 0;}
#ef-journal .loc{display:inline-block;font-size:13px;color:#4a3517;margin:3px 10px 3px 0;}
#ef-journal .none{font-style:italic;color:#84714a;font-size:13.5px;}
#ef-journal .tabs{display:flex;gap:8px;justify-content:center;margin:6px 0 2px;}
#ef-journal .tab{font-family:inherit;font-size:12px;letter-spacing:.18em;text-transform:uppercase;
  color:#6b4f22;background:rgba(107,79,34,.08);border:1px solid rgba(107,79,34,.4);
  border-radius:4px;padding:5px 14px;cursor:pointer;transition:background .12s ease;}
#ef-journal .tab.on{background:rgba(107,79,34,.22);color:#3a2a12;border-color:#6b4f22;}
#ef-journal .be{margin:9px 0;}
#ef-journal .be .n{font-size:15px;color:#3a2a12;}
#ef-journal .be .n .k{font-size:12px;color:#6b4f22;margin-left:8px;font-style:italic;}
#ef-journal .be .f{font-size:13px;font-style:italic;color:#5c4520;margin-top:1px;line-height:1.35;}
#ef-journal .be.unk .n{color:#84714a;font-style:italic;}
#ef-journal .tally{text-align:center;font-size:12px;font-style:italic;color:#6d5c3a;margin-top:10px;}

/* ---------- world map tab (MAP addition) ---------- */
#ef-journal .mapblock{margin:10px 0 2px;filter:drop-shadow(0 3px 9px rgba(40,26,10,.4));}
#ef-journal .mapfr{padding:9px;background:linear-gradient(150deg,#cdb488,#b89c6d);
  clip-path:polygon(0.8% 2.2%,5% 0.6%,11% 1.8%,17% 0.4%,24% 2%,31% 0.9%,38% 2.3%,45% 0.5%,
  52% 1.9%,59% 0.6%,66% 2.2%,73% 0.8%,80% 2.4%,87% 0.6%,94% 1.9%,99.2% 3%,98% 9%,99.5% 16%,
  98.2% 23%,99.6% 30%,98.3% 37%,99.7% 44%,98.4% 51%,99.5% 58%,98.2% 65%,99.6% 72%,98.3% 79%,
  99.5% 86%,98.1% 93%,99% 98%,93% 99.4%,86% 98.1%,79% 99.5%,72% 98.3%,65% 99.6%,58% 98.2%,
  51% 99.5%,44% 98.4%,37% 99.7%,30% 98.3%,23% 99.6%,16% 98.2%,9% 99.4%,3% 98.6%,0.5% 94%,
  1.8% 87%,0.4% 80%,1.9% 73%,0.6% 66%,2.1% 59%,0.5% 52%,1.8% 45%,0.4% 38%,2% 31%,0.7% 24%,
  2.2% 17%,0.5% 10%,1.6% 5%);}
#ef-journal .mapfr canvas{display:block;width:100%;height:auto;
  box-shadow:inset 0 0 0 1px rgba(90,64,26,.4);}
#ef-journal .mapcap{text-align:center;font-style:italic;font-size:13px;letter-spacing:.1em;
  color:#5c4520;margin-top:7px;}

/* ---------- death ---------- */
#ef-death{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;opacity:0;pointer-events:none;transition:opacity 1.5s ease;
  background:radial-gradient(circle at 50% 62%,rgba(46,0,0,.6),rgba(0,0,0,.95));}
#ef-death.on{opacity:1;pointer-events:auto;}
#ef-death .t{font-size:clamp(30px,7vw,54px);letter-spacing:.3em;color:#b8352a;font-weight:400;
  text-shadow:0 0 34px rgba(130,0,0,.9),0 2px 8px #000;}
#ef-death .s{margin:10px 0 30px;font-style:italic;letter-spacing:.14em;color:#8a7c62;font-size:14px;}
#ef-death button{font-family:inherit;font-size:17px;letter-spacing:.2em;color:#f0e4c4;cursor:pointer;
  background:linear-gradient(180deg,rgba(90,66,38,.9),rgba(52,38,22,.9));
  border:1px solid var(--gold2);border-radius:5px;padding:13px 46px;
  box-shadow:0 0 18px rgba(200,150,60,.2),inset 0 1px 0 rgba(255,230,170,.25);
  transition:transform .12s ease;}
#ef-death button:active{transform:scale(.95);}

/* ---------- hint ---------- */
#ef-hint{position:absolute;bottom:calc(6px + env(safe-area-inset-bottom,0px));left:50%;
  transform:translateX(-50%);font-size:12px;letter-spacing:.08em;color:rgba(203,185,143,.85);
  text-shadow:0 1px 3px #000;pointer-events:none;white-space:nowrap;opacity:1;
  transition:opacity 1.2s ease;max-width:96vw;overflow:hidden;text-overflow:ellipsis;}
#ef-hint.off{opacity:0;}

/* ---------- modal state: hide gameplay chrome ---------- */
#hud.ef-modal-open #ef-touch,#hud.ef-modal-open #ef-pill,#hud.ef-modal-open #ef-cross,
#hud.ef-modal-open #ef-joy,#hud.ef-modal-open #ef-hint,#hud.ef-modal-open #ef-counter{
  opacity:0!important;pointer-events:none!important;}
#hud.ef-modal-open #ef-touch *{pointer-events:none!important;}
/* while the weapon wheel is open, clear the center of competing chrome */
#hud.ef-wheel-open #ef-pill,#hud.ef-wheel-open #ef-cross,#hud.ef-wheel-open #ef-counter,
#hud.ef-wheel-open #ef-hint{opacity:0!important;pointer-events:none!important;}

/* ---------- photo mode (EXPLORE) — explore.js stamps 'ef-photo' on <body>
   while the free camera is up; the ENTIRE hud vanishes for clean captures */
body.ef-photo #hud{display:none!important;}
`;
  document.head.appendChild(style);

  // ==========================================================================
  // Weapon wheel geometry / icons (SVG built as a string once)
  // ==========================================================================
  const WHEEL_IDS = ['sword', 'axe', 'greatsword', 'bow', 'fire', 'frost', 'lightning', 'heal'];
  const WHEEL_LABELS = {
    sword: 'Sword', axe: 'War Axe', greatsword: 'Greatsword', bow: 'Bow',
    fire: 'Fireball', frost: 'Frost', lightning: 'Lightning', heal: 'Heal',
  };
  const MANA_COST = { fire: 14, frost: 18, lightning: 22, heal: 20 };
  const SEG_N = WHEEL_IDS.length, SEG_STEP = 360 / SEG_N;
  // Stroke-style icon paths, centered on (0,0), roughly 28u tall.
  const WICONS = {
    sword: 'M0 -14 L2.8 -10 V4 L0 8 L-2.8 4 V-10 Z M-7 8.5 H7 M0 8.5 V14.5',
    axe: 'M0 -14 V14 M0 -12 C6 -13 9.5 -8.5 9 -2 C5.5 -5 2.5 -5.5 0 -5 M0 -12 C-6 -13 -9.5 -8.5 -9 -2 C-5.5 -5 -2.5 -5.5 0 -5',
    greatsword: 'M0 -15 L3.4 -10 V4 L0 8 L-3.4 4 V-10 Z M0 -10.5 V3 M-8.5 8.5 H8.5 M0 8.5 V14 M-2.8 14.2 H2.8',
    bow: 'M-5 -13 C7 -8 7 8 -5 13 M-5 -13 L-5 13 M-5 0 H11 M11 0 L6.5 -3 M11 0 L6.5 3',
    fire: 'M0 -13 C5 -7 8 -2.5 8 2.5 A8 8.6 0 1 1 -8 2.5 C-8 -1.5 -5.5 -4.5 -3.2 -8.5 C-2 -5.5 0.5 -4.5 1.2 -6.8 Z',
    frost: 'M0 -13 V13 M-11.3 -6.5 L11.3 6.5 M-11.3 6.5 L11.3 -6.5 M-3.2 -9.5 L0 -6.3 L3.2 -9.5 M-3.2 9.5 L0 6.3 L3.2 9.5',
    lightning: 'M3.5 -14 L-5.5 1.5 H-0.5 L-3.5 14 L6.5 -1.5 H1 Z',
    heal: 'M0 -12 L2.5 -2.5 L12 0 L2.5 2.5 L0 12 L-2.5 2.5 L-12 0 L-2.5 -2.5 Z',
    torch: 'M-1.8 2.5 L-1.1 14 H1.1 L1.8 2.5 M-4.5 2.5 H4.5 M0 -11 C3.2 -8 4.2 -4.8 3 -2.4 A3.7 4.1 0 1 1 -3 -2.4 C-4.2 -4.8 -3.2 -8 0 -11 Z',
    potion: 'M-2.6 -13.5 H2.6 M-2 -13 V-7 C-7 -4.5 -8.6 2 -6 6.5 C-3 11.6 3 11.6 6 6.5 C8.6 2 7 -4.5 2 -7 V-13 M-5.6 3 H5.6',
  };
  function polar(r, aDeg) { // 0° = up, clockwise
    const a = (aDeg - 90) * Math.PI / 180;
    return [+(r * Math.cos(a)).toFixed(2), +(r * Math.sin(a)).toFixed(2)];
  }
  function wedgePath(i) {
    const c = i * SEG_STEP, a0 = c - 19.5, a1 = c + 19.5, r0 = 52, r1 = 150;
    const [x0, y0] = polar(r0, a0), [x1, y1] = polar(r1, a0);
    const [x2, y2] = polar(r1, a1), [x3, y3] = polar(r0, a1);
    return `M${x0} ${y0} L${x1} ${y1} A${r1} ${r1} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${r0} ${r0} 0 0 0 ${x0} ${y0} Z`;
  }
  let wheelSvg = '<svg viewBox="-170 -170 340 340">';
  for (let i = 0; i < SEG_N; i++) wheelSvg += `<path class="ef-seg" data-i="${i}" d="${wedgePath(i)}"/>`;
  for (let i = 0; i < SEG_N; i++) {
    const id = WHEEL_IDS[i];
    const [gx, gy] = polar(102, i * SEG_STEP);
    wheelSvg += `<g class="ef-wgrp" data-i="${i}" transform="translate(${gx},${gy}) scale(1.2)">` +
      `<path class="ef-wicon" d="${WICONS[id]}"/>` +
      `<text class="ef-wcnt" y="22" id="ef-wc-${id}"></text></g>`;
  }
  wheelSvg += '<circle id="ef-whub" r="44"/><text id="ef-wname" y="5"></text></svg>';

  // Small button icon helper
  const bico = (d, sw) => `<svg viewBox="-16 -16 32 32"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICO_ATT = 'M-9 9 L8 -8 M4 -10 L10 -4 M-9 9 L-12 12 M-9 5 L-5 9';
  const ICO_BLK = 'M0 -10 C5 -8 8 -8 10.5 -9 C10.5 -1 7 7 0 11.5 C-7 7 -10.5 -1 -10.5 -9 C-8 -8 -5 -8 0 -10 Z';
  const ICO_JMP = 'M0 11 V-8 M-6.5 -1.5 L0 -9 L6.5 -1.5';
  const ICO_DGD = 'M-11 4 A11 11 0 1 1 5 -10 M5 -10 L5.5 -4.5 M5 -10 L-0.5 -10.5';
  const ICO_WHL = 'M0 -11 A11 11 0 1 0 0.01 -11 M0 -11 V-4.5 M9.5 5.5 L4 2.5 M-9.5 5.5 L-4 2.5';
  const ICO_SPR = 'M-9 -6 L-2 0 L-9 6 M0 -6 L7 0 L0 6';
  const ICO_JRN = 'M0 -8 C-3 -10.5 -8 -10.5 -10.5 -8.5 V8.5 C-8 6.5 -3 6.5 0 8.5 C3 6.5 8 6.5 10.5 8.5 V-8.5 C8 -10.5 3 -10.5 0 -8 V8';
  const ICO_GEAR = 'M0 -11.5 V-7 M0 11.5 V7 M-11.5 0 H-7 M11.5 0 H7 M-8 -8 L-5 -5 M8 8 L5 5 M-8 8 L-5 5 M8 -8 L5 -5 M0 -4.2 A4.2 4.2 0 1 0 0.01 -4.2';
  const SVG_COIN = '<svg width="13" height="13" viewBox="-8 -8 16 16"><circle r="6.6" fill="#d9a83f" stroke="#7a5a1e"/><circle r="4" fill="none" stroke="#7a5a1e" stroke-width="1"/></svg>';
  const SVG_FLASK = '<svg width="13" height="13" viewBox="-8 -8 16 16"><path d="M-1.6 -7 H1.6 M-1.2 -6.5 V-3 C-4.2 -1.5 -5.2 2 -3.6 4.5 C-2 7.2 2 7.2 3.6 4.5 C5.2 2 4.2 -1.5 1.2 -3 V-6.5" fill="#a02a20" stroke="#5c1610" stroke-width="1"/></svg>';

  // ==========================================================================
  // DOM
  // ==========================================================================
  const root = document.createElement('div');
  root.id = 'ef-root';
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  root.innerHTML = `
<div id="ef-vig"></div>
<div id="ef-lowhp"></div>
<div id="ef-dmg"></div>
<div id="ef-compass"><div id="ef-ticks"></div><div id="ef-citems"></div></div>
<div id="ef-boss"><div class="n" id="ef-bossn"></div><div class="b"><div id="ef-bossf"></div></div></div>
<div id="ef-cross"></div>
<div class="ef-hit" id="ef-hit0"><i></i><i></i></div>
<div class="ef-hit" id="ef-hit1"><i></i><i></i></div>
<div id="ef-stats">
  <div id="ef-statrow">
    <div id="ef-lvl">1</div>
    <div class="ef-cnt">${SVG_COIN}<span id="ef-gold">0</span></div>
    <div class="ef-cnt">${SVG_FLASK}<span id="ef-pot">0</span></div>
  </div>
  <div class="ef-bar hp" id="ef-bhp"><div class="ef-fill" id="ef-fhp"></div></div>
  <div class="ef-bar st" id="ef-bst"><div class="ef-fill" id="ef-fst"></div></div>
  <div class="ef-bar mn" id="ef-bmn"><div class="ef-fill" id="ef-fmn"></div></div>
  <div id="ef-xp"><div id="ef-xpf"></div></div>
</div>
<div id="ef-pill"><span class="key">E</span><span id="ef-pill-t"></span></div>
<div id="ef-joy"><div id="ef-joy-nub"></div></div>
<div id="ef-touch">
  <div class="ef-tbtn" id="ef-b-att">${bico(ICO_ATT)}<span>ATTACK</span></div>
  <div class="ef-tbtn" id="ef-b-blk">${bico(ICO_BLK)}<span>BLOCK</span></div>
  <div class="ef-tbtn" id="ef-b-dgd">${bico(ICO_DGD)}<span>DODGE</span></div>
  <div class="ef-tbtn" id="ef-b-jmp">${bico(ICO_JMP)}<span>JUMP</span></div>
  <div class="ef-tbtn" id="ef-b-whl">${bico(ICO_WHL)}<span>WHEEL</span></div>
  <div class="ef-tbtn ef-qbtn" id="ef-b-tch">${bico(WICONS.torch, 1.8)}<span>TORCH</span></div>
  <div class="ef-tbtn ef-qbtn" id="ef-b-pot">${bico(WICONS.potion, 1.8)}<span>POTION</span><span class="ef-qbadge" id="ef-qb-pot">0</span></div>
  <div class="ef-tbtn" id="ef-b-spr">${bico(ICO_SPR)}<span>SPRINT</span></div>
</div>
<div class="ef-corner" id="ef-b-jrn">${bico(ICO_JRN, 1.7)}</div>
<div class="ef-corner" id="ef-b-pse">${bico(ICO_GEAR, 1.7)}</div>
<div id="ef-wheel">${wheelSvg}</div>
<div id="ef-banner"><div class="t" id="ef-ban-t"></div><div class="ef-rule"></div><div class="s" id="ef-ban-s"></div></div>
<div id="ef-toasts"></div>
<div id="ef-dlg">
  <div id="ef-dlg-name"></div>
  <div id="ef-dlg-text"></div>
  <div id="ef-dlg-ch"></div>
</div>
<div class="ef-cpanel" id="ef-journal"></div>
<div class="ef-cpanel" id="ef-pause">
  <div class="ef-x" id="ef-p-x">✕</div>
  <h2>ELDERFALL</h2>
  <div class="ef-rule"></div>
  <button class="ef-mbtn" id="ef-p-resume">Resume</button>
  <button class="ef-mbtn" id="ef-p-save">Save Game</button>
  <button class="ef-mbtn" id="ef-p-load">Load Game</button>
  <button class="ef-mbtn" id="ef-p-new">New Game</button>
  <div class="ef-rule"></div>
  <div class="ef-mrow"><span>Quality</span><button class="ef-sbtn" id="ef-p-q">HIGH</button></div>
  <div class="ef-mrow"><span>Look Sensitivity</span><input type="range" id="ef-p-sens" min="0.3" max="2.5" step="0.05"></div>
  <div class="ef-mrow"><span>Invert Y</span><button class="ef-sbtn" id="ef-p-inv">OFF</button></div>
  <div class="ef-mrow"><span>Voiced Dialogue</span><button class="ef-sbtn" id="ef-p-voice">ON</button></div>
  <div class="ef-mrow"><span>Resolution</span><button class="ef-sbtn" id="ef-p-res">NATIVE</button></div>
  <div class="ef-mrow"><span>Field of View</span><input type="range" id="ef-p-fov" min="55" max="95" step="1"></div>
  <div class="ef-mrow" id="ef-p-fxrow" style="display:none"><span>Cinematic FX</span><button class="ef-sbtn" id="ef-p-fx">ON</button></div>
  <button class="ef-mbtn" id="ef-p-photo">Photo Mode</button>
  <button class="ef-mbtn" id="ef-p-fs">Fullscreen</button>
  <div id="ef-p-note"></div>
</div>
<div id="ef-death"><div class="t">YOU HAVE FALLEN</div><div class="s">— the road ends here… for now —</div><button id="ef-respawn">RISE AGAIN</button></div>
<div id="ef-flash"></div>
<div id="ef-pdodge"></div>
<div id="ef-counter">⚔</div>
<div id="ef-hint"></div>
`;
  hud.appendChild(root);

  const $ = (id) => root.querySelector('#' + id);
  const elDmg = $('ef-dmg'), elLowHp = $('ef-lowhp'), elFlash = $('ef-flash');
  const elPDodge = $('ef-pdodge'), elCounter = $('ef-counter');
  const elQTorch = $('ef-b-tch'), elQPot = $('ef-b-pot'), elQPotB = $('ef-qb-pot');
  const elCompass = $('ef-compass'), elTicks = $('ef-ticks'), elCItems = $('ef-citems');
  const elBoss = $('ef-boss'), elBossN = $('ef-bossn'), elBossF = $('ef-bossf');
  const elCross = $('ef-cross');
  const elHits = [$('ef-hit0'), $('ef-hit1')];
  const elLvl = $('ef-lvl'), elGold = $('ef-gold'), elPot = $('ef-pot');
  const elBHp = $('ef-bhp'), elBSt = $('ef-bst'), elBMn = $('ef-bmn');
  const elFHp = $('ef-fhp'), elFSt = $('ef-fst'), elFMn = $('ef-fmn'), elXpf = $('ef-xpf');
  const elPill = $('ef-pill'), elPillT = $('ef-pill-t');
  const elJoy = $('ef-joy'), elJoyNub = $('ef-joy-nub');
  const elTouch = $('ef-touch');
  const elWheel = $('ef-wheel'), elWName = $('ef-wname');
  const elBanner = $('ef-banner'), elBanT = $('ef-ban-t'), elBanS = $('ef-ban-s');
  const elToasts = $('ef-toasts');
  const elDlg = $('ef-dlg'), elDlgName = $('ef-dlg-name'), elDlgText = $('ef-dlg-text'), elDlgCh = $('ef-dlg-ch');
  const elJournal = $('ef-journal'), elPause = $('ef-pause'), elDeath = $('ef-death');
  const elHint = $('ef-hint');
  const segEls = Array.from(root.querySelectorAll('.ef-seg'));
  const grpEls = Array.from(root.querySelectorAll('.ef-wgrp'));
  const wcntEls = {};
  for (const id of WHEEL_IDS) wcntEls[id] = $('ef-wc-' + id);

  if (IS_COARSE) { elTouch.classList.add('on'); hud.classList.add('ef-touchmode'); }

  // ==========================================================================
  // INPUT — the single shared object (exact contract shape)
  // ==========================================================================
  const input = {
    move: { x: 0, y: 0 },
    look: { dx: 0, dy: 0 },
    jumpPressed: false,
    attackPressed: false,
    attackHeld: false,
    attackReleased: false,
    blockHeld: false,
    interactPressed: false,
    sprintOn: false,
    hotkeySelected: null,
    // dodgePressed: edge-triggered dodge intent (mobile DODGE button, desktop
    // C/Alt); direction comes from the current move vector. Cleared in
    // endFrame like the other *Pressed flags — part of the input contract.
    dodgePressed: false,
    endFrame() {
      input.jumpPressed = false;
      input.attackPressed = false;
      input.attackReleased = false;
      input.interactPressed = false;
      input.dodgePressed = false;
      input.look.dx = 0;
      input.look.dy = 0;
      // combat consumes hotkeySelected during its update (which runs before
      // ui.update/endFrame each frame) — clearing here prevents re-equip spam.
      input.hotkeySelected = null;
    },
  };

  // ==========================================================================
  // Modal / pause state
  // ==========================================================================
  let dlgOpen = false, journalOpen = false, pauseOpen = false, deathOpen = false;
  let suppressLockPause = false;
  const keys = new Set();      // movement key codes currently down
  let shiftDown = false;
  let sprintToggle = false;

  const modalOpen = () => dlgOpen || journalOpen || pauseOpen || deathOpen;

  function releaseHeldInputs() {
    keys.clear();
    shiftDown = false;
    setMoveFromKeys();
    input.blockHeld = false;
    if (input.attackHeld) { input.attackHeld = false; input.attackReleased = true; }
  }

  function refreshModal() {
    g.paused = dlgOpen || journalOpen || pauseOpen; // death screen does not pause
    hud.classList.toggle('ef-modal-open', modalOpen());
    if (modalOpen()) {
      releaseHeldInputs();
      closeWheel(false);
      if (document.pointerLockElement === canvas) {
        suppressLockPause = true;
        document.exitPointerLock();
      }
    }
  }

  // ==========================================================================
  // Generic button binding (pointer events, captures, visual press state)
  // ==========================================================================
  function bindBtn(el, onDown, onUp, opts) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
      el.classList.add('down');
      if (opts && opts.click) click();
      if (onDown) onDown(e);
    });
    const up = (e) => {
      if (!el.classList.contains('down')) return;
      el.classList.remove('down');
      if (onUp) onUp(e);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // ==========================================================================
  // Touch: floating joystick (left 45%) + drag look (rest) on the canvas
  // ==========================================================================
  let joyId = null, joyOX = 0, joyOY = 0;
  let lookId = null, lookLX = 0, lookLY = 0;
  const JOY_R = 64, JOY_DEAD = 0.12;

  function touchSeen() {
    if (!elTouch.classList.contains('on')) {
      elTouch.classList.add('on');
      hud.classList.add('ef-touchmode');
    }
  }

  function startJoy(e) {
    joyId = e.pointerId;
    joyOX = e.clientX; joyOY = e.clientY;
    elJoy.style.transform = `translate(${joyOX}px,${joyOY}px)`;
    elJoyNub.style.transform = 'translate(0px,0px)';
    elJoy.classList.add('on');
  }
  function moveJoy(cx, cy) {
    let dx = cx - joyOX, dy = cy - joyOY;
    const len = Math.hypot(dx, dy);
    const cl = Math.min(len, JOY_R);
    const nx = len > 0.001 ? dx / len : 0, ny = len > 0.001 ? dy / len : 0;
    elJoyNub.style.transform = `translate(${nx * cl}px,${ny * cl}px)`;
    let mag = cl / JOY_R;
    mag = mag < JOY_DEAD ? 0 : (mag - JOY_DEAD) / (1 - JOY_DEAD);
    input.move.x = nx * mag;
    input.move.y = -ny * mag; // screen-up = forward
  }
  function endJoy() {
    joyId = null;
    elJoy.classList.remove('on');
    setMoveFromKeys();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (modalOpen() || (g.paused && !pauseOpen)) return;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      touchSeen();
      if (e.clientX < innerWidth * 0.45 && joyId === null) startJoy(e);
      else if (lookId === null) { lookId = e.pointerId; lookLX = e.clientX; lookLY = e.clientY; }
    } else if (e.pointerType === 'mouse') {
      if (e.button === 0) {
        if (document.pointerLockElement === canvas) {
          input.attackPressed = true;
          input.attackHeld = true;
        } else if (canvas.requestPointerLock) {
          canvas.requestPointerLock();
        }
      } else if (e.button === 2) {
        input.blockHeld = true;
      }
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerId === joyId) { moveJoy(e.clientX, e.clientY); return; }
    if (e.pointerId === lookId) {
      const s = TOUCH_SENS * userSens;
      input.look.dx += (e.clientX - lookLX) * s;
      input.look.dy += (e.clientY - lookLY) * s * (invertY ? -1 : 1);
      lookLX = e.clientX; lookLY = e.clientY;
    }
  });
  function pointerEnd(e) {
    if (e.pointerId === joyId) endJoy();
    if (e.pointerId === lookId) lookId = null;
    if (e.pointerType === 'mouse') {
      if (e.button === 0 && input.attackHeld) { input.attackHeld = false; input.attackReleased = true; }
      if (e.button === 2) input.blockHeld = false;
    }
  }
  window.addEventListener('pointerup', pointerEnd);
  window.addEventListener('pointercancel', pointerEnd);
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- touch action buttons -------------------------------------------------
  bindBtn($('ef-b-att'),
    () => { input.attackPressed = true; input.attackHeld = true; },
    () => { if (input.attackHeld) { input.attackHeld = false; input.attackReleased = true; } });
  bindBtn($('ef-b-blk'),
    () => { input.blockHeld = true; },
    () => { input.blockHeld = false; });
  bindBtn($('ef-b-jmp'), () => { input.jumpPressed = true; });
  bindBtn($('ef-b-dgd'), () => { input.dodgePressed = true; });

  // ---- torch / potion quick-buttons (beside the wheel button) ---------------
  // Torch is a toggle: prefer g.combat.useTorch()/usePotion() when combat
  // exposes them; otherwise fall back to hotkeySelected (combat consumes it).
  let torchLit = false;
  let lastWeapon = 'sword'; // last non-torch selection, used to toggle torch off
  function selectWeapon(id) {
    input.hotkeySelected = id;
    if (id !== 'torch') {
      torchLit = false;
      elQTorch.classList.remove('lit');
      if (id !== 'potion') lastWeapon = id;
    }
  }
  function useTorchAction() {
    if (g.combat && typeof g.combat.useTorch === 'function') {
      const r = g.combat.useTorch();
      torchLit = typeof r === 'boolean' ? r : !torchLit;
    } else {
      torchLit = !torchLit;
      input.hotkeySelected = torchLit ? 'torch' : lastWeapon;
    }
    elQTorch.classList.toggle('lit', torchLit);
  }
  function usePotionAction() {
    if (g.combat && typeof g.combat.usePotion === 'function') g.combat.usePotion();
    else input.hotkeySelected = 'potion';
  }
  bindBtn(elQTorch, () => { useTorchAction(); }, null, { click: true });
  bindBtn(elQPot, () => { usePotionAction(); }, null, { click: true });

  const elSpr = $('ef-b-spr');
  bindBtn(elSpr, () => {
    sprintToggle = !sprintToggle;
    elSpr.classList.toggle('lit', sprintToggle);
    click();
  });

  bindBtn($('ef-b-jrn'), () => { toggleJournal(); }, null, { click: true });
  bindBtn($('ef-b-pse'), () => { pauseOpen ? closePause() : openPause(); }, null, { click: true });

  bindBtn(elPill, () => { input.interactPressed = true; });

  // ==========================================================================
  // Keyboard / mouse (desktop)
  // ==========================================================================
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  function setMoveFromKeys() {
    if (joyId !== null) return; // joystick owns move while active
    input.move.x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    input.move.y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    if (e.code === 'Space') e.preventDefault();
    if (e.repeat) return;

    // ---- dialogue keyboard shortcuts ----
    if (dlgOpen) {
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') { dlgSkipOrNothing(); return; }
      if (e.code.startsWith('Digit')) {
        const i = parseInt(e.code.slice(5), 10) - 1;
        const btns = elDlgCh.querySelectorAll('.ef-choice');
        if (elDlgCh.classList.contains('on') && btns[i]) btns[i].click();
        return;
      }
      if (e.code === 'Escape') { closeDialogue(); }
      return;
    }
    if (e.code === 'Escape') {
      if (wheel.open) { closeWheel(false); return; }
      if (journalOpen) { closeJournal(); return; }
      if (pauseOpen) { closePause(); return; }
      if (!deathOpen) openPause();
      return;
    }
    if (e.code === 'KeyJ') {
      if (!pauseOpen && !deathOpen) toggleJournal();
      return;
    }
    if (e.code === 'KeyM') { // MAP addition: open journal straight to the Map tab
      openMapTab();
      return;
    }
    if (modalOpen() || (g.paused && !pauseOpen)) return;

    if (MOVE_KEYS.has(e.code)) { keys.add(e.code); setMoveFromKeys(); return; }
    switch (e.code) {
      case 'Space': input.jumpPressed = true; break;
      case 'ShiftLeft': case 'ShiftRight': shiftDown = true; break;
      case 'KeyE': input.interactPressed = true; break;
      case 'KeyC': case 'AltLeft': case 'AltRight':
        e.preventDefault();
        input.dodgePressed = true;
        break;
      case 'KeyT': useTorchAction(); break;
      case 'KeyR': usePotionAction(); break;
      case 'KeyQ': case 'Tab':
        if (!wheel.open) { openWheel(); wheel.keyHeld = true; }
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
      case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': {
        const i = parseInt(e.code.slice(5), 10) - 1;
        if (WHEEL_IDS[i]) selectWeapon(WHEEL_IDS[i]);
        break;
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (MOVE_KEYS.has(e.code)) { keys.delete(e.code); setMoveFromKeys(); return; }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { shiftDown = false; return; }
    if ((e.code === 'KeyQ' || e.code === 'Tab') && wheel.open && wheel.keyHeld) closeWheel(true);
  });

  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      if (wheel.open && wheel.keyHeld) {
        wheel.vx += e.movementX; wheel.vy += e.movementY;
        const l = Math.hypot(wheel.vx, wheel.vy);
        if (l > 140) { wheel.vx *= 140 / l; wheel.vy *= 140 / l; }
        setWheelVec(wheel.vx, wheel.vy);
        return;
      }
      const s = MOUSE_SENS * userSens;
      input.look.dx += e.movementX * s;
      input.look.dy += e.movementY * s * (invertY ? -1 : 1);
    } else if (wheel.open && wheel.keyHeld) {
      setWheelVec(e.clientX - innerWidth / 2, e.clientY - innerHeight / 2);
    }
  });

  let everLocked = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) { everLocked = true; return; }
    // Lock lost (usually Esc on desktop) → treat as pause request
    if (input.attackHeld) { input.attackHeld = false; input.attackReleased = true; }
    input.blockHeld = false;
    if (wheel.open && wheel.keyHeld) closeWheel(false);
    // Photo mode (explore.js) exits pointer lock when it takes the camera —
    // that lock-loss is intentional, not a pause request.
    if (!modalOpen() && !suppressLockPause && everLocked &&
        !document.body.classList.contains('ef-photo')) openPause();
    suppressLockPause = false;
  });

  window.addEventListener('blur', () => {
    releaseHeldInputs();
    endJoy(); lookId = null;
    closeWheel(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { releaseHeldInputs(); closeWheel(false); }
  });

  // First interaction anywhere → unlock audio (once)
  const unlockOnce = () => {
    if (g.audio && g.audio.unlock) g.audio.unlock();
    window.removeEventListener('pointerdown', unlockOnce, true);
    window.removeEventListener('keydown', unlockOnce, true);
  };
  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);

  // ==========================================================================
  // Weapon wheel logic
  // ==========================================================================
  const wheel = { open: false, sticky: false, sel: -1, pid: null, sx: 0, sy: 0, vx: 0, vy: 0, keyHeld: false, tDown: 0 };

  function refreshWheelCounts() {
    const st = g.player && g.player.stats;
    const mana = st ? st.mana : 0;
    for (let i = 0; i < SEG_N; i++) {
      const id = WHEEL_IDS[i], cost = MANA_COST[id];
      wcntEls[id].textContent = cost ? cost + ' MP' : '';
      grpEls[i].classList.toggle('dim', !!cost && mana < cost);
    }
  }

  function setWheelSel(i) {
    if (wheel.sel === i) return;
    if (wheel.sel >= 0) { segEls[wheel.sel].classList.remove('on'); grpEls[wheel.sel].classList.remove('sel'); }
    wheel.sel = i;
    if (i >= 0) {
      segEls[i].classList.add('on');
      grpEls[i].classList.add('sel');
      elWName.textContent = WHEEL_LABELS[WHEEL_IDS[i]];
    } else {
      elWName.textContent = '';
    }
  }
  function setWheelVec(vx, vy) {
    if (Math.hypot(vx, vy) < 26) { setWheelSel(-1); return; }
    const ang = wrap360(Math.atan2(vx, -vy) * 180 / Math.PI); // 0 = up, cw
    setWheelSel(Math.round(ang / SEG_STEP) % SEG_N);
  }

  function openWheel() {
    if (wheel.open || modalOpen()) return;
    wheel.open = true;
    wheel.sticky = false;
    wheel.keyHeld = false;
    wheel.pid = null;
    wheel.vx = wheel.vy = 0;
    setWheelSel(-1);
    refreshWheelCounts();
    if (g.requestSlowmo) g.requestSlowmo(0.15);
    sfx('wheelOpen');
    elWheel.classList.add('on');
    hud.classList.add('ef-wheel-open');
  }
  function closeWheel(select) {
    if (!wheel.open) return;
    wheel.open = false;
    wheel.sticky = false;
    wheel.keyHeld = false;
    wheel.pid = null;
    elWheel.classList.remove('on', 'sticky');
    hud.classList.remove('ef-wheel-open');
    if (g.releaseSlowmo) g.releaseSlowmo();
    if (select && wheel.sel >= 0) {
      selectWeapon(WHEEL_IDS[wheel.sel]);
      click();
    }
    setWheelSel(-1);
  }

  const elWhl = $('ef-b-whl');
  elWhl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (wheel.open) { closeWheel(false); return; } // tap again while sticky = cancel
    try { elWhl.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    elWhl.classList.add('down');
    openWheel();
    wheel.pid = e.pointerId;
    wheel.sx = e.clientX; wheel.sy = e.clientY;
    wheel.tDown = performance.now();
  });
  elWhl.addEventListener('pointermove', (e) => {
    if (e.pointerId !== wheel.pid || !wheel.open) return;
    setWheelVec(e.clientX - wheel.sx, e.clientY - wheel.sy);
  });
  const whlUp = (e) => {
    elWhl.classList.remove('down');
    if (e.pointerId !== wheel.pid || !wheel.open) return;
    wheel.pid = null;
    if (performance.now() - wheel.tDown < 260 && wheel.sel < 0) {
      // quick tap → stay open ("sticky") so segments can be tapped directly
      wheel.sticky = true;
      elWheel.classList.add('sticky');
    } else {
      closeWheel(true);
    }
  };
  elWhl.addEventListener('pointerup', whlUp);
  elWhl.addEventListener('pointercancel', whlUp);

  // Direct segment taps (during hold-drag or sticky mode)
  segEls.forEach((seg, i) => {
    seg.addEventListener('pointerdown', (e) => {
      if (!wheel.open) return;
      e.stopPropagation();
      setWheelSel(i);
      closeWheel(true);
    });
  });
  elWheel.addEventListener('pointerdown', () => { if (wheel.sticky) closeWheel(false); });

  // ==========================================================================
  // Compass — built once, transform-updated
  // ==========================================================================
  const COMPASS_RANGE = 75; // degrees visible each side of center
  const CARDINALS = [
    ['N', 0, 1], ['NE', 45, 0], ['E', 90, 1], ['SE', 135, 0],
    ['S', 180, 1], ['SW', 225, 0], ['W', 270, 1], ['NW', 315, 0],
  ];
  const POI_GLYPH = { village: '⌂', peak: '▲', lake: '●', shrine: '✦' };
  const cardEls = CARDINALS.map(([label, , major]) => {
    const d = document.createElement('div');
    d.className = 'ef-c ' + (major ? 'maj' : 'min');
    d.textContent = label;
    d.style.opacity = '0';
    elCItems.appendChild(d);
    return d;
  });
  const poiEls = POIS.map((p) => {
    const d = document.createElement('div');
    d.className = 'ef-c poi';
    d.textContent = POI_GLYPH[p.id] || '◆';
    d.title = p.name;
    d.style.opacity = '0';
    elCItems.appendChild(d);
    return d;
  });
  const markEl = document.createElement('div');
  markEl.className = 'ef-c mark';
  markEl.innerHTML = '▼<span class="d"></span>';
  const markDistEl = markEl.querySelector('.d');
  markEl.style.opacity = '0';
  elCItems.appendChild(markEl);
  // Generic compass markers (tome hints, hunt targets): g.compassMarkers = [{id,x,z,icon,label}]
  if (!g.compassMarkers) g.compassMarkers = [];
  const xtraEls = [];
  for (let i = 0; i < 3; i++) {
    const el = document.createElement('div');
    el.className = 'ef-c mark';
    el.style.opacity = '0';
    el.style.color = '#9fd8ff';
    elCItems.appendChild(el);
    xtraEls.push(el);
  }

  let compassW = 300, pxPerDeg = 2;
  function measureCompass() {
    compassW = elCompass.clientWidth || 300;
    pxPerDeg = compassW / (COMPASS_RANGE * 2);
    elTicks.style.backgroundSize = `${15 * pxPerDeg}px 42%`;
  }
  measureCompass();
  window.addEventListener('resize', measureCompass);

  function placeCompassItem(el, rel, clampEdge) {
    let r = rel, op = 1;
    if (clampEdge) {
      // Fade toward 0.25 as the icon nears/passes the strip edge, and drop the
      // distance label once clamped, so half-clipped glyphs/labels never
      // collide with the cardinal letters.
      const over = Math.abs(rel) - COMPASS_RANGE;
      const clamped = over > 0;
      if (clamped) {
        r = rel < 0 ? -COMPASS_RANGE : COMPASS_RANGE;
        op = 0.25;
      } else if (over > -10) {
        op = 0.25 + 0.75 * (-over / 10); // eases 1 -> 0.25 over the last 10deg
      }
      el.classList.toggle('ef-clamped', clamped);
    } else if (Math.abs(r) > COMPASS_RANGE + 4) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = String(op);
    el.style.transform = `translateX(calc(${(r * pxPerDeg).toFixed(1)}px - 50%))`;
  }

  let lastMarkDist = -1;
  function updateCompass() {
    const p = g.player;
    if (!p) return;
    const heading = wrap360(-(p.yaw || 0) * 180 / Math.PI);
    elTicks.style.backgroundPosition = `${(-heading * pxPerDeg).toFixed(1)}px 100%`;
    for (let i = 0; i < CARDINALS.length; i++) {
      placeCompassItem(cardEls[i], angDiff(CARDINALS[i][1], heading), false);
    }
    const disc = g.flags.discovered;
    const px = p.position.x, pz = p.position.z;
    for (let i = 0; i < POIS.length; i++) {
      const poi = POIS[i];
      if (!disc || !disc[poi.id]) { poiEls[i].style.opacity = '0'; continue; }
      const b = Math.atan2(poi.x - px, -(poi.z - pz)) * 180 / Math.PI;
      placeCompassItem(poiEls[i], angDiff(b, heading), false);
    }
    // Gold quest marker
    let mpos = null;
    if (g.quests && g.quests.markerPos) mpos = g.quests.markerPos();
    if (mpos) {
      const b = Math.atan2(mpos.x - px, -(mpos.z - pz)) * 180 / Math.PI;
      placeCompassItem(markEl, angDiff(b, heading), true);
      const dist = Math.round(Math.hypot(mpos.x - px, mpos.z - pz));
      if (Math.abs(dist - lastMarkDist) > 1) {
        lastMarkDist = dist;
        markDistEl.textContent = dist + 'm';
      }
    }
    // extra markers
    for (let i = 0; i < xtraEls.length; i++) {
      const m = g.compassMarkers[i];
      if (!m) { xtraEls[i].style.opacity = '0'; continue; }
      if (xtraEls[i]._icon !== m.icon) { xtraEls[i]._icon = m.icon; xtraEls[i].textContent = m.icon || '✦'; }
      const b2 = Math.atan2(m.x - px, -(m.z - pz)) * 180 / Math.PI;
      placeCompassItem(xtraEls[i], angDiff(b2, heading), true);
    }
    if (!mpos) markEl.style.opacity = '0';
  }

  // ==========================================================================
  // Bars / counters (throttled, cached writes)
  // ==========================================================================
  let inCombat = false;
  const barCache = { hp: -1, st: -1, mn: -1, xp: -1, lvl: -1, gold: -1, pot: -1, lowhp: false };
  const barActiveAt = { hp: 0, st: 0, mn: 0 };
  const barHidden = { hp: false, st: false, mn: false };

  function setFill(el, key, frac) {
    frac = clamp(frac, 0, 1);
    if (Math.abs(frac - barCache[key]) > 0.002) {
      barCache[key] = frac;
      el.style.transform = `scaleX(${frac.toFixed(4)})`;
    }
    return frac;
  }
  function setBarVis(el, key, frac, now) {
    if (frac < 0.999 || inCombat) barActiveAt[key] = now;
    const hide = now - barActiveAt[key] > 4;
    if (hide !== barHidden[key]) {
      barHidden[key] = hide;
      el.classList.toggle('hide', hide);
    }
  }

  function updateBars(now) {
    const pl = g.player;
    if (!pl || !pl.stats) return;
    const st = pl.stats;
    const maxHp = st.maxHp + ((pl.bonus && pl.bonus.maxHp) || 0);
    const fhp = setFill(elFHp, 'hp', st.hp / Math.max(1, maxHp));
    const fst = setFill(elFSt, 'st', st.stamina / Math.max(1, st.maxStamina));
    const fmn = setFill(elFMn, 'mn', st.mana / Math.max(1, st.maxMana));
    setBarVis(elBHp, 'hp', fhp, now);
    setBarVis(elBSt, 'st', fst, now);
    setBarVis(elBMn, 'mn', fmn, now);
    setFill(elXpf, 'xp', st.xp / Math.max(1, st.xpNext));
    if (st.level !== barCache.lvl) { barCache.lvl = st.level; elLvl.textContent = st.level; }
    if (st.gold !== barCache.gold) { barCache.gold = st.gold; elGold.textContent = st.gold; }
    if (st.potions !== barCache.pot) {
      barCache.pot = st.potions;
      elPot.textContent = st.potions;
      elQPotB.textContent = st.potions;
      elQPot.classList.toggle('dim', st.potions < 1);
    }
    const low = fhp < 0.3 && !deathOpen;
    if (low !== barCache.lowhp) { barCache.lowhp = low; elLowHp.classList.toggle('on', low); }
  }

  // ==========================================================================
  // Interactables — proximity scan (throttled), pill + crosshair swell
  // ==========================================================================
  let nearInter = null, pillShown = false, pillLabel = '';
  function scanInteract() {
    const pl = g.player;
    let best = null, bd = Infinity;
    if (pl && pl.position && !modalOpen()) {
      const p = pl.position;
      for (let i = 0; i < g.interactables.length; i++) {
        const it = g.interactables[i];
        if (!it || !it.pos) continue;
        if (it.enabled && !it.enabled()) continue;
        const dx = it.pos.x - p.x, dy = it.pos.y - (p.y + 1), dz = it.pos.z - p.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= (it.radius || 2.5) && d < bd) { bd = d; best = it; }
      }
    }
    nearInter = best;
    const show = !!best;
    if (show !== pillShown) {
      pillShown = show;
      elPill.classList.toggle('on', show);
      elCross.classList.toggle('on', show);
    }
    if (best) {
      const label = best.prompt || best.label || 'Interact';
      if (label !== pillLabel) { pillLabel = label; elPillT.textContent = label; }
    }
  }

  // ==========================================================================
  // Flashes, hit markers, banner, toasts
  // ==========================================================================
  function dmgFlash() {
    elDmg.style.transition = 'none';
    elDmg.style.opacity = '0.85';
    void elDmg.offsetWidth;
    elDmg.style.transition = 'opacity .55s ease';
    elDmg.style.opacity = '0';
  }
  function goldFlash() {
    elFlash.style.transition = 'none';
    elFlash.style.opacity = '0.9';
    void elFlash.offsetWidth;
    elFlash.style.transition = 'opacity 1.1s ease';
    elFlash.style.opacity = '0';
  }
  function pdodgeFlash() {
    elPDodge.style.transition = 'none';
    elPDodge.style.opacity = '0.9';
    void elPDodge.offsetWidth;
    elPDodge.style.transition = 'opacity .7s ease';
    elPDodge.style.opacity = '0';
  }
  let hitIdx = 0;
  function hitMark(kill) {
    const el = elHits[hitIdx ^= 1];
    el.classList.remove('go');
    el.classList.toggle('kill', !!kill);
    void el.offsetWidth;
    el.classList.add('go');
  }

  let bannerBusy = false;
  const bannerQ = [];
  function showBanner(title, sub) {
    if (bannerBusy) { bannerQ.push([title, sub]); return; }
    bannerBusy = true;
    elBanT.textContent = title || '';
    elBanS.textContent = sub || '';
    elBanner.classList.remove('on');
    void elBanner.offsetWidth;
    elBanner.classList.add('on');
    setTimeout(() => {
      bannerBusy = false;
      const n = bannerQ.shift();
      if (n) showBanner(n[0], n[1]);
    }, 3350);
  }

  function toast(title, sub) {
    const d = document.createElement('div');
    d.className = 'ef-toast';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = title || '';
    const s = document.createElement('div');
    s.className = 's';
    s.textContent = sub || '';
    if (title) d.appendChild(t);
    if (sub) d.appendChild(s);
    elToasts.appendChild(d);
    while (elToasts.children.length > 4) elToasts.removeChild(elToasts.firstChild);
    requestAnimationFrame(() => d.classList.add('on'));
    setTimeout(() => {
      d.classList.remove('on');
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 380);
    }, 4600);
  }

  // ==========================================================================
  // Dialogue — typed text, tree navigation
  // ==========================================================================
  const dlg = { npc: null, tree: null, node: null, full: '', chars: 0, typing: false };

  function npcName(npc) {
    if (!npc) return '';
    if (typeof npc === 'string') return npc;
    return npc.name || npc.id || '';
  }

  function openDialogue(npc, tree) {
    if (!tree || !tree.nodes) return;
    dlg.npc = npc;
    dlg.tree = tree;
    dlgOpen = true;
    refreshModal();
    elDlg.classList.add('on');
    showDlgNode(tree.start);
  }
  function showDlgNode(id) {
    const node = dlg.tree && dlg.tree.nodes ? dlg.tree.nodes[id] : null;
    if (!node) { closeDialogue(); return; }
    dlg.node = node;
    elDlgName.textContent = node.speaker || npcName(dlg.npc);
    dlg.full = node.text || '';
    dlg.chars = 0;
    dlg.typing = true;
    // voice.js speaks each line as it starts typing
    g.events.emit('dialogueLine', { speaker: elDlgName.textContent, text: dlg.full });
    elDlgText.textContent = '';
    // build choices (hidden until typing finishes)
    elDlgCh.classList.remove('on');
    elDlgCh.textContent = '';
    let choices = (node.choices || []).filter((c) => !c.if || c.if());
    if (choices.length === 0) choices = [{ label: 'Farewell.', next: null }];
    for (const c of choices) {
      const b = document.createElement('button');
      b.className = 'ef-choice';
      b.textContent = c.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        click();
        if (c.do) c.do();
        if (c.next) showDlgNode(c.next);
        else closeDialogue();
      });
      elDlgCh.appendChild(b);
    }
  }
  function dlgSkipOrNothing() {
    if (dlg.typing) {
      dlg.typing = false;
      dlg.chars = dlg.full.length;
      elDlgText.textContent = dlg.full;
      elDlgCh.classList.add('on');
    }
  }
  elDlg.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    dlgSkipOrNothing();
  });
  function closeDialogue() {
    if (!dlgOpen) return;
    dlgOpen = false;
    dlg.typing = false;
    elDlg.classList.remove('on');
    refreshModal();
    g.events.emit('dialogueEnd', {});
  }

  // ==========================================================================
  // Journal — quest log built from quest events + discovered flags
  // ==========================================================================
  const journal = { active: new Map(), completed: [] };
  const qKey = (q) => (q && (q.id || q.name || q.title)) || String(q);
  const qName = (q) => (q && (q.name || q.title || q.id)) || 'Quest';
  let journalTab = 'quests';

  // ---- Bestiary — kill counts persisted under g.flags.bestiary --------------
  // [canonical key, display name, flavor line]
  const BESTIARY = [
    ['wolf', 'Wolf', 'Grey hunters of the pinewood. They circle twice before they lunge — and flee when blooded.'],
    ['goblin', 'Goblin', 'A cackling wretch with a rusted knife. Brave in a pack, pitiful alone.'],
    ['bandit', 'Bandit', 'Redfang oath-breakers who bleed travelers for coin. They guard high and strike low.'],
    ['skeleton', 'Skeleton', 'Barrow-dead rattled up from old soil. The rattling stops a breath before the swing.'],
    ['skeletonArcher', 'Skeleton Archer', 'A hollow-eyed marksman of the ruins. Dead fingers never tire on the string.'],
    ['wraith', 'Wraith', 'Cold light wearing the memory of a man. Arrows drift through it; fire does not.'],
    ['thrall', 'Vampire Thrall', 'A pale servant of the crypt, quick as regret. Every cut it lands, it drinks.'],
    ['morvane', 'Morvane', 'The lord beneath the cemetery. He steps between shadows and calls the dead to table.'],
    ['witch', 'Grimhilde', 'The crone of the pines. The village names her curse what she names medicine.'],
    ['troll', 'Troll', 'The toll-keeper under Stonebridge. Slow to anger, slower to move — mind the slam.'],
    ['werewolf', 'Werewolf', 'Umber terror of the night woods. It hunts until dawn; then the dawn hunts it.'],
    ['barrowlord', 'Barrow Lord', 'Crowned king of the deep barrows. His buried court still answers when he calls.'],
    ['vargr', 'Vargr Redfang', 'The bandit lord himself. He earned every scar on that hide — and gave far worse.'],
    ['drake', 'Vhastrix', 'Terror of the high peak. First the sky darkens, then the throat glows. Then fire.'],
    ['guard', 'Village Guard', 'A knight sworn to Emberhollow\'s gate. Who raises a blade against a friend?'],
    ['boar', 'Boar', 'A bristle-backed tusker of the thickets. Even the hedge-pig dies angrier than it lived.'],
  ];
  // Normalize whatever type id enemies.js emits to a canonical bestiary key.
  const BEST_ALIAS = {
    wolf: 'wolf', goblin: 'goblin', bandit: 'bandit', skeleton: 'skeleton',
    skeletonarcher: 'skeletonArcher', skelarcher: 'skeletonArcher', archer: 'skeletonArcher',
    wraith: 'wraith',
    vampirethrall: 'thrall', thrall: 'thrall', vampire: 'thrall',
    vampirelord: 'morvane', morvane: 'morvane',
    grimhilde: 'witch', witch: 'witch',
    troll: 'troll', werewolf: 'werewolf', barrowlord: 'barrowlord', vargr: 'vargr',
    drake: 'drake', vhastrix: 'drake',
    guard: 'guard', knight: 'guard',
    boar: 'boar',
  };
  const bestKey = (t) => BEST_ALIAS[String(t || '').toLowerCase().replace(/[^a-z]/g, '')] || null;

  function renderBestiary() {
    let html = '';
    const raw = g.flags.bestiary || {};
    const agg = {}; // canonical key (or raw id) → count
    for (const k in raw) {
      const c = bestKey(k) || k;
      agg[c] = (agg[c] || 0) + (raw[k] | 0);
    }
    let seen = 0;
    for (const [key, name, flavor] of BESTIARY) {
      const n = agg[key];
      delete agg[key];
      if (n > 0) {
        seen++;
        html += `<div class="be"><div class="n">${esc(name)}<span class="k">slain ×${n}</span></div>` +
          `<div class="f">${esc(flavor)}</div></div>`;
      } else {
        html += '<div class="be unk"><div class="n">??? — not yet encountered</div></div>';
      }
    }
    // Any kills whose type id we don't recognize still get a row.
    for (const key in agg) {
      if (!(agg[key] > 0)) continue;
      const name = String(key).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      html += `<div class="be"><div class="n">${esc(name)}<span class="k">slain ×${agg[key]}</span></div>` +
        '<div class="f">Little is written of this creature. Perhaps you should write it.</div></div>';
    }
    html += `<div class="tally">${seen} of ${BESTIARY.length} beasts recorded in the vale</div>`;
    return html;
  }

  function renderJournal() {
    let html = '<div class="ef-x" id="ef-j-x">✕</div><h2>JOURNAL</h2><div class="ef-rule"></div>';
    html += `<div class="tabs"><button class="tab${journalTab === 'quests' ? ' on' : ''}" data-t="quests">Quests</button>` +
      `<button class="tab${journalTab === 'bestiary' ? ' on' : ''}" data-t="bestiary">Bestiary</button>` +
      `<button class="tab${journalTab === 'map' ? ' on' : ''}" data-t="map">Map</button></div>`;
    if (journalTab === 'bestiary') {
      html += renderBestiary();
    } else if (journalTab === 'map') {
      // map canvas is a persistent subtree — appended after innerHTML below so
      // the cached terrain paint survives tab switches / re-opens.
    } else {
      html += '<h3>Active Quests</h3>';
      if (journal.active.size === 0) html += '<div class="none">No active quests. Seek out the folk of Emberhollow.</div>';
      else {
        for (const [, q] of journal.active) {
          html += `<div class="q"><div class="n">${esc(q.name)}</div>` +
            (q.text ? `<div class="o">✦ ${esc(q.text)}</div>` : '') + '</div>';
        }
      }
      html += '<h3>Completed</h3>';
      if (journal.completed.length === 0) html += '<div class="none">Nothing yet — your legend awaits.</div>';
      else for (const n of journal.completed) html += `<div class="done">${esc(n)}</div>`;
      html += '<h3>Discovered Places</h3>';
      const disc = g.flags.discovered;
      let any = false;
      for (const p of POIS) {
        if (disc && disc[p.id]) { any = true; html += `<span class="loc">${POI_GLYPH[p.id] || '◆'} ${esc(p.name)}</span>`; }
      }
      if (!any) html += '<div class="none">The map of the vale is still blank.</div>';
    }
    elJournal.innerHTML = html;
    elJournal.querySelector('#ef-j-x').addEventListener('click', () => { click(); closeJournal(); });
    elJournal.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => {
        const t = b.dataset.t;
        if (t === journalTab) return;
        journalTab = t;
        click();
        renderJournal();
      });
    });
    if (journalTab === 'map') { elJournal.appendChild(mapWrap); drawMap(); }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function toggleJournal() { journalOpen ? closeJournal() : openJournal(); }
  function openJournal() {
    if (dlgOpen || pauseOpen || deathOpen) return;
    renderJournal();
    journalOpen = true;
    refreshModal();
    elJournal.classList.add('on');
  }
  function closeJournal() {
    if (!journalOpen) return;
    journalOpen = false;
    elJournal.classList.remove('on');
    refreshModal();
  }

  // ==========================================================================
  // WORLD MAP — journal tab (scoped MAP addition)
  // Terrain is sampled ONCE on first open (256×256 grid of core.terrainHeight
  // + biomeAt over x −1600..1600, z −2200..1200 — Drakespire included) into a
  // cached offscreen 512×512 canvas: muted biome palette, hillshade from the
  // same central-difference normal scheme core.terrainNormal uses (taken off
  // the sampled grid, eps = one map cell), inked coastline, then a sepia
  // wash + aged-edge vignette + paper grain so it reads as an in-world chart.
  // Overlays (discovered POIs, quest/hunt/compass markers, player arrow) are
  // redrawn every frame while the tab is open. Undiscovered POIs stay
  // unlabeled ("fogged"); the terrain itself is fully visible.
  // ==========================================================================
  const MAP_S = 512;
  const MAP_X0 = -1600, MAP_X1 = 1600, MAP_Z0 = -2200, MAP_Z1 = 1200;
  const mapPx = (x) => (x - MAP_X0) / (MAP_X1 - MAP_X0) * MAP_S;
  const mapPy = (z) => (z - MAP_Z0) / (MAP_Z1 - MAP_Z0) * MAP_S; // north (−z) = up
  let mapTerrain = null; // cached terrain paint (built lazily, once)

  const mapWrap = document.createElement('div');
  mapWrap.className = 'mapblock';
  mapWrap.innerHTML =
    '<div class="mapfr"><canvas width="512" height="512"></canvas></div>' +
    '<div class="mapcap">— Here be the Vale of Elderfall —</div>';
  const mapCanvas = mapWrap.querySelector('canvas');
  const mapCtx = mapCanvas.getContext('2d');

  function buildMapTerrain() {
    const G = 256;
    const W = MAP_X1 - MAP_X0, D = MAP_Z1 - MAP_Z0;
    const cw = W / G, cd = D / G;
    const hs = new Float32Array(G * G);
    for (let j = 0; j < G; j++) {
      const z = MAP_Z0 + (j + 0.5) / G * D;
      for (let i = 0; i < G; i++) hs[j * G + i] = terrainHeight(MAP_X0 + (i + 0.5) / G * W, z);
    }
    const small = document.createElement('canvas');
    small.width = small.height = G;
    const sc = small.getContext('2d');
    const img = sc.createImageData(G, G);
    const px = img.data;
    // muted palette, tuned to sit on parchment
    const C_ROCK = [122, 116, 104], C_SNOW = [228, 224, 213];
    const C_SAND = [158, 139, 97], C_MARSH = [96, 104, 64];
    const C_FOREST = [80, 97, 58], C_MEADOW = [116, 123, 73], C_MEADOW_LO = [133, 136, 86];
    const LX = -0.62, LY = 0.72, LZ = -0.32; // light out of the north-west
    for (let j = 0; j < G; j++) {
      const z = MAP_Z0 + (j + 0.5) / G * D;
      for (let i = 0; i < G; i++) {
        const x = MAP_X0 + (i + 0.5) / G * W;
        const h = hs[j * G + i];
        let r, gr, b, shade = 1;
        if (h < WATER_LEVEL) {
          // muted slate-teal, engraved wave bands — antique-chart water, not ink-black
          const t = Math.min(1, (WATER_LEVEL - h) / 22);
          const wave = 1 + 0.05 * Math.sin(j * 0.55 + Math.sin(i * 0.22) * 1.6);
          r = lerp(88, 40, t) * wave; gr = lerp(110, 62, t) * wave; b = lerp(111, 78, t) * wave;
        } else {
          const bio = biomeAt(x, z, h);
          let base;
          if (bio === BIOME.SAND) base = C_SAND;
          else if (bio === BIOME.MARSH) base = C_MARSH;
          else if (bio === BIOME.FOREST) base = C_FOREST;
          else {
            const t = smoothstep(-2, 52, h); // low meadows warmer, highlands cooler
            base = [lerp(C_MEADOW_LO[0], C_MEADOW[0], t),
              lerp(C_MEADOW_LO[1], C_MEADOW[1], t),
              lerp(C_MEADOW_LO[2], C_MEADOW[2], t)];
          }
          const rk = smoothstep(48, 66, h), sn = smoothstep(88, 104, h);
          r = lerp(lerp(base[0], C_ROCK[0], rk), C_SNOW[0], sn);
          gr = lerp(lerp(base[1], C_ROCK[1], rk), C_SNOW[1], sn);
          b = lerp(lerp(base[2], C_ROCK[2], rk), C_SNOW[2], sn);
          // hillshade — core.terrainNormal's central-difference scheme on the grid
          const hL = hs[j * G + (i > 0 ? i - 1 : i)], hR = hs[j * G + (i < G - 1 ? i + 1 : i)];
          const hN = hs[(j > 0 ? j - 1 : j) * G + i], hS = hs[(j < G - 1 ? j + 1 : j) * G + i];
          const nx = hL - hR, ny = 2 * cw, nz = (hN - hS) * (cw / cd);
          const nl = Math.hypot(nx, ny, nz);
          shade = clamp(0.52 + 0.48 * ((nx * LX + ny * LY + nz * LZ) / nl) / LY, 0.55, 1.16);
          // ink the coastline for a drawn-chart feel
          if (hL < WATER_LEVEL || hR < WATER_LEVEL || hN < WATER_LEVEL || hS < WATER_LEVEL) shade *= 0.6;
        }
        const dn = (hash2(i, j * 7 + 3) - 0.5) * 7; // dither breaks banding
        const o = (j * G + i) * 4;
        px[o] = clamp(r * shade + dn, 0, 255);
        px[o + 1] = clamp(gr * shade + dn, 0, 255);
        px[o + 2] = clamp(b * shade + dn, 0, 255);
        px[o + 3] = 255;
      }
    }
    sc.putImageData(img, 0, 0);
    mapTerrain = document.createElement('canvas');
    mapTerrain.width = mapTerrain.height = MAP_S;
    const mc = mapTerrain.getContext('2d');
    mc.imageSmoothingEnabled = true;
    mc.drawImage(small, 0, 0, MAP_S, MAP_S); // 256 → 512 (smoothed)
    // sepia wash + aged-edge vignette + paper grain
    mc.globalCompositeOperation = 'overlay';
    mc.fillStyle = 'rgba(198,160,106,0.30)';
    mc.fillRect(0, 0, MAP_S, MAP_S);
    mc.globalCompositeOperation = 'multiply';
    const vg = mc.createRadialGradient(MAP_S / 2, MAP_S / 2, MAP_S * 0.30, MAP_S / 2, MAP_S / 2, MAP_S * 0.74);
    vg.addColorStop(0, '#ffffff');
    vg.addColorStop(1, '#c3a878');
    mc.fillStyle = vg;
    mc.fillRect(0, 0, MAP_S, MAP_S);
    mc.globalCompositeOperation = 'source-over';
    const grng = makeRng(7);
    for (let k = 0; k < 1100; k++) {
      mc.fillStyle = k & 1 ? 'rgba(56,40,18,0.05)' : 'rgba(255,240,205,0.05)';
      mc.fillRect(grng() * MAP_S, grng() * MAP_S, 1.6, 1.6);
    }
    // inked neatline — the double border every hand-drawn chart carries
    mc.strokeStyle = 'rgba(58,42,18,0.5)';
    mc.lineWidth = 2;
    mc.strokeRect(7, 7, MAP_S - 14, MAP_S - 14);
    mc.lineWidth = 1;
    mc.strokeStyle = 'rgba(58,42,18,0.3)';
    mc.strokeRect(11.5, 11.5, MAP_S - 23, MAP_S - 23);
    // compass rose (bottom-right), aged ink on a worn parchment disc
    mc.save();
    mc.translate(MAP_S - 58, MAP_S - 60);
    mc.fillStyle = 'rgba(233,220,190,0.4)';
    mc.beginPath(); mc.arc(0, 0, 26, 0, Math.PI * 2); mc.fill();
    mc.strokeStyle = 'rgba(58,42,18,0.7)';
    mc.lineWidth = 1;
    mc.beginPath(); mc.arc(0, 0, 21, 0, Math.PI * 2); mc.stroke();
    mc.fillStyle = 'rgba(58,42,18,0.45)'; // diagonal (half) points first, beneath
    mc.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k * 90 + 45) * Math.PI / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      mc.moveTo(ca * 12, sa * 12);
      mc.lineTo(Math.cos(a + 0.5) * 3.4, Math.sin(a + 0.5) * 3.4);
      mc.lineTo(Math.cos(a - 0.5) * 3.4, Math.sin(a - 0.5) * 3.4);
    }
    mc.fill();
    mc.fillStyle = 'rgba(58,42,18,0.8)'; // cardinal star
    mc.beginPath();
    mc.moveTo(0, -19); mc.lineTo(3.6, -3.6); mc.lineTo(19, 0); mc.lineTo(3.6, 3.6);
    mc.lineTo(0, 19); mc.lineTo(-3.6, 3.6); mc.lineTo(-19, 0); mc.lineTo(-3.6, -3.6);
    mc.closePath();
    mc.fill();
    mc.font = 'italic 12px Georgia,serif';
    mc.textAlign = 'center';
    mc.strokeStyle = 'rgba(236,224,195,0.85)';
    mc.lineWidth = 3;
    mc.lineJoin = 'round';
    mc.strokeText('N', 0, -26);
    mc.fillText('N', 0, -26);
    mc.restore();
  }

  function mapHalo(txt, x, y, ink, font) {
    const c = mapCtx;
    c.font = font;
    c.strokeStyle = 'rgba(236,224,195,0.85)';
    c.lineWidth = 3;
    c.strokeText(txt, x, y);
    c.fillStyle = ink;
    c.fillText(txt, x, y);
  }

  function drawMap() {
    if (!mapTerrain) buildMapTerrain();
    const c = mapCtx;
    c.drawImage(mapTerrain, 0, 0); // opaque — doubles as clear
    c.textAlign = 'center';
    c.lineJoin = 'round';
    // discovered POIs only — the same glyphs the compass uses
    const disc = g.flags.discovered || {};
    for (const poi of POIS) {
      if (!disc[poi.id]) continue;
      const x = mapPx(poi.x), y = mapPy(poi.z);
      mapHalo(POI_GLYPH[poi.id] || '◆', x, y + 5, '#3a2a12', '15px Georgia,serif');
      mapHalo(poi.name, x, y + 19, '#4a3517', 'italic 11px Georgia,serif');
    }
    // generic compass markers (the hunt mirrors into these as id 'hunt' — drawn below)
    for (const m of g.compassMarkers) {
      if (!m || m.id === 'hunt') continue;
      const x = clamp(mapPx(m.x), 10, MAP_S - 10), y = clamp(mapPy(m.z), 14, MAP_S - 8);
      mapHalo(m.icon || '✦', x, y + 5, '#2e556e', '14px Georgia,serif');
      if (m.label) mapHalo(m.label, x, y + 18, '#2e556e', 'italic 10px Georgia,serif');
    }
    // active hunt bounty
    const hunt = g.enemies && g.enemies.activeHunt;
    if (hunt) {
      const x = clamp(mapPx(hunt.x), 10, MAP_S - 10), y = clamp(mapPy(hunt.z), 14, MAP_S - 8);
      mapHalo('☠', x, y + 5, '#5a1d13', '15px Georgia,serif');
      if (hunt.name) mapHalo(hunt.name, x, y + 19, '#5a1d13', 'italic 10px Georgia,serif');
    }
    // gold quest marker
    const mpos = g.quests && g.quests.markerPos ? g.quests.markerPos() : null;
    if (mpos) {
      const x = clamp(mapPx(mpos.x), 10, MAP_S - 10), y = clamp(mapPy(mpos.z), 14, MAP_S - 8);
      mapHalo('▼', x, y + 4, '#8a5c10', '16px Georgia,serif');
    }
    // player arrow — position + facing, live while the map is open
    const p = g.player;
    if (p && p.position) {
      c.save();
      c.translate(clamp(mapPx(p.position.x), 8, MAP_S - 8), clamp(mapPy(p.position.z), 8, MAP_S - 8));
      c.rotate(-(p.yaw || 0)); // heading 0 = north = map-up (compass convention)
      c.beginPath();
      c.moveTo(0, -8.5); c.lineTo(5.6, 6.5); c.lineTo(0, 3); c.lineTo(-5.6, 6.5);
      c.closePath();
      c.fillStyle = '#8a2318'; // wax-seal red
      c.strokeStyle = 'rgba(240,228,196,0.9)';
      c.lineWidth = 1.4;
      c.fill();
      c.stroke();
      c.restore();
    }
  }

  function openMapTab() { // desktop M / direct opens
    if (pauseOpen || deathOpen || dlgOpen) return;
    if (journalOpen && journalTab === 'map') { closeJournal(); return; }
    journalTab = 'map';
    if (journalOpen) renderJournal();
    else openJournal();
  }

  // ==========================================================================
  // Pause menu
  // ==========================================================================
  const elPQ = $('ef-p-q'), elPInv = $('ef-p-inv'), elPSens = $('ef-p-sens');
  const elPVoice = $('ef-p-voice');
  const elPRes = $('ef-p-res');
  if (elPRes) {
    const cur = localStorage.getItem('elderfall_res') === '4k';
    elPRes.textContent = cur ? '4K SS' : 'NATIVE';
    elPRes.addEventListener('click', () => {
      const now = localStorage.getItem('elderfall_res') === '4k';
      localStorage.setItem('elderfall_res', now ? 'native' : '4k');
      elPRes.textContent = now ? 'NATIVE' : '4K SS';
      const n = $('ef-p-note'); if (n) n.textContent = 'Applies after reload';
      click();
    });
  }
  if (elPVoice) elPVoice.addEventListener('click', () => {
    g.flags.voiceOff = !g.flags.voiceOff;
    elPVoice.textContent = g.flags.voiceOff ? 'OFF' : 'ON';
    click();
  });
  const elPNote = $('ef-p-note'), elPLoad = $('ef-p-load'), elPNew = $('ef-p-new'), elPFs = $('ef-p-fs');
  let newConfirm = 0;

  // --------------------------------------------------------------------------
  // EXPLORE scoped additions: base FOV (g.baseFov), Photo Mode, Cinematic FX.
  //
  // player.js caches the boot-time camera.fov as its sprint-lerp base and
  // combat.js layers a decaying FOV kick on top AFTER player each frame, so a
  // one-shot slider write would be overwritten next frame. Instead ui owns
  // g.baseFov and re-bases the camera every frame (ui runs after both
  // writers): whatever offset the gameplay writers left on top of the boot
  // base (sprint lerp + combat kick) is preserved on top of the user's base.
  // When g.baseFov equals the boot base this writes NOTHING — the untouched
  // (mobile/default) path stays byte-identical.
  // --------------------------------------------------------------------------
  const elPFov = $('ef-p-fov'), elPPhoto = $('ef-p-photo');
  const elPFxRow = $('ef-p-fxrow'), elPFx = $('ef-p-fx');
  const bootBaseFov = g.camera.fov; // same value player.js cached at creation
  {
    const sv = parseFloat(localStorage.getItem('elderfall_fov') || '');
    g.baseFov = isFinite(sv) ? clamp(sv, 55, 95) : bootBaseFov;
  }
  let fovOffset = 0; // sprint lerp + combat kick, measured off the boot base
  function rebaseFov() {
    if (g.cameraLock) return; // photo/cinema own the camera (and its fov)
    const cam = g.camera;
    // While unpaused, player.update rewrote fov this frame (combat may have
    // added its kick after) — measure the gameplay offset fresh. While paused
    // neither writer runs, so keep the last measured offset frozen.
    if (!g.paused) fovOffset = cam.fov - bootBaseFov;
    const want = (g.baseFov || bootBaseFov) + fovOffset;
    if (Math.abs(cam.fov - want) > 0.005) {
      cam.fov = want;
      cam.updateProjectionMatrix();
    }
  }

  function syncPauseUI() {
    elPQ.textContent = g.quality.tier === 'low' ? 'LOW' : 'HIGH';
    elPInv.textContent = invertY ? 'ON' : 'OFF';
    if (elPVoice) elPVoice.textContent = g.flags.voiceOff ? 'OFF' : 'ON';
    elPSens.value = String(userSens);
    elPLoad.disabled = !(g.save && g.save.hasSave && g.save.hasSave());
    elPNew.textContent = 'New Game';
    elPNew.classList.remove('warn');
    newConfirm = 0;
    elPNote.textContent = '';
    elPFs.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    // EXPLORE additions: base-FOV slider + ultra-only Cinematic FX row
    elPFov.value = String(Math.round(g.baseFov || bootBaseFov));
    const fx = g.quality.ultra && g.postfx && g.postfx.setEnabled;
    elPFxRow.style.display = fx ? '' : 'none';
    if (fx) elPFx.textContent = g.postfx.enabled === false ? 'OFF' : 'ON';
    elPPhoto.disabled = !(g.explore && g.explore.openPhoto);
  }
  function openPause() {
    if (modalOpen()) return;
    syncPauseUI();
    pauseOpen = true;
    refreshModal();
    elPause.classList.add('on');
    click();
  }
  function closePause() {
    if (!pauseOpen) return;
    pauseOpen = false;
    elPause.classList.remove('on');
    refreshModal();
    click();
  }
  $('ef-p-x').addEventListener('click', closePause);
  $('ef-p-resume').addEventListener('click', closePause);
  $('ef-p-save').addEventListener('click', () => {
    click();
    if (g.save && g.save.save) g.save.save();
  });
  elPLoad.addEventListener('click', () => {
    click();
    if (g.save && g.save.load && g.save.load()) closePause();
    else elPNote.textContent = 'No saved journey found.';
  });
  elPNew.addEventListener('click', () => {
    click();
    if (newConfirm === 0) {
      newConfirm = 1;
      elPNew.textContent = 'Erase & Begin Anew?';
      elPNew.classList.add('warn');
      setTimeout(() => { if (newConfirm === 1) { newConfirm = 0; elPNew.textContent = 'New Game'; elPNew.classList.remove('warn'); } }, 4000);
    } else {
      if (g.save && g.save.clear) g.save.clear();
      location.reload();
    }
  });
  elPQ.addEventListener('click', () => {
    click();
    const next = g.quality.tier === 'low' ? 'high' : 'low';
    localStorage.setItem('elderfall_quality', next);
    g.flags.qualityPref = next;
    elPQ.textContent = next.toUpperCase();
    elPNote.textContent = 'Saving & reloading to apply…';
    if (g.save && g.save.save) { try { g.save.save(); } catch (_) { /* ok */ } }
    setTimeout(() => location.reload(), 350);
  });
  elPSens.addEventListener('input', () => {
    userSens = parseFloat(elPSens.value) || 1;
    localStorage.setItem('elderfall_sens', String(userSens));
  });
  elPInv.addEventListener('click', () => {
    click();
    invertY = !invertY;
    localStorage.setItem('elderfall_invy', invertY ? '1' : '0');
    elPInv.textContent = invertY ? 'ON' : 'OFF';
    if (elPVoice) elPVoice.textContent = g.flags.voiceOff ? 'OFF' : 'ON';
  });
  elPFs.addEventListener('click', () => {
    click();
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      elPFs.textContent = 'Fullscreen';
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => { /* ok */ });
      elPFs.textContent = 'Exit Fullscreen';
    }
  });
  // --- EXPLORE additions: FOV slider / Photo Mode / Cinematic FX bindings ---
  elPFov.addEventListener('input', () => {
    const v = parseFloat(elPFov.value);
    if (!isFinite(v)) return;
    g.baseFov = clamp(v, 55, 95);
    localStorage.setItem('elderfall_fov', String(g.baseFov));
    rebaseFov(); // live preview while the menu is open
  });
  elPPhoto.addEventListener('click', () => {
    if (!(g.explore && g.explore.openPhoto)) return;
    click();
    closePause();
    g.explore.openPhoto();
  });
  elPFx.addEventListener('click', () => {
    if (!(g.postfx && g.postfx.setEnabled)) return;
    click();
    const on = g.postfx.enabled === false;
    g.postfx.setEnabled(on);
    elPFx.textContent = on ? 'ON' : 'OFF';
  });

  // ==========================================================================
  // Death screen
  // ==========================================================================
  $('ef-respawn').addEventListener('click', () => {
    click();
    if (g.player && g.player.respawn) g.player.respawn();
    deathOpen = false;
    elDeath.classList.remove('on');
    refreshModal();
  });

  // ==========================================================================
  // Event subscriptions
  // ==========================================================================
  const ev = g.events;
  ev.on('playerDamaged', () => { dmgFlash(); });
  ev.on('hitLanded', (d) => { hitMark(d && d.kill); });
  ev.on('playerDied', () => {
    setTimeout(() => {
      deathOpen = true;
      elDeath.classList.add('on');
      refreshModal();
    }, 500);
  });
  ev.on('levelUp', (d) => {
    goldFlash();
    showBanner('LEVEL ' + ((d && d.level) || ''), 'Your legend grows');
  });
  ev.on('discover', (d) => {
    const poi = d && d.poi;
    showBanner(poi ? poi.name : 'Unknown Place', 'Discovered');
  });
  ev.on('notify', (d) => { toast(d && d.text, d && d.sub); });
  ev.on('questStarted', (d) => {
    const q = d && d.quest;
    journal.active.set(qKey(q), { name: qName(q), text: (d && d.text) || '' });
    toast('New Quest — ' + qName(q), (d && d.text) || '');
    if (journalOpen) renderJournal();
  });
  ev.on('questUpdated', (d) => {
    const q = d && d.quest;
    const entry = journal.active.get(qKey(q)) || { name: qName(q), text: '' };
    if (d && d.text) entry.text = d.text;
    journal.active.set(qKey(q), entry);
    toast(qName(q), (d && d.text) || 'Objective updated');
    if (journalOpen) renderJournal();
  });
  ev.on('questCompleted', (d) => {
    const q = d && d.quest;
    journal.active.delete(qKey(q));
    if (!journal.completed.includes(qName(q))) journal.completed.push(qName(q));
    toast('Quest Complete — ' + qName(q), (d && d.text) || '');
    if (journalOpen) renderJournal();
  });
  ev.on('bossBar', (d) => {
    if (d && d.name != null) {
      elBossN.textContent = d.name;
      elBossF.style.transform = `scaleX(${clamp(d.hp / Math.max(1, d.maxHp), 0, 1).toFixed(4)})`;
      elBoss.classList.add('on');
    } else {
      elBoss.classList.remove('on');
    }
  });
  ev.on('gameSaved', () => { toast('Game Saved', 'Your tale is recorded.'); });
  ev.on('gameLoaded', () => { toast('Game Loaded', 'The tale resumes.'); });
  // Combat wave-2 cues
  ev.on('counterWindow', (d) => { elCounter.classList.toggle('on', !!(d && d.open)); });
  ev.on('perfectDodge', () => { pdodgeFlash(); });
  // Bestiary tally (persisted via g.flags so save.js carries it)
  ev.on('enemyKilled', (d) => {
    if (!d || !d.type) return;
    const b = g.flags.bestiary || (g.flags.bestiary = {});
    b[d.type] = (b[d.type] || 0) + 1;
    if (journalOpen && journalTab === 'bestiary') renderJournal();
  });

  // ==========================================================================
  // Input hints (shown briefly, per detected input type)
  // ==========================================================================
  elHint.textContent = IS_COARSE
    ? 'Left thumb: move  ·  Right thumb: look'
    : 'WASD move · Mouse look · LMB attack · RMB block · C dodge · E interact · Q wheel · J journal · M map · Esc menu';
  setTimeout(() => elHint.classList.add('off'), 16000);

  // ==========================================================================
  // Per-frame update (uses rawDt so slow-mo never slows the UI itself)
  // ==========================================================================
  let frame = 0;
  let interTimer = 0;

  function update() {
    const rdt = g.time.rawDt || 0.016;
    frame++;

    // EXPLORE addition: apply the user base FOV over the gameplay writers
    // (no-op while g.baseFov matches the boot base — the default path).
    rebaseFov();

    input.sprintOn = shiftDown || sprintToggle;

    // Typed dialogue text
    if (dlgOpen && dlg.typing) {
      dlg.chars += rdt * 35;
      const n = Math.min(dlg.full.length, dlg.chars | 0);
      elDlgText.textContent = dlg.full.slice(0, n);
      if (n >= dlg.full.length) {
        dlg.typing = false;
        elDlgCh.classList.add('on');
      }
    }

    // Throttled HUD work: bars + compass every other frame
    if (frame & 1) {
      updateBars(performance.now() * 0.001);
      updateCompass();
    }

    // MAP addition: live overlays (player arrow etc.) while the map tab is open
    if (journalOpen && journalTab === 'map') drawMap();

    // Interactable proximity scan (~8/s)
    interTimer += rdt;
    if (interTimer > 0.12) {
      interTimer = 0;
      scanInteract();
    }

    // Consume interact intent (E key / pill tap) — ui owns interaction
    if (input.interactPressed && !modalOpen() && nearInter) {
      const it = nearInter;
      nearInter = null;
      pillShown = false;
      elPill.classList.remove('on');
      elCross.classList.remove('on');
      click();
      if (it.onInteract) it.onInteract();
    }
  }

  // combatState → keeps bars visible during fights
  ev.on('combatState', (d) => { inCombat = !!(d && d.inCombat); });

  return { update, input, openDialogue, closeDialogue, showBanner };
}
