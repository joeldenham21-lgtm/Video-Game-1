// Orchestra: CC0 recordings from VSCO-2 CE (Versilian Studios) and VCSL.
// oct: VSCO note names sit one octave below scientific pitch (verified with YIN).
// Seating (pan) follows a standard stage: violins left, violas centre-right, celli/basses right,
// horns left-back, trumpets centre-back, trombones/tuba right-back, winds centre, harp far left.
import { Instrument } from './sampler.mjs';

const V = 'VSCO-2-CE/', C = 'VCSL/';
const DEFS = {
  // ---- strings
  vln:      { dir: V + 'Strings/Violin Section/susVib', oct: 12, kind: 'sus', rel: 0.5, legatoFade: 0.09, pan: -0.55, width: 0.7, send: 0.34 },
  vlnSpic:  { dir: V + 'Strings/Violin Section/Spic', oct: 12, kind: 'short', pan: -0.5, width: 0.7, send: 0.3 },
  vlnTrem:  { dir: V + 'Strings/Violin Section/Trem', oct: 12, kind: 'sus', rel: 0.4, pan: -0.5, width: 0.7, send: 0.34 },
  vla:      { dir: V + 'Strings/Viola Section/susvib', oct: 12, kind: 'sus', rel: 0.5, legatoFade: 0.09, pan: 0.18, width: 0.6, send: 0.34 },
  vlaSpic:  { dir: V + 'Strings/Viola Section/spic', oct: 12, kind: 'short', pan: 0.15, width: 0.6, send: 0.3 },
  vlaTrem:  { dir: V + 'Strings/Viola Section/trem', oct: 12, kind: 'sus', rel: 0.4, pan: 0.18, width: 0.6, send: 0.34 },
  vc:       { dir: V + 'Strings/Cello Section/susvib', oct: 12, kind: 'sus', rel: 0.55, legatoFade: 0.09, pan: 0.45, width: 0.6, send: 0.32 },
  vcSpic:   { dir: V + 'Strings/Cello Section/spic', oct: 12, kind: 'short', pan: 0.45, width: 0.6, send: 0.28 },
  vcTrem:   { dir: V + 'Strings/Cello Section/trem', oct: 12, kind: 'sus', rel: 0.4, pan: 0.45, width: 0.6, send: 0.32 },
  vcPizz:   { dir: V + 'Strings/Cello Section/pizzT', oct: 12, kind: 'short', pan: 0.45, width: 0.5, send: 0.3 },
  cb:       { dir: V + 'Strings/Solo Contrabass/SusVib', oct: 12, kind: 'sus', rel: 0.55, legatoFade: 0.1, pan: 0.65, width: 0.4, send: 0.3, unison: 2 },
  cbSpic:   { dir: V + 'Strings/Solo Contrabass/Spic', oct: 12, kind: 'short', pan: 0.65, width: 0.4, send: 0.26, unison: 2 },
  cbPizz:   { dir: V + 'Strings/Solo Contrabass/Pizz', oct: 12, kind: 'short', pan: 0.65, width: 0.4, send: 0.3 },
  vlnSolo:  { dir: V + 'Strings/Solo Violin/Arco Vib', oct: 0, kind: 'sus', rel: 0.45, legatoFade: 0.08, pan: -0.2, width: 0.35, send: 0.4 },
  // ---- brass
  hn:       { dir: V + 'Brass/F Horn/sus', oct: 12, kind: 'sus', rel: 0.45, legatoFade: 0.08, pan: -0.3, width: 0.5, send: 0.5 },
  hnStac:   { dir: V + 'Brass/F Horn/stac', oct: 12, kind: 'short', pan: -0.3, width: 0.5, send: 0.48 },
  tpt:      { dir: V + 'Brass/Trumpet/sus', oct: 12, kind: 'sus', rel: 0.4, legatoFade: 0.06, pan: 0.05, width: 0.35, send: 0.46 },
  tbn:      { dir: V + 'Brass/Tenor Trombone/sus', oct: 12, kind: 'sus', rel: 0.4, legatoFade: 0.07, pan: 0.4, width: 0.45, send: 0.46 },
  tbnStac:  { dir: V + 'Brass/Tenor Trombone/stac', oct: 12, kind: 'short', pan: 0.4, width: 0.45, send: 0.44 },
  tuba:     { dir: V + 'Brass/Tuba/sus', oct: 12, kind: 'sus', rel: 0.45, pan: 0.55, width: 0.35, send: 0.42 },
  tubaStac: { dir: V + 'Brass/Tuba/stac', oct: 12, kind: 'short', pan: 0.55, width: 0.35, send: 0.4 },
  // ---- woodwinds
  fl:       { dir: V + 'Woodwinds/Flute/susvib', oct: 12, kind: 'sus', rel: 0.35, legatoFade: 0.06, pan: -0.1, width: 0.3, send: 0.42 },
  ob:       { dir: V + 'Woodwinds/Oboe/Vib', oct: 12, kind: 'sus', rel: 0.3, legatoFade: 0.05, pan: 0.05, width: 0.3, send: 0.4 },
  cl:       { dir: V + 'Woodwinds/Clarinet/susLong', oct: 12, kind: 'sus', rel: 0.35, legatoFade: 0.06, pan: -0.05, width: 0.3, send: 0.4 },
  bsn:      { dir: V + 'Woodwinds/Bassoon/sus', oct: 12, kind: 'sus', rel: 0.35, legatoFade: 0.06, pan: 0.12, width: 0.3, send: 0.4 },
  // ---- keys & harp
  piano:    { dir: C + 'Chordophones/Zithers/Grand Piano, Steinway B/Sus', oct: 0, kind: 'pluck', rel: 0.5, pan: -0.15, width: 0.8, send: 0.3 },
  harp:     { dir: C + 'Chordophones/Composite Chordophones/Concert Harp', oct: 0, kind: 'pluck', rel: 1.2, pan: -0.75, width: 0.4, send: 0.42 },
  organ:    { dir: C + 'Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet', oct: 12, kind: 'sus', rel: 0.9, legatoFade: 0.12, pan: 0, width: 0.9, send: 0.5 },
  organPed: { dir: C + 'Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet Pedal', oct: 12, kind: 'sus', rel: 1.0, pan: 0, width: 0.9, send: 0.45 },
  // ---- percussion
  timp:     { dir: [V + 'Percussion/Timpani', C + 'Membranophones/Struck Membranophones/Timpani 2/Hit'], detect: 'timpani', oct: 0, kind: 'short', pan: 0.1, width: 0.5, send: 0.4,
              groupOf: f => f.replace(/_(Hit|hit).*/, '') },
  timpRoll: { dir: V + 'Percussion/Timpani/Rolls', detect: 'timpani', oct: 0, kind: 'sus', rel: 0.5, pan: 0.1, width: 0.5, send: 0.42, loop: true },
  bd:       { dir: V + 'Percussion', match: /^BDrumNewhit/, unpitched: true, kind: 'short', pan: 0.05, width: 0.6, send: 0.45 },
  bdRoll:   { dir: C + 'Membranophones/Struck Membranophones/Bass Drum 2', match: /^bassdrum_roll_(pp|mp|mf|ff)\.wav/, unpitched: true, kind: 'sus', rel: 0.8, pan: 0.05, width: 0.6, send: 0.45 },
  frame:    { dir: C + 'Membranophones/Struck Membranophones/Frame Drum', match: /^HDrumL_Hit_v/, unpitched: true, kind: 'short', pan: -0.2, width: 0.5, send: 0.4 },
  frameS:   { dir: C + 'Membranophones/Struck Membranophones/Frame Drum', match: /^HDrumS_Hit(Muted)?_v/, unpitched: true, kind: 'short', pan: 0.25, width: 0.5, send: 0.38 },
  cymSwell: { dir: C + 'Idiophones/Struck Idiophones/Suspended Cymbal 1', match: /cresc_/, unpitched: true, kind: 'short', pan: -0.1, width: 0.8, send: 0.45,
              layerOf: f => ({ '1.5s': 1, '2s': 2, '4s': 3, '7.5s': 4 })[f.match(/cresc_([\d.]+s)/)[1]] },
  cymRoll:  { dir: C + 'Idiophones/Struck Idiophones/Suspended Cymbal 1', match: /roll_.*_nloop/, unpitched: true, kind: 'sus', rel: 1.2, pan: -0.1, width: 0.8, send: 0.45 },
  crash:    { dir: V + 'Percussion', match: /^cymbal-crash1_/, unpitched: true, kind: 'short', pan: 0.1, width: 0.9, send: 0.5 },
  gong:     { dir: C + 'Idiophones/Struck Idiophones/Gong 1', match: /^gong_(p|mf|f|fff)\.wav/, unpitched: true, kind: 'short', pan: 0, width: 0.8, send: 0.5 },
};

const cache = new Map();
export function inst(id) {
  if (!cache.has(id)) {
    const d = DEFS[id];
    if (!d) throw new Error('unknown instrument ' + id);
    cache.set(id, new Instrument(id, d));
  }
  return cache.get(id);
}
export const INSTRUMENT_IDS = Object.keys(DEFS);
