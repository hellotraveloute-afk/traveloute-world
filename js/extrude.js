// Builds low-poly buildings straight into typed arrays: walls plus a roof.
//
// This replaces one THREE.ExtrudeGeometry per building followed by a merge. It
// skips the floor (never visible), creates no temporary objects for ordinary
// convex footprints, and writes each chunk of a tile into a single buffer.
//
// Roofs: small, roughly rectangular buildings get a gable roof along their long
// side; the rest get a flat roof, optionally with a low parapet lip.
//
// Every vertex also gets `aWin` (metres): x = distance along the walls, y = height
// above the ground, z = wall height. The building shader draws the plinth band
// and the windows from it, so neither costs any geometry. Roofs have y = NOT_WALL.
//
// Coordinates: x east, z south, y up (the same as the world). Faces wind
// counter-clockwise seen from outside, so back-face culling works.

export const NOT_WALL = -100;

export class BuildingBuffer {
  constructor(withNormals = true, initialVerts = 1024) {
    this.withNormals = withNormals;
    this.n = 0; // vertices written
    this.cap = initialVerts;
    this.pos = new Float32Array(initialVerts * 3);
    this.col = new Float32Array(initialVerts * 3);
    this.win = new Float32Array(initialVerts * 3);
    this.nrm = withNormals ? new Float32Array(initialVerts * 3) : null;
    this.buildings = 0;
    this.gables = 0;
    // scratch for the current wall: aWin values of the vertex being written
    this.wx = 0;
    this.wy = NOT_WALL;
    this.wz = 0;
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
    this.win = grow(this.win);
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
    this.win[i] = this.wx;
    this.win[i + 1] = this.wy;
    this.win[i + 2] = this.wz;
    if (this.nrm) {
      this.nrm[i] = nx;
      this.nrm[i + 1] = ny;
      this.nrm[i + 2] = nz;
    }
    this.n++;
  }

  // A wall quad from p to q between heights y0 and y1. `along` is the distance
  // along the walls at p; `ground` is the ground height for aWin.
  wallQuad(p, q, y0, y1, c, along, ground, wallH, flip = false) {
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len;
    let nz = dx / len;
    if (flip) {
      [p, q] = [q, p];
      nx = -nx;
      nz = -nz;
    }
    const a0 = flip ? along + len : along;
    const a1 = flip ? along : along + len;
    this.wz = wallH;
    const v = (pt, y, a) => {
      this.wx = a;
      this.wy = y - ground;
      this.vert(pt.x, y, pt.z, c, nx, 0, nz);
    };
    v(p, y0, a0);
    v(q, y0, a1);
    v(q, y1, a1);
    v(p, y0, a0);
    v(q, y1, a1);
    v(p, y1, a0);
    return len;
  }

  // A triangle that always faces up (roofs). Normal from the actual slope.
  roofTri(a, b, c, col) {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (ny < 0) {
      [b, c] = [c, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    this.wy = NOT_WALL;
    this.vert(a.x, a.y, a.z, col, nx / l, ny / l, nz / l);
    this.vert(b.x, b.y, b.z, col, nx / l, ny / l, nz / l);
    this.vert(c.x, c.y, c.z, col, nx / l, ny / l, nz / l);
  }

  // ring: [{x, z}, ...] footprint, open or closed. `triangulate(points)` is only
  // called for concave footprints and returns index triples [[a, b, c], ...].
  // style (all optional):
  //   gableArea  footprints up to this many m² that are (nearly) rectangles get a gable roof
  //   parapet    height of the lip around flat roofs (0 = none)
  //   rim        colour of the parapet (default: the roof colour)
  //   along      where the window pattern starts along the walls (varies buildings)
  // Returns false (and writes nothing) for shapes that can't be built.
  add(ring, bottom, top, wall, roof, triangulate, style = {}) {
    let pts = cleanRing(ring);
    if (!pts) return false;

    // walls need the footprint clockwise in (x, z), i.e. negative signed area
    if (signedArea(pts) > 0) pts.reverse();
    const ground = bottom + 1; // buildings start 1 m below the lowest ground point
    const along = style.along || 0;

    if (style.gableArea) {
      const rect = gableFootprint(pts, style.gableArea);
      if (rect) {
        const short = Math.min(dist(rect[0], rect[1]), dist(rect[1], rect[2]));
        this.addGable(rect, bottom, top, clamp(short * 0.35, 1.5, 4), wall, roof, along, ground);
        return true;
      }
    }

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
    const lip = style.parapet || 0;
    const inner = lip ? insetRing(pts, 0.5) : null;
    this.reserve(m * 6 + tris.length * 3 + (inner ? m * 12 : 0));
    const wallTop = top + lip;

    // walls
    let a = along;
    for (let i = 0; i < m; i++) a += this.wallQuad(pts[i], pts[(i + 1) % m], bottom, wallTop, wall, a, ground, wallTop - ground);

    // parapet: inner face of the lip and its top, in the rim colour
    if (inner) {
      const rim = style.rim || roof;
      this.wy = NOT_WALL;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        this.wallQuad(inner[i], inner[j], top, wallTop, rim, 0, 1e4, 0, true);
        this.roofTri(at(pts[i], wallTop), at(pts[j], wallTop), at(inner[j], wallTop), rim);
        this.roofTri(at(pts[i], wallTop), at(inner[j], wallTop), at(inner[i], wallTop), rim);
      }
      pts = inner;
    }

    // roof, every triangle facing up
    for (const [ia, ib, ic] of tris) {
      const pa = pts[ia];
      const pb = pts[ib];
      const pc = pts[ic];
      if (!pa || !pb || !pc) continue;
      this.roofTri(at(pa, top), at(pb, top), at(pc, top), roof);
    }
    this.buildings++;
    return true;
  }

  // Gable roof on a rectangle (4 clockwise corners): the ridge runs along the long
  // side at `ridge` metres above the eaves, the short sides get triangular gables.
  addGable(rect, bottom, top, ridge, wall, roof, along = 0, ground = bottom + 1) {
    // make edge 0 (and 2) the long sides
    const r = dist(rect[0], rect[1]) >= dist(rect[1], rect[2]) ? rect : [rect[1], rect[2], rect[3], rect[0]];
    const [p0, p1, p2, p3] = r;
    const m1 = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 }; // ridge ends above the gable walls
    const m3 = { x: (p3.x + p0.x) / 2, z: (p3.z + p0.z) / 2 };
    const peak = top + ridge;
    this.reserve(42);
    let a = along;
    for (let i = 0; i < 4; i++) {
      const p = r[i];
      const q = r[(i + 1) % 4];
      const len = this.wallQuad(p, q, bottom, top, wall, a, ground, top - ground);
      if (i === 1 || i === 3) {
        // gable triangle, same outward normal as the wall below it
        const m = i === 1 ? m1 : m3;
        const nx = -(q.z - p.z) / len;
        const nz = (q.x - p.x) / len;
        const v = (pt, y, s) => {
          this.wx = s;
          this.wy = y - ground;
          this.vert(pt.x, y, pt.z, wall, nx, 0, nz);
        };
        v(p, top, a);
        v(q, top, a + len);
        v(m, peak, a + len / 2);
      }
      a += len;
    }
    this.roofTri(at(p0, top), at(p1, top), at(m1, peak), roof);
    this.roofTri(at(p0, top), at(m1, peak), at(m3, peak), roof);
    this.roofTri(at(p2, top), at(p3, top), at(m3, peak), roof);
    this.roofTri(at(p2, top), at(m3, peak), at(m1, peak), roof);
    this.buildings++;
    this.gables++;
  }

