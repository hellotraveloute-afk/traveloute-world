// Minimal three.js stand-in for testing control flow and geometry data in Node.
// Only what tiles/fog/landmarks/perf use; geometry transforms are real maths.
export const stats = { disposed: 0, textures: 0, uploads: 0 };

export class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; return this.set(this.x / l, this.y / l, this.z / l); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  setScalar(s) { return this.set(s, s, s); }
  project() { return this; }
}
export class Quaternion { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } setFromAxisAngle(a, ang) { const s = Math.sin(ang / 2); this.x = a.x * s; this.y = a.y * s; this.z = a.z * s; this.w = Math.cos(ang / 2); return this; } }
export class Matrix4 {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  compose(p, q, s) {
    const { x, y, z, w } = q; const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    const e = this.elements;
    e[0] = (1 - (yy + zz)) * s.x; e[1] = (xy + wz) * s.x; e[2] = (xz - wy) * s.x; e[3] = 0;
    e[4] = (xy - wz) * s.y; e[5] = (1 - (xx + zz)) * s.y; e[6] = (yz + wx) * s.y; e[7] = 0;
    e[8] = (xz + wy) * s.z; e[9] = (yz - wx) * s.z; e[10] = (1 - (xx + yy)) * s.z; e[11] = 0;
    e[12] = p.x; e[13] = p.y; e[14] = p.z; e[15] = 1; return this;
  }
  toArray(a, o = 0) { for (let i = 0; i < 16; i++) a[o + i] = this.elements[i]; return a; }
}
const hexRe = /^#?([0-9a-f]{6})$/i;
const toLin = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
export class Color {
  constructor(v) { this.r = 1; this.g = 1; this.b = 1; if (v !== undefined) this.set(v); }
  set(v) {
    if (v instanceof Color) { this.r = v.r; this.g = v.g; this.b = v.b; return this; }
    const m = hexRe.exec(v); if (!m) throw new Error('bad colour ' + v);
    const n = parseInt(m[1], 16); this.r = toLin(((n >> 16) & 255) / 255); this.g = toLin(((n >> 8) & 255) / 255); this.b = toLin((n & 255) / 255); return this;
  }
  offsetHSL(h, s, l) { this.r = Math.min(1, Math.max(0, this.r + l)); this.g = Math.min(1, Math.max(0, this.g + l)); this.b = Math.min(1, Math.max(0, this.b + l)); return this; }
  toArray(a, o = 0) { a[o] = this.r; a[o + 1] = this.g; a[o + 2] = this.b; return a; }
  copy(c) { return this.set(c); }
}
export class Sphere { constructor(c = new Vector3(), r = 0) { this.center = c; this.radius = r; } }

export class BufferAttribute {
  constructor(array, itemSize) { if (!(ArrayBuffer.isView(array))) throw new Error('attribute needs typed array'); this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
  getX(i) { return this.array[i * this.itemSize]; } getY(i) { return this.array[i * this.itemSize + 1]; } getZ(i) { return this.array[i * this.itemSize + 2]; }
  setY(i, v) { this.array[i * this.itemSize + 1] = v; }
}
export class Float32BufferAttribute extends BufferAttribute { constructor(a, s) { super(a instanceof Float32Array ? a : new Float32Array(a), s); } }
export class InstancedBufferAttribute extends BufferAttribute {}
export class EventTarget { dispose() { stats.disposed++; this.disposed = true; } }

export class BufferGeometry extends EventTarget {
  constructor() { super(); this.attributes = {}; this.index = null; this.boundingSphere = null; }
  setAttribute(n, a) { this.attributes[n] = a; return this; }
  deleteAttribute(n) { delete this.attributes[n]; return this; }
  setIndex(i) { this.index = new BufferAttribute(new Uint32Array(i), 1); return this; }
  applyFn(fn) { const p = this.attributes.position; for (let i = 0; i < p.count; i++) { const [x, y, z] = fn(p.array[i * 3], p.array[i * 3 + 1], p.array[i * 3 + 2]); p.array[i * 3] = x; p.array[i * 3 + 1] = y; p.array[i * 3 + 2] = z; } return this; }
  translate(x, y, z) { return this.applyFn((a, b, c) => [a + x, b + y, c + z]); }
  rotateX(ang) { const c = Math.cos(ang), s = Math.sin(ang); return this.applyFn((x, y, z) => [x, y * c - z * s, y * s + z * c]); }
  toNonIndexed() {
    if (!this.index) return this;
    const g = new BufferGeometry(); const idx = this.index.array;
    for (const [n, a] of Object.entries(this.attributes)) { const out = new Float32Array(idx.length * a.itemSize); for (let i = 0; i < idx.length; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.array[idx[i] * a.itemSize + k]; g.setAttribute(n, new BufferAttribute(out, a.itemSize)); }
    return g;
  }
  computeVertexNormals() { const n = this.attributes.position.count; if (!this.attributes.normal) this.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3)); this.normalsComputed = true; }
  computeBoundingSphere() {
    const p = this.attributes.position.array; let cx = 0, cy = 0, cz = 0; const n = p.length / 3;
    for (let i = 0; i < n; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n; let r = 0; for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(p[i * 3] - cx, p[i * 3 + 1] - cy, p[i * 3 + 2] - cz));
    this.boundingSphere = new Sphere(new Vector3(cx, cy, cz), r);
  }
}
function gridGeo(verts, tris) { const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3)); g.setAttribute('normal', new BufferAttribute(new Float32Array(verts.length), 3)); g.setAttribute('uv', new BufferAttribute(new Float32Array((verts.length / 3) * 2), 2)); if (tris) g.setIndex(tris); return g; }
export class PlaneGeometry extends BufferGeometry {
  constructor(w, h, sx, sy) {
    super(); const v = []; const idx = [];
    for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) v.push((i / sx) * w - w / 2, h / 2 - (j / sy) * h, 0);
    for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) { const a = j * (sx + 1) + i; idx.push(a, a + sx + 1, a + 1, a + sx + 1, a + sx + 2, a + 1); }
    Object.assign(this, gridGeo(v, idx));
  }
}
function ringGeo(n, r0, r1, h, capBottom) { const v = []; const idx = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; v.push(Math.cos(a) * r1, h / 2, Math.sin(a) * r1, Math.cos(a) * r0, -h / 2, Math.sin(a) * r0); } for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } if (capBottom) { const c = v.length / 3; v.push(0, -h / 2, 0); for (let i = 0; i < n; i++) idx.push(c, i * 2 + 1, i * 2 + 3); } return gridGeo(v, idx); }
export class CylinderGeometry extends BufferGeometry { constructor(rt, rb, h, n = 8, hs = 1, open = false) { super(); Object.assign(this, ringGeo(n, rb, rt, h, !open)); this.openEnded = open; } }
export class ConeGeometry extends BufferGeometry { constructor(r, h, n = 8) { super(); Object.assign(this, ringGeo(n, r, 0, h, true)); } }
export class IcosahedronGeometry extends BufferGeometry { constructor(r) { super(); const v = []; for (let i = 0; i < 60; i++) { const a = i * 2.4; v.push(Math.cos(a) * r, Math.sin(i) * r, Math.sin(a) * r); } Object.assign(this, gridGeo(v, null)); } }
export class OctahedronGeometry extends IcosahedronGeometry {}
export class RingGeometry extends IcosahedronGeometry {}
export class SphereGeometry extends IcosahedronGeometry {}
export class CapsuleGeometry extends IcosahedronGeometry {}
export class BoxGeometry extends IcosahedronGeometry {}

