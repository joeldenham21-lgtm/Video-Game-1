const NOTE = { 'B#': 12, 'E#': 5, Cb: -1, Fb: 4, C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
// note name → midi using scientific pitch (C4 = 60)
export function parseNote(name) {
  const m = name.match(/(?:^|[_\s-])([A-G](?:#|b)?)(-?\d)(?=[_\s.-]|$)/);
  if (!m) return null;
  return (+m[2] + 1) * 12 + NOTE[m[1]];
}
export function parseLayer(name) {
  let m = name.match(/_v(?:l)?(\d)/i); if (m) return +m[1];
  m = name.match(/_(ppp|pp|p|mp|mf|f|ff|fff)(\d)?(?=[_.])/); if (m) return { ppp: 1, pp: 1, p: 2, mp: 3, mf: 4, f: 5, ff: 6, fff: 7 }[m[1]];
  return 1;
}
export function parseRR(name) {
  const m = name.match(/rr(\d)/i) || name.match(/_(\d)(?:_\w+)?\.wav$/);
  return m ? +m[1] : 1;
}
export const noteName = (m) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);
