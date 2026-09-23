// VESPER — the handler AI who talks you through the fall of Halcyon Ring.
import { G } from '../state.js';

export const LINES = {
  intro: [
    'Unit Seven, you\'re awake. Good. Halcyon Ring has gone quiet — except for them.',
    'The Choir. Porcelain machines that sing each other into existence. I\'ll guide you down to the Core.',
  ],
  mite: ['Mites. They circle, then dive. Keep moving and they miss.'],
  sentinel: ['Sentinel. Its orbs are slow — sidestep them, or punch them straight back.'],
  firstStagger: ['It\'s cracking! Get close and hit it — shattered constructs bleed repair energy.'],
  lancer: ['Lancer on the high ground. Red line means it has you. Break line of sight or dash.'],
  brute: ['Brute. That front plate is armored. Bait the charge into a wall and hit the core on its back.'],
  warden: ['Warden. It\'s shielding the others. Kill it first and the bubbles pop.'],
  lanceUnlock: ['I found an Arc Lance in the armory. It pierces everything in a line. Line them up.'],
  novaUnlock: ['Nova Launcher recovered. Arcing plasma. Also works as a rocket jump — you won\'t take the blast.'],
  conductor: ['That\'s the Conductor. It keeps the swarm in time. Break its rhythm — and its rings.'],
  conductorPhase2: ['Its rings are loose! Watch the beam — jump the low sweep.'],
  conductorPhase3: ['It\'s desperate. Everything it has — now.'],
  conductorDown: ['The swarm is scattering. Seven... that was beautiful. Take the lift down.'],
  sector2: ['We\'re in the Garden. The Choir grew here first. Stay sharp — they\'ll send elites now.'],
  heart: ['The Heart. Everything they are, in one place. Destroy the pylons to open it up.'],
  heartOpen: ['Its shell is down. Now, Seven — end the song.'],
  heartPhase: ['It\'s rebuilding the pylons. Again. You can do this.'],
  victory: ['...Listen. Silence. Real silence. Thank you, Seven.'],
  lowHealth: ['Your frame\'s failing. Shatter something — you need the repair energy.'],
  overdrive: ['Overdrive is charged. Trigger it and the world slows down for you.'],
  floorClear: ['Sector clear.', 'That\'s the last of them.', 'Clean work.', 'Quiet again. For now.', 'Moving you down.'],
  death: ['Frame lost. I\'ve got your pattern — we go again.'],
  checkpoint: ['I kept a backup of you from the Garden gate. Let\'s try that again.'],
};

export function createStory() {
  const said = new Set();
  const S = {
    say(key, opts = {}) {
      const lines = LINES[key];
      if (!lines) return;
      if (opts.once && said.has(key)) return;
      said.add(key);
      const list = opts.random ? [lines[Math.floor(Math.random() * lines.length)]] : lines;
      G.hud?.subtitle('VESPER', list, opts.delay || 0);
    },
    reset() { said.clear(); },
    has(k) { return said.has(k); },
  };
  G.events.on('enemyStaggered', () => { if (G.run?.floor <= 2) S.say('firstStagger', { once: true }); G.hud?.tipOnce('stagger'); });
  G.events.on('playerDamaged', () => { if (G.player.hp / G.player.maxHp < 0.28) S.say('lowHealth', { once: true }); });
  return S;
}
