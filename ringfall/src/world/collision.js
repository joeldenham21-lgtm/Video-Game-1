// Collision world: axis-aligned boxes (optionally with a sloped top = ramps) and vertical cylinders.
// Player = vertical cylinder; enemies = spheres/circles; rays for hitscan and line of sight.
import { clamp } from '../util.js';

export class CollisionWorld {
  constructor() {
    this.boxes = [];
    this.cyls = [];
    this.rings = [];  // annular walls: { x, z, rIn, rOut, y0, y1 }
    this.killY = -40;
    this.hit = { t: 0, nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0, obj: null };
  }

  clear() { this.boxes.length = 0; this.cyls.length = 0; this.rings.length = 0; }

  addRing(x, z, rIn, rOut, y0, y1, tag = null) {
    const r = { x, z, rIn, rOut, y0, y1, tag };
    this.rings.push(r);
    return r;
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ, tag = null) {
    const b = { minX, minY, minZ, maxX, maxY, maxZ, ramp: null, tag };
    this.boxes.push(b);
    return b;
  }

  // Ramp rising along +axis (dir=1) or -axis (dir=-1), from yLow to yHigh, solid below the slope.
  addRamp(minX, minZ, maxX, maxZ, yBase, yLow, yHigh, axis = 'z', dir = 1, tag = null) {
    const b = this.addBox(minX, yBase, minZ, maxX, Math.max(yLow, yHigh), maxZ, tag);
    const len = axis === 'x' ? maxX - minX : maxZ - minZ;
    const k = (yHigh - yLow) / len * dir;           // slope dy / d(axis)
    const start = dir > 0 ? (axis === 'x' ? minX : minZ) : (axis === 'x' ? maxX : maxZ);
    // top(a) = yLow + k * (a - start)
    b.ramp = { axis, k, c: yLow - k * start };
    return b;
  }

  addCyl(x, z, r, y0, y1, tag = null) {
    const c = { x, z, r, y0, y1, tag };
    this.cyls.push(c);
    return c;
  }

  topAt(b, x, z) {
    if (!b.ramp) return b.maxY;
    const a = b.ramp.axis === 'x' ? x : z;
    return clamp(b.ramp.c + b.ramp.k * a, b.minY, b.maxY);
  }

