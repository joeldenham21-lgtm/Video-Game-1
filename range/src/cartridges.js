// ============================================================================
// RANGE — cartridges.js
// Real-world cartridge data. Masses in grams, lengths in mm, velocities in m/s.
// BCs are the commonly published (Litz / manufacturer) values. Muzzle velocity
// is given for a reference barrel length with a per-inch correction so each
// weapon's actual barrel produces its own MV.
// Case dimensions drive the ejected-brass geometry (SAAMI / CIP nominal).
// ============================================================================

export const CARTRIDGES = {
  '556_m855': {
    id: '556_m855', name: '5.56×45 NATO M855 62 gr FMJ-BT', short: 'M855 62gr', caliber: '5.56',
    oalMm: 57.4,
    bulletMassG: 4.018, diameterMm: 5.70, lengthMm: 23.1, bc: 0.151, model: 'G7',
    mvRefMs: 940, refBarrelIn: 20, mvPerInch: 8.5, powderMassG: 1.62, gasVelFactor: 1.75,
    accuracyMoa: 2.0, // intrinsic 5-shot extreme spread, typical carbine
    case: { len: 44.7, base: 9.58, rim: 9.6, shoulder: 9.0, shoulderAt: 36.5, neck: 6.43, neckLen: 5.8, massG: 6.0 },
    bulletShape: 'spitzer-bt', tip: 'green',
  },
  '556_m193': {
    id: '556_m193', name: '5.56×45 M193 55 gr FMJ-BT', short: 'M193 55gr', caliber: '5.56',
    oalMm: 57.4,
    bulletMassG: 3.56, diameterMm: 5.70, lengthMm: 19.1, bc: 0.125, model: 'G7',
    mvRefMs: 990, refBarrelIn: 20, mvPerInch: 9.0, powderMassG: 1.68, gasVelFactor: 1.75,
    accuracyMoa: 2.2,
    case: { len: 44.7, base: 9.58, rim: 9.6, shoulder: 9.0, shoulderAt: 36.5, neck: 6.43, neckLen: 5.8, massG: 6.0 },
    bulletShape: 'spitzer-bt', tip: 'none',
  },
  '556_mk262': {
    id: '556_mk262', name: '5.56×45 Mk 262 77 gr OTM', short: 'Mk262 77gr', caliber: '5.56',
    oalMm: 57.4,
    bulletMassG: 4.99, diameterMm: 5.70, lengthMm: 25.3, bc: 0.190, model: 'G7',
    mvRefMs: 838, refBarrelIn: 20, mvPerInch: 8.0, powderMassG: 1.55, gasVelFactor: 1.75,
    accuracyMoa: 1.0,
    case: { len: 44.7, base: 9.58, rim: 9.6, shoulder: 9.0, shoulderAt: 36.5, neck: 6.43, neckLen: 5.8, massG: 6.0 },
    bulletShape: 'spitzer-bt', tip: 'hollow',
  },
  '9mm_124': {
    id: '9mm_124', name: '9×19 mm 124 gr FMJ', short: '9mm 124gr', caliber: '9mm',
    oalMm: 29.7,
    bulletMassG: 8.04, diameterMm: 9.01, lengthMm: 15.5, bc: 0.150, model: 'G1',
    mvRefMs: 360, refBarrelIn: 4.5, mvPerInch: 9.0, powderMassG: 0.39, gasVelFactor: 1.5,
    accuracyMoa: 4.0,
    case: { len: 19.15, base: 9.93, rim: 9.96, shoulder: 9.65, shoulderAt: 18.5, neck: 9.65, neckLen: 0.6, massG: 4.0 },
    bulletShape: 'round-nose', tip: 'none',
  },
  '9mm_115': {
    id: '9mm_115', name: '9×19 mm 115 gr FMJ', short: '9mm 115gr', caliber: '9mm',
    oalMm: 29.4,
    bulletMassG: 7.45, diameterMm: 9.01, lengthMm: 14.6, bc: 0.145, model: 'G1',
    mvRefMs: 375, refBarrelIn: 4.5, mvPerInch: 9.5, powderMassG: 0.40, gasVelFactor: 1.5,
    accuracyMoa: 4.5,
    case: { len: 19.15, base: 9.93, rim: 9.96, shoulder: 9.65, shoulderAt: 18.5, neck: 9.65, neckLen: 0.6, massG: 4.0 },
    bulletShape: 'round-nose', tip: 'none',
  },
  '9mm_147': {
    id: '9mm_147', name: '9×19 mm 147 gr FMJ-FP (subsonic)', short: '9mm 147gr', caliber: '9mm',
    oalMm: 29.7,
    bulletMassG: 9.53, diameterMm: 9.01, lengthMm: 17.0, bc: 0.212, model: 'G1',
    mvRefMs: 300, refBarrelIn: 4.5, mvPerInch: 6.0, powderMassG: 0.30, gasVelFactor: 1.5,
    accuracyMoa: 3.5,
    case: { len: 19.15, base: 9.93, rim: 9.96, shoulder: 9.65, shoulderAt: 18.5, neck: 9.65, neckLen: 0.6, massG: 4.0 },
    bulletShape: 'flat-nose', tip: 'none',
  },
  '308_m80': {
    id: '308_m80', name: '7.62×51 NATO M80 147 gr FMJ-BT', short: 'M80 147gr', caliber: '.308',
    oalMm: 71.1,
    bulletMassG: 9.53, diameterMm: 7.82, lengthMm: 28.6, bc: 0.200, model: 'G7',
    mvRefMs: 838, refBarrelIn: 22, mvPerInch: 7.0, powderMassG: 2.98, gasVelFactor: 1.75,
    accuracyMoa: 1.8,
    case: { len: 51.18, base: 11.96, rim: 12.01, shoulder: 11.53, shoulderAt: 39.6, neck: 8.72, neckLen: 7.7, massG: 11.5 },
    bulletShape: 'spitzer-bt', tip: 'none',
  },
  '308_m118lr': {
    id: '308_m118lr', name: '7.62×51 M118LR 175 gr SMK', short: 'M118LR 175gr', caliber: '.308',
    oalMm: 72.4,
    bulletMassG: 11.34, diameterMm: 7.82, lengthMm: 31.5, bc: 0.243, model: 'G7',
    mvRefMs: 790, refBarrelIn: 24, mvPerInch: 6.5, powderMassG: 2.85, gasVelFactor: 1.75,
    accuracyMoa: 0.8,
    case: { len: 51.18, base: 11.96, rim: 12.01, shoulder: 11.53, shoulderAt: 39.6, neck: 8.72, neckLen: 7.7, massG: 11.5 },
    bulletShape: 'spitzer-bt', tip: 'hollow',
  },
  '65cm_140': {
    id: '65cm_140', name: '6.5 Creedmoor 140 gr ELD-M', short: '6.5CM 140gr', caliber: '6.5',
    oalMm: 71.8,
    bulletMassG: 9.07, diameterMm: 6.72, lengthMm: 35.9, bc: 0.315, model: 'G7',
    mvRefMs: 823, refBarrelIn: 24, mvPerInch: 6.0, powderMassG: 2.72, gasVelFactor: 1.75,
    accuracyMoa: 0.6,
    case: { len: 48.77, base: 11.95, rim: 12.01, shoulder: 11.71, shoulderAt: 38.6, neck: 7.52, neckLen: 6.8, massG: 10.8 },
    bulletShape: 'spitzer-bt', tip: 'red',
  },
};

/** Muzzle velocity for a cartridge from a given barrel length (inches). */
export function muzzleVelocity(cart, barrelIn) {
  return cart.mvRefMs + (barrelIn - cart.refBarrelIn) * cart.mvPerInch;
}

/** Ammo choices offered per caliber (in menu order). */
export const AMMO_BY_CALIBER = {
  '5.56': ['556_m855', '556_m193', '556_mk262'],
  '9mm': ['9mm_124', '9mm_115', '9mm_147'],
  '.308': ['308_m118lr', '308_m80'],
  '6.5': ['65cm_140'],
};
