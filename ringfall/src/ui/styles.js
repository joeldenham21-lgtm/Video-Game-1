// All UI styling (HUD, touch controls, menus). Injected once at boot.
export const CSS = /* css */`
#ui * { box-sizing: border-box; }
.hud { position: absolute; inset: 0; pointer-events: none; font-family: var(--display); color: var(--text); opacity: 1; transition: opacity .3s; }
.hud.off { opacity: 0; }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }

/* crosshair */
.xh { position: absolute; left: 50%; top: 50%; width: 0; height: 0; --s: 10px; --c: rgba(235,248,255,.92); }
.xh i { position: absolute; background: var(--c); box-shadow: 0 0 3px rgba(0,0,0,.7); transition: transform .06s linear, background .1s; }
.xh .t, .xh .b { width: 2px; height: 8px; left: -1px; }
.xh .l, .xh .r { width: 8px; height: 2px; top: -1px; }
.xh .t { top: calc(-8px - var(--s)); } .xh .b { top: var(--s); }
.xh .l { left: calc(-8px - var(--s)); } .xh .r { left: var(--s); }
.xh .d { width: 3px; height: 3px; left: -1.5px; top: -1.5px; border-radius: 50%; }
.xh .ring { position: absolute; left: calc(-1 * var(--s) - 6px); top: calc(-1 * var(--s) - 6px); width: calc(var(--s) * 2 + 12px); height: calc(var(--s) * 2 + 12px); border: 1.5px solid var(--c); border-radius: 50%; opacity: 0; box-shadow: none; background: transparent; }
.xh.scatter .ring { opacity: .75; } .xh.scatter .t, .xh.scatter .b, .xh.scatter .l, .xh.scatter .r { opacity: .0; }
.xh.lance .t, .xh.lance .b { height: 14px; } .xh.lance .t { top: calc(-14px - var(--s)); }
.xh.lance .l, .xh.lance .r { width: 14px; } .xh.lance .l { left: calc(-14px - var(--s)); }
.xh.nova .b { height: 16px; }
.xh.target { --c: #ff6b7f; }
.xh.auto .ring { opacity: .9; border-style: dashed; animation: spin 1.4s linear infinite; }
.xh.hidden { opacity: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
.hm { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
.hm i { position: absolute; width: 11px; height: 2.5px; background: #fff; box-shadow: 0 0 4px rgba(0,0,0,.6); left: -5.5px; top: -1.25px; }
.hm i:nth-child(1) { transform: rotate(45deg) translateX(-12px); } .hm i:nth-child(2) { transform: rotate(135deg) translateX(-12px); }
.hm i:nth-child(3) { transform: rotate(225deg) translateX(-12px); } .hm i:nth-child(4) { transform: rotate(315deg) translateX(-12px); }
.hm.show { animation: hm .2s ease-out; }
.hm.crit i { background: var(--gold); } .hm.kill i { background: var(--danger); width: 15px; }
.hm.shield i { background: #7fd8ff; }
@keyframes hm { 0% { opacity: 1; transform: scale(1.35); } 100% { opacity: 0; transform: scale(1); } }
.reload-tag { position: absolute; left: 50%; top: calc(50% + 34px); transform: translateX(-50%); font: 600 11px var(--mono); letter-spacing: .25em; color: var(--amber); opacity: 0; transition: opacity .15s; text-shadow: 0 0 6px rgba(0,0,0,.8); }
.reload-tag.on { opacity: 1; }

/* damage direction */
.dmgdir { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.dmgdir i { position: absolute; left: -60px; top: -130px; width: 120px; height: 40px; border-top: 5px solid rgba(255,50,70,.9); border-radius: 50% 50% 0 0 / 100% 100% 0 0; filter: drop-shadow(0 0 6px rgba(255,30,60,.8)); opacity: 0; transform-origin: 60px 130px; }

/* offscreen indicators */
.offs i { position: absolute; left: 0; top: 0; width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 14px solid rgba(255,90,110,.85); filter: drop-shadow(0 0 4px rgba(0,0,0,.7)); display: none; }
.offs i.lancer { border-bottom-color: #ff2040; animation: blink .25s steps(2) infinite; }
@keyframes blink { 50% { opacity: .35; } }

/* floating world labels */
.dn { position: absolute; left: 0; top: 0; font: 700 15px var(--mono); color: #eaf6ff; text-shadow: 0 1px 2px #000, 0 0 8px rgba(0,0,0,.6); white-space: nowrap; will-change: transform, opacity; display: none; }
.dn.crit { color: var(--gold); font-size: 19px; }
.stg { position: absolute; left: 0; top: 0; display: none; text-align: center; transform-origin: 50% 50%; }
.stg b { display: block; width: 18px; height: 18px; margin: 0 auto; border: 2.5px solid #ffcf6b; transform: rotate(45deg); box-shadow: 0 0 10px rgba(255,190,80,.8); animation: stgp .5s ease-in-out infinite alternate; }
.stg span { display: block; margin-top: 6px; font: 700 10px var(--mono); letter-spacing: .2em; color: #ffe2a8; text-shadow: 0 0 6px #000; }
@keyframes stgp { to { transform: rotate(45deg) scale(1.25); } }

/* vitals */
.vitals { position: absolute; left: calc(22px + var(--safe-l)); bottom: calc(20px + var(--safe-b)); width: min(300px, 36vw); }
.bar { position: relative; height: 12px; background: rgba(6,10,16,.6); clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%); overflow: hidden; }
.bar > i { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; transform-origin: 0 50%; transition: transform .12s ease-out; }
.bar > b { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; transform-origin: 0 50%; background: rgba(255,255,255,.55); transition: transform .6s ease-in .25s; }
.bar .ticks { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 2px), rgba(4,6,11,.75) calc(10% - 2px) 10%); }
.hpbar > i { background: linear-gradient(90deg, #4fe89a, #9dffc8); }
.hpbar.low > i { background: linear-gradient(90deg, #ff3b5c, #ff8b6b); animation: blink .5s steps(2) infinite; }
.shbar { height: 7px; margin-bottom: 4px; }
.shbar > i { background: linear-gradient(90deg, #3aa8ff, #9fe8ff); }
.vit-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 5px; }
.vit-row .hp { font: 700 26px var(--mono); line-height: 1; }
.vit-row .sh { font: 500 14px var(--mono); color: #9fe8ff; }
.vit-row .lbl { font-size: 10px; letter-spacing: .25em; color: var(--muted); }
.pips { display: flex; gap: 5px; margin-top: 7px; align-items: center; }
.pips i { width: 22px; height: 5px; background: rgba(160,220,255,.18); position: relative; overflow: hidden; }
.pips i.on { background: #9fe8ff; box-shadow: 0 0 6px rgba(127,230,255,.7); }
.pips i s { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(160,220,255,.5); }
.pips .lbl { font-size: 9px; letter-spacing: .25em; color: var(--muted); margin-right: 3px; }
.odm { margin-top: 8px; display: flex; align-items: center; gap: 8px; }
.odm .bar { flex: 1; height: 6px; }
.odm .bar > i { background: linear-gradient(90deg, #8a5cff, #d8b8ff); }
.odm .lbl { font-size: 9px; letter-spacing: .25em; color: #c6a0ff; }
.odm.ready .lbl { color: #fff; text-shadow: 0 0 8px #c6a0ff; animation: blink .6s steps(2) infinite; }
.odm.ready .bar > i { background: linear-gradient(90deg, #c6a0ff, #fff); }
.pulse-heal .hpbar { box-shadow: 0 0 14px rgba(93,255,168,.9); }
.pulse-shield .shbar { box-shadow: 0 0 14px rgba(127,216,255,.9); }

/* weapon panel */
.wpn { position: absolute; right: calc(24px + var(--safe-r)); bottom: calc(20px + var(--safe-b)); text-align: right; }
.wpn .ammo { font: 700 40px var(--mono); line-height: 1; letter-spacing: -.02em; }
.wpn .ammo small { font-size: 16px; color: var(--muted); margin-left: 4px; }
.wpn .ammo.low { color: var(--danger); }
.wpn .name { font-size: 11px; letter-spacing: .32em; color: var(--signal); margin-top: 4px; }
.slots { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
.slots span { font: 600 10px var(--mono); padding: 3px 7px; border: 1px solid rgba(160,220,255,.2); color: var(--muted); letter-spacing: .12em; }
.slots span.on { border-color: var(--signal); color: #fff; background: rgba(127,230,255,.12); }
.slots span.locked { opacity: .25; }

/* top center */
.topc { position: absolute; left: 50%; top: calc(14px + var(--safe-t)); transform: translateX(-50%); text-align: center; width: min(560px, 70vw); }
.wave-info { font: 600 11px var(--mono); letter-spacing: .3em; color: var(--muted); text-shadow: 0 1px 3px #000; }
.wave-info b { color: #fff; font-weight: 600; }
.boss { margin-top: 6px; display: none; }
.boss.on { display: block; }
.boss .bname { font-weight: 700; font-size: 13px; letter-spacing: .4em; color: #ffe6ea; text-shadow: 0 0 10px rgba(255,60,90,.6); margin-bottom: 5px; }
.boss .bar { height: 10px; clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 100%, 0 100%); }
.boss .bar > i { background: linear-gradient(90deg, #ff3b5c, #ff8f7a); }
.boss .bar .ph { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(4,6,11,.9); }
.boss .sub { font: 500 10px var(--mono); letter-spacing: .25em; color: #ffb3c0; margin-top: 4px; min-height: 12px; }

/* score + style */
.score { position: absolute; right: calc(22px + var(--safe-r)); top: calc(16px + var(--safe-t)); text-align: right; }
.score .pts { font: 700 22px var(--mono); }
.score .lbl { font-size: 9px; letter-spacing: .3em; color: var(--muted); }
.style { position: absolute; right: calc(22px + var(--safe-r)); top: 34%; text-align: right; width: 220px; }
.style .rank { font-weight: 700; font-size: 58px; line-height: .9; letter-spacing: -.02em; font-style: italic; transition: color .2s; text-shadow: 0 0 22px currentColor; }
.style .rname { font-size: 10px; letter-spacing: .4em; margin-top: 2px; opacity: .85; }
.style .sbar { margin: 6px 0 8px auto; width: 150px; height: 4px; background: rgba(255,255,255,.12); }
.style .sbar i { display: block; height: 100%; background: currentColor; transform-origin: 100% 50%; }
.style .feed div { font: 600 11px var(--mono); letter-spacing: .12em; color: #dfeeff; opacity: .9; margin-top: 3px; text-shadow: 0 1px 2px #000; transition: opacity .3s; }
.style .feed div.gold { color: var(--gold); }
.style .feed div em { font-style: normal; color: var(--muted); margin-left: 6px; }
.style.empty { opacity: 0; }
.style.bump .rank { animation: bump .35s ease-out; }
@keyframes bump { 0% { transform: scale(1.5); } 100% { transform: scale(1); } }

/* announcements */
.ann { position: absolute; left: 50%; top: 24%; transform: translateX(-50%); text-align: center; opacity: 0; white-space: nowrap; }
.ann.show { animation: ann 2.4s cubic-bezier(.2,.8,.2,1) forwards; }
.ann h2 { font-weight: 700; font-size: clamp(26px, 5vw, 50px); letter-spacing: .28em; text-indent: .28em; text-shadow: 0 0 24px rgba(127,230,255,.5), 0 2px 4px #000; }
.ann p { font: 500 12px var(--mono); letter-spacing: .3em; color: var(--muted); margin-top: 6px; }
.ann.warn h2 { color: #ff8a9a; text-shadow: 0 0 24px rgba(255,60,90,.6); }
.ann.od h2 { color: #e0cfff; text-shadow: 0 0 24px rgba(198,160,255,.8); }
.ann.gold h2, .ann.clear h2 { color: #fff1c8; text-shadow: 0 0 24px rgba(255,210,87,.6); }
@keyframes ann { 0% { opacity: 0; letter-spacing: .6em; } 12% { opacity: 1; letter-spacing: .28em; } 80% { opacity: 1; } 100% { opacity: 0; } }

.card { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); text-align: center; opacity: 0; pointer-events: none; }
.card.show { animation: card 3.6s ease forwards; }
.card .k { font: 500 12px var(--mono); letter-spacing: .5em; color: var(--signal); }
.card h1 { font-weight: 700; font-size: clamp(30px, 6.5vw, 64px); letter-spacing: .18em; text-indent: .18em; margin-top: 6px; text-shadow: 0 0 30px rgba(127,230,255,.35); }
.card .rule { width: 0; height: 1px; background: var(--signal); margin: 12px auto 0; box-shadow: 0 0 8px var(--signal); animation: rule 1.2s .3s ease forwards; }
@keyframes rule { to { width: 240px; } }
@keyframes card { 0% { opacity: 0; transform: translate(-50%, -46%); } 15% { opacity: 1; transform: translate(-50%, -50%); } 78% { opacity: 1; } 100% { opacity: 0; } }

.newfoe { position: absolute; left: calc(22px + var(--safe-l)); top: 30%; padding: 10px 16px 10px 14px; background: linear-gradient(90deg, rgba(255,59,92,.22), rgba(255,59,92,0)); border-left: 3px solid var(--danger); opacity: 0; transform: translateX(-20px); }
.newfoe.show { animation: foe 3.4s ease forwards; }
.newfoe .k { font: 600 10px var(--mono); letter-spacing: .3em; color: #ff9aa8; }
.newfoe .n { font-weight: 700; font-size: 22px; letter-spacing: .2em; }
@keyframes foe { 0% { opacity: 0; transform: translateX(-20px); } 10% { opacity: 1; transform: none; } 85% { opacity: 1; } 100% { opacity: 0; } }

.subs { position: absolute; left: 50%; bottom: calc(24% + var(--safe-b)); transform: translateX(-50%); width: min(600px, 56vw); text-align: center; opacity: 0; transition: opacity .3s; }
.subs.on { opacity: 1; }
.subs .who { font: 700 10px var(--mono); letter-spacing: .4em; color: var(--signal); margin-bottom: 4px; }
.subs .txt { font-size: 16px; line-height: 1.4; text-shadow: 0 1px 3px #000, 0 0 12px rgba(0,0,0,.8); background: rgba(4,8,14,.45); display: inline-block; padding: 6px 12px; }
.tip { position: absolute; left: 50%; top: calc(58px + var(--safe-t)); transform: translateX(-50%); font: 500 12px var(--mono); letter-spacing: .12em; padding: 7px 14px; background: rgba(8,14,22,.78); border: 1px solid var(--line); opacity: 0; transition: opacity .3s; white-space: nowrap; max-width: 92vw; overflow: hidden; text-overflow: ellipsis; }
.tip.on { opacity: 1; }
.tip kbd { font: 700 11px var(--mono); color: #04121a; background: var(--signal); padding: 1px 6px; margin: 0 2px; }
.fps { position: absolute; left: 50%; bottom: 4px; transform: translateX(-50%); font: 11px var(--mono); color: var(--muted); }
.warp { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0) 20%, rgba(200,240,255,.35) 70%); opacity: 0; }
.warp.on { animation: warp .8s ease-in forwards; }
@keyframes warp { to { opacity: 1; } }

/* touch layout: vitals move to the top-left, weapon panel hides (ammo lives on the swap button) */
.touch .vitals { top: calc(12px + var(--safe-t)); bottom: auto; left: calc(62px + var(--safe-l)); width: min(230px, 30vw); }
.touch .vit-row .hp { font-size: 20px; }
.touch .wpn { display: none; }
.touch .style { top: calc(60px + var(--safe-t)); width: 160px; }
.touch .style .rank { font-size: 40px; }
.touch .style .feed { display: none; }
.touch .score { right: calc(70px + var(--safe-r)); top: calc(12px + var(--safe-t)); }
.touch .subs { bottom: auto; top: calc(64px + var(--safe-t)); width: min(520px, 56vw); }
.touch .subs .txt { font-size: 13px; }
.touch .tip { top: calc(26% + var(--safe-t)); white-space: normal; text-align: center; width: max-content; max-width: min(460px, 52vw); line-height: 1.5; }
.touch .topc { width: min(420px, 44vw); }

/* ---------------- touch controls ---------------- */
#touch .tbtn { position: absolute; border-radius: 50%; display: grid; place-items: center; color: rgba(235,248,255,.92);
  background: radial-gradient(circle at 50% 40%, rgba(40,60,80,.45), rgba(8,14,22,.55)); border: 1.5px solid rgba(160,220,255,.35);
  box-shadow: 0 0 0 1px rgba(0,0,0,.3), inset 0 0 14px rgba(127,230,255,.08); touch-action: none; -webkit-user-select: none; user-select: none; }
#touch .tbtn i { width: 46%; height: 46%; display: block; pointer-events: none; }
#touch .tbtn svg { width: 100%; height: 100%; display: block; }
#touch .tbtn.down { background: radial-gradient(circle at 50% 40%, rgba(127,230,255,.45), rgba(20,40,60,.6)); border-color: #9fe8ff; transform: scale(.94); }
#touch .btn-fire { width: var(--fire); height: var(--fire); right: calc(var(--u) * 13 + var(--safe-r)); bottom: calc(var(--u) * 22 + var(--safe-b)); border-color: rgba(255,120,140,.55); }
#touch .btn-fire.down { background: radial-gradient(circle, rgba(255,90,110,.5), rgba(40,10,20,.6)); border-color: #ff8a9a; }
#touch .btn-fire.auto { border-style: dashed; }
#touch .btn-jump { width: var(--b1); height: var(--b1); right: calc(var(--u) * 3 + var(--safe-r)); bottom: calc(var(--u) * 5 + var(--safe-b)); }
#touch .btn-dash { width: var(--b2); height: var(--b2); right: calc(var(--u) * 23 + var(--safe-r)); bottom: calc(var(--u) * 4 + var(--safe-b)); }
#touch .btn-melee { width: var(--b2); height: var(--b2); right: calc(var(--u) * 35 + var(--safe-r)); bottom: calc(var(--u) * 22 + var(--safe-b)); }
#touch .btn-reload { width: var(--b3); height: var(--b3); right: calc(var(--u) * 29 + var(--safe-r)); bottom: calc(var(--u) * 42 + var(--safe-b)); }
#touch .btn-swap { width: var(--b2); height: var(--b2); right: calc(var(--u) * 5 + var(--safe-r)); bottom: calc(var(--u) * 44 + var(--safe-b)); }
#touch .btn-overdrive { width: var(--b2); height: var(--b2); right: calc(var(--u) * 45 + var(--safe-r)); bottom: calc(var(--u) * 6 + var(--safe-b)); opacity: .35; }
#touch .btn-overdrive.ready { opacity: 1; border-color: #c6a0ff; color: #fff; box-shadow: 0 0 18px rgba(198,160,255,.8); animation: odp .8s ease-in-out infinite alternate; }
@keyframes odp { to { box-shadow: 0 0 30px rgba(198,160,255,1); } }
#touch .btn-pause { width: 40px; height: 40px; left: calc(12px + var(--safe-l)); top: calc(10px + var(--safe-t)); border-radius: 8px; }
#touch .btn-pause i { width: 60%; height: 60%; }
#touch .tbtn .pips { position: absolute; bottom: -12px; left: 50%; transform: translateX(-50%); display: flex; gap: 3px; }
#touch .tbtn .pips b { width: 9px; height: 4px; background: rgba(160,220,255,.25); display: block; }
#touch .tbtn .pips b.on { background: #9fe8ff; }
#touch .tbtn .ammo { position: absolute; bottom: -15px; left: 50%; transform: translateX(-50%); font: 700 11px var(--mono); color: #eaf6ff; white-space: nowrap; text-shadow: 0 1px 2px #000; }
#touch .tbtn .cool { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(rgba(0,0,0,.55) var(--p, 0%), transparent 0); pointer-events: none; }
#touch .tbtn .ring { position: absolute; inset: -4px; border-radius: 50%; background: conic-gradient(#c6a0ff var(--p, 0%), rgba(198,160,255,.12) 0); -webkit-mask: radial-gradient(circle, transparent 62%, #000 63%); mask: radial-gradient(circle, transparent 62%, #000 63%); pointer-events: none; }
#touch .stick-base { position: absolute; left: 0; top: 0; width: 0; height: 0; display: none; pointer-events: none; }
#touch .stick-base::before { content: ''; position: absolute; left: calc(var(--stick) / -2); top: calc(var(--stick) / -2); width: var(--stick); height: var(--stick); border-radius: 50%; border: 1.5px solid rgba(160,220,255,.35); background: radial-gradient(circle, rgba(127,230,255,.08), rgba(8,14,22,.3)); }
#touch .stick-knob { position: absolute; left: 0; top: 0; width: calc(var(--stick) * .42); height: calc(var(--stick) * .42); border-radius: 50%; background: rgba(200,240,255,.55); box-shadow: 0 0 12px rgba(127,230,255,.6); transform: translate(-50%, -50%); }
#touch .stick-hint, #touch .look-hint { position: absolute; bottom: calc(var(--u) * 14 + var(--safe-b)); font: 600 10px var(--mono); letter-spacing: .3em; color: rgba(200,230,255,.45); pointer-events: none; transition: opacity .6s; }
#touch .stick-hint { left: calc(var(--u) * 14 + var(--safe-l)); }
#touch .stick-hint span::before { content: ''; display: block; width: calc(var(--stick) * .9); height: calc(var(--stick) * .9); border-radius: 50%; border: 1.5px dashed rgba(160,220,255,.3); margin: 0 auto 8px; }
#touch .look-hint { right: 48%; bottom: calc(var(--u) * 40 + var(--safe-b)); }
#touch .gone { opacity: 0; }
#touch.lefty .tbtn:not(.btn-pause) { right: auto; }

/* ---------------- menus ---------------- */
.menu { position: absolute; inset: 0; pointer-events: auto; display: flex; align-items: center; justify-content: center; padding: max(16px, var(--safe-t)) max(16px, var(--safe-r)) max(16px, var(--safe-b)) max(16px, var(--safe-l)); overflow-y: auto; }
.menu.dim { background: radial-gradient(ellipse at 50% 40%, rgba(4,8,14,.55), rgba(2,4,8,.88)); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.panel { width: min(560px, 100%); background: linear-gradient(180deg, rgba(12,18,28,.92), rgba(6,10,16,.94)); border: 1px solid var(--line); padding: 26px 26px 22px; clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px)); position: relative; margin: auto; }
.panel::before { content: ''; position: absolute; left: 0; top: 0; width: 60px; height: 2px; background: var(--signal); box-shadow: 0 0 8px var(--signal); }
.panel h3 { font-weight: 700; font-size: 20px; letter-spacing: .3em; margin-bottom: 4px; }
.panel .kick { font: 500 10px var(--mono); letter-spacing: .35em; color: var(--signal); margin-bottom: 16px; }
.btn { display: block; width: 100%; text-align: left; font: 600 15px var(--display); letter-spacing: .24em; color: var(--text); background: rgba(127,230,255,.04); border: 1px solid rgba(160,220,255,.16); padding: 13px 16px; margin-top: 8px; cursor: pointer; position: relative; transition: background .15s, border-color .15s, transform .1s; }
.btn:hover, .btn.focus, .btn:focus-visible { background: rgba(127,230,255,.14); border-color: var(--signal); outline: none; }
.btn:active { transform: scale(.985); }
.btn small { display: block; font: 400 11px var(--mono); letter-spacing: .06em; color: var(--muted); margin-top: 4px; text-transform: none; }
.btn.primary { background: linear-gradient(90deg, rgba(127,230,255,.22), rgba(127,230,255,.05)); border-color: rgba(127,230,255,.6); }
.btn.danger:hover { border-color: var(--danger); background: rgba(255,59,92,.12); }
.btn .arrow { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--signal); font-family: var(--mono); }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .row2 .btn { margin-top: 0; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); margin: 14px 0 6px; }
.stats div { background: rgba(6,10,16,.95); padding: 10px 12px; }
.stats b { display: block; font: 700 20px var(--mono); }
.stats span { font-size: 9px; letter-spacing: .3em; color: var(--muted); }

/* title */
.title-wrap { width: min(1100px, 100%); display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 32px; align-items: center; }
.logo { position: relative; container-type: inline-size; }
.logo .word { font-weight: 700; font-size: clamp(40px, 7vw, 104px); font-size: min(14.5cqw, 110px); letter-spacing: .1em; line-height: .9; white-space: nowrap; background: linear-gradient(180deg, #ffffff 30%, #9fb6cc 100%); -webkit-background-clip: text; background-clip: text; color: transparent; position: relative; z-index: 1; text-shadow: none; filter: drop-shadow(0 4px 18px rgba(0,0,0,.5)); }
.logo svg { position: absolute; left: -6%; top: -18%; width: 112%; height: 150%; pointer-events: none; overflow: visible; }
.logo .ring-back { z-index: 0; } .logo .ring-front { z-index: 2; }
.logo .tag { font: 500 12px var(--mono); letter-spacing: .42em; color: var(--muted); margin-top: 18px; }
.logo .tag b { color: var(--amber); font-weight: 500; }
.title-meta { margin-top: 26px; display: flex; gap: 22px; flex-wrap: wrap; font: 500 11px var(--mono); letter-spacing: .2em; color: var(--muted); }
.title-meta b { color: var(--text); font-weight: 600; }
.title-menu .btn { font-size: 16px; }
.title-foot { position: absolute; left: 50%; bottom: max(12px, var(--safe-b)); transform: translateX(-50%); font: 10px var(--mono); letter-spacing: .25em; color: rgba(142,163,184,.6); white-space: nowrap; pointer-events: none; }

.diff { display: grid; gap: 8px; }
.diff .btn b { font-weight: 700; }
.diff .btn .chip { float: right; font: 600 10px var(--mono); letter-spacing: .15em; padding: 2px 6px; border: 1px solid currentColor; }

/* settings */
.set { display: grid; gap: 12px; margin-top: 6px; max-height: min(58vh, 520px); overflow-y: auto; padding-right: 6px; }
.set label { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; font-size: 13px; letter-spacing: .12em; }
.set label span.v { font: 12px var(--mono); color: var(--signal); min-width: 44px; text-align: right; }
.set input[type=range] { grid-column: 1 / -1; width: 100%; accent-color: #7fe6ff; height: 26px; }
.set select { font: 13px var(--mono); background: #0b121c; color: var(--text); border: 1px solid var(--line); padding: 6px 8px; }
.toggle { width: 46px; height: 24px; border-radius: 12px; background: rgba(160,220,255,.15); position: relative; border: 1px solid var(--line); cursor: pointer; }
.toggle::after { content: ''; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted); transition: left .15s, background .15s; }
.toggle.on { background: rgba(127,230,255,.35); } .toggle.on::after { left: 25px; background: #fff; }
.set h4 { font: 600 10px var(--mono); letter-spacing: .35em; color: var(--muted); margin-top: 6px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }

/* controls */
.ctl { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 16px; font-size: 12px; margin-top: 8px; }
.ctl div { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px dashed rgba(160,220,255,.12); }
.ctl kbd { font: 600 11px var(--mono); color: var(--signal); }
.tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.tabs button { flex: 1; font: 600 11px var(--mono); letter-spacing: .2em; padding: 8px; background: transparent; color: var(--muted); border: 1px solid var(--line); cursor: pointer; }
.tabs button.on { color: #fff; border-color: var(--signal); background: rgba(127,230,255,.1); }

/* augments */
.aug-wrap { width: min(1000px, 100%); text-align: center; margin: auto; }
.aug-wrap .kick { font: 500 11px var(--mono); letter-spacing: .4em; color: var(--signal); }
.aug-wrap h2 { font-weight: 700; font-size: clamp(22px, 3.6vw, 34px); letter-spacing: .25em; margin: 6px 0 4px; }
.aug-wrap .sub { font: 12px var(--mono); color: var(--muted); letter-spacing: .1em; }
.augs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 22px; }
.aug { --rc: #9fd8ff; text-align: left; background: linear-gradient(180deg, rgba(14,22,34,.95), rgba(6,10,16,.96)); border: 1px solid rgba(160,220,255,.18); padding: 18px 18px 16px; cursor: pointer; position: relative; clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px)); transition: transform .15s, border-color .15s, background .15s; opacity: 0; transform: translateY(14px); animation: augIn .45s ease forwards; font-family: var(--display); color: var(--text); }
.aug:nth-child(2) { animation-delay: .08s; } .aug:nth-child(3) { animation-delay: .16s; }
@keyframes augIn { to { opacity: 1; transform: none; } }
.aug:hover, .aug.focus, .aug:focus-visible { border-color: var(--rc); background: linear-gradient(180deg, rgba(20,32,48,.98), rgba(8,14,22,.98)); transform: translateY(-3px); outline: none; }
.aug::before { content: ''; position: absolute; left: 0; top: 0; right: 0; height: 3px; background: var(--rc); box-shadow: 0 0 12px var(--rc); }
.aug .rar { font: 600 10px var(--mono); letter-spacing: .3em; color: var(--rc); }
.aug .ico { width: 44px; height: 44px; margin: 12px 0 10px; color: var(--rc); filter: drop-shadow(0 0 8px var(--rc)); }
.aug .ico svg { width: 100%; height: 100%; }
.aug h4 { font-weight: 700; font-size: 17px; letter-spacing: .08em; }
.aug p { font-size: 13px; line-height: 1.45; color: #b8c8d8; margin-top: 8px; min-height: 38px; }
.aug .stack { font: 10px var(--mono); color: var(--muted); margin-top: 10px; letter-spacing: .15em; }
.aug .key { position: absolute; right: 14px; top: 12px; font: 600 10px var(--mono); color: var(--muted); border: 1px solid var(--line); padding: 1px 6px; }
.unlock { margin: 16px auto 0; display: inline-flex; gap: 12px; align-items: center; padding: 10px 16px; border: 1px solid rgba(255,210,87,.5); background: rgba(255,210,87,.08); font: 600 12px var(--mono); letter-spacing: .2em; color: var(--gold); }
.owned { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.owned span { font: 10px var(--mono); letter-spacing: .1em; padding: 3px 8px; border: 1px solid var(--line); color: var(--muted); }
.skip { margin-top: 14px; background: none; border: none; color: var(--muted); font: 11px var(--mono); letter-spacing: .25em; cursor: pointer; }

.end h1 { font-weight: 700; font-size: clamp(24px, 4.6vw, 46px); letter-spacing: .14em; text-indent: .14em; text-align: center; white-space: nowrap; }
.end.dead h1 { color: #ff8a9a; text-shadow: 0 0 30px rgba(255,59,92,.5); }
.end.win h1 { color: #fff1c8; text-shadow: 0 0 30px rgba(255,210,87,.5); }
.end .kick { text-align: center; }
.end .rankbig { text-align: center; font-weight: 700; font-style: italic; font-size: 64px; line-height: 1; margin-top: 4px; text-shadow: 0 0 24px currentColor; }
.end .quote { text-align: center; font-size: 14px; color: #b8c8d8; margin: 10px auto 0; max-width: 46ch; line-height: 1.5; }

.rotate { position: absolute; inset: 0; display: none; place-items: center; background: rgba(4,6,11,.94); pointer-events: auto; text-align: center; z-index: 5; padding: 24px; }
.rotate.on { display: grid; }
.rotate .ph { width: 56px; height: 92px; border: 3px solid var(--signal); border-radius: 10px; margin: 0 auto 18px; animation: rot 1.8s ease-in-out infinite; }
@keyframes rot { 0%, 30% { transform: rotate(0); } 60%, 100% { transform: rotate(-90deg); } }
.rotate p { font-size: 15px; letter-spacing: .15em; } .rotate button { margin-top: 18px; background: none; border: 1px solid var(--line); color: var(--muted); font: 11px var(--mono); letter-spacing: .2em; padding: 8px 14px; }

.confirm { margin-top: 12px; padding: 12px; border: 1px solid rgba(255,59,92,.4); background: rgba(255,59,92,.06); font-size: 13px; }

@media (max-width: 760px), (max-height: 500px) {
  .title-wrap { grid-template-columns: 1fr; gap: 14px; }
  .logo .word { font-size: min(14.5cqw, 76px); }
  .logo .tag { margin-top: 10px; font-size: 10px; }
  .title-meta { margin-top: 12px; }
  .panel { padding: 18px 18px 16px; }
  .btn { padding: 11px 14px; font-size: 14px; }
  .augs { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .aug { padding: 12px; } .aug .ico { width: 30px; height: 30px; margin: 6px 0; } .aug h4 { font-size: 14px; } .aug p { font-size: 11.5px; min-height: 0; }
  .aug .key { display: none; }
  .style .rank { font-size: 44px; }
}
@media (max-height: 500px) and (orientation: landscape) {
  .title-wrap { grid-template-columns: 1.1fr 1fr; gap: 18px; }
  .logo .word { font-size: min(14.5cqw, 72px); }
  .title-menu .btn { padding: 9px 12px; margin-top: 6px; font-size: 13px; }
  .title-menu .btn small { display: none; }
  .aug-wrap h2 { margin: 2px 0; } .aug-wrap .sub { display: none; }
  .end h1 { font-size: 26px; } .end .rankbig { font-size: 40px; }
  .set { grid-template-columns: 1fr 1fr; column-gap: 26px; max-height: 60vh; }
  .set h4 { grid-column: 1 / -1; }
  .stats { margin: 8px 0 4px; } .stats b { font-size: 16px; } .stats div { padding: 6px 10px; }
}
@media (max-width: 560px) and (orientation: portrait) {
  .augs { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .ann.show, .card.show, .newfoe.show { animation-duration: .01s; animation-delay: 0s; opacity: 1; }
  .aug { animation: none; opacity: 1; transform: none; }
}
`;
