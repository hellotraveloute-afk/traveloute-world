// Builds low-poly buildings straight into typed arrays: walls plus a flat roof.
//
// This replaces one THREE.ExtrudeGeometry per building followed by a merge. It
// skips the floor (never visible), creates no temporary objects for ordinary
// convex footprints, and writes each chunk of a tile into a single buffer.
//
// Coordinates: x east, z south, y up (the same as the world). Faces wind
// counter-clockwise seen from outside, so back-face culling works.

export class BuildingBuffer {
  constructor(withNormals = true, initialVerts = 1024) {
    this.withNormals = withNormals;
    this.n = 0; // vertices written
    this.cap = initialVerts;
    this.pos = new Float32Array(initialVerts * 3);
    this.col = new Float32Array(initialVerts * 3);
    this.nrm = withNormals ? new Float32Array(initialVerts * 3) : null;
    this.buildings = 0;
  }

  reserve(extra) {
    const need = this.n + extra;
    if (need <= this.cap) return;
    let cap = this.cap * 2;
    while (cap < need) cap *= 2;
    const grow = (a) => {
      const b = new Float32Array(cap * 3);
      b.set(a.subarray(0, this.n * 3));
      return b;
    };
    this.pos = grow(this.pos);
    this.col = grow(this.col);
    if (this.nrm) this.nrm = grow(this.nrm);
    this.cap = cap;
  }

  vert(x, y, z, c, nx, ny, nz) {
    const i = this.n * 3;
    this.pos[i] = x;
    this.pos[i + 1] = y;
    this.pos[i + 2] = z;
    this.col[i] = c.r;
    this.col[i + 1] = c.g;
    this.col[i + 2] = c.b;
    if (this.nrm) {
      this.nrm[i] = nx;
      this.nrm[i + 1] = ny;
      this.nrm[i + 2] = nz;
    }
    this.n++;
  }

  // ring: [{x, z}, ...] footprint, open or closed. `triangulate(points)` is only
  // called for concave footprints and returns index triples [[a, b, c], ...].
  // Returns false (and writes nothing) for shapes that can't be built.
  add(ring, bottom, top, wall, roof, triangulate) {
    const pts = cleanRing(ring);
    if (!pts) return false;

    // walls need the footprint clockwise in (x, z), i.e. negative signed area
    if (signedArea(pts) > 0) pts.reverse();

    let tris;
    if (isConvex(pts)) {
      tris = [];
      for (let i = 1; i < pts.length - 1; i++) tris.push([0, i, i + 1]);
    } else {
      try {
        tris = triangulate(pts);
      } catch {
        return false;
      }
      if (!tris || !tris.length) return false;
    }

    const m = pts.length;
    this.reserve(m * 6 + tris.length * 3);

    // walls
    for (let i = 0; i < m; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % m];
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      this.vert(p.x, bottom, p.z, wall, nx, 0, nz);
      this.vert(q.x, bottom, q.z, wall, nx, 0, nz);
      this.vert(q.x, top, q.z, wall, nx, 0, nz);
      this.vert(p.x, bottom, p.z, wall, nx, 0, nz);
      this.vert(q.x, top, q.z, wall, nx, 0, nz);
      this.vert(p.x, top, p.z, wall, nx, 0, nz);
    }

    // roof, every triangle facing up
    for (const [ia, ib, ic] of tris) {
      const a = pts[ia];
      let b = pts[ib];
      let c = pts[ic];
      if (!a || !b || !c) continue;
      const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      if (ny < 0) [b, c] = [c, b];
      this.vert(a.x, top, a.z, roof, 0, 1, 0);
      this.vert(b.x, top, b.z, roof, 0, 1, 0);
      this.vert(c.x, top, c.z, roof, 0, 1, 0);
    }
    this.buildings++;
    return true;
  }

  // Trimmed copies, ready for BufferAttributes.
  arrays() {
    const k = this.n * 3;
    return {
      position: this.pos.slice(0, k),
      color: this.col.slice(0, k),
      normal: this.nrm ? this.nrm.slice(0, k) : null,
      count: this.n,
    };
  }
}

// Drops repeated points (including the closing point) and returns null if fewer than 3 remain.
export function cleanRing(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.z - p.z) < 1e-6) continue;
    out.push({ x: p.x, z: p.z });
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6) out.pop();
    else break;
  }
  return out.length >= 3 ? out : null;
}

export function signedArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

// True if every turn goes the same way (collinear points allowed).
export function isConvex(pts) {
  let sign = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}
