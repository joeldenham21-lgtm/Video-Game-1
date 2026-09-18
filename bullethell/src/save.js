// localStorage persistence: options, high scores, unlocks.
const KEY = 'hollowchoir.v1';
const DEFAULTS = () => ({
  options: { music: 0.7, sfx: 0.8, shake: true, autofire: true, hitbox: false, fx: true },
  hiscores: { novice: [], normal: [], lunatic: [] },
  unlocked: 1, clears: { novice: 0, normal: 0, lunatic: 0 },
  stats: { runs: 0, kills: 0, deaths: 0, bosses: 0, graze: 0, playtime: 0 },
});
export function load() {
  try { const raw = localStorage.getItem(KEY); if (!raw) return DEFAULTS(); const d = JSON.parse(raw); const def = DEFAULTS(); return { ...def, ...d, options: { ...def.options, ...(d.options || {}) }, hiscores: { ...def.hiscores, ...(d.hiscores || {}) }, stats: { ...def.stats, ...(d.stats || {}) }, clears: { ...def.clears, ...(d.clears || {}) } }; }
  catch { return DEFAULTS(); }
}
export function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} }
export function addScore(d, diff, entry) {
  const L = d.hiscores[diff] || (d.hiscores[diff] = []);
  L.push(entry); L.sort((a, b) => b.score - a.score); if (L.length > 8) L.length = 8;
  return L.indexOf(entry);
}
export function reset() { try { localStorage.removeItem(KEY); } catch {} }
