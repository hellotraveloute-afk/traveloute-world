import { net } from './stubs/dom-stub.mjs';
import * as THREE from './stubs/three-stub.mjs';
import { stats } from './stubs/three-stub.mjs';
import { Projection } from './app/geo.mjs';
import { FogOfWar } from './app/fog.mjs';
import { TileManager } from './app/tiles.mjs';
import { Landmarks } from './app/landmarks.mjs';
import { detectQuality, CONFIG } from './app/config.mjs';
import { rleEncode, rleDecode, saveBytes, loadBytes } from './app/storage.mjs';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- storage RLE
{
  const g = new Uint8Array(128 * 128); for (let i = 3000; i < 5200; i++) g[i] = 255; for (let i = 6000; i < 6050; i++) g[i] = i & 255;
  const e = rleEncode(g); const d = rleDecode(e, g.length);
  ok(d && d.every((v, i) => v === g[i]), 'RLE round trip');
  saveBytes('k1', g); const s = localStorage.getItem('tw.k1');
  ok(s.length < 1000, `RLE saved size small (${s.length} chars vs ~21848 raw)`);
  ok(loadBytes('k1', g.length).every((v, i) => v === g[i]), 'saveBytes/loadBytes round trip');
  const rand = new Uint8Array(128 * 128).map(() => (Math.random() * 256) | 0);
  saveBytes('k2', rand); ok(loadBytes('k2', rand.length).every((v, i) => v === rand[i]), 'random data round trip');
  // legacy raw base64
  let bin = ''; for (const b of g) bin += String.fromCharCode(b);
  localStorage.setItem('tw.k3', btoa(bin));
  const l = loadBytes('k3', g.length); ok(l && l.every((v, i) => v === g[i]), 'legacy base64 still readable');
}

