// ============================================================================
// ELDERFALL — save.js
// localStorage persistence: manual save/load, autosave every 60s and on
// quest completion. Every field is guarded — a partial or stale save must
// never throw. Owns events: `gameSaved`, `gameLoaded`.
// ============================================================================

const KEY = 'elderfall_save_v1';
const VERSION = 1;

export function createSave(g) {
  function save() {
    try {
      const data = { version: VERSION };

      // flags — plain JSON-safe key/value store
      try { data.flags = JSON.parse(JSON.stringify(g.flags || {})); }
      catch (_) { data.flags = {}; }

      data.time = { dayFrac: g.time && typeof g.time.dayFrac === 'number' ? g.time.dayFrac : 0.3 };

      if (g.player && typeof g.player.serialize === 'function') {
        try { data.player = g.player.serialize(); } catch (_) { /* skip */ }
      }
      if (g.quests && typeof g.quests.serialize === 'function') {
        try { data.quests = g.quests.serialize(); } catch (_) { /* skip */ }
      }
      if (g.enemies && typeof g.enemies.serialize === 'function') {
        try { data.enemies = g.enemies.serialize(); } catch (_) { /* skip */ }
      }
      if (g.combat && typeof g.combat.current === 'string') {
        data.equipped = g.combat.current;
      }

      localStorage.setItem(KEY, JSON.stringify(data));
      g.events.emit('gameSaved', {});
      return true;
    } catch (err) {
      // Quota/serialization failure must never crash the game
      console.error('Save failed:', err);
      return false;
    }
  }

  function load() {
    let data = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      data = JSON.parse(raw);
    } catch (_) {
      return false;
    }
    if (!data || typeof data !== 'object') return false;

    // flags: reset in place (subsystems hold references through g.flags)
    if (data.flags && typeof data.flags === 'object') {
      for (const k in g.flags) delete g.flags[k];
      for (const k in data.flags) g.flags[k] = data.flags[k];
    }

    if (data.time && typeof data.time.dayFrac === 'number' && isFinite(data.time.dayFrac)) {
      g.time.dayFrac = ((data.time.dayFrac % 1) + 1) % 1;
    }

    if (data.player && g.player && typeof g.player.deserialize === 'function') {
      try { g.player.deserialize(data.player); } catch (err) { console.error(err); }
    }
    if (data.quests && g.quests && typeof g.quests.deserialize === 'function') {
      try { g.quests.deserialize(data.quests); } catch (err) { console.error(err); }
    }
    if (data.enemies && g.enemies && typeof g.enemies.deserialize === 'function') {
      try { g.enemies.deserialize(data.enemies); } catch (err) { console.error(err); }
    }
    if (typeof data.equipped === 'string' && g.combat && typeof g.combat.equip === 'function') {
      try { g.combat.equip(data.equipped); } catch (err) { console.error(err); }
    }

    g.events.emit('gameLoaded', {});
    return true;
  }

  function hasSave() {
    try { return localStorage.getItem(KEY) !== null; }
    catch (_) { return false; }
  }

  function clear() {
    try { localStorage.removeItem(KEY); }
    catch (_) { /* private mode — nothing to clear anyway */ }
  }

  // Autosave: every 60s (skipped while paused or dead), and on quest completion.
  setInterval(() => {
    if (g.paused) return;
    if (!g.player || !g.player.stats || g.player.stats.hp <= 0) return;
    save();
  }, 60000);

  g.events.on('questCompleted', () => {
    if (g.player && g.player.stats && g.player.stats.hp > 0) save();
  });

  return { save, load, hasSave, clear };
}
