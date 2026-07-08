// ============================================================================
// ELDERFALL — voice.js
// Voiced NPC dialogue via the Web Speech API (speechSynthesis).
// Deterministic per-character voice casting from local en-* system voices,
// listens to `dialogueLine` / `dialogueEnd`, respects g.flags.voiceOff,
// never throws where speech synthesis is unavailable. No DOM, no three.js.
// ============================================================================

// Fixed vocal personalities for the named cast (pitch/rate per EXPANSION.md).
// Order matters: the index guarantees each named speaker a distinct system
// voice whenever the device offers enough of them.
const CAST = [
  ['maera',   { pitch: 0.8,  rate: 0.85 }], // village elder — slow, low
  ['torvald', { pitch: 0.6,  rate: 0.9  }], // blacksmith — deep
  ['sylva',   { pitch: 1.15, rate: 1.0  }], // hunter — bright
  ['bram',    { pitch: 0.9,  rate: 1.1  }], // innkeeper — jovial, quick
  ['wendel',  { pitch: 0.95, rate: 0.85 }], // farmer — weary
  ['vargr',   { pitch: 0.5,  rate: 0.85 }], // nemesis / narrator — gravel
];
const GRAVEL = CAST[5][1]; // narrator fallback tone

// Deterministic string hash → uint32 (stable across sessions).
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Strip HTML tags, markdown-ish emphasis and bracketed stage directions so
// the synthesizer never reads markup aloud.
function stripMarkup(text) {
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[*_`~#^|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createVoice(g) {
  // --- Feature detection: everything below must be inert if absent --------
  const synth = (typeof window !== 'undefined' &&
                 'speechSynthesis' in window &&
                 typeof SpeechSynthesisUtterance !== 'undefined')
    ? window.speechSynthesis : null;

  let pool = [];            // usable voices, deterministically ordered
  let castCache = new Map();// speaker(lowercase) → {voice, pitch, rate}
  let current = null;       // live utterance (retained: Chrome GC bug drops onend)
  let pendingTimer = 0;     // cancel-before-speak delay handle (Android quirk)
  let wasPaused = false;    // g.paused edge detection
  let lastKeepAlive = 0;    // Chrome long-utterance stall workaround clock

  // Build the deterministic voice pool. Prefer LOCAL en-* voices, then any
  // en-*, then anything at all. Sorted by name+lang so casting is stable no
  // matter what order the browser reports voices in.
  function buildPool() {
    if (!synth) return;
    let all;
    try { all = synth.getVoices() || []; } catch (e) { all = []; }
    if (!all.length) return;
    const en = all.filter(v => /^en[-_]?/i.test(v.lang || ''));
    const localEn = en.filter(v => v.localService);
    const chosen = localEn.length ? localEn : (en.length ? en : all.slice());
    chosen.sort((a, b) =>
      (a.name + '|' + a.lang) < (b.name + '|' + b.lang) ? -1 : 1);
    pool = chosen;
    castCache = new Map(); // recast everyone against the new pool
  }

  // Resolve (and memoize) a stable {voice, pitch, rate} for a speaker name.
  function castFor(speaker) {
    const key = String(speaker || 'narrator').trim().toLowerCase();
    let cfg = castCache.get(key);
    if (cfg) return cfg;
    let tone = null, idx = -1;
    for (let i = 0; i < CAST.length; i++) {
      if (key.indexOf(CAST[i][0]) !== -1) { tone = CAST[i][1]; idx = i; break; }
    }
    if (!tone) { // unknown speaker → stable hash-picked personality
      const h = strHash(key);
      tone = key === 'narrator' ? GRAVEL : {
        pitch: 0.65 + ((h >>> 8) % 100) / 100 * 0.6,   // 0.65..1.25
        rate:  0.85 + ((h >>> 16) % 100) / 100 * 0.25, // 0.85..1.10
      };
      idx = h % Math.max(pool.length, 1);
    } else {
      idx = idx % Math.max(pool.length, 1); // named cast: distinct slots
    }
    cfg = { voice: pool.length ? pool[idx] : null, pitch: tone.pitch, rate: tone.rate };
    castCache.set(key, cfg);
    return cfg;
  }

  function stop() {
    if (!synth) return;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = 0; }
    current = null;
    try { synth.cancel(); } catch (e) { /* never throw */ }
  }

  function speak(speaker, text) {
    if (!synth || api.enabled === false) return;
    if (g.flags && g.flags.voiceOff) return; // toggle checked per line
    const clean = stripMarkup(text);
    if (!clean) return;
    if (!pool.length) buildPool(); // voices may have loaded since boot

    // Android/Chrome quirk: always cancel first, then give the engine a
    // short beat before the next speak() or it silently drops the line.
    stop();
    const cfg = castFor(speaker);
    pendingTimer = setTimeout(() => {
      pendingTimer = 0;
      try {
        const u = new SpeechSynthesisUtterance(clean);
        if (cfg.voice) { u.voice = cfg.voice; u.lang = cfg.voice.lang; }
        u.pitch = cfg.pitch;
        u.rate = cfg.rate;
        u.volume = 0.9;
        u.onend = u.onerror = () => { if (current === u) current = null; };
        current = u; // hold a reference (Chrome garbage-collects live utterances)
        synth.speak(u);
        lastKeepAlive = Date.now();
      } catch (e) { current = null; }
    }, 60);
  }

  function update(dt) {
    if (!synth) return;
    // Pause-menu edge: cancel speech the frame g.paused flips on. (Dialogue
    // sets paused before its first dialogueLine fires, so lines still play.)
    if (g.paused && !wasPaused) stop();
    wasPaused = !!g.paused;
    // Chrome desktop stalls long utterances (~15s) unless nudged with resume.
    if (current && synth.speaking) {
      const now = Date.now();
      if (now - lastKeepAlive > 8000) {
        lastKeepAlive = now;
        try { synth.resume(); } catch (e) { /* ignore */ }
      }
    }
  }

  const api = { update, speak, stop, enabled: !!synth };

  if (synth) {
    buildPool(); // may be empty now; voiceschanged fires when they load async
    try {
      if (typeof synth.addEventListener === 'function') {
        synth.addEventListener('voiceschanged', buildPool);
      } else {
        synth.onvoiceschanged = buildPool;
      }
    } catch (e) { /* some engines expose neither — polled in speak() */ }

    // iOS/Safari quirk: synthesis suspends when the tab hides; resume on return.
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && current) {
          try { synth.resume(); } catch (e) { /* ignore */ }
        }
      });
    }

    // Event wiring (g.events is safe at factory time per contract).
    g.events.on('dialogueLine', (d) => {
      if (!d) return;
      speak(d.speaker, d.text);
    });
    g.events.on('dialogueEnd', () => stop());
  }

  return api;
}
