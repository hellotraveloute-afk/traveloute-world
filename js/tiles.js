// Loads map tiles around the player and turns them into game world using rules.js.
//
// For each tile:
//   1. download vector map data (OpenStreetMap) and elevation (AWS Terrain Tiles),
//      several tiles at once, cached on the device
//   2. build a low-poly terrain mesh from the heights
//   3. paint the ground texture from land use, water, roads and railways
//   4. scatter trees by density rules
//   5. extrude buildings from their footprints
//   6. collect places that become crystals
//
// Building runs on the main thread, one tile at a time, in small steps with a
// frame in between, so walking stays smooth while new tiles appear.
//
// Trees and buildings are split into CONFIG.chunksPerTile x chunksPerTile chunks.
// Each chunk is its own mesh, so the camera, the shadow pass and the distance
// check (cull) can skip the parts of a tile that can't be seen.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as PbfModule from 'pbf';
import * as VectorTileModule from '@mapbox/vector-tile';
import { CONFIG } from './config.js';
import { tileKey } from './geo.js';
import { patchTileMaterial } from './fog.js';
import { BuildingBuffer } from './extrude.js';
import { cachedFetch, freshFetch } from './net.js';
import { clamp, hashStr, mulberry32, nextFrame } from './util.js';
import {
  GROUND, LANDCOVER, LANDUSE, PARK, WATER, WATERWAY, ROADS, RAIL, BUILDING, TREES,
  classifyPlace, placeName, PLACE_MERGE_DISTANCE, RARITY,
} from './rules.js';

// The CDN builds of these CommonJS packages expose their exports slightly differently; accept both shapes.
const Pbf = PbfModule.default || PbfModule.Pbf || PbfModule;
const VectorTile = VectorTileModule.VectorTile || (VectorTileModule.default && VectorTileModule.default.VectorTile);

const RARITY_ORDER = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 };
const TRUNK_COLOR = new THREE.Color('#6A4A33');

function makeCanvas(size, readable = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { canvas: c, ctx: c.getContext('2d', readable ? { willReadFrequently: true } : undefined) };
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return a / 2;
}

// Groups vector tile rings into polygons (outer ring + holes).
function toPolygons(rings) {
  const polys = [];
  let current = null;
  let outerSign = 0;
  for (const ring of rings) {
    const a = ringArea(ring);
    if (a === 0) continue;
    const s = Math.sign(a);
    if (!outerSign) outerSign = s;
    if (s === outerSign || !current) {
      current = [ring];
      polys.push(current);
    } else current.push(ring);
  }
  return polys;
}

// Replaces single bad height samples (spikes or pits) with the median of their neighbours.
// Sorts the (at most 8) neighbours in place, so no arrays are created per pixel.
export function despike(h) {
  const out = new Float32Array(h);
  const nb = new Float32Array(8);
  for (let y = 0; y < 256; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y1 = y < 255 ? y + 1 : 255;
    for (let x = 0; x < 256; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x < 255 ? x + 1 : 255;
      let n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * 256;
        for (let xx = x0; xx <= x1; xx++) {
          if (xx === x && yy === y) continue;
          // insertion sort as we go
          const v = h[row + xx];
          let k = n++;
          while (k > 0 && nb[k - 1] > v) {
            nb[k] = nb[k - 1];
            k--;
          }
          nb[k] = v;
        }
      }
      const med = nb[n >> 1];
      const i = y * 256 + x;
      if (Math.abs(h[i] - med) > 40) out[i] = med;
    }
  }
  return out;
}

// Tree shape with its trunk merged in, so one instanced draw covers both.
// `aTrunk` marks trunk vertices; the tile material colours them brown.
function treeGeometry(crown) {
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 2.6, 5, 1, true).translate(0, 1.3, 0).toNonIndexed();
  const top = crown.index ? crown.toNonIndexed() : crown;
  const parts = [top, trunk];
  parts.forEach((g, i) => {
    g.deleteAttribute('uv');
    g.setAttribute('aTrunk', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(i), 1));
  });
  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

function triangulate(pts) {
  return THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.x, p.z)), []);
}

class Tile {
  constructor(tx, ty, z) {
    this.tx = tx;
    this.ty = ty;
    this.z = z;
    this.num = tx * 65536 + ty;
    this.key = tileKey(z, tx, ty);
    this.state = 'queued'; // queued -> loading (building) -> ready | error
    this.cancelled = false;
    this.group = new THREE.Group();
    this.places = [];
    this.heights = null;
    this.disposables = [];
    this.cullables = []; // { obj, x, z, r, kind: 'tree' | 'building' }
    this.download = null;
    this.abort = null;
    this.fogHeld = false;
  }
}