  // Trimmed copies, ready for BufferAttributes.
  arrays() {
    const k = this.n * 3;
    return {
      position: this.pos.slice(0, k),
      color: this.col.slice(0, k),
      win: this.win.slice(0, k),
      normal: this.nrm ? this.nrm.slice(0, k) : null,
      count: this.n,
    };
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const at = (p, y) => ({ x: p.x, y, z: p.z });

// The rectangle a gable roof sits on, or null. Plain 4-corner footprints are used
// as they are; others qualify if their smallest enclosing rectangle is at least
// 85 % filled (then the building is squared off to that rectangle).
// `pts` must be clockwise; the result is clockwise too.
export function gableFootprint(pts, maxArea) {
  const area = -signedArea(pts);
  if (area <= 0 || area > maxArea) return null;
  if (pts.length === 4 && isConvex(pts)) {
    // a real quad, but only if its corners are near right angles
    for (let i = 0; i < 4; i++) {
      const a = pts[(i + 3) % 4];
      const b = pts[i];
      const c = pts[(i + 1) % 4];
      const cos = ((a.x - b.x) * (c.x - b.x) + (a.z - b.z) * (c.z - b.z)) / (dist(a, b) * dist(c, b) || 1);
      if (Math.abs(cos) > 0.26) return null; // more than ~15° off square
    }
    return pts;
  }
  const box = orientedBox(pts);
  if (!box || area / box.area < 0.85) return null;
  return box.corners;
}

// Smallest-area rectangle around the points, trying each edge direction.
export function orientedBox(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const len = dist(p, q);
    if (len < 1e-6) continue;
    const ux = (q.x - p.x) / len;
    const uz = (q.z - p.z) / len;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const s of pts) {
      const a = s.x * ux + s.z * uz;
      const b = -s.x * uz + s.z * ux;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { area, ux, uz, a0, a1, b0, b1 };
  }
  if (!best || best.area <= 0) return null;
  const { ux, uz, a0, a1, b0, b1 } = best;
  const pt = (a, b) => ({ x: a * ux - b * uz, z: a * uz + b * ux });
  const corners = [pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)];
  if (signedArea(corners) > 0) corners.reverse();
  return { area: best.area, corners };
}

// The ring moved inwards by `d` metres (clockwise ring). Mitred corners, with
// very sharp corners clamped so they don't shoot across the roof.
export function insetRing(pts, d) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const l1 = dist(a, b) || 1;
    const l2 = dist(b, c) || 1;
    // outward normals of the two edges (same convention as the walls)
    const n1x = -(b.z - a.z) / l1;
    const n1z = (b.x - a.x) / l1;
    const n2x = -(c.z - b.z) / l2;
    const n2z = (c.x - b.x) / l2;
    // mitre: (n1 + n2) * d / (1 + n1·n2) keeps both edges exactly d away
    const k = 1 + n1x * n2x + n1z * n2z;
    const s = k > 1e-3 ? d / k : d;
    let mx = (n1x + n2x) * s;
    let mz = (n1z + n2z) * s;
    const ml = Math.hypot(mx, mz);
    if (ml > d * 3) {
      mx *= (d * 3) / ml;
      mz *= (d * 3) / ml;
    }
    out[i] = { x: b.x - mx, z: b.z - mz };
  }
  return out;
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