for (const tier of ['high', 'low']) {
  console.log(`\n== tier ${tier}`);
  const q = detectQuality(tier);
  const proj = new Projection(6.8768, 81.0608, CONFIG.zoom);
  const fog = new FogOfWar(proj);
  const scene = new THREE.Scene();
  const renderer = { initTexture: () => stats.uploads++, capabilities: { getMaxAnisotropy: () => 16 } };
  let added = 0, removed = 0, errors = [];
  const tm = new TileManager({ scene, renderer, proj, quality: q, fog,
    onPlacesAdded: (k, p) => { added += p.length; lm.add(k, p); }, onPlacesRemoved: (k) => { removed++; lm.remove(k); },
    onStatus: () => {}, onError: (e) => errors.push(e) });
  const labelsEl = document.createElement('div');
  const lm = new Landmarks({ scene, labelsEl, fog, claims: {}, onDiscover: () => {} });
  ok(await tm.init(), 'init found vector url');
  const t0 = performance.now();
  tm.update(0, 0);
  for (let i = 0; i < 2000 && [...tm.tiles.values()].some((t) => t.state !== 'ready' && t.state !== 'error'); i++) await sleep(5);
  const tiles = [...tm.tiles.values()];
  ok(tiles.length === 9 && tiles.every((t) => t.state === 'ready'), `9 tiles ready (${tiles.map((t) => t.state).join(',')}) in ${(performance.now() - t0).toFixed(0)} ms`);
  ok(errors.length === 0, 'no tile errors ' + errors.join(' | '));
  const t = tm.byNum.get(tiles[4].num);
  const trees = t.cullables.filter((c) => c.kind === 'tree'), blds = t.cullables.filter((c) => c.kind === 'building');
  const inst = trees.reduce((a, c) => a + c.obj.count, 0);
  ok(trees.length > 0 && trees.length <= 48, `tree chunks (pine+round+palm per chunk) ${trees.length}, instances ${inst}`);
  ok(inst <= q.trees, `tree cap held (${inst} <= ${q.trees})`);
  const kinds = new Set(trees.map((c) => c.obj.geometry));
  ok(kinds.size >= 2 && [...kinds].every((g) => [tm.pineGeo, tm.roundGeo, tm.palmGeo].includes(g)), `tree kinds in use: ${kinds.size}`);
  // palm rule: white palm map = palms anywhere; grey = only below palmMaxElevation; black = none
  {
    const { TREES } = await import('./app/rules.mjs');
    const palmMap = (v) => ({ palm: new Uint8ClampedArray(128 * 128 * 4).fill(v) });
    let r = 1; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const count = (paint, h) => { let n = 0; for (let i = 0; i < 1000; i++) if (tm.treeKind(paint, 5, 5, h, rnd) === 2) n++; return n; };
    const lowH = (TREES.palmMaxElevation - 20) * CONFIG.heightScale, highH = (TREES.palmMaxElevation + 200) * CONFIG.heightScale;
    const any = count(palmMap(255), highH), lowTown = count(palmMap(128), lowH), highTown = count(palmMap(128), highH), none = count(palmMap(0), lowH);
    ok(Math.abs(any / 1000 - TREES.palmShare) < 0.06 && lowTown > 500 && highTown === 0 && none === 0 && count({ palm: null }, lowH) === 0,
      `palm rule: sand/shore ${any}, low town ${lowTown}, high town ${highTown}, elsewhere ${none} (of 1000)`);
    ok(tm.palmGeo.boundingSphere && tm.palmGeo.attributes.aTrunk && tm.palmGeo.attributes.position.count > 0, `palm geometry ${tm.palmGeo.attributes.position.count} vertices`);
  }
  ok(trees.every((c) => c.obj.count > 0 && c.obj.frustumCulled !== false && c.obj.geometry.boundingSphere), 'tree chunks non-empty, frustum culled, with bounds');
  ok(blds.length > 0 && blds.length <= 16, `building chunks ${blds.length}`);
  const bv = blds.reduce((a, c) => a + c.obj.geometry.attributes.position.count, 0);
  ok(bv > 902 * 12, `building vertices ${bv}`);
  ok(blds.every((c) => !!c.obj.material.isMeshLambertMaterial === (tier === 'low')), 'material type matches tier');
  ok(added > 0 && lm.items.size > 0, `places added ${added}, crystals ${lm.items.size}`);
  const h = tm.heightAt(10, 10); ok(Number.isFinite(h), `heightAt ${h.toFixed(2)}`);
  const hit = tm.raycastGround({ origin: new THREE.Vector3(0, 400, 0), direction: new THREE.Vector3(0.5, -0.7, 0.3) });
  ok(hit && Math.abs(tm.heightAt(hit.x, hit.z) - hit.y) < 0.05, `raycast hit ${hit && hit.toArray ? hit.toArray().map((v) => v.toFixed(1)) : JSON.stringify(hit)}`);
  tm.cull(0, 0, 900, 3000);
  const vis = (arr) => arr.filter((c) => c.obj.visible).length;
  const allTrees = tiles.flatMap((x) => x.cullables.filter((c) => c.kind === 'tree'));
  ok(vis(allTrees) < allTrees.length && vis(allTrees) > 0, `cull: ${vis(allTrees)}/${allTrees.length} tree chunks visible at 900 m`);
  tm.cull(0, 0, Infinity, 1e9); ok(vis(allTrees) === allTrees.length, 'cull: all visible when unlimited');
  const texBefore = fog.textures.size;
  ok(texBefore === 9 && [...fog.textures.values()].every((e) => e.refs === 1), `fog textures ${texBefore}, refs 1`);
  // canvases released
  ok(stats.uploads > 0, `textures pre-uploaded (${stats.uploads})`);

  // walk far: all unload
  const disposedBefore = stats.disposed;
  net.aborted = 0;
  tm.update(proj.tileMeters * 3.5, 0);
  ok(fog.textures.size <= 9, `after moving: fog textures ${fog.textures.size}`);
  ok(stats.disposed > disposedBefore, `disposed ${stats.disposed - disposedBefore} GPU objects`);
  ok(removed > 0, `places removed for ${removed} tiles`);
  // move again quickly (abort in-flight downloads, cancel mid-build)
  await sleep(3);
  tm.update(proj.tileMeters * 10, 0);
  ok(net.aborted > 0, `aborted ${net.aborted} downloads`);
  for (let i = 0; i < 2000 && [...tm.tiles.values()].some((t) => t.state !== 'ready' && t.state !== 'error') || tm.building; i++) await sleep(5);
  const refsOk = [...fog.textures.entries()].every(([k, e]) => e.refs === 1);
  ok(fog.textures.size === 9 && refsOk, `fog textures balanced after churn: ${fog.textures.size} (${[...fog.textures.values()].map((e) => e.refs).join(',')})`);
  // rebuild all
  tm.rebuildAll(proj.tileMeters * 10, 0);
  for (let i = 0; i < 2000 && ([...tm.tiles.values()].some((t) => t.state !== 'ready' && t.state !== 'error') || tm.building); i++) await sleep(5);
  ok([...tm.tiles.values()].every((t) => t.state === 'ready') && fog.textures.size === 9 && [...fog.textures.values()].every((e) => e.refs === 1), 'rebuildAll ok, fog refs balanced');
  ok(lm.items.size === [...lm.byTile.values()].reduce((a, v) => a + v.length, 0), `landmarks consistent (${lm.items.size})`);
  ok(labelsEl.children.length === lm.items.size, `label elements match items (${labelsEl.children.length})`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
