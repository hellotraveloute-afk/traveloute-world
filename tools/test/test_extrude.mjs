import { BuildingBuffer, isConvex, cleanRing, NOT_WALL } from './app/extrude.mjs';
// naive ear clipping for the test only
function earclip(pts) {
  const idx = pts.map((_, i) => i); const tris = [];
  const area = (a,b,c)=> (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
  let s=0; for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length]; s+=a.x*b.z-b.x*a.z;} const sgn=Math.sign(s);
  let guard=0;
  while (idx.length>3 && guard++<1000) {
    for (let i=0;i<idx.length;i++){
      const a=pts[idx[(i+idx.length-1)%idx.length]], b=pts[idx[i]], c=pts[idx[(i+1)%idx.length]];
      if (Math.sign(area(a,b,c))!==sgn) continue;
      tris.push([idx[(i+idx.length-1)%idx.length], idx[i], idx[(i+1)%idx.length]]); idx.splice(i,1); break;
    }
  }
  tris.push([idx[0],idx[1],idx[2]]); return tris;
}
const W={r:1,g:0,b:0}, R={r:0,g:0,b:1};
function check(name, ring) {
  const bb = new BuildingBuffer(true, 4);
  const ok = bb.add(ring, 0, 10, W, R, earclip);
  const a = bb.arrays();
  const pts = cleanRing(ring); let cx=0,cz=0; for(const p of pts){cx+=p.x;cz+=p.z} cx/=pts.length; cz/=pts.length;
  let bad = 0, walls=0, roofs=0;
  for (let t=0;t<a.count/3;t++){
    const v = (k)=>[a.position[(t*3+k)*3],a.position[(t*3+k)*3+1],a.position[(t*3+k)*3+2]];
    const [A,B,C]=[v(0),v(1),v(2)];
    const u=[B[0]-A[0],B[1]-A[1],B[2]-A[2]], w=[C[0]-A[0],C[1]-A[1],C[2]-A[2]];
    const n=[u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
    const sn=[a.normal[t*9],a.normal[t*9+1],a.normal[t*9+2]];
    const isRoof = a.color[t*9+2]===1;
    if (isRoof) { roofs++; if (!(n[1]>0)) bad++; }
    else { walls++;
      const mx=(A[0]+B[0]+C[0])/3-cx, mz=(A[2]+B[2]+C[2])/3-cz;
      // for convex shapes the outward normal points away from the centroid
      if (isConvex(pts) && n[0]*mx+n[2]*mz <= 0) bad++;
    }
    if (n[0]*sn[0]+n[1]*sn[1]+n[2]*sn[2] <= 0) bad++;
  }
  console.log(`${name.padEnd(22)} ok=${ok} walls=${walls} roofs=${roofs} bad=${bad}`);
  return bad===0 && ok;
}
const sq=[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:0,z:10},{x:0,z:0}];
const L=[{x:0,z:0},{x:10,z:0},{x:10,z:4},{x:4,z:4},{x:4,z:10},{x:0,z:10},{x:0,z:0}];
let all = true;
all &= check('square (closed)', sq);
all &= check('square reversed', [...sq].reverse());
all &= check('L-shape concave', L);
all &= check('L-shape reversed', [...L].reverse());
all &= check('hexagon', Array.from({length:7},(_,i)=>({x:Math.cos(i*Math.PI/3)*5,z:Math.sin(i*Math.PI/3)*5})));
const deg = new BuildingBuffer(); console.log('degenerate rejected:', deg.add([{x:0,z:0},{x:1,z:1},{x:0,z:0}],0,1,W,R,earclip)===false);
// growth
const g=new BuildingBuffer(true,2); for(let i=0;i<500;i++) g.add(sq.map(p=>({x:p.x+i*20,z:p.z})),0,5,W,R,earclip);
console.log('500 buildings verts', g.arrays().count, 'expected', 500*(4*6+2*3));

