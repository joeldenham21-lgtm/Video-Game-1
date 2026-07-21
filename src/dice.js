// ============================================================================
// ELDERFALL — dice.js (next-level wave: DICE)
// Witcher-1-style dice poker. A carved tavern table sits beside Bram's post
// in Emberhollow (and a worn dice mat waits at Fenwick's roadside stall).
// Interact → a short invite dialogue → a parchment-and-felt panel: 5 dice
// each, selectable ante (10/25/50g), one reroll round with hold-toggles, an
// EV-playing opponent with personality taunts, CSS-tumbled dice, rattle sfx,
// escrowed gold through g.player.addGold, record in g.flags.dice = {w,l,gold}.
// g.paused is held while the table is open. Both hands are always face-up and
// named/ranked so losing feels fair. After dusk (dayFrac >0.76 or <0.22) the
// game follows Bram into the Ember Hearth: the outdoor table sleeps and a
// 'Dice by the fire' interactable wakes at the buried taproom's fireside
// table (spot published by structures on g.emberHearth).
// Owns only itself: no other src module is imported (contract rule).
// ============================================================================
import * as THREE from 'three';
import { terrainHeight } from './core.js';

export function createDice(g) {
  const ev = g.events;
  const sfx = (n, o) => { if (g.audio && g.audio.play) g.audio.play(n, o); };
  const rec = () => {
    if (!g.flags.dice) g.flags.dice = { w: 0, l: 0, gold: 0 };
    return g.flags.dice;
  };

  // ==========================================================================
  // Hand evaluation — Witcher dice-poker ranking.
  // tier: 8 five-of-a-kind, 7 four, 6 full house, 5 six-high straight,
  //       4 five-high straight, 3 three, 2 two pairs, 1 pair, 0 nothing.
  // Returns { tier, score, name, part: bool[5] (dice that form the hand) }.
  // ==========================================================================
  const NUMW = ['', 'Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes'];
  const ONEW = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

  function evalHand(d) {
    const cnt = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) cnt[d[i]]++;
    let five = 0, four = 0, three = 0;
    const pairs = [], singles = [];
    for (let v = 6; v >= 1; v--) {
      if (cnt[v] === 5) five = v;
      else if (cnt[v] === 4) four = v;
      else if (cnt[v] === 3) three = v;
      else if (cnt[v] === 2) pairs.push(v);
      else if (cnt[v] === 1) singles.push(v);
    }
    let tier, sig, name, partVals;
    if (five) {
      tier = 8; sig = [five]; name = 'Five ' + NUMW[five] + '!'; partVals = [five];
    } else if (four) {
      tier = 7; sig = [four, singles[0] || 0]; name = 'Four ' + NUMW[four]; partVals = [four];
    } else if (three && pairs.length) {
      tier = 6; sig = [three, pairs[0]];
      name = 'Full House — ' + NUMW[three] + ' over ' + NUMW[pairs[0]];
      partVals = [three, pairs[0]];
    } else if (singles.length === 5 && cnt[1] === 0) {
      tier = 5; sig = [6]; name = 'Six-High Straight'; partVals = [2, 3, 4, 5, 6];
    } else if (singles.length === 5 && cnt[6] === 0) {
      tier = 4; sig = [5]; name = 'Five-High Straight'; partVals = [1, 2, 3, 4, 5];
    } else if (three) {
      tier = 3; sig = [three].concat(singles); name = 'Three ' + NUMW[three]; partVals = [three];
    } else if (pairs.length === 2) {
      tier = 2; sig = [pairs[0], pairs[1], singles[0] || 0];
      name = 'Two Pairs — ' + NUMW[pairs[0]] + ' & ' + NUMW[pairs[1]];
      partVals = [pairs[0], pairs[1]];
    } else if (pairs.length === 1) {
      tier = 1; sig = [pairs[0]].concat(singles); name = 'Pair of ' + NUMW[pairs[0]];
      partVals = [pairs[0]];
    } else {
      tier = 0; sig = singles; name = ONEW[singles[0]] + ' High'; partVals = [singles[0]];
    }
    let score = tier;
    for (let k = 0; k < 5; k++) score = score * 7 + (sig[k] || 0);
    const part = [false, false, false, false, false];
    for (let i = 0; i < 5; i++) part[i] = partVals.indexOf(d[i]) >= 0;
    return { tier, score, name, part };
  }

  // ==========================================================================
  // Opponent AI — simple EV: keep made hands, keep pairs and better, chase
  // open four-to-a-straight, otherwise keep a lone six for the tiebreak.
  // ==========================================================================
  function aiHolds(d, out) {
    for (let i = 0; i < 5; i++) out[i] = false;
    const cnt = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) cnt[d[i]]++;
    const h = evalHand(d);
    if (h.tier === 8 || h.tier === 6 || h.tier === 5 || h.tier === 4) {
      for (let i = 0; i < 5; i++) out[i] = true;            // made hand: stand pat
      return out;
    }
    if (h.tier === 7) {                                     // four: chase the fifth
      let quad = 0;
      for (let v = 6; v >= 1; v--) if (cnt[v] === 4) quad = v;
      for (let i = 0; i < 5; i++) out[i] = d[i] === quad;
      return out;
    }
    if (h.tier === 3) {                                     // trips: keep the three
      let t = 0;
      for (let v = 6; v >= 1; v--) if (cnt[v] === 3) t = v;
      for (let i = 0; i < 5; i++) out[i] = d[i] === t;
      return out;
    }
    if (h.tier === 2) {                                     // two pairs: chase the boat
      for (let i = 0; i < 5; i++) out[i] = cnt[d[i]] === 2;
      return out;
    }
    if (h.tier === 1) {                                     // pair: keep it, roll three
      let p = 0;
      for (let v = 6; v >= 1; v--) if (cnt[v] === 2) p = v;
      for (let i = 0; i < 5; i++) out[i] = d[i] === p;
      return out;
    }
    // Nothing: four to a straight? (prefer the higher run)
    const RUNS = [[3, 4, 5, 6], [2, 3, 4, 5], [1, 2, 3, 4]];
    for (const run of RUNS) {
      let ok = true;
      for (const v of run) if (!cnt[v]) { ok = false; break; }
      if (!ok) continue;
      const seen = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 5; i++) {
        if (run.indexOf(d[i]) >= 0 && !seen[d[i]]) { seen[d[i]] = 1; out[i] = true; }
      }
      return out;
    }
    for (let i = 0; i < 5; i++) if (d[i] === 6) { out[i] = true; break; } // tiebreak six
    return out;
  }

  // ==========================================================================
  // Taunts — Bram (jovial innkeeper, debts and barrels) & Fenwick (merchant).
  // Keys are from the OPPONENT's point of view (win = opponent won the pot).
  // ==========================================================================
  const LINES = {
    bram: {
      open: [
        'Sit down, sit down. The dice are the only honest things in this inn — myself included.',
        'Ale loosens tongues, dice loosen purses. Choose your ante, friend.',
      ],
      roll: [
        'Hold the good ones, roll the rest, and pray louder than the man across the table.',
        'I learned this game off a Redfang man. It cost me the cellar key to learn it proper.',
        'The cellar is full of barrels I won at this table. And two I lost.',
      ],
      bighand: [
        'Would you look at that! The dice love an innkeeper — everyone owes him something.',
      ],
      win: [
        'Ha! Straight into the strongbox. Vargr can have THAT coin when he pries up the floorboards.',
        'Don’t sulk. Losers drink at half price — tonight only, mind.',
        'Every coin of it goes to an honest cause: me.',
      ],
      lose: [
        'Bah — take it. Coin never stays in this inn longer than a traveler anyway.',
        'You’ve a gambler’s wrists and a hangman’s patience. Well won.',
      ],
      draw: [
        'A push! The mountain splits us even. Roll again before our luck notices.',
      ],
    },
    fenwick: {
      open: [
        'Sit, sit — the road is long and the margins are thin. Let’s make them thinner for one of us.',
      ],
      roll: ['I once diced a troll out of half his toll. True story. Mostly.'],
      bighand: ['Oh-ho! A hand like that ought to be taxed.'],
      win: ['Commerce, friend! The pot simply prefers a merchant’s pocket.'],
      lose: ['Take it, take it — a free sample of my luck. Refills cost extra.'],
      draw: ['Even? Terrible outcome. Nobody profits — the worst crime I know.'],
    },
  };
  const OPP_NAME = { bram: 'Bram', fenwick: 'Fenwick' };
  const OPP_SUB = {
    bram: 'with Bram · innkeeper of Emberhollow',
    fenwick: 'with Fenwick · wandering merchant',
  };

  // ==========================================================================
  // 3D props — one merged-geometry mesh each (1 draw call): a carved dice
  // table with stools by Bram's post, and Fenwick's roadside dice mat.
  // ==========================================================================
  const propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  function bake(parts) {
    const pos = [], nor = [], col = [];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    const c = new THREE.Color();
    for (const p of parts) {
      const gg = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      E.set(p.rx || 0, p.ry || 0, p.rz || 0);
      Q.setFromEuler(E);
      P.set(p.x || 0, p.y || 0, p.z || 0);
      const s = p.s || 1;
      S.set(s, s, s);
      M.compose(P, Q, S);
      gg.applyMatrix4(M);
      c.set(p.color);
      const pa = gg.getAttribute('position'), na = gg.getAttribute('normal');
      for (let i = 0; i < pa.count; i++) {
        pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
        nor.push(na.getX(i), na.getY(i), na.getZ(i));
        col.push(c.r, c.g, c.b);
      }
      if (gg !== p.geo) gg.dispose();
      p.geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, propMat);
    mesh.castShadow = !!(g.quality && g.quality.shadows);
    mesh.receiveShadow = true;
    return mesh;
  }

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, n) => new THREE.CylinderGeometry(rt, rb, h, n);

  const W_DARK = 0x54391f, W_MID = 0x76522e, FELT = 0x2c5a37;
  const IVORY = 0xe9dfc2, GOLD = 0xd9b45a, LEATHER = 0x6b3f26;

  // --- Bram's table (beside his post at the inn-side of the square) ---------
  const TBL = { x: -13.4, z: -17.2 };
  TBL.ry = Math.atan2(-9 - TBL.x, -13 - TBL.z); // long side squares up to Bram
  {
    const gy = terrainHeight(TBL.x, TBL.z);
    const parts = [
      // legs + top + rim
      { geo: box(0.09, 0.76, 0.09), x: 0.62, y: 0.38, z: 0.34, color: W_DARK },
      { geo: box(0.09, 0.76, 0.09), x: -0.62, y: 0.38, z: 0.34, color: W_DARK },
      { geo: box(0.09, 0.76, 0.09), x: 0.62, y: 0.38, z: -0.34, color: W_DARK },
      { geo: box(0.09, 0.76, 0.09), x: -0.62, y: 0.38, z: -0.34, color: W_DARK },
      { geo: box(1.7, 0.08, 1.06), x: 0, y: 0.79, z: 0, color: W_MID },
      { geo: box(1.7, 0.05, 0.07), x: 0, y: 0.845, z: 0.5, color: W_DARK },
      { geo: box(1.7, 0.05, 0.07), x: 0, y: 0.845, z: -0.5, color: W_DARK },
      { geo: box(0.07, 0.05, 0.94), x: 0.815, y: 0.845, z: 0, color: W_DARK },
      { geo: box(0.07, 0.05, 0.94), x: -0.815, y: 0.845, z: 0, color: W_DARK },
      // felt inset
      { geo: box(1.48, 0.026, 0.84), x: 0, y: 0.835, z: 0, color: FELT },
      // leather dice cup + scattered dice + coin stacks
      { geo: cyl(0.09, 0.115, 0.22, 7), x: 0.5, y: 0.95, z: 0.24, rz: 0.06, color: LEATHER },
      { geo: box(0.09, 0.09, 0.09), x: -0.26, y: 0.895, z: 0.1, ry: 0.5, color: IVORY },
      { geo: box(0.09, 0.09, 0.09), x: -0.06, y: 0.895, z: -0.19, ry: 1.1, color: IVORY },
      { geo: box(0.09, 0.09, 0.09), x: 0.13, y: 0.895, z: 0.2, ry: 0.2, color: IVORY },
      { geo: cyl(0.07, 0.07, 0.06, 8), x: -0.46, y: 0.88, z: -0.24, color: GOLD },
      { geo: cyl(0.07, 0.07, 0.11, 8), x: 0.37, y: 0.905, z: -0.27, color: GOLD },
      // two stools
      { geo: cyl(0.23, 0.2, 0.07, 7), x: 1.2, y: 0.52, z: 0, color: W_MID },
      { geo: cyl(0.05, 0.07, 0.5, 5), x: 1.2, y: 0.25, z: 0, color: W_DARK },
      { geo: cyl(0.23, 0.2, 0.07, 7), x: -1.2, y: 0.52, z: 0, color: W_MID },
      { geo: cyl(0.05, 0.07, 0.5, 5), x: -1.2, y: 0.25, z: 0, color: W_DARK },
    ];
    const mesh = bake(parts);
    mesh.position.set(TBL.x, gy, TBL.z);
    mesh.rotation.y = TBL.ry;
    g.scene.add(mesh);
    g.colliders.push({ x: TBL.x, z: TBL.z, r: 0.95 });
    g.interactables.push({
      pos: new THREE.Vector3(TBL.x, gy + 0.9, TBL.z),
      radius: 3.2,
      label: '🎲 Dice Poker — Bram',
      onInteract: () => invite('bram'),
      // Bram's evenings belong to the Ember Hearth — the game moves inside.
      enabled: () => !g.paused && !hearthNight(),
    });
  }

  // --- Dice by the fire: after dusk the game relocates into the Ember
  //     Hearth (structures.js buries the tavern interior and publishes
  //     g.emberHearth; the fireside-table spot streams in via update()) ------
  const hearthNight = () => {
    const f = g.time.dayFrac;
    return f > 0.76 || f < 0.22;
  };
  const hearthPos = new THREE.Vector3(0, -9999, 0);
  let hearthPosSet = false;
  g.interactables.push({
    pos: hearthPos,
    radius: 3.0,
    label: '🎲 Dice by the fire',
    onInteract: () => invite('bram'),
    enabled: () => !g.paused && hearthPosSet && hearthNight(),
  });

  // --- Fenwick's dice mat (his stall at the village edge; he plays only
  //     while he's stopped there — his road walk is a function of dayFrac) ---
  const MAT = { x: 18.2, z: -24.6 };
  {
    const gy = terrainHeight(MAT.x, MAT.z);
    const parts = [
      { geo: box(0.95, 0.03, 0.72), x: 0, y: 0.03, z: 0, color: 0x7a4a33 },
      { geo: box(0.09, 0.09, 0.09), x: -0.18, y: 0.09, z: 0.08, ry: 0.7, color: IVORY },
      { geo: box(0.09, 0.09, 0.09), x: 0.08, y: 0.09, z: -0.12, ry: 1.3, color: IVORY },
      { geo: box(0.09, 0.09, 0.09), x: 0.22, y: 0.09, z: 0.14, ry: 0.25, color: IVORY },
      { geo: cyl(0.07, 0.07, 0.08, 8), x: -0.3, y: 0.09, z: -0.18, color: GOLD },
      { geo: box(0.44, 0.4, 0.44), x: 0.75, y: 0.2, z: -0.35, ry: 0.4, color: 0x7a5a34 },
    ];
    const mesh = bake(parts);
    mesh.position.set(MAT.x, gy, MAT.z);
    mesh.rotation.y = -0.5;
    g.scene.add(mesh);
    const fenResting = () => {
      const f = g.time.dayFrac;
      return f < 0.30 || f >= 0.74; // stalled at the village edge (economy.js schedule)
    };
    g.interactables.push({
      pos: new THREE.Vector3(MAT.x, gy + 0.6, MAT.z),
      radius: 3.0,
      label: '🎲 Dice Poker — Fenwick',
      onInteract: () => invite('fenwick'),
      enabled: () => !g.paused && fenResting(),
    });
  }

  // ==========================================================================
  // Invite dialogue — routes through ui.openDialogue so pointer lock / pause
  // hand-off matches every other vendor panel (economy.js pattern).
  // ==========================================================================
  function invite(id) {
    if (!g.ui || !g.ui.openDialogue) return;
    const npc = (id === 'bram' && g.quests && g.quests.npcs && g.quests.npcs.bram)
      ? g.quests.npcs.bram
      : { name: OPP_NAME[id] };
    if (npc.talking !== undefined) npc.talking = true;
    const deal = { label: 'Deal me in.', next: null, do: () => setTimeout(() => open(id), 60) };
    const tree = {
      start: 'start',
      nodes: {
        start: {
          text: id === 'bram'
            ? 'You’ve the look of a gambler about you, friend. Five dice, poker hands, one ' +
              'reroll each — winner takes the pot. The table’s older than the inn and twice as honest.'
            : 'A game between travelers keeps the road short — five dice, one reroll, honest gold. ' +
              'My cups were never weighted. The dice… well, roll them and see.',
          choices: [
            deal,
            { label: 'How’s it played?', next: 'rules' },
            { label: 'Another time.', next: null },
          ],
        },
        rules: {
          text: 'Five dice each, both hands face-up. We roll, keep what we like, roll the rest once ' +
            'more. Pairs, straights, full houses — ranked same as card poker. Best hand sweeps the ' +
            'antes. Simple as falling off a stool.',
          choices: [deal, { label: 'Another time.', next: null }],
        },
      },
    };
    ev.emit('dialogueStart', { npc, node: tree.start });
    g.ui.openDialogue(npc, tree);
  }

  // ==========================================================================
  // Panel DOM + CSS — parchment-framed wood, stitched felt, tumbling dice.
  // ==========================================================================
  const style = document.createElement('style');
  style.textContent = `
#ef-diceroot{position:fixed;inset:0;z-index:39;display:none;pointer-events:auto;
  font-family:Georgia,'Times New Roman',serif;-webkit-tap-highlight-color:transparent;
  --dsz:clamp(38px,8.6vmin,58px);}
#ef-diceroot.on{display:block;}
#ef-diceroot *{box-sizing:border-box;-webkit-user-select:none;user-select:none;}
#ef-dicedim{position:absolute;inset:0;opacity:0;transition:opacity .22s ease;
  background:radial-gradient(ellipse at center,rgba(10,7,4,.5),rgba(6,4,2,.82));}
#ef-diceroot.on #ef-dicedim{opacity:1;}
#ef-dicewrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);opacity:0;
  width:min(94vw,620px);max-height:min(94dvh,620px);display:flex;flex-direction:column;
  border-radius:9px;padding:12px 14px 10px;overflow:hidden;
  background:linear-gradient(168deg,#5c4326,#43301a 55%,#33230f);
  border:1px solid #a3813f;
  box-shadow:0 0 0 3px rgba(26,18,10,.9),0 0 0 4px rgba(217,180,106,.45),0 18px 60px rgba(0,0,0,.78);
  transition:transform .2s ease,opacity .2s ease;}
#ef-diceroot.on #ef-dicewrap{transform:translate(-50%,-50%) scale(1);opacity:1;}
#ef-dicewrap::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:9px;
  background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.35) 100%);}
#ef-dicex{position:absolute;top:6px;right:8px;z-index:3;width:34px;height:34px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;border-radius:50%;color:#d9b46a;font-size:15px;
  border:1px solid rgba(163,129,63,.7);
  background:radial-gradient(circle at 35% 30%,rgba(60,44,24,.95),rgba(28,20,11,.95));}
#ef-dicex:active{transform:scale(.92);}
#ef-dicehead{flex:none;text-align:center;padding:0 34px;}
#ef-dicetitle{color:#d9b46a;font-size:16px;letter-spacing:.22em;text-transform:uppercase;
  text-shadow:0 1px 2px rgba(0,0,0,.7);}
#ef-dicesub{color:#b39a6b;font-style:italic;font-size:11.5px;margin-top:1px;}
#ef-dicerec{color:#8a7550;font-size:10.5px;letter-spacing:.12em;margin-top:2px;text-transform:uppercase;}
#ef-dicetaunt{flex:none;text-align:center;color:#e6d7b2;font-style:italic;font-size:12.5px;
  line-height:1.35;padding:6px 26px 7px;min-height:1.5em;opacity:.92;}
#ef-dicetaunt.pop{animation:ef-dtaunt .45s ease;}
@keyframes ef-dtaunt{0%{opacity:0;transform:translateY(3px);}100%{opacity:.92;transform:none;}}
#ef-dicefelt{flex:1;min-height:0;position:relative;border-radius:14px;padding:10px 12px;
  display:flex;flex-direction:column;justify-content:space-between;gap:4px;
  background:radial-gradient(ellipse at 50% 42%,#31654428,transparent),
    radial-gradient(ellipse at 50% 40%,#2e6041,#1f4630 58%,#16331f);
  border:1px solid #0f2416;
  box-shadow:inset 0 0 0 2px rgba(217,180,106,.22),inset 0 2px 26px rgba(0,0,0,.55);}
#ef-dicefelt::before{content:'';position:absolute;inset:7px;border-radius:9px;pointer-events:none;
  border:1px dashed rgba(217,180,106,.28);}
#ef-dicefelt::after{content:'\\2684';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  font-size:76px;color:#000;opacity:.14;pointer-events:none;line-height:1;}
.ef-dside{position:relative;z-index:1;}
.ef-dlabel{display:flex;justify-content:center;align-items:baseline;gap:12px;min-height:17px;}
.ef-dlabel .nm{color:#d9b46a;font-size:11px;letter-spacing:.2em;text-transform:uppercase;}
.ef-dlabel .hand{color:#efe4c8;font-style:italic;font-size:12.5px;text-shadow:0 1px 2px rgba(0,0,0,.6);}
.ef-drow{display:flex;justify-content:center;gap:clamp(6px,1.4vmin,12px);padding:5px 0;perspective:420px;}
#ef-dopprow{padding-top:16px;}
#ef-dyourow{padding-bottom:17px;}
.ef-die{position:relative;width:var(--dsz);height:var(--dsz);border-radius:16%;flex:none;
  display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);
  padding:calc(var(--dsz)*.12);cursor:default;
  background:linear-gradient(145deg,#f7f0da,#e3d7b4 60%,#cbbc92);
  box-shadow:0 3px 7px rgba(0,0,0,.55),inset 0 1px 2px rgba(255,255,255,.75),inset 0 -2px 4px rgba(0,0,0,.2);
  transition:transform .16s ease,box-shadow .16s ease,opacity .2s ease;}
.ef-die i{width:68%;height:68%;border-radius:50%;align-self:center;justify-self:center;opacity:0;
  background:radial-gradient(circle at 36% 30%,#4a3524,#221207 70%);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.65),0 1px 0 rgba(255,255,255,.3);}
.ef-die i.on{opacity:1;}
.ef-die.opp{background:linear-gradient(145deg,#8a3a2c,#5c1f18 60%,#411310);
  box-shadow:0 3px 7px rgba(0,0,0,.55),inset 0 1px 2px rgba(255,170,130,.35),inset 0 -2px 4px rgba(0,0,0,.35);}
.ef-die.opp i{background:radial-gradient(circle at 36% 30%,#fdf6e0,#cfc19b 70%);
  box-shadow:inset 0 -1px 2px rgba(0,0,0,.3),0 1px 1px rgba(0,0,0,.35);}
.ef-die.idle{opacity:.55;}
.ef-die.held{transform:translateY(-7px);outline:2px solid #ffd98a;outline-offset:1px;
  box-shadow:0 7px 12px rgba(0,0,0,.55),0 0 14px rgba(255,214,138,.55),inset 0 1px 2px rgba(255,255,255,.75);}
.ef-die.held::after{content:'HELD';position:absolute;left:50%;bottom:-15px;transform:translateX(-50%);
  font-size:8px;letter-spacing:.24em;color:#ffd98a;text-shadow:0 1px 2px rgba(0,0,0,.8);}
.ef-die.keep::after{content:'KEEPS';position:absolute;left:50%;top:-15px;transform:translateX(-50%);
  font-size:8px;letter-spacing:.22em;color:#e8b7a0;text-shadow:0 1px 2px rgba(0,0,0,.8);}
.ef-die.kick{filter:saturate(.6) brightness(.65);}
.ef-die.roll{animation:ef-dtumble .68s cubic-bezier(.32,.6,.35,1) both;}
@keyframes ef-dtumble{
  0%{transform:translateY(0) rotate(0deg) scale(1);}
  22%{transform:translateY(-24px) rotate(150deg) scale(1.09);}
  45%{transform:translateY(3px) rotate(290deg) scale(.95);}
  66%{transform:translateY(-9px) rotate(415deg) scale(1.05);}
  86%{transform:translateY(2px) rotate(505deg) scale(.99);}
  100%{transform:translateY(0) rotate(540deg) scale(1);}}
#ef-diceroot[data-state="hold"] #ef-dyourow .ef-die{cursor:pointer;}
#ef-diceroot[data-state="hold"] #ef-dyourow .ef-die:hover{box-shadow:0 3px 7px rgba(0,0,0,.55),
  0 0 10px rgba(255,214,138,.4),inset 0 1px 2px rgba(255,255,255,.75);}
.winrow .ef-die:not(.kick){animation:ef-dwin .85s ease 2;}
@keyframes ef-dwin{0%,100%{box-shadow:0 3px 7px rgba(0,0,0,.55);}
  50%{box-shadow:0 3px 7px rgba(0,0,0,.4),0 0 20px 5px rgba(255,214,138,.75);}}
.loserow .ef-die:not(.kick){filter:saturate(.75) brightness(.82);}
#ef-dicemid{position:relative;z-index:1;text-align:center;min-height:36px;
  display:flex;flex-direction:column;justify-content:center;gap:1px;}
#ef-dicepot{color:#c9b585;font-size:10.5px;letter-spacing:.26em;text-transform:uppercase;
  text-shadow:0 1px 2px rgba(0,0,0,.6);}
#ef-diceres{font-size:clamp(15px,2.4vmin,19px);min-height:0;color:#efe4c8;letter-spacing:.04em;
  text-shadow:0 1px 3px rgba(0,0,0,.8);}
#ef-diceres.win{color:#ffd98a;text-shadow:0 0 14px rgba(255,214,138,.6),0 1px 3px rgba(0,0,0,.8);}
#ef-diceres.lose{color:#d98a7a;}
#ef-diceres.go{animation:ef-dres .5s cubic-bezier(.2,1.4,.4,1);}
@keyframes ef-dres{0%{opacity:0;transform:scale(.6);}100%{opacity:1;transform:scale(1);}}
#ef-diceressub{color:#b8c9ae;font-style:italic;font-size:11.5px;min-height:0;
  text-shadow:0 1px 2px rgba(0,0,0,.7);}
.ef-dcoin{position:absolute;left:50%;top:50%;width:11px;height:11px;border-radius:50%;z-index:2;
  background:radial-gradient(circle at 35% 30%,#ffe9a8,#d9b46a 55%,#8a6520);
  box-shadow:0 1px 3px rgba(0,0,0,.5);pointer-events:none;
  animation:ef-dcoinfly .95s cubic-bezier(.2,.7,.4,1) both;}
@keyframes ef-dcoinfly{0%{transform:translate(-50%,-50%) scale(.6);opacity:1;}
  70%{opacity:1;}100%{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(1);opacity:0;}}
#ef-dicefoot{flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:9px 2px calc(2px + env(safe-area-inset-bottom,0px));}
#ef-diceante{display:flex;align-items:center;gap:6px;}
#ef-diceante .cap{color:#8a7550;font-size:10px;letter-spacing:.2em;text-transform:uppercase;}
.ef-dchip{cursor:pointer;font-family:inherit;font-size:12.5px;color:#e8dcc0;width:42px;height:30px;
  border-radius:15px;border:1px solid #a3813f;
  background:linear-gradient(180deg,rgba(60,44,24,.95),rgba(34,24,13,.95));box-shadow:0 2px 5px rgba(0,0,0,.4);}
.ef-dchip.sel{color:#2c1e10;font-weight:bold;border-color:#e8cf8e;
  background:radial-gradient(circle at 35% 30%,#ffe9a8,#d9b46a 60%,#b28a3a);
  box-shadow:0 0 9px rgba(255,214,138,.45),0 2px 5px rgba(0,0,0,.4);}
.ef-dchip:disabled{opacity:.38;cursor:default;}
.ef-dchip:not(:disabled):active{transform:scale(.93);}
#ef-dicehint{flex:1;text-align:center;color:#8a7550;font-size:10.5px;font-style:italic;min-width:90px;}
#ef-dicegold{color:#e6d7b2;font-size:13.5px;display:flex;align-items:center;gap:6px;}
#ef-dicegold .coin{width:12px;height:12px;border-radius:50%;flex:none;
  background:radial-gradient(circle at 35% 30%,#ffe9a8,#d9b46a 55%,#8a6520);box-shadow:0 1px 2px rgba(0,0,0,.4);}
#ef-dicegold.no{animation:ef-dgoldno .3s ease;}
@keyframes ef-dgoldno{25%{transform:translateX(-3px);color:#d98a7a;}75%{transform:translateX(3px);color:#d98a7a;}}
#ef-dicego{cursor:pointer;font-family:inherit;color:#2c1e10;font-size:13px;letter-spacing:.12em;
  text-transform:uppercase;padding:8px 20px;border-radius:5px;border:1px solid #e8cf8e;
  background:radial-gradient(circle at 35% 25%,#ffe9a8,#d9b46a 60%,#b28a3a);
  box-shadow:0 0 10px rgba(255,214,138,.3),0 2px 6px rgba(0,0,0,.45);font-weight:bold;}
#ef-dicego:disabled{opacity:.42;cursor:default;box-shadow:none;}
#ef-dicego:not(:disabled):active{transform:scale(.95);}
#ef-diceleave{cursor:pointer;font-family:inherit;color:#e8dcc0;font-size:12px;letter-spacing:.12em;
  text-transform:uppercase;padding:8px 16px;border-radius:5px;border:1px solid #a3813f;
  background:linear-gradient(180deg,rgba(60,44,24,.95),rgba(34,24,13,.95));box-shadow:0 2px 6px rgba(0,0,0,.4);}
#ef-diceleave:active{transform:scale(.95);}
@media (max-height:460px){
  #ef-diceroot{--dsz:clamp(32px,7.4vmin,44px);}
  #ef-dicewrap{padding:8px 10px 6px;}
  #ef-dicetitle{font-size:13px;}
  #ef-dicetaunt{font-size:11px;padding:3px 22px 4px;}
  #ef-dicefelt{padding:6px 8px;}
  #ef-dicemid{min-height:26px;}
  #ef-dicefelt::after{font-size:52px;}
  .ef-drow{padding:3px 0;}
  #ef-dicefoot{padding:6px 2px 2px;}
}`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'ef-diceroot';
  root.innerHTML = `
<div id="ef-dicedim"></div>
<div id="ef-dicewrap">
  <div id="ef-dicex">✕</div>
  <div id="ef-dicehead">
    <div id="ef-dicetitle">Dice Poker</div>
    <div id="ef-dicesub"></div>
    <div id="ef-dicerec"></div>
  </div>
  <div id="ef-dicetaunt"></div>
  <div id="ef-dicefelt">
    <div class="ef-dside">
      <div class="ef-dlabel"><span class="nm" id="ef-doppnm"></span><span class="hand" id="ef-dopphand"></span></div>
      <div class="ef-drow" id="ef-dopprow"></div>
    </div>
    <div id="ef-dicemid">
      <span id="ef-dicepot"></span>
      <span id="ef-diceres"></span>
      <span id="ef-diceressub"></span>
    </div>
    <div class="ef-dside">
      <div class="ef-drow" id="ef-dyourow"></div>
      <div class="ef-dlabel"><span class="nm">You</span><span class="hand" id="ef-dyouhand"></span></div>
    </div>
  </div>
  <div id="ef-dicefoot">
    <div id="ef-diceante"><span class="cap">ante</span></div>
    <div id="ef-dicehint"></div>
    <div id="ef-dicegold"><span class="coin"></span><span id="ef-dicegoldn">0</span></div>
    <button id="ef-dicego">Roll</button>
    <button id="ef-diceleave">Leave</button>
  </div>
</div>`;
  document.body.appendChild(root);
  const $ = (id) => root.querySelector('#' + id);
  const elSub = $('ef-dicesub'), elRec = $('ef-dicerec'), elTaunt = $('ef-dicetaunt');
  const elOppNm = $('ef-doppnm'), elOppHand = $('ef-dopphand'), elYouHand = $('ef-dyouhand');
  const elOppRow = $('ef-dopprow'), elYouRow = $('ef-dyourow');
  const elPot = $('ef-dicepot'), elRes = $('ef-diceres'), elResSub = $('ef-diceressub');
  const elFelt = $('ef-dicefelt'), elHint = $('ef-dicehint');
  const elGold = $('ef-dicegold'), elGoldN = $('ef-dicegoldn');
  const elGo = $('ef-dicego'), elAnte = $('ef-diceante');

  // Dice elements: 9 pip cells each, values map to a 3×3 grid.
  const PIPS = {
    1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };
  function makeDie(row, opp) {
    const el = document.createElement('div');
    el.className = 'ef-die' + (opp ? ' opp' : '');
    for (let i = 0; i < 9; i++) el.appendChild(document.createElement('i'));
    row.appendChild(el);
    return el;
  }
  function setFace(el, v) {
    const on = PIPS[v] || PIPS[1];
    for (let i = 0; i < 9; i++) el.children[i].classList.toggle('on', on.indexOf(i) >= 0);
  }
  const oppEls = [], youEls = [];
  for (let i = 0; i < 5; i++) oppEls.push(makeDie(elOppRow, true));
  for (let i = 0; i < 5; i++) youEls.push(makeDie(elYouRow, false));

  // Ante chips
  const ANTES = [10, 25, 50];
  const chipEls = [];
  for (const a of ANTES) {
    const b = document.createElement('button');
    b.className = 'ef-dchip';
    b.textContent = a;
    b.addEventListener('click', () => {
      if (state !== 'ante' && state !== 'result') return;
      if (goldOf() < a) { goldNo(); return; }
      ante = a;
      sfx('uiClick');
      refresh();
    });
    elAnte.appendChild(b);
    chipEls.push(b);
  }

  // ==========================================================================
  // Game state
  // ==========================================================================
  let state = 'closed';       // closed | ante | rolling1 | hold | rolling2 | result
  let who = 'bram';
  let ante = 10, pot = 0, escrow = 0;
  const youD = [1, 2, 3, 4, 5], oppD = [5, 4, 3, 2, 1];
  const youHold = [false, false, false, false, false];
  const oppHold = [false, false, false, false, false];
  const rigQ = [];            // test hook: queued {you:[5], opp:[5]} rolls
  let flick = null;
  const timers = [];

  const goldOf = () => (g.player && g.player.stats ? g.player.stats.gold : 0);
  const roll = () => 1 + ((Math.random() * 6) | 0);
  const clampD = (v) => Math.min(6, Math.max(1, v | 0));

  function later(ms, fn) {
    const id = setTimeout(() => {
      const k = timers.indexOf(id);
      if (k >= 0) timers.splice(k, 1);
      fn();
    }, ms);
    timers.push(id);
  }
  function killTimers() {
    for (const id of timers) clearTimeout(id);
    timers.length = 0;
    if (flick) { clearInterval(flick); flick = null; }
  }

  function goldNo() {
    elGold.classList.remove('no');
    void elGold.offsetWidth;
    elGold.classList.add('no');
    sfx('uiClick');
  }

  function taunt(kind) {
    const pool = (LINES[who] && LINES[who][kind]) || null;
    if (!pool || !pool.length) return;
    elTaunt.textContent = '“' + pool[(Math.random() * pool.length) | 0] + '”';
    elTaunt.classList.remove('pop');
    void elTaunt.offsetWidth;
    elTaunt.classList.add('pop');
  }

  function clearHandVisuals() {
    for (let i = 0; i < 5; i++) {
      youEls[i].classList.remove('held', 'kick', 'roll', 'idle');
      oppEls[i].classList.remove('keep', 'kick', 'roll', 'idle');
      youEls[i].style.animationDelay = oppEls[i].style.animationDelay = '';
    }
    elOppRow.parentElement.classList.remove('winrow', 'loserow');
    elYouRow.parentElement.classList.remove('winrow', 'loserow');
    elOppHand.textContent = elYouHand.textContent = '';
    elRes.textContent = elResSub.textContent = '';
    elRes.className = '';
  }

  function refresh() {
    root.dataset.state = state;
    const gold = goldOf();
    const r = rec();
    elGoldN.textContent = gold;
    elRec.textContent = 'W ' + r.w + ' · L ' + r.l + ' · ' +
      (r.gold >= 0 ? '+' : '−') + Math.abs(r.gold) + 'g';
    elPot.textContent = pot > 0 ? '· pot ' + pot + ' gold ·' : '· ante ' + ante + ' gold ·';
    const canBet = state === 'ante' || state === 'result';
    for (let i = 0; i < ANTES.length; i++) {
      chipEls[i].disabled = !canBet || gold < ANTES[i];
      chipEls[i].classList.toggle('sel', ANTES[i] === ante);
    }
    let allHeld = true;
    for (let i = 0; i < 5; i++) if (!youHold[i]) allHeld = false;
    if (state === 'ante') {
      elGo.textContent = 'Roll';
      elGo.disabled = gold < ante;
      elHint.textContent = gold < 10 ? 'come back when your purse is heavier'
        : 'choose your ante, then roll';
    } else if (state === 'rolling1' || state === 'rolling2') {
      elGo.textContent = 'Rolling…';
      elGo.disabled = true;
      elHint.textContent = '';
    } else if (state === 'hold') {
      elGo.textContent = allHeld ? 'Stand' : 'Reroll the rest';
      elGo.disabled = false;
      elHint.textContent = 'tap your dice to hold them — ' + OPP_NAME[who] + ' keeps the marked dice';
    } else if (state === 'result') {
      elGo.textContent = 'Play again';
      elGo.disabled = gold < ante;
      elHint.textContent = gold < ante ? 'not enough gold for the ante' : 'another hand?';
    }
  }

  // --- open / close ----------------------------------------------------------
  function open(id) {
    if (state !== 'closed') return;
    who = id;
    state = 'ante';
    pot = 0; escrow = 0;
    g.paused = true;
    elSub.textContent = OPP_SUB[who];
    elOppNm.textContent = OPP_NAME[who];
    clearHandVisuals();
    for (let i = 0; i < 5; i++) {
      setFace(youEls[i], roll()); setFace(oppEls[i], roll());
      youEls[i].classList.add('idle'); oppEls[i].classList.add('idle');
      youHold[i] = oppHold[i] = false;
    }
    root.classList.add('on');
    sfx('wheelOpen');
    taunt('open');
    refresh();
  }

  function close() {
    if (state === 'closed') return;
    killTimers();
    if (escrow > 0 && g.player) { g.player.addGold(escrow); escrow = 0; } // mid-hand: ante returned
    state = 'closed';
    root.classList.remove('on');
    root.dataset.state = 'closed';
    g.paused = false;
    sfx('uiClick');
  }

  // --- rolling ----------------------------------------------------------------
  function animate(rollYou, rollOpp, done) {
    const rolling = [];
    for (let i = 0; i < 5; i++) {
      if (rollOpp[i]) rolling.push({ el: oppEls[i], d: oppD, i });
      if (rollYou[i]) rolling.push({ el: youEls[i], d: youD, i });
    }
    if (!rolling.length) { later(280, done); return; }
    sfx('uiClick');                       // the rattle ×3
    sfx('uiClick', { delay: 0.09 });
    sfx('uiClick', { delay: 0.18 });
    for (let k = 0; k < rolling.length; k++) {
      rolling[k].el.classList.add('roll');
      rolling[k].el.style.animationDelay = (k * 45) + 'ms';
    }
    flick = setInterval(() => {
      for (const r of rolling) {
        if (r.el.classList.contains('roll')) setFace(r.el, 1 + ((Math.random() * 6) | 0));
      }
    }, 85);
    for (let k = 0; k < rolling.length; k++) {
      const r = rolling[k];
      later(720 + k * 45, () => {
        r.el.classList.remove('roll');
        r.el.style.animationDelay = '';
        setFace(r.el, r.d[r.i]);
        if ((k & 1) === 0) sfx('uiClick');
      });
    }
    later(720 + rolling.length * 45 + 140, () => {
      if (flick) { clearInterval(flick); flick = null; }
      done();
    });
  }

  function startHand() {
    const pl = g.player;
    if (!pl || pl.stats.gold < ante) { goldNo(); return; }
    pl.addGold(-ante);                    // escrow: the ante leaves the purse now
    escrow = ante;
    pot = ante * 2;                       // opponent matches
    clearHandVisuals();
    for (let i = 0; i < 5; i++) { youHold[i] = oppHold[i] = false; }
    const rigd = rigQ.length ? rigQ.shift() : null;
    for (let i = 0; i < 5; i++) {
      youD[i] = rigd && rigd.you ? clampD(rigd.you[i]) : roll();
      oppD[i] = rigd && rigd.opp ? clampD(rigd.opp[i]) : roll();
    }
    state = 'rolling1';
    refresh();
    animate([1, 1, 1, 1, 1], [1, 1, 1, 1, 1], () => {
      state = 'hold';
      aiHolds(oppD, oppHold);
      const ho = evalHand(oppD), hy = evalHand(youD);
      elOppHand.textContent = ho.name;
      elYouHand.textContent = hy.name;
      for (let i = 0; i < 5; i++) {
        oppEls[i].classList.toggle('keep', oppHold[i]);
        oppEls[i].classList.toggle('kick', !ho.part[i]);
        youEls[i].classList.toggle('kick', !hy.part[i]);
      }
      taunt(ho.tier >= 4 ? 'bighand' : 'roll');
      refresh();
    });
  }

  function doReroll() {
    const rigd = rigQ.length ? rigQ.shift() : null;
    const ry = [0, 0, 0, 0, 0], ro = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) {
      if (!youHold[i]) {
        youD[i] = rigd && rigd.you ? clampD(rigd.you[i]) : roll();
        ry[i] = 1;
        youEls[i].classList.remove('kick');
      }
      if (!oppHold[i]) {
        oppD[i] = rigd && rigd.opp ? clampD(rigd.opp[i]) : roll();
        ro[i] = 1;
        oppEls[i].classList.remove('kick');
      }
    }
    state = 'rolling2';
    refresh();
    animate(ry, ro, settle);
  }

  function coinBurst() {
    for (let k = 0; k < 10; k++) {
      const s = document.createElement('span');
      s.className = 'ef-dcoin';
      const a = (k / 10) * Math.PI * 2 + Math.random() * 0.5;
      const r = 60 + Math.random() * 70;
      s.style.setProperty('--dx', (Math.cos(a) * r).toFixed(0) + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * r * 0.6 - 30).toFixed(0) + 'px');
      elFelt.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  function settle() {
    const hy = evalHand(youD), ho = evalHand(oppD);
    elYouHand.textContent = hy.name;
    elOppHand.textContent = ho.name;
    for (let i = 0; i < 5; i++) {
      youEls[i].classList.toggle('kick', !hy.part[i]);
      youEls[i].classList.remove('held');
      oppEls[i].classList.toggle('kick', !ho.part[i]);
      oppEls[i].classList.remove('keep');
    }
    const r = rec();
    let res;
    if (hy.score > ho.score) {
      if (g.player) g.player.addGold(pot);       // escrow + winnings
      r.w++; r.gold += ante;
      res = 'win';
    } else if (hy.score < ho.score) {
      r.l++; r.gold -= ante;
      res = 'lose';
    } else {
      if (g.player) g.player.addGold(ante);      // push: ante returned
      res = 'draw';
    }
    escrow = 0;
    state = 'result';
    // verdict — both hands named so a loss reads fair
    if (res === 'win') {
      elRes.textContent = 'You take the pot — ' + pot + ' gold';
      elRes.className = 'win go';
      elResSub.textContent = hy.name === ho.name
        ? hy.name + ' beats ' + ho.name + ' on higher dice'
        : hy.name + ' beats ' + ho.name;
      elYouRow.parentElement.classList.add('winrow');
      elOppRow.parentElement.classList.add('loserow');
      sfx('pickupCoin');
      sfx('pickupCoin', { delay: 0.14 });
      coinBurst();
      taunt('lose');
    } else if (res === 'lose') {
      elRes.textContent = OPP_NAME[who] + ' takes the pot — ' + pot + ' gold';
      elRes.className = 'lose go';
      elResSub.textContent = ho.name === hy.name
        ? ho.name + ' beats ' + hy.name + ' on higher dice'
        : ho.name + ' beats ' + hy.name;
      elOppRow.parentElement.classList.add('winrow');
      elYouRow.parentElement.classList.add('loserow');
      sfx('block');
      taunt('win');
    } else {
      elRes.textContent = 'A push — antes returned';
      elRes.className = 'go';
      elResSub.textContent = 'Dead-even hands';
      sfx('uiClick');
      taunt('draw');
    }
    pot = 0;
    refresh();
  }

  // --- wiring -----------------------------------------------------------------
  for (let i = 0; i < 5; i++) {
    youEls[i].addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (state !== 'hold') return;
      youHold[i] = !youHold[i];
      youEls[i].classList.toggle('held', youHold[i]);
      sfx('uiClick');
      refresh();
    });
  }
  elGo.addEventListener('click', () => {
    if (state === 'ante' || state === 'result') startHand();
    else if (state === 'hold') doReroll();
  });
  $('ef-diceleave').addEventListener('click', close);
  $('ef-dicex').addEventListener('click', close);
  $('ef-dicedim').addEventListener('pointerdown', close);
  window.addEventListener('keydown', (e) => {
    if (state !== 'closed' && (e.code === 'Escape' || e.code === 'KeyE')) {
      e.stopPropagation();
      close();
    }
  }, true);

  ev.on('gameLoaded', () => { if (state !== 'closed') close(); });

  // --- update: hold the pause while the table is open; adopt the Ember
  //     Hearth fireside spot once structures has published it -----------------
  function update() {
    if (!hearthPosSet && g.emberHearth && g.emberHearth.diceSpot) {
      const s = g.emberHearth.diceSpot;
      hearthPos.set(s.x, s.y, s.z);
      hearthPosSet = true;
    }
    if (state !== 'closed' && !g.paused) g.paused = true;
  }

  return {
    update,
    // debug/test hooks (underscore convention, cf. economy.js)
    _open: open,
    _rig: (you, opp) => rigQ.push({ you, opp }),
    _eval: evalHand,
    _state: () => state,
  };
}