  // Highest walkable surface under a circle whose top is below maxTop
  groundHeight(x, z, r, maxTop) {
    let best = -Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (x + r < b.minX || x - r > b.maxX || z + r < b.minZ || z - r > b.maxZ) continue;
      const cx = clamp(x, b.minX, b.maxX), cz = clamp(z, b.minZ, b.maxZ);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > r * r) continue;
      const top = this.topAt(b, clamp(x, b.minX, b.maxX), clamp(z, b.minZ, b.maxZ));
      if (top <= maxTop && top > best) best = top;
    }
    for (let i = 0; i < this.cyls.length; i++) {
      const c = this.cyls[i];
      const dx = x - c.x, dz = z - c.z, rr = c.r + r;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (c.y1 <= maxTop && c.y1 > best) best = c.y1;
    }
    for (let i = 0; i < this.rings.length; i++) {
      const g = this.rings[i];
      const d = Math.hypot(x - g.x, z - g.z);
      if (d + r < g.rIn || d - r > g.rOut) continue;
      if (g.y1 <= maxTop && g.y1 > best) best = g.y1;
    }
    return best;
  }

  // Lowest ceiling above y within the circle footprint
  ceilingHeight(x, z, r, fromY) {
    let best = Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.minY < fromY - 0.01 || b.minY >= best) continue;
      if (x + r < b.minX || x - r > b.maxX || z + r < b.minZ || z - r > b.maxZ) continue;
      best = b.minY;
    }
    for (let i = 0; i < this.cyls.length; i++) {
      const c = this.cyls[i];
      if (c.y0 < fromY - 0.01 || c.y0 >= best) continue;
      const dx = x - c.x, dz = z - c.z, rr = c.r + r;
      if (dx * dx + dz * dz > rr * rr) continue;
      best = c.y0;
    }
    return best;
  }

  // Push a vertical cylinder (feet at p.y) out of walls. Obstacles lower than feet+step are ignored (stepped onto).
  // v (optional) has its into-wall component removed. Returns true if any wall was touched.
  pushCylinder(p, v, r, h, step) {
    let touched = false;
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < this.boxes.length; i++) {
        const b = this.boxes[i];
        if (p.x + r <= b.minX || p.x - r >= b.maxX || p.z + r <= b.minZ || p.z - r >= b.maxZ) continue;
        if (b.minY >= p.y + h) continue;
        const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        const top = this.topAt(b, cx, cz);
        if (top <= p.y + step) continue;
        let nx, nz, pen;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; pen = r - d;
        } else {
          // center inside the footprint: exit along the shallowest side
          const l = p.x - b.minX, rr = b.maxX - p.x, n = p.z - b.minZ, f = b.maxZ - p.z;
          const m = Math.min(l, rr, n, f);
          if (m === l) { nx = -1; nz = 0; pen = l + r; }
          else if (m === rr) { nx = 1; nz = 0; pen = rr + r; }
          else if (m === n) { nx = 0; nz = -1; pen = n + r; }
          else { nx = 0; nz = 1; pen = f + r; }
        }
        p.x += nx * pen; p.z += nz * pen;
        if (v) {
          const vn = v.x * nx + v.z * nz;
          if (vn < 0) { v.x -= vn * nx; v.z -= vn * nz; }
        }
        touched = true;
      }
      for (let i = 0; i < this.cyls.length; i++) {
        const c = this.cyls[i];
        if (c.y0 >= p.y + h || c.y1 <= p.y + step) continue;
        const dx = p.x - c.x, dz = p.z - c.z, rr = c.r + r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-5;
        const nx = dx / d, nz = dz / d, pen = rr - d;
        p.x += nx * pen; p.z += nz * pen;
        if (v) {
          const vn = v.x * nx + v.z * nz;
          if (vn < 0) { v.x -= vn * nx; v.z -= vn * nz; }
        }
        touched = true;
      }
      for (let i = 0; i < this.rings.length; i++) {
        const g = this.rings[i];
        if (g.y0 >= p.y + h || g.y1 <= p.y + step) continue;
        const dx = p.x - g.x, dz = p.z - g.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1e-5;
        const mid = (g.rIn + g.rOut) * 0.5;
        let nx, nz, pen;
        if (d < mid && d + r > g.rIn) { nx = -dx / d; nz = -dz / d; pen = d + r - g.rIn; }
        else if (d >= mid && d - r < g.rOut) { nx = dx / d; nz = dz / d; pen = g.rOut - (d - r); }
        else continue;
        p.x += nx * pen; p.z += nz * pen;
        if (v) {
          const vn = v.x * nx + v.z * nz;
          if (vn < 0) { v.x -= vn * nx; v.z -= vn * nz; }
        }
        touched = true;
      }
    }
    return touched;
  }

  // Sphere vs world (for flyers/projectiles). Pushes p out; returns true if touched.
  pushSphere(p, r, v) {
    let touched = false;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (p.x + r <= b.minX || p.x - r >= b.maxX || p.z + r <= b.minZ || p.z - r >= b.maxZ || p.y + r <= b.minY || p.y - r >= b.maxY) continue;
      const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
      const cy = clamp(p.y, b.minY, this.topAt(b, cx, cz));
      let dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      let nx = 0, ny = 1, nz = 0, pen;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; nz = dz / d; pen = r - d; }
      else { pen = this.topAt(b, p.x, p.z) - p.y + r; }
      p.x += nx * pen; p.y += ny * pen; p.z += nz * pen;
      if (v) { const vn = v.x * nx + v.y * ny + v.z * nz; if (vn < 0) { v.x -= vn * nx; v.y -= vn * ny; v.z -= vn * nz; } }
      touched = true;
    }
    for (let i = 0; i < this.cyls.length; i++) {
      const c = this.cyls[i];
      if (p.y + r <= c.y0 || p.y - r >= c.y1) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1e-5;
      const cy = clamp(p.y, c.y0, c.y1);
      const ex = d > c.r ? (d - c.r) : 0;
      const dy = p.y - cy;
      const dist = Math.sqrt(ex * ex + dy * dy);
      if (dist >= r) continue;
      if (dist > 1e-6) {
        const nx = (ex / dist) * (dx / d), nz = (ex / dist) * (dz / d), ny = dy / dist;
        const pen = r - dist;
        p.x += nx * pen; p.y += ny * pen; p.z += nz * pen;
        if (v) { const vn = v.x * nx + v.y * ny + v.z * nz; if (vn < 0) { v.x -= vn * nx; v.y -= vn * ny; v.z -= vn * nz; } }
      } else {
        const pen = c.r + r - d;
        p.x += (dx / d) * pen; p.z += (dz / d) * pen;
      }
      touched = true;
    }
    for (let i = 0; i < this.rings.length; i++) {
      const g = this.rings[i];
      if (p.y - r >= g.y1 || p.y + r <= g.y0) continue;
      const dx = p.x - g.x, dz = p.z - g.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1e-5;
      const mid = (g.rIn + g.rOut) * 0.5;
      if (d < mid && d + r > g.rIn) {
        const pen = d + r - g.rIn; p.x -= dx / d * pen; p.z -= dz / d * pen;
        if (v) { const vn = -(v.x * dx + v.z * dz) / d; if (vn < 0) { v.x += vn * dx / d; v.z += vn * dz / d; } }
        touched = true;
      } else if (d >= mid && d - r < g.rOut) {
        const pen = g.rOut - (d - r); p.x += dx / d * pen; p.z += dz / d * pen;
        touched = true;
      }
    }
    return touched;
  }

  // Ray cast; returns this.hit (shared) or null. d must be normalized.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    let found = false;
    let bnx = 0, bny = 0, bnz = 0, bobj = null;
    const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      let t1 = (b.minX - ox) * ix, t2 = (b.maxX - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      let nx = dx > 0 ? -1 : 1, ny = 0, nz = 0;
      t1 = (b.minY - oy) * iy; t2 = (b.maxY - oy) * iy;
      let a = Math.min(t1, t2), c = Math.max(t1, t2);
      if (a > tmin) { tmin = a; nx = 0; ny = dy > 0 ? -1 : 1; nz = 0; }
      if (c < tmax) tmax = c;
      t1 = (b.minZ - oz) * iz; t2 = (b.maxZ - oz) * iz;
      a = Math.min(t1, t2); c = Math.max(t1, t2);
      if (a > tmin) { tmin = a; nx = 0; ny = 0; nz = dz > 0 ? -1 : 1; }
      if (c < tmax) tmax = c;
      if (b.ramp) {
        // half-space: y - k*axis - c <= 0
        const r = b.ramp;
        const oa = r.axis === 'x' ? ox : oz, da = r.axis === 'x' ? dx : dz;
        const f0 = oy - r.k * oa - r.c, f1 = dy - r.k * da;
        if (Math.abs(f1) < 1e-9) { if (f0 > 0) continue; }
        else {
          const tp = -f0 / f1;
          if (f1 > 0) { if (tp < tmax) tmax = tp; }
          else if (tp > tmin) {
            tmin = tp;
            const inv = 1 / Math.sqrt(1 + r.k * r.k);
            ny = inv; if (r.axis === 'x') { nx = -r.k * inv; nz = 0; } else { nz = -r.k * inv; nx = 0; }
          }
        }
      }
      if (tmax < Math.max(tmin, 0) || tmin > best) continue;
      if (tmin < 0) continue; // origin inside: ignore
      best = tmin; found = true; bnx = nx; bny = ny; bnz = nz; bobj = b;
    }
    for (let i = 0; i < this.cyls.length; i++) {
      const cy = this.cyls[i];
      // side
      const px = ox - cy.x, pz = oz - cy.z;
      const A = dx * dx + dz * dz;
      if (A > 1e-10) {
        const B = px * dx + pz * dz, C = px * px + pz * pz - cy.r * cy.r;
        const disc = B * B - A * C;
        if (disc >= 0) {
          const t = (-B - Math.sqrt(disc)) / A;
          if (t >= 0 && t < best) {
            const y = oy + dy * t;
            if (y >= cy.y0 && y <= cy.y1) {
              best = t; found = true; bobj = cy;
              bnx = (px + dx * t) / cy.r; bny = 0; bnz = (pz + dz * t) / cy.r;
            }
          }
        }
      }
      // caps
      if (Math.abs(dy) > 1e-9) {
        for (const capY of [cy.y1, cy.y0]) {
          const t = (capY - oy) / dy;
          if (t < 0 || t >= best) continue;
          const x = px + dx * t, z = pz + dz * t;
          if (x * x + z * z <= cy.r * cy.r) {
            best = t; found = true; bobj = cy;
            bnx = 0; bnz = 0; bny = capY === cy.y1 ? 1 : -1;
          }
        }
      }
    }
    for (let i = 0; i < this.rings.length; i++) {
      const g = this.rings[i];
      const px = ox - g.x, pz = oz - g.z;
      const A = dx * dx + dz * dz;
      const d0 = Math.sqrt(px * px + pz * pz);
      if (A > 1e-10) {
        const B = px * dx + pz * dz;
        // inner surface (seen from inside): far root of the inner circle
        if (d0 < g.rIn) {
          const C = px * px + pz * pz - g.rIn * g.rIn;
          const disc = B * B - A * C;
          if (disc >= 0) {
            const t = (-B + Math.sqrt(disc)) / A;
            const y = oy + dy * t;
            if (t >= 0 && t < best && y >= g.y0 && y <= g.y1) {
              best = t; found = true; bobj = g;
              bnx = -(px + dx * t) / g.rIn; bny = 0; bnz = -(pz + dz * t) / g.rIn;
            }
          }
        } else if (d0 > g.rOut) {
          const C = px * px + pz * pz - g.rOut * g.rOut;
          const disc = B * B - A * C;
          if (disc >= 0) {
            const t = (-B - Math.sqrt(disc)) / A;
            const y = oy + dy * t;
            if (t >= 0 && t < best && y >= g.y0 && y <= g.y1) {
              best = t; found = true; bobj = g;
              bnx = (px + dx * t) / g.rOut; bny = 0; bnz = (pz + dz * t) / g.rOut;
            }
          }
        }
      }
      if (Math.abs(dy) > 1e-9) {
        const t = (g.y1 - oy) / dy;
        if (t >= 0 && t < best) {
          const x = px + dx * t, z = pz + dz * t;
          const rr = x * x + z * z;
          if (rr >= g.rIn * g.rIn && rr <= g.rOut * g.rOut) { best = t; found = true; bobj = g; bnx = 0; bny = 1; bnz = 0; }
        }
      }
    }
    if (!found) return null;
    const h = this.hit;
    h.t = best; h.nx = bnx; h.ny = bny; h.nz = bnz; h.obj = bobj;
    h.x = ox + dx * best; h.y = oy + dy * best; h.z = oz + dz * best;
    return h;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05);
  }

  insideSolid(x, y, z) {
    for (const b of this.boxes) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y > b.minY && y < this.topAt(b, x, z)) return true;
    }
    for (const c of this.cyls) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r && y > c.y0 && y < c.y1) return true;
    }
    return false;
  }
}