// ---- roofs with character: gables, parapets, plinth/window attribute
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) all = false; };
const tri = (a, t) => [0, 1, 2].map((k) => [a.position[(t * 3 + k) * 3], a.position[(t * 3 + k) * 3 + 1], a.position[(t * 3 + k) * 3 + 2]]);
const faceN = ([A, B, C]) => { const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]; return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; };
// Every edge above the (open) bottom must be used exactly once in each direction:
// the surface is closed and consistently wound (outward everywhere).
function watertight(a, bottom) {
  const key = (p) => p.map((v) => v.toFixed(3)).join(',');
  const dir = new Map();
  for (let t = 0; t < a.count / 3; t++) {
    const T = tri(a, t);
    for (let k = 0; k < 3; k++) {
      const p = T[k], q = T[(k + 1) % 3];
      if (Math.abs(p[1] - bottom) < 1e-6 && Math.abs(q[1] - bottom) < 1e-6) continue; // open floor
      const d = key(p) + '>' + key(q);
      dir.set(d, (dir.get(d) || 0) + 1);
    }
  }
  let bad = 0;
  for (const [d, n] of dir) { const [p, q] = d.split('>'); if (n !== 1 || dir.get(q + '>' + p) !== 1) bad++; }
  return bad;
}
{
  const bb = new BuildingBuffer(true, 4);
  const rect = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: 6 }];
  ok(bb.add(rect, 0, 7, W, R, earclip, { gableArea: 400 }) && bb.gables === 1, 'small rectangle gets a gable roof');
  const a = bb.arrays();
  ok(a.count === 42, `gable vertices ${a.count} (24 walls + 6 gables + 12 roof)`);
  let maxY = 0, roofUp = 0, roofTris = 0, badN = 0;
  for (let t = 0; t < a.count / 3; t++) {
    const T = tri(a, t); const n = faceN(T);
    maxY = Math.max(maxY, ...T.map((p) => p[1]));
    const sn = [a.normal[t * 9], a.normal[t * 9 + 1], a.normal[t * 9 + 2]];
    if (n[0] * sn[0] + n[1] * sn[1] + n[2] * sn[2] <= 0) badN++;
    if (a.color[t * 9 + 2] === 1) { roofTris++; if (n[1] > 0 && sn[1] > 0.3) roofUp++; }
  }
  ok(Math.abs(maxY - (7 + 2.1)) < 1e-6, `ridge at 35 % of the short side (${(maxY - 7).toFixed(2)} m)`);
  ok(roofTris === 4 && roofUp === 4, `roof slopes face up (${roofUp}/${roofTris})`);
  ok(badN === 0, 'stored normals match the winding');
  ok(watertight(a, 0) === 0, 'gable building is closed and wound outward');
  // ridge along the long side: ridge endpoints sit over the short (6 m) sides
  const ridge = []; for (let i = 0; i < a.count; i++) if (Math.abs(a.position[i * 3 + 1] - 9.1) < 1e-6) ridge.push(a.position[i * 3] + ',' + a.position[i * 3 + 2]);
  ok(new Set(ridge).size === 2 && [...new Set(ridge)].every((s) => s === '0,3' || s === '10,3'), `ridge runs along the long side (${[...new Set(ridge)].join(' / ')})`);

  // plinth + windows attribute: wall height above ground, wall height; roofs flagged
  let wallOk = true, roofFlag = true;
  for (let i = 0; i < a.count; i++) {
    const y = a.position[i * 3 + 1], wy = a.win[i * 3 + 1], wz = a.win[i * 3 + 2];
    const isRoof = a.color[i * 3 + 2] === 1;
    if (isRoof) { if (wy !== NOT_WALL) roofFlag = false; }
    else if (Math.abs(wy - (y - 1)) > 1e-6 || Math.abs(wz - 6) > 1e-6) wallOk = false;
  }
  ok(wallOk, 'wall aWin = (along, height above ground, wall height); ground = bottom + 1');
  ok(roofFlag, 'roof vertices are flagged NOT_WALL (no plinth or windows)');
  const bottoms = []; for (let i = 0; i < a.count; i++) if (a.position[i * 3 + 1] === 0) bottoms.push(a.win[i * 3 + 1]);
  ok(bottoms.length > 0 && bottoms.every((v) => v < 0.8), 'wall feet fall inside the 0.8 m plinth band');
}
{
  // nearly rectangular (extra point on an edge) -> squared off to its box, gable
  const bb = new BuildingBuffer(true, 4);
  ok(bb.add([{ x: 0, z: 0 }, { x: 5, z: 0.2 }, { x: 12, z: 0 }, { x: 12, z: 7 }, { x: 0, z: 7 }], 0, 5, W, R, earclip, { gableArea: 400 }) && bb.gables === 1, 'near-rectangle (box fill >= 85 %) gets a gable');
  const L2 = new BuildingBuffer(true, 4);
  L2.add(L, 0, 5, W, R, earclip, { gableArea: 400 });
  ok(L2.gables === 0, 'L-shape keeps a flat roof');
  const big = new BuildingBuffer(true, 4);
  big.add([{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 20 }, { x: 0, z: 20 }], 0, 5, W, R, earclip, { gableArea: 400 });
  ok(big.gables === 0, 'large building (600 m²) keeps a flat roof');
  const skew = new BuildingBuffer(true, 4);
  skew.add([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 14, z: 6 }, { x: 4, z: 6 }], 0, 5, W, R, earclip, { gableArea: 400 });
  ok(skew.gables === 0, 'parallelogram (not square-cornered) keeps a flat roof');
}
{
  // parapet lip on a flat roof
  const rim = { r: 0, g: 1, b: 0 };
  const bb = new BuildingBuffer(true, 4);
  const box = [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 0, z: 30 }];
  bb.add(box, 0, 10, W, R, earclip, { gableArea: 400, parapet: 0.4, rim });
  const a = bb.arrays();
  let maxY = 0; for (let i = 0; i < a.count; i++) maxY = Math.max(maxY, a.position[i * 3 + 1]);
  ok(Math.abs(maxY - 10.4) < 1e-6, 'parapet walls rise 0.4 m above the roof');
  ok(a.count === 4 * 6 + 4 * 12 + 2 * 3, `parapet vertices ${a.count}`);
  ok(watertight(a, 0) === 0, 'parapet building is closed and wound outward');
  let rimUp = true; for (let t = 0; t < a.count / 3; t++) { const T = tri(a, t); if (a.color[t * 9 + 1] === 1 && T.every((p) => Math.abs(p[1] - 10.4) < 1e-6) && faceN(T)[1] <= 0) rimUp = false; }
  ok(rimUp, 'parapet top faces up');
}
console.log(all ? 'ALL PASS' : 'FAIL');
process.exit(all ? 0 : 1);
