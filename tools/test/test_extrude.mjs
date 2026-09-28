import { BuildingBuffer, isConvex, cleanRing } from './app/extrude.mjs';
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
console.log(all ? 'ALL PASS' : 'FAIL');
