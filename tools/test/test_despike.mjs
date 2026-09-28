import './stubs/dom-stub.mjs';
import { despikeOld } from './despike_reference.mjs';
import { despike as despikeNew } from './app/tiles.mjs';
function field(seed){ let a=seed>>>0; const r=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};
  const h=new Float32Array(65536); for(let y=0;y<256;y++)for(let x=0;x<256;x++) h[y*256+x]=800+300*Math.sin(x/30)*Math.cos(y/25)+r()*5;
  for(let i=0;i<400;i++) h[Math.floor(r()*65536)] += (r()<0.5?-1:1)*(50+r()*500); // spikes and pits
  for(let i=0;i<20;i++){const x=Math.floor(r()*256); for(let y=0;y<256;y++) h[y*256+x]+=256;} // column artefacts
  return h; }
let same=true, fixed=0;
for (let s=1;s<=5;s++){ const h=field(s); const a=despikeOld(h), b=despikeNew(h);
  for(let i=0;i<a.length;i++){ if(a[i]!==b[i]) { same=false; console.log('diff at',s,i,a[i],b[i]); break; } if (a[i]!==h[i]) fixed++; } }
console.log('identical output:', same, '| samples corrected:', fixed);
const h=field(9); let t=performance.now(); for(let i=0;i<10;i++) despikeOld(h); const to=(performance.now()-t)/10;
t=performance.now(); for(let i=0;i<10;i++) despikeNew(h); const tn=(performance.now()-t)/10;
console.log(`old ${to.toFixed(1)} ms/tile, new ${tn.toFixed(1)} ms/tile (${(to/tn).toFixed(1)}x faster, desktop CPU)`);