export function mergeGeometries(gs) {
  const names = Object.keys(gs[0].attributes);
  for (const g of gs) { if (g.index) throw new Error('merge: mixed indexed'); const n2 = Object.keys(g.attributes); if (n2.length !== names.length || !names.every((n) => n2.includes(n))) throw new Error('merge: attribute mismatch ' + n2.join(',') + ' vs ' + names.join(',')); }
  const out = new BufferGeometry();
  for (const n of names) { const len = gs.reduce((s, g) => s + g.attributes[n].array.length, 0); const arr = new Float32Array(len); let o = 0; for (const g of gs) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; } out.setAttribute(n, new BufferAttribute(arr, gs[0].attributes[n].itemSize)); }
  return out;
}

export class Object3D {
  constructor() { this.position = new Vector3(); this.rotation = new Vector3(); this.scale = new Vector3(1, 1, 1); this.children = []; this.visible = true; this.userData = {}; this.matrixAutoUpdate = true; this.parent = null; }
  add(...o) { for (const c of o) { c.parent = this; this.children.push(c); } return this; }
  remove(o) { this.children = this.children.filter((c) => c !== o); return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  updateMatrix() { this.matrixUpdated = true; }
}
export class Group extends Object3D {}
export class Scene extends Object3D {}
export class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
export class Points extends Mesh {}
export class InstancedMesh extends Mesh {
  constructor(g, m, count) { super(g, m); this.count = count; this.instanceMatrix = new InstancedBufferAttribute(new Float32Array(count * 16), 16); this.instanceColor = null; this.boundingSphere = null; }
  computeBoundingSphere() {
    if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere();
    const a = this.instanceMatrix.array; let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < this.count; i++) { const x = a[i * 16 + 12], z = a[i * 16 + 14]; minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    this.boundingSphere = new Sphere(new Vector3((minx + maxx) / 2, 0, (minz + maxz) / 2), Math.hypot(maxx - minx, maxz - minz) / 2 + this.geometry.boundingSphere.radius * 1.6);
  }
  dispose() { stats.disposed++; this.disposed = true; }
}
class Material extends EventTarget { constructor(p = {}) { super(); Object.assign(this, p); this.onBeforeCompile = null; } }
export class MeshStandardMaterial extends Material { constructor(p) { super(p); this.isMeshStandardMaterial = true; } }
export class MeshLambertMaterial extends Material { constructor(p) { if (p && 'roughness' in p) throw new Error('Lambert has no roughness'); super(p); this.isMeshLambertMaterial = true; } }
export class MeshBasicMaterial extends Material {}
export class ShaderMaterial extends Material {}
export class PointsMaterial extends Material {}
export class Texture extends EventTarget { constructor(img) { super(); this.image = img; stats.textures++; } }
export class CanvasTexture extends Texture {}
export class DataTexture extends Texture {}
export const SRGBColorSpace = 'srgb', RedFormat = 1, UnsignedByteType = 2, LinearFilter = 3, AdditiveBlending = 4, DoubleSide = 5, BackSide = 6, HalfFloatType = 7;
export const ShapeUtils = {
  triangulateShape(contour) { // fan from the first point with an ear check, enough for the test's simple concave shapes
    const pts = contour; const idx = pts.map((_, i) => i); const tris = [];
    let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; }
    const ar = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let guard = 0;
    while (idx.length > 3 && guard++ < 999) { for (let i = 0; i < idx.length; i++) { const a = pts[idx[(i + idx.length - 1) % idx.length]], b = pts[idx[i]], c = pts[idx[(i + 1) % idx.length]]; if (Math.sign(ar(a, b, c)) !== Math.sign(s)) continue; tris.push([idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]]); idx.splice(i, 1); break; } }
    tris.push([idx[0], idx[1], idx[2]]); return tris;
  },
};
