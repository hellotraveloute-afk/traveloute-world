// The ground painter: canvas sizes, density map, balanced save/restore and town decor.
import './stubs/dom-stub.mjs';
import * as THREE from './stubs/three-stub.mjs';
import { VectorTile } from './stubs/vt-stub.mjs';
import { Projection } from './app/geo.mjs';
import { FogOfWar } from './app/fog.mjs';
import { TileManager } from './app/tiles.mjs';
import { detectQuality, CONFIG } from './app/config.mjs';
import { mulberry32, shadeHex } from './app/util.mjs';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

ok(shadeHex('#FFFFFF', 0.25) === '#bfbfbf', `shadeHex darkens (${shadeHex('#FFFFFF', 0.25)})`);
ok(shadeHex('#000000', -0.5) === '#808080', `shadeHex lightens (${shadeHex('#000000', -0.5)})`);

for (const tier of ['low', 'high']) {
  const q = detectQuality(tier);
  const proj = new Projection(6.8768, 81.0608, CONFIG.zoom);
  const tm = new TileManager({ scene: new THREE.Scene(), renderer: { initTexture() {}, capabilities: { getMaxAnisotropy: () => 16 } }, proj, quality: q, fog: new FogOfWar(proj) });
  const tile = { cancelled: false, key: 'test' };
  const arcs0 = globalThis.Path2D.arcs;
  const res = await tm.paint(tile, new VectorTile(), q.texSize, proj.tileMeters, mulberry32(1));
  ok(res?.color.width === q.texSize && res.color.height === q.texSize, `${tier}: ground canvas ${res.color.width}x${res.color.height}`);
  ok(res.water.width === 256 && res.water.height === 256, `${tier}: water mask 256x256`);
  ok(res.density && res.density.length === 128 * 128 * 4 && res.density.some((v) => v > 0), `${tier}: density map 128x128, not empty`);
  const ctx = res.color.getContext();
  ok(!ctx.depth, `${tier}: save/restore balanced`);
  const decor = globalThis.Path2D.arcs - arcs0;
  ok(decor > 100, `${tier}: town decor scattered (${decor} dots)`);

  const empty = await tm.paint(tile, null, q.texSize, proj.tileMeters, mulberry32(1));
  ok(empty.color.width === q.texSize && empty.density.length === 128 * 128 * 4, `${tier}: tile without map data still paints`);

  tile.cancelled = true;
  ok((await tm.paint(tile, new VectorTile(), q.texSize, proj.tileMeters, mulberry32(1))) === null, `${tier}: cancelled tile stops painting`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
