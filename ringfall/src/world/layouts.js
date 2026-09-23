// Arena layouts. Units: meters. Floors are solid slabs; colliders are built from these primitives.
// Primitive kinds:
//   disc:  { x, z, r, y (top), h (thickness), trim }            round deck platform
//   box:   { x, z, w, d, y (bottom), h, mat, trim }              block (cover, walls, ledges)
//   ramp:  { x, z, w, d, y0, y1, axis, dir }                     slope rising y0->y1 along +axis (dir 1) or -axis (dir -1)
//   pillar:{ x, z, r, y, h }                                     column with light strips
//   rim:   { x, z, r, y, h, gaps }                                ring wall around a disc (segments), gaps: array of [angleStart, angleEnd]
//   pad:   { x, z, y, to: [x, y, z] }                            jump pad
// spawns.ground/air: [x, y, z]; the director picks points away from the player.

const ring = (n, r, y, off = 0) => Array.from({ length: n }, (_, i) => {
  const a = off + (i / n) * Math.PI * 2;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
});

export const LAYOUTS = {
  // Sector 1 — circular deck, raised dais, four pillars, two sniper ledges reached by jump pads
  aperture: {
    name: 'APERTURE DECK',
    theme: 'docks',
    bounds: 30,
    start: [6, 0, 21, 0.278],
    prims: [
      { k: 'disc', x: 0, z: 0, r: 27, y: 0, h: 3, trim: true, rings: [9, 17.5] },
      { k: 'rim', x: 0, z: 0, r: 27, y: 0, h: 1.1, gaps: [] },
      { k: 'disc', x: 0, z: 0, r: 5.5, y: 1.6, h: 1.6, trim: true, mat: 'dark' },
      { k: 'ramp', x: 0, z: 7.6, w: 3.2, d: 4.4, y0: 0, y1: 1.6, axis: 'z', dir: -1 },
      { k: 'ramp', x: 0, z: -7.6, w: 3.2, d: 4.4, y0: 0, y1: 1.6, axis: 'z', dir: 1 },
      { k: 'pillar', x: 13, z: 13, r: 1.3, y: 0, h: 10 },
      { k: 'pillar', x: -13, z: 13, r: 1.3, y: 0, h: 10 },
      { k: 'pillar', x: 13, z: -13, r: 1.3, y: 0, h: 10 },
      { k: 'pillar', x: -13, z: -13, r: 1.3, y: 0, h: 10 },
      { k: 'box', x: 8, z: 0, w: 1.2, d: 3.6, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: -8, z: 0, w: 1.2, d: 3.6, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: 0, z: 17, w: 4, d: 1.2, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: 0, z: -17, w: 4, d: 1.2, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: 17.5, z: 7, w: 2.2, d: 2.2, y: 0, h: 1.6, mat: 'dark', trim: true },
      { k: 'box', x: -17.5, z: -7, w: 2.2, d: 2.2, y: 0, h: 1.6, mat: 'dark', trim: true },
      { k: 'box', x: 17.5, z: -7, w: 1.4, d: 3, y: 0, h: 1.1, mat: 'dark', trim: true },
      { k: 'box', x: -17.5, z: 7, w: 1.4, d: 3, y: 0, h: 1.1, mat: 'dark', trim: true },
      // sniper ledges on the east/west rim
      { k: 'box', x: 24, z: 0, w: 5, d: 9, y: 4.2, h: 0.8, trim: true },
      { k: 'box', x: -24, z: 0, w: 5, d: 9, y: 4.2, h: 0.8, trim: true },
      { k: 'box', x: 26.3, z: 0, w: 0.4, d: 9, y: 5, h: 1, mat: 'dark' },
      { k: 'box', x: -26.3, z: 0, w: 0.4, d: 9, y: 5, h: 1, mat: 'dark' },
      { k: 'pad', x: 15, z: 0, y: 0, to: [23.5, 5.0, 0] },
      { k: 'pad', x: -15, z: 0, y: 0, to: [-23.5, 5.0, 0] },
    ],
    spawns: {
      ground: [...ring(8, 21, 0, 0.4), ...ring(4, 11, 0, 0.78), [0, 3.2, 0]],
      air: [...ring(6, 18, 6, 0.2), ...ring(4, 8, 9, 0.9)],
      high: [[24, 5, 3], [-24, 5, -3], [13, 10, 13], [-13, 10, -13], [13, 10, -13], [-13, 10, 13]],
    },
  },

  // Sector 1 — a lower ring deck around a central tower; bridges and a crown platform
  spindle: {
    name: 'SPINDLE ARRAY',
    theme: 'docks',
    bounds: 32,
    start: [0, 0, 24, 0],
    prims: [
      { k: 'disc', x: 0, z: 0, r: 29, y: 0, h: 3, trim: true, rings: [20] },
      { k: 'rim', x: 0, z: 0, r: 29, y: 0, h: 1.1, gaps: [] },
      { k: 'disc', x: 0, z: 0, r: 7, y: 5, h: 5, trim: true, mat: 'wall' },
      { k: 'disc', x: 0, z: 0, r: 4.5, y: 9.2, h: 0.6, trim: true, mat: 'dark' },
      { k: 'pillar', x: 0, z: 0, r: 1.6, y: 5, h: 4.2 },
      { k: 'ramp', x: 10.4, z: 0, w: 7, d: 3.4, y0: 0, y1: 5, axis: 'x', dir: -1 },
      { k: 'ramp', x: -10.4, z: 0, w: 7, d: 3.4, y0: 0, y1: 5, axis: 'x', dir: 1 },
      { k: 'box', x: 0, z: 13, w: 6, d: 1.2, y: 0, h: 1.3, mat: 'dark', trim: true },
      { k: 'box', x: 0, z: -13, w: 6, d: 1.2, y: 0, h: 1.3, mat: 'dark', trim: true },
      { k: 'box', x: 14, z: 14, w: 2.4, d: 2.4, y: 0, h: 2.2, mat: 'dark', trim: true },
      { k: 'box', x: -14, z: -14, w: 2.4, d: 2.4, y: 0, h: 2.2, mat: 'dark', trim: true },
      { k: 'box', x: 14, z: -14, w: 2.4, d: 2.4, y: 0, h: 2.2, mat: 'dark', trim: true },
      { k: 'box', x: -14, z: 14, w: 2.4, d: 2.4, y: 0, h: 2.2, mat: 'dark', trim: true },
      { k: 'box', x: 21, z: 0, w: 1.2, d: 5, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: -21, z: 0, w: 1.2, d: 5, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'pillar', x: 20, z: 20, r: 1.1, y: 0, h: 12 },
      { k: 'pillar', x: -20, z: -20, r: 1.1, y: 0, h: 12 },
      { k: 'pillar', x: 20, z: -20, r: 1.1, y: 0, h: 12 },
      { k: 'pillar', x: -20, z: 20, r: 1.1, y: 0, h: 12 },
      { k: 'pad', x: 0, z: 18, y: 0, to: [0, 9.5, 2.5] },
      { k: 'pad', x: 0, z: -18, y: 0, to: [0, 9.5, -2.5] },
    ],
    spawns: {
      ground: [...ring(10, 22, 0, 0.3), [0, 5.2, 5.5], [0, 5.2, -5.5]],
      air: [...ring(8, 16, 7, 0.1), [0, 14, 0]],
      high: [[0, 10, 0], [5.5, 5.2, 0], [-5.5, 5.2, 0], [20, 12.5, 20], [-20, 12.5, -20]],
    },
  },

  // Sector 2 — shattered islands linked by bridges; falling is a real threat
  shards: {
    name: 'SHATTERED CONCOURSE',
    theme: 'garden',
    bounds: 34,
    start: [0, 0, 22, 0],
    prims: [
      { k: 'disc', x: 0, z: 0, r: 11, y: 0, h: 3, trim: true, rings: [6] },
      { k: 'disc', x: 0, z: 22, r: 7, y: 0, h: 3, trim: true },
      { k: 'disc', x: 20, z: -11, r: 7.5, y: 1.5, h: 3, trim: true },
      { k: 'disc', x: -20, z: -11, r: 7.5, y: 1.5, h: 3, trim: true },
      { k: 'disc', x: 0, z: -24, r: 6, y: 4, h: 3, trim: true, mat: 'dark' },
      // bridges
      { k: 'box', x: 0, z: 13.5, w: 3.4, d: 6, y: -0.6, h: 0.6, trim: true },
      { k: 'ramp', x: 12, z: -6.2, w: 7, d: 3, y0: 0, y1: 1.5, axis: 'x', dir: 1 },
      { k: 'ramp', x: -12, z: -6.2, w: 7, d: 3, y0: 0, y1: 1.5, axis: 'x', dir: -1 },
      { k: 'ramp', x: 0, z: -14.5, w: 3, d: 7.6, y0: 0, y1: 4, axis: 'z', dir: -1 },
      { k: 'box', x: 0, z: 0, w: 2.4, d: 2.4, y: 0, h: 2.4, mat: 'dark', trim: true },
      { k: 'box', x: 6, z: 4, w: 1.2, d: 3, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: -6, z: 4, w: 1.2, d: 3, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: 20, z: -11, w: 3, d: 1.2, y: 1.5, h: 1.3, mat: 'dark', trim: true },
      { k: 'box', x: -20, z: -11, w: 3, d: 1.2, y: 1.5, h: 1.3, mat: 'dark', trim: true },
      { k: 'box', x: 0, z: 24, w: 3, d: 1.2, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'pillar', x: 0, z: -24, r: 1.2, y: 4, h: 7 },
      { k: 'pillar', x: 24, z: -14, r: 0.9, y: 1.5, h: 8 },
      { k: 'pillar', x: -24, z: -14, r: 0.9, y: 1.5, h: 8 },
      { k: 'pad', x: 4, z: 22, y: 0, to: [17, 2.4, -8] },
      { k: 'pad', x: -4, z: 22, y: 0, to: [-17, 2.4, -8] },
      { k: 'pad', x: 20, z: -15, y: 1.5, to: [2, 4.8, -22] },
      { k: 'pad', x: -20, z: -15, y: 1.5, to: [-2, 4.8, -22] },
    ],
    spawns: {
      ground: [[0, 0, 7], [7, 0, -3], [-7, 0, -3], [0, 0, 20], [20, 1.5, -9], [-20, 1.5, -9], [0, 4, -24], [22, 1.5, -12], [-22, 1.5, -12]],
      air: [...ring(8, 16, 7, 0.1), [0, 10, -10], [0, 9, 12]],
      high: [[0, 11.5, -24], [24, 9.5, -14], [-24, 9.5, -14], [0, 6, -26]],
    },
  },

  // Sector 2 — long cathedral nave with balconies and tall columns
  nave: {
    name: 'CHOIR NAVE',
    theme: 'garden',
    bounds: 34,
    start: [0, 0, 26, 0],
    prims: [
      { k: 'box', x: 0, z: 0, w: 26, d: 62, y: -3, h: 3, trim: true, floor: true },
      { k: 'box', x: 12.8, z: 0, w: 0.4, d: 62, y: 0, h: 1.1, mat: 'dark' },
      { k: 'box', x: -12.8, z: 0, w: 0.4, d: 62, y: 0, h: 1.1, mat: 'dark' },
      { k: 'box', x: 0, z: 30.8, w: 26, d: 0.4, y: 0, h: 1.1, mat: 'dark' },
      { k: 'box', x: 0, z: -30.8, w: 26, d: 0.4, y: 0, h: 1.1, mat: 'dark' },
      // balconies
      { k: 'box', x: 10, z: -8, w: 5, d: 22, y: 4.5, h: 0.7, trim: true },
      { k: 'box', x: -10, z: 8, w: 5, d: 22, y: 4.5, h: 0.7, trim: true },
      { k: 'ramp', x: 10, z: 7, w: 3, d: 8, y0: 0, y1: 5.2, axis: 'z', dir: -1 },
      { k: 'ramp', x: -10, z: -7, w: 3, d: 8, y0: 0, y1: 5.2, axis: 'z', dir: 1 },
      // columns
      ...[-22, -11, 0, 11, 22].flatMap(z => [
        { k: 'pillar', x: 6, z, r: 1.0, y: 0, h: 14 },
        { k: 'pillar', x: -6, z, r: 1.0, y: 0, h: 14 },
      ]),
      { k: 'box', x: 0, z: -5.5, w: 3.2, d: 1.2, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: 0, z: 5.5, w: 3.2, d: 1.2, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: 0, z: 16.5, w: 1.2, d: 3, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'box', x: 0, z: -16.5, w: 1.2, d: 3, y: 0, h: 1.2, mat: 'dark', trim: true },
      { k: 'disc', x: 0, z: -26, r: 3.5, y: 1.4, h: 1.4, trim: true, mat: 'dark' },
      { k: 'pad', x: 0, z: 22, y: 0, to: [-10, 5.4, 14] },
      { k: 'pad', x: 0, z: -21, y: 0, to: [10, 5.4, -14] },
    ],
    spawns: {
      ground: [[0, 0, -26], [8, 0, -24], [-8, 0, -24], [8, 0, 24], [-8, 0, 24], [0, 0, 0], [9, 0, -2], [-9, 0, 2], [0, 1.4, -26]],
      air: [[0, 8, -20], [0, 8, 20], [8, 9, 0], [-8, 9, 0], [0, 12, 0]],
      high: [[10, 5.2, -14], [-10, 5.2, 14], [10, 5.2, -2], [-10, 5.2, 2], [6, 14.6, -22], [-6, 14.6, 22]],
    },
  },

  // Boss arena — the Conductor
  crucible: {
    name: 'THE CRUCIBLE',
    theme: 'docks',
    bounds: 32,
    start: [0, 0, 24, 0],
    prims: [
      { k: 'disc', x: 0, z: 0, r: 30, y: 0, h: 3, trim: true, rings: [10, 20] },
      { k: 'rim', x: 0, z: 0, r: 30, y: 0, h: 1.2, gaps: [] },
      { k: 'pillar', x: 21, z: 0, r: 1.4, y: 0, h: 6 },
      { k: 'pillar', x: -21, z: 0, r: 1.4, y: 0, h: 6 },
      { k: 'pillar', x: 0, z: 21, r: 1.4, y: 0, h: 6 },
      { k: 'pillar', x: 0, z: -21, r: 1.4, y: 0, h: 6 },
      { k: 'box', x: 12, z: 12, w: 2.6, d: 1.2, y: 0, h: 1.3, mat: 'dark', trim: true },
      { k: 'box', x: -12, z: -12, w: 2.6, d: 1.2, y: 0, h: 1.3, mat: 'dark', trim: true },
      { k: 'box', x: 12, z: -12, w: 1.2, d: 2.6, y: 0, h: 1.3, mat: 'dark', trim: true },
      { k: 'box', x: -12, z: 12, w: 1.2, d: 2.6, y: 0, h: 1.3, mat: 'dark', trim: true },
      { k: 'pad', x: 15, z: 15, y: 0, to: [-15, 0.2, -15], power: 1.2 },
      { k: 'pad', x: -15, z: -15, y: 0, to: [15, 0.2, 15], power: 1.2 },
    ],
    spawns: {
      ground: ring(8, 24, 0, 0.2),
      air: ring(8, 18, 7, 0.4),
      high: ring(4, 21, 6.4, 0),
    },
  },

  // Final boss — the Heart, four pylons on outer islands
  sanctum: {
    name: 'HEART OF THE CHOIR',
    theme: 'heart',
    bounds: 34,
    start: [0, 0, 26, 0],
    prims: [
      { k: 'disc', x: 0, z: 0, r: 31, y: 0, h: 3, trim: true, rings: [12, 22] },
      { k: 'rim', x: 0, z: 0, r: 31, y: 0, h: 1.2, gaps: [] },
      { k: 'disc', x: 0, z: 0, r: 5, y: 1.0, h: 1.0, trim: true, mat: 'dark' },
      ...ring(4, 20, 0, Math.PI / 4).map(([x, , z]) => ({ k: 'disc', x, z, r: 3.2, y: 0.8, h: 0.8, trim: true, mat: 'dark' })),
      ...ring(8, 13, 0, 0).map(([x, , z]) => ({ k: 'box', x, z, w: 1.4, d: 1.4, y: 0, h: 1.3, mat: 'dark', trim: true })),
      { k: 'pad', x: 0, z: 17, y: 0, to: [0, 0.3, -17], power: 1.25 },
      { k: 'pad', x: 0, z: -17, y: 0, to: [0, 0.3, 17], power: 1.25 },
    ],
    spawns: {
      ground: ring(8, 25, 0, 0.1),
      air: ring(8, 18, 8, 0.3),
      high: ring(4, 26, 5, 0),
    },
  },
};
