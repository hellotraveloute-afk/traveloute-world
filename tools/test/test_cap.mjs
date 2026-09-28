import './stubs/dom-stub.mjs';
import { makeFrameCap } from './app/perf.mjs';
let seed=7; const rnd=()=>{seed=(seed*16807)%2147483647; return seed/2147483647;};
for (const cap of [60, 30]) for (const hz of [60, 90, 120, 144]) {
  const due = makeFrameCap(cap); let rendered=0, t=0, maxGap=0, last=null;
  for (let i=0;i<hz*10;i++){ t = i*1000/hz + (rnd()-0.5)*1.5; if (due(t)) { rendered++; if(last!==null) maxGap=Math.max(maxGap,t-last); last=t; } }
  const fps = rendered/10;
  console.log(`cap ${cap} @ ${String(hz).padStart(3)} Hz -> ${fps.toFixed(1)} fps, worst gap ${maxGap.toFixed(1)} ms`);
}