export class TileManager {
  constructor({ scene, renderer, proj, quality, fog, onPlacesAdded, onPlacesRemoved, onStatus, onError }) {
    Object.assign(this, { scene, renderer, proj, quality, fog, onPlacesAdded, onPlacesRemoved, onStatus, onError });
    this.tiles = new Map();
    this.byNum = new Map(); // same tiles, keyed by a number for fast height lookups
    this.queue = [];
    this.downloading = 0;
    this.building = 0;
    this.vectorUrl = null;
    this.lastHeight = 0;
    this.errors = 0;
    this.lastStatus = '';

    // shared tree geometry (metres)
    this.pineGeo = treeGeometry(new THREE.ConeGeometry(2.3, 7.5, 6).translate(0, 6, 0));
    this.roundGeo = treeGeometry(new THREE.IcosahedronGeometry(3.1, 0).translate(0, 5.2, 0));
    this.terracePatterns = new Map();
  }

  get busy() {
    return this.building > 0;
  }

  async init() {
    try {
      const res = await freshFetch(CONFIG.tileJsonUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      this.vectorUrl = json.tiles && json.tiles[0];
      if (!this.vectorUrl) throw new Error('No tile URL in TileJSON');
    } catch (e) {
      console.warn('Vector tiles unavailable:', e);
      this.vectorUrl = null;
    }
    if (!VectorTile || typeof Pbf !== 'function') {
      console.warn('Vector tile decoder did not load; showing terrain only.');
      this.vectorUrl = null;
    }
    return !!this.vectorUrl;
  }

  // Call regularly with the player position.
  update(x, z) {
    const { tx, ty } = this.proj.tileAt(x, z);
    const R = CONFIG.loadRadius;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const k = tileKey(this.proj.z, tx + dx, ty + dy);
        if (this.tiles.has(k)) continue;
        const t = new Tile(tx + dx, ty + dy, this.proj.z);
        this.tiles.set(t.key, t);
        this.byNum.set(t.num, t);
        this.queue.push(t);
      }
    }
    for (const t of [...this.tiles.values()]) {
      if (Math.max(Math.abs(t.tx - tx), Math.abs(t.ty - ty)) > CONFIG.keepRadius) this.unload(t);
    }
    // keep the queue ordered by distance to the player, dropping unloaded tiles
    const dist = (t) => Math.abs(t.tx - tx) + Math.abs(t.ty - ty);
    this.queue = this.queue.filter((t) => !t.cancelled).sort((a, b) => dist(a) - dist(b));
    this.pump();
  }

  pump() {
    // downloads: nearest tiles first, several at once
    for (const t of this.queue) {
      if (this.downloading >= CONFIG.maxParallelDownloads) break;
      if (!t.cancelled && !t.download) this.startDownload(t);
    }
    // builds: one at a time (it's main-thread work)
    while (this.building < CONFIG.maxParallelBuilds && this.queue.length) {
      const t = this.queue.shift();
      if (t.cancelled || t.state !== 'queued') continue;
      this.building++;
      this.build(t)
        .catch((e) => {
          console.error('Tile failed', t.key, e);
          this.errors++;
          t.state = 'error';
          this.onError && this.onError(`Tile ${t.key} failed: ${e && e.message ? e.message : e}`);
        })
        .finally(() => {
          this.building--;
          this.reportStatus();
          this.pump();
        });
    }
    this.reportStatus();
  }

  startDownload(t) {
    this.downloading++;
    t.abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = t.abort ? t.abort.signal : undefined;
    t.download = Promise.all([this.loadElevation(t.tx, t.ty, t.z, signal), this.loadVector(t.tx, t.ty, t.z, signal)])
      .then(([elev, vt]) => ({ elev, vt }))
      .finally(() => {
        this.downloading--;
        this.pump();
      });
  }

  reportStatus() {
    let ready = 0;
    let total = 0;
    for (const t of this.tiles.values()) {
      total++;
      if (t.state === 'ready' || t.state === 'error') ready++;
    }
    const key = `${ready}/${total}`;
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.onStatus && this.onStatus(ready, total);
  }

  isReadyAt(x, z) {
    const { tx, ty } = this.proj.tileAt(x, z);
    const t = this.byNum.get(tx * 65536 + ty);
    return !!(t && (t.state === 'ready' || t.state === 'error') && t.heights);
  }

  unload(t) {
    t.cancelled = true;
    if (t.abort) t.abort.abort(); // stops downloads still in flight; harmless if they finished
    this.tiles.delete(t.key);
    if (this.byNum.get(t.num) === t) this.byNum.delete(t.num);
    if (t.state === 'ready') {
      this.scene.remove(t.group);
      this.freeTile(t);
      this.onPlacesRemoved && this.onPlacesRemoved(t.key);
    }
    // a tile still being built frees itself at its next step (discard)
  }

  // Frees a tile that was unloaded while it was still being built.
  discard(t) {
    this.freeTile(t);
  }

  freeTile(t) {
    for (const d of t.disposables) d.dispose();
    t.disposables.length = 0;
    t.cullables.length = 0;
    if (t.fogHeld) {
      this.fog.releaseTexture(t.tx, t.ty);
      t.fogHeld = false;
    }
  }

  // Throws everything away and loads it again (after the GPU context was lost).
  rebuildAll(x, z) {
    for (const t of [...this.tiles.values()]) this.unload(t);
    this.queue.length = 0;
    this.update(x, z);
  }

  // Shows only the chunks near enough to matter. `treeDist` for trees,
  // `farDist` for buildings and whole tiles (beyond it everything is fully fogged).
  cull(camX, camZ, treeDist, farDist) {
    const tm = this.proj.tileMeters;
    for (const t of this.tiles.values()) {
      if (t.state !== 'ready') continue;
      const ox = t.origin.x;
      const oz = t.origin.z;
      const dx = Math.max(ox - camX, 0, camX - (ox + tm));
      const dz = Math.max(oz - camZ, 0, camZ - (oz + tm));
      const visible = Math.hypot(dx, dz) <= farDist;
      t.group.visible = visible;
      if (!visible) continue;
      for (const c of t.cullables) {
        const d = Math.hypot(c.x - camX, c.z - camZ) - c.r;
        c.obj.visible = d <= (c.kind === 'tree' ? treeDist : farDist);
      }
    }
  }

  // Terrain height at a world position (metres).
  heightAt(x, z) {
    const h = this.heightAtOrNull(x, z);
    if (h === null) return this.lastHeight;
    this.lastHeight = h;
    return h;
  }

  heightAtOrNull(x, z) {
    const tm = this.proj.tileMeters;
    const fx = this.proj.X0 + x / tm;
    const fy = this.proj.Y0 + z / tm;
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    const t = this.byNum.get(tx * 65536 + ty);
    if (!t || !t.heights) return null;
    return this.sampleGrid(t, fx - tx, fy - ty);
  }

  // Where a ray first meets the ground, found by stepping along the ray over the
  // height grid. Much cheaper than testing every terrain triangle.
  raycastGround(ray, maxDist = 4000) {
    const o = ray.origin;
    const d = ray.direction;
    const at = (s) => this.heightAtOrNull(o.x + d.x * s, o.z + d.z * s);
    let h = at(0);
    if (h === null) return null;
    if (o.y <= h) return new THREE.Vector3(o.x, h, o.z);
    let prev = 0;
    let s = 0;
    while (s < maxDist) {
      s += Math.min(20, 3 + s * 0.01);
      h = at(s);
      if (h === null) return null; // ran off the loaded map
      if (o.y + d.y * s <= h) {
        let lo = prev;
        let hi = s;
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) / 2;
          const hm = at(mid);
          if (hm !== null && o.y + d.y * mid <= hm) hi = mid;
          else lo = mid;
        }
        return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      }
      prev = s;
    }
    return null;
  }

  sampleGrid(t, u, v) {
    const seg = t.seg;
    const N = seg + 1;
    const fx = clamp(u, 0, 1) * seg;
    const fy = clamp(v, 0, 1) * seg;
    const i = Math.min(seg - 1, Math.floor(fx));
    const j = Math.min(seg - 1, Math.floor(fy));
    const ax = fx - i;
    const ay = fy - j;
    const h = t.heights;
    const h00 = h[j * N + i];
    const h10 = h[j * N + i + 1];
    const h01 = h[(j + 1) * N + i];
    const h11 = h[(j + 1) * N + i + 1];
    return (h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay;
  }

  /* ---------------------------------------------------------------- loading */

  async loadElevation(tx, ty, z, signal) {
    const url = CONFIG.terrainUrl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
    try {
      // Heights are stored in the pixel colours, so the browser must not colour-correct them:
      // even a 1-step change in the red channel means a 256 m spike.
      let source;
      try {
        const res = await cachedFetch(url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        source = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      } catch (e) {
        if (signal && signal.aborted) return null;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        await img.decode();
        source = img;
      }
      const { ctx } = makeCanvas(256, true);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, 0, 0, 256, 256);
      if (source.close) source.close();
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const raw = new Float32Array(256 * 256);
      for (let i = 0; i < raw.length; i++) raw[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      return despike(raw);
    } catch (e) {
      if (!(signal && signal.aborted)) console.warn('Elevation tile failed', tx, ty, e);
      return null;
    }
  }

  async loadVector(tx, ty, z, signal) {
    if (!this.vectorUrl) return null;
    const url = this.vectorUrl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
    try {
      const res = await cachedFetch(url, { signal });
      if (res.status === 204 || res.status === 404) return null; // empty sea tile
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (!buf.byteLength) return null;
      return new VectorTile(new Pbf(new Uint8Array(buf)));
    } catch (e) {
      if (!(signal && signal.aborted)) console.warn('Vector tile failed', tx, ty, e);
      return null;
    }
  }

  /* ---------------------------------------------------------------- building */

  material(params) {
    const q = this.quality;
    if (q.lambert) {
      const { roughness, ...rest } = params;
      return new THREE.MeshLambertMaterial(rest);
    }
    return new THREE.MeshStandardMaterial(params);
  }

  // Uploads a canvas texture to the GPU now (instead of during a later frame)
  // and then frees the canvas: the GPU copy is all that's needed.
  // If the GPU context is lost, main.js rebuilds the tiles.
  upload(tex) {
    try {
      this.renderer.initTexture(tex);
      const c = tex.image;
      if (c && c.width) c.width = c.height = 1;
    } catch {
      /* leave it to the first render */
    }
  }

  async build(t) {
    t.state = 'loading';
    if (!t.download) this.startDownload(t);
    const { elev, vt } = await t.download;
    if (t.cancelled) return this.discard(t);

    const q = this.quality;
    const tm = this.proj.tileMeters;
    t.origin = this.proj.tileOrigin(t.tx, t.ty);
    t.group.position.set(t.origin.x, 0, t.origin.z);
    const rand = mulberry32(hashStr(t.key));

    // 1. height grid
    const seg = q.seg;
    const N = seg + 1;
    const hg = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let h = 0;
        if (elev) {
          const px = (i / seg) * 255;
          const py = (j / seg) * 255;
          const x0 = Math.floor(px);
          const y0 = Math.floor(py);
          const x1 = Math.min(255, x0 + 1);
          const y1 = Math.min(255, y0 + 1);
          const ax = px - x0;
          const ay = py - y0;
          h = (elev[y0 * 256 + x0] * (1 - ax) + elev[y0 * 256 + x1] * ax) * (1 - ay) + (elev[y1 * 256 + x0] * (1 - ax) + elev[y1 * 256 + x1] * ax) * ay;
        }
        hg[j * N + i] = Math.max(CONFIG.minHeight, h) * CONFIG.heightScale;
      }
    }
    t.heights = hg;
    t.seg = seg;

    // 2. paint the ground (spread over a few frames)
    const paint = await this.paint(t, vt, q.texSize, tm, rand);
    if (t.cancelled) return this.discard(t);
    const tex = new THREE.CanvasTexture(paint.color);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(q.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    const waterTex = new THREE.CanvasTexture(paint.water);
    t.disposables.push(tex, waterTex);
    this.upload(tex);
    this.upload(waterTex);
    await nextFrame();
    if (t.cancelled) return this.discard(t);

    // 3. terrain mesh
    const reveal = this.fog.texture(t.tx, t.ty);
    t.fogHeld = true;
    const fogOpts = { reveal, origin: t.origin, size: tm };
    const terrainMat = patchTileMaterial(
      this.material({ map: tex, flatShading: true, roughness: 0.95 }),
      this.fog,
      { ...fogOpts, terrain: true, waterMask: waterTex }
    );
    const geo = new THREE.PlaneGeometry(tm, tm, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(tm / 2, 0, tm / 2);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const i = Math.round((pos.getX(k) / tm) * seg);
      const j = Math.round((pos.getZ(k) / tm) * seg);
      pos.setY(k, hg[j * N + i]);
    }
    // normals are only needed for the shadow offset; flat shading works them out per pixel
    if (q.shadows) geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.receiveShadow = q.shadows;
    terrain.userData.isTerrain = true;
    t.group.add(terrain);
    const skirt = new THREE.Mesh(this.skirtGeometry(hg, seg, tm), terrainMat);
    t.group.add(skirt);
    t.terrain = terrain;
    t.disposables.push(geo, skirt.geometry, terrainMat);
    await nextFrame();
    if (t.cancelled) return this.discard(t);

    // 4. trees
    this.buildTrees(t, paint.density, rand, fogOpts);
    await nextFrame();
    if (t.cancelled) return this.discard(t);

    // 5. buildings
    if (vt) await this.buildBuildings(t, vt, rand, fogOpts);
    if (t.cancelled) return this.discard(t);

    // 6. places
    if (vt) t.places = this.collectPlaces(t, vt);

    // nothing in a tile moves, so its matrices are computed once
    t.group.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    this.scene.add(t.group);
    t.state = 'ready';
    this.onPlacesAdded && this.onPlacesAdded(t.key, t.places);
  }

  // A strip hanging down from the tile edges hides cracks between neighbouring tiles.
  // Its faces point outwards, so the terrain material doesn't need to be double-sided.
  skirtGeometry(hg, seg, tm) {
    const N = seg + 1;
    const drop = 40;
    const pos = [];
    const uv = [];
    const edges = [
      (k) => [k, 0],
      (k) => [seg, k],
      (k) => [seg - k, seg],
      (k) => [0, seg - k],
    ];
    for (const edge of edges) {
      for (let k = 0; k < seg; k++) {
        const [i0, j0] = edge(k);
        const [i1, j1] = edge(k + 1);
        const x0 = (i0 / seg) * tm;
        const z0 = (j0 / seg) * tm;
        const x1 = (i1 / seg) * tm;
        const z1 = (j1 / seg) * tm;
        const h0 = hg[j0 * N + i0];
        const h1 = hg[j1 * N + i1];
        const u0 = i0 / seg;
        const v0 = 1 - j0 / seg;
        const u1 = i1 / seg;
        const v1 = 1 - j1 / seg;
        pos.push(x0, h0, z0, x1, h1, z1, x1, h1 - drop, z1, x0, h0, z0, x1, h1 - drop, z1, x0, h0 - drop, z0);
        uv.push(u0, v0, u1, v1, u1, v1, u0, v0, u1, v1, u0, v0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (this.quality.shadows) g.computeVertexNormals();
    return g;
  }

  terracePattern(ctx, fill) {
    const key = fill;
    if (!this.terracePatterns.has(key)) {
      const { canvas, ctx: p } = makeCanvas(16);
      p.fillStyle = fill;
      p.fillRect(0, 0, 16, 16);
      p.fillStyle = 'rgba(40,90,40,0.28)';
      p.fillRect(0, 0, 16, 5);
      this.terracePatterns.set(key, canvas);
    }
    return ctx.createPattern(this.terracePatterns.get(key), 'repeat');
  }

  // Paints the ground texture, a water mask (for shimmer) and a tree density map.
  // Yields a frame between layer groups; returns null if the tile was unloaded meanwhile.
  async paint(t, vt, size, tm, rand) {
    const { canvas: color, ctx: c } = makeCanvas(size);
    const { canvas: water, ctx: w } = makeCanvas(256);
    const { canvas: dens, ctx: d } = makeCanvas(128, true);
    c.lineJoin = c.lineCap = 'round';
    w.lineJoin = w.lineCap = 'round';
    d.lineJoin = d.lineCap = 'round';

    c.fillStyle = GROUND.base;
    c.fillRect(0, 0, size, size);
    // speckles, collected into two paths so there are 2 fills instead of thousands
    const speckA = new Path2D();
    const speckB = new Path2D();
    for (let i = 0; i < size * 3; i++) {
      const target = rand() < 0.5 ? speckA : speckB;
      const r = 1 + (rand() * size) / 170;
      target.rect(rand() * size, rand() * size, r, r);
    }
    c.fillStyle = GROUND.speckleA;
    c.fill(speckA);
    c.fillStyle = GROUND.speckleB;
    c.fill(speckB);
    w.fillStyle = '#000';
    w.fillRect(0, 0, 256, 256);
    const g0 = TREES.unmappedDensity;
    d.fillStyle = `rgb(${g0},${g0},${g0})`;
    d.fillRect(0, 0, 128, 128);

    const result = { color, water, density: null };
    if (!vt) {
      result.density = d.getImageData(0, 0, 128, 128).data;
      return result;
    }
    const step = async () => {
      await nextFrame();
      return !t.cancelled;
    };

    const layers = vt.layers;
    const each = (name, type, fn) => {
      const layer = layers[name];
      if (!layer) return;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== type) continue;
        fn(f, f.loadGeometry(), layer.extent || 4096);
      }
    };
    const path = (ctx, rings, k, close) => {
      ctx.beginPath();
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i];
          if (i === 0) ctx.moveTo(p.x * k, p.y * k);
          else ctx.lineTo(p.x * k, p.y * k);
        }
        if (close) ctx.closePath();
      }
    };
    const grey = (v) => `rgb(${v},${v},${v})`;
    const area = (geom, ext, fill, trees, pattern) => {
      path(c, geom, size / ext, true);
      c.fillStyle = pattern ? this.terracePattern(c, fill) : fill;
      c.fill('evenodd');
      if (trees !== undefined) {
        path(d, geom, 128 / ext, true);
        d.fillStyle = grey(trees);
        d.fill('evenodd');
      }
    };

    // land
    each('landcover', 3, (f, g, ext) => {
      const r = LANDCOVER[f.properties.class];
      if (r) area(g, ext, r.fill, r.trees, r.pattern);
    });
    each('landuse', 3, (f, g, ext) => {
      const r = LANDUSE[f.properties.class];
      if (r) area(g, ext, r.fill, r.trees);
    });
    each('park', 3, (f, g, ext) => {
      area(g, ext, PARK.fill, PARK.trees);
      c.strokeStyle = PARK.stroke;
      c.lineWidth = Math.max(1, size / 512);
      c.stroke();
    });
    if (!(await step())) return null;

    // water
    each('water', 3, (f, g, ext) => {
      path(c, g, size / ext, true);
      c.strokeStyle = WATER.shore;
      c.lineWidth = Math.max(2, size / 220);
      c.stroke();
      c.fillStyle = WATER.fill;
      c.fill('evenodd');
      path(w, g, 256 / ext, true);
      w.fillStyle = '#fff';
      w.fill('evenodd');
      path(d, g, 128 / ext, true);
      d.fillStyle = '#000';
      d.fill('evenodd');
    });
    const m = size / tm;
    each('waterway', 2, (f, g, ext) => {
      const wid = WATERWAY[f.properties.class];
      if (!wid || f.properties.brunnel === 'tunnel') return;
      path(c, g, size / ext, false);
      c.strokeStyle = WATER.fill;
      c.lineWidth = Math.max(1, wid * m);
      c.stroke();
      path(w, g, 256 / ext, false);
      w.strokeStyle = '#fff';
      w.lineWidth = Math.max(1, (wid * 256) / tm);
      w.stroke();
      path(d, g, 128 / ext, false);
      d.strokeStyle = '#000';
      d.lineWidth = ((wid + 6) * 128) / tm + 0.5;
      d.stroke();
    });
    if (!(await step())) return null;

    // roads and railways
    const roads = [];
    each('transportation', 2, (f, g, ext) => {
      if (f.properties.brunnel === 'tunnel') return;
      roads.push({ p: f.properties, g, ext });
    });
    const width = (r) => (RAIL.classes.includes(r.p.class) ? RAIL.w : ROADS[r.p.class] ? ROADS[r.p.class].w : 0);
    roads.sort((a, b) => width(a) - width(b));
    for (const r of roads) {
      const rule = ROADS[r.p.class];
      if (!rule || rule.dash) continue;
      path(c, r.g, size / r.ext, false);
      c.setLineDash([]);
      c.strokeStyle = rule.casing;
      c.lineWidth = Math.max(1.6, rule.w * m + 2);
      c.stroke();
    }
    for (const r of roads) {
      const isRail = RAIL.classes.includes(r.p.class);
      const rule = isRail ? RAIL : ROADS[r.p.class];
      if (!rule) continue;
      path(c, r.g, size / r.ext, false);
      c.strokeStyle = rule.fill;
      c.lineWidth = Math.max(1, rule.w * m);
      c.setLineDash(rule.dash ? rule.dash.map((v) => Math.max(1, v * m * 2)) : []);
      c.stroke();
      if (isRail) {
        c.strokeStyle = RAIL.tie;
        c.lineWidth = Math.max(1, rule.w * m * 1.8);
        c.setLineDash([Math.max(1, 0.8 * m), Math.max(1.5, 2.2 * m)]);
        c.stroke();
      }
      c.setLineDash([]);
      path(d, r.g, 128 / r.ext, false);
      d.strokeStyle = '#000';
      d.lineWidth = ((rule.w + 5) * 128) / tm + 0.5;
      d.stroke();
    }
    if (!(await step())) return null;

    // building footprints (the 3D buildings stand on these)
    each('building', 3, (f, g, ext) => {
      path(c, g, size / ext, true);
      c.fillStyle = BUILDING.footprint;
      c.fill('evenodd');
      path(d, g, 128 / ext, true);
      d.fillStyle = '#000';
      d.fill('evenodd');
    });

    result.density = d.getImageData(0, 0, 128, 128).data;
    return result;
  }

  // Registers a chunk mesh for distance culling. (ci, cj) is the chunk cell.
  addChunk(t, obj, ci, cj, kind) {
    const cs = this.proj.tileMeters / CONFIG.chunksPerTile;
    t.group.add(obj);
    t.cullables.push({ obj, kind, x: t.origin.x + (ci + 0.5) * cs, z: t.origin.z + (cj + 0.5) * cs, r: cs * 0.7072 + 10 });
  }

  buildTrees(t, density, rand, fogOpts) {
    const q = this.quality;
    const tm = this.proj.tileMeters;
    const C = CONFIG.chunksPerTile;
    const max = q.trees;
    // one material for leaves and trunks: the trunk colour comes from the shader
    const mat = patchTileMaterial(this.material({ color: '#ffffff', flatShading: true, roughness: 0.85 }), this.fog, { ...fogOpts, trunkColor: TRUNK_COLOR });
    t.disposables.push(mat);

    const species = [
      { geo: this.pineGeo, m: new Float32Array(max * 16), c: new Float32Array(max * 3), k: new Uint8Array(max), n: 0 },
      { geo: this.roundGeo, m: new Float32Array(max * 16), c: new Float32Array(max * 3), k: new Uint8Array(max), n: 0 },
    ];
    const mtx = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const attempts = max * 4;
    for (let a = 0; a < attempts && species[0].n + species[1].n < max; a++) {
      const u = rand();
      const v = rand();
      const di = Math.min(127, Math.floor(u * 128));
      const dj = Math.min(127, Math.floor(v * 128));
      const dens = density[(dj * 128 + di) * 4];
      if (rand() * 255 >= dens) continue;
      const h = this.sampleGrid(t, u, v);
      if (h <= CONFIG.minHeight * CONFIG.heightScale + 0.5) continue; // sea
      const s = 0.8 + rand() * 0.8;
      p.set(u * tm, h - 0.4, v * tm);
      quat.setFromAxisAngle(up, rand() * Math.PI * 2);
      scl.set(s, s * (0.85 + rand() * 0.4), s);
      mtx.compose(p, quat, scl);
      col.set(TREES.colors[Math.floor(rand() * TREES.colors.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.06);
      const sp = rand() < TREES.pineShare ? species[0] : species[1];
      mtx.toArray(sp.m, sp.n * 16);
      col.toArray(sp.c, sp.n * 3);
      sp.k[sp.n] = Math.min(C - 1, Math.floor(v * C)) * C + Math.min(C - 1, Math.floor(u * C));
      sp.n++;
    }

    // one instanced mesh per species per chunk, sized to exactly the trees in it
    for (const sp of species) {
      const counts = new Uint32Array(C * C);
      for (let i = 0; i < sp.n; i++) counts[sp.k[i]]++;
      for (let chunk = 0; chunk < C * C; chunk++) {
        const n = counts[chunk];
        if (!n) continue;
        const im = new THREE.InstancedMesh(sp.geo, mat, n);
        const colors = new Float32Array(n * 3);
        const mats = im.instanceMatrix.array;
        let w = 0;
        for (let i = 0; i < sp.n; i++) {
          if (sp.k[i] !== chunk) continue;
          mats.set(sp.m.subarray(i * 16, i * 16 + 16), w * 16);
          colors.set(sp.c.subarray(i * 3, i * 3 + 3), w * 3);
          w++;
        }
        im.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        im.computeBoundingSphere(); // lets the camera and shadow pass skip off-screen chunks
        im.castShadow = q.shadows;
        im.receiveShadow = q.shadows;
        this.addChunk(t, im, chunk % C, Math.floor(chunk / C), 'tree');
        t.disposables.push(im);
      }
    }
  }

  async buildBuildings(t, vt, rand, fogOpts) {
    const layer = vt.layers.building;
    if (!layer) return;
    const q = this.quality;
    const tm = this.proj.tileMeters;
    const C = CONFIG.chunksPerTile;
    const ext = layer.extent || 4096;
    const k = tm / ext;
    const bufs = new Array(C * C).fill(null);
    const wall = new THREE.Color();
    const roof = new THREE.Color();
    let count = 0;
    outer: for (let i = 0; i < layer.length; i++) {
      if (i % 400 === 399) {
        await nextFrame();
        if (t.cancelled) return;
      }
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const props = f.properties;
      for (const poly of toPolygons(f.loadGeometry())) {
        const ring = poly[0];
        if (ring.length < 4) continue;
        // skip shapes whose centre lies in the neighbouring tile (tiles overlap slightly)
        let cx = 0;
        let cy = 0;
        for (const pt of ring) {
          cx += pt.x;
          cy += pt.y;
        }
        cx /= ring.length;
        cy /= ring.length;
        if (cx < 0 || cx >= ext || cy < 0 || cy >= ext) continue;
        const areaM2 = Math.abs(ringArea(ring)) * k * k;
        if (areaM2 < BUILDING.minArea) continue;

        const h = clamp(Number(props.render_height) || BUILDING.defaultHeight, BUILDING.minHeight, BUILDING.maxHeight);
        let base = Infinity;
        for (const pt of ring) base = Math.min(base, this.sampleGrid(t, pt.x / ext, pt.y / ext));
        wall.set(BUILDING.walls[Math.floor(rand() * BUILDING.walls.length)]);
        roof.set(BUILDING.roofs[Math.floor(rand() * BUILDING.roofs.length)]);

        const chunk = Math.min(C - 1, Math.floor((cy / ext) * C)) * C + Math.min(C - 1, Math.floor((cx / ext) * C));
        const buf = bufs[chunk] || (bufs[chunk] = new BuildingBuffer(q.shadows));
        const pts = ring.map((pt) => ({ x: pt.x * k, z: pt.y * k }));
        if (buf.add(pts, base - 1, base + h, wall, roof, triangulate) && ++count >= q.buildings) break outer;
      }
    }
    if (!count) return;

    const mat = patchTileMaterial(this.material({ vertexColors: true, flatShading: true, roughness: 0.8 }), this.fog, fogOpts);
    t.disposables.push(mat);
    bufs.forEach((buf, chunk) => {
      if (!buf || !buf.n) return;
      const a = buf.arrays();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
      g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
      if (a.normal) g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = q.shadows;
      mesh.receiveShadow = q.shadows;
      this.addChunk(t, mesh, chunk % C, Math.floor(chunk / C), 'building');
      t.disposables.push(g);
    });
  }

  collectPlaces(t, vt) {
    const tm = this.proj.tileMeters;
    const found = [];
    for (const layerName of ['poi', 'mountain_peak']) {
      const layer = vt.layers[layerName];
      if (!layer) continue;
      const ext = layer.extent || 4096;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 1) continue;
        const props = f.properties;
        const cls = classifyPlace(layerName, props);
        if (!cls) continue;
        const pt = f.loadGeometry()[0][0];
        const u = pt.x / ext;
        const v = pt.y / ext;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        const x = t.origin.x + u * tm;
        const z = t.origin.z + v * tm;
        const ll = this.proj.toLatLon(x, z);
        const name = placeName(props);
        found.push({
          id: `${name}@${ll.lat.toFixed(4)},${ll.lon.toFixed(4)}`,
          name,
          kind: String(props.subclass || props.class || layerName).replace(/_/g, ' '),
          rarity: cls.rarity,
          stars: cls.stars,
          color: RARITY[cls.rarity].color,
          x,
          z,
          y: this.sampleGrid(t, u, v),
          lat: ll.lat,
          lon: ll.lon,
        });
      }
    }
    // merge near-duplicates, keeping the rarest
    found.sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]);
    const out = [];
    for (const p of found) {
      if (out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < PLACE_MERGE_DISTANCE)) continue;
      out.push(p);
    }
    return out;
  }
}
