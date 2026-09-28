// Low-poly toon tree shapes (metres), each merged with its trunk so one instanced
// draw covers both. `aTrunk` marks trunk vertices; the tile material colours them
// brown, shades the crown two-tone and sways it in the wind.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function merge(crowns, trunks) {
  const parts = [];
  const mark = (g, v) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    ng.setAttribute('aTrunk', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count).fill(v), 1));
    parts.push(ng);
  };
  crowns.forEach((g) => mark(g, 0));
  trunks.forEach((g) => mark(g, 1));
  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

const trunk = (h = 2.6) => new THREE.CylinderGeometry(0.35, 0.5, h, 5, 1, true).translate(0, h / 2, 0);

// pine: two stacked cones (open underneath: the camera is always above)
export function pineGeometry() {
  return merge(
    [new THREE.ConeGeometry(2.5, 5.2, 6, 1, true).translate(0, 4.6, 0), new THREE.ConeGeometry(1.8, 4.2, 6, 1, true).translate(0, 7.4, 0)],
    [trunk()]
  );
}

// round: a squashed icosahedron with a smaller one offset, so crowns look lumpy
export function roundGeometry() {
  return merge(
    [new THREE.IcosahedronGeometry(3.1, 0).scale(1, 0.85, 1).translate(0, 5.2, 0), new THREE.OctahedronGeometry(1.9, 0).translate(1.4, 6.6, 0.6)],
    [trunk()]
  );
}

// palm: a curved, tapering trunk and drooping frond blades
export function palmGeometry({ height = 9, lean = 1.4, segments = 4, sides = 5, fronds = 7 } = {}) {
  const tp = [];
  const tn = [];
  const ring = (k) => {
    const s = k / segments;
    return { x: lean * s * s, y: height * s, r: 0.42 - 0.18 * s };
  };
  for (let k = 0; k < segments; k++) {
    const a = ring(k);
    const b = ring(k + 1);
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2;
      const t1 = ((i + 1) / sides) * Math.PI * 2;
      const P = (c, t) => [c.x + Math.cos(t) * c.r, c.y, Math.sin(t) * c.r];
      const quad = [P(a, t0), P(b, t0), P(b, t1), P(a, t0), P(b, t1), P(a, t1)];
      const tm = (t0 + t1) / 2;
      for (const v of quad) {
        tp.push(...v);
        tn.push(Math.cos(tm), 0, Math.sin(tm));
      }
    }
  }
  const top = ring(segments);
  const fp = [];
  const fnm = [];
  // one triangle that faces up (fronds are seen from above)
  const upTri = (A, B, C) => {
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (n[1] < 0) {
      [B, C] = [C, B];
      n = n.map((v) => -v);
    }
    const l = Math.hypot(...n) || 1;
    for (const v of [A, B, C]) {
      fp.push(...v);
      fnm.push(n[0] / l, n[1] / l, n[2] / l);
    }
  };
  for (let i = 0; i < fronds; i++) {
    const t = (i / fronds) * Math.PI * 2 + 0.3;
    const dx = Math.cos(t);
    const dz = Math.sin(t);
    const root = [top.x, top.y, 0];
    const mid = [top.x + dx * 1.9, top.y + 0.55, dz * 1.9];
    const tip = [top.x + dx * 3.7, top.y - 1.3, dz * 3.7];
    const w = 0.55;
    const midL = [mid[0] - dz * w, mid[1], mid[2] + dx * w];
    const midR = [mid[0] + dz * w, mid[1], mid[2] - dx * w];
    upTri(root, midL, midR);
    upTri(midL, tip, midR);
  }
  const geo = (p, n) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return g;
  };
  return merge([geo(fp, fnm)], [geo(tp, tn)]);
}
