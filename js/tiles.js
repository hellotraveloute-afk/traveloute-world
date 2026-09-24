// Loads map tiles around the player and turns them into game world using rules.js.
//
// For each tile:
//   1. download vector map data (OpenStreetMap) and elevation (AWS Terrain Tiles)
//   2. build a low-poly terrain mesh from the heights
//   3. paint the ground texture from land use, water, roads and railways
//   4. scatter trees by density rules
//   5. extrude buildings from their footprints
//   6. collect places that become crystals

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as PbfModule from 'pbf';
import * as VectorTileModule from '@mapbox/vector-tile';
import { CONFIG } from './config.js';
import { tileKey } from './geo.js';
import { patchTileMaterial } from './fog.js';
import { clamp, hashStr, mulberry32, nextFrame } from './util.js';
import {
  GROUND, LANDCOVER, LANDUSE, PARK, WATER, WATERWAY, ROADS, RAIL, BUILDING, TREES,
  classifyPlace, placeName, PLACE_MERGE_DISTANCE, RARITY,
} from './rules.js';

// The CDN builds of these CommonJS packages expose their exports slightly differently; accept both shapes.
const Pbf = PbfModule.default || PbfModule.Pbf || PbfModule;
const VectorTile = VectorTileModule.VectorTile || (VectorTileModule.default && VectorTileModule.default.VectorTile);

const RARITY_ORDER = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 };

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

class Tile {
  constructor(tx, ty, z) {
    this.tx = tx;
    this.ty = ty;
    this.z = z;
    this.key = tileKey(z, tx, ty);
    this.state = 'queued';
    this.cancelled = false;
    this.group = new THREE.Group();
    this.places = [];
    this.heights = null;
    this.disposables = [];
  }
}

export class TileManager {
  constructor({ scene, proj, quality, fog, onPlacesAdded, onPlacesRemoved, onStatus }) {
    Object.assign(this, { scene, proj, quality, fog, onPlacesAdded, onPlacesRemoved, onStatus });
    this.tiles = new Map();
    this.queue = [];
    this.loading = 0;
    this.vectorUrl = null;
    this.lastHeight = 0;
    this.errors = 0;

    // shared tree geometry (metres)
    this.pineGeo = new THREE.ConeGeometry(2.3, 7.5, 6).translate(0, 6, 0);
    this.roundGeo = new THREE.IcosahedronGeometry(3.1, 0).translate(0, 5.2, 0);
    this.trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 2.6, 5).translate(0, 1.3, 0);
    this.terracePatterns = new Map();
  }

  async init() {
    try {
      const res = await fetch(CONFIG.tileJsonUrl);
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

  // Call every frame with the player position.
  update(x, z) {
    const { tx, ty } = this.proj.tileAt(x, z);
    const R = CONFIG.loadRadius;
    const want = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const k = tileKey(this.proj.z, tx + dx, ty + dy);
        if (!this.tiles.has(k)) want.push({ tx: tx + dx, ty: ty + dy, d: Math.abs(dx) + Math.abs(dy) });
      }
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      const t = new Tile(w.tx, w.ty, this.proj.z);
      this.tiles.set(t.key, t);
      this.queue.push(t);
    }
    for (const t of [...this.tiles.values()]) {
      if (Math.max(Math.abs(t.tx - tx), Math.abs(t.ty - ty)) > CONFIG.keepRadius) this.unload(t);
    }
    // keep the queue ordered by distance to the player
    this.queue.sort((a, b) => Math.abs(a.tx - tx) + Math.abs(a.ty - ty) - (Math.abs(b.tx - tx) + Math.abs(b.ty - ty)));
    this.pump();
  }

  pump() {
    while (this.loading < CONFIG.maxParallelLoads && this.queue.length) {
      const t = this.queue.shift();
      if (t.cancelled || t.state !== 'queued') continue;
      this.loading++;
      this.build(t)
        .catch((e) => {
          console.error('Tile failed', t.key, e);
          this.errors++;
          t.state = 'error';
        })
        .finally(() => {
          this.loading--;
          this.reportStatus();
          this.pump();
        });
    }
    this.reportStatus();
  }

  reportStatus() {
    let ready = 0;
    let total = 0;
    for (const t of this.tiles.values()) {
      total++;
      if (t.state === 'ready' || t.state === 'error') ready++;
    }
    this.onStatus && this.onStatus(ready, total);
  }

  isReadyAt(x, z) {
    const { tx, ty } = this.proj.tileAt(x, z);
    const t = this.tiles.get(tileKey(this.proj.z, tx, ty));
    return !!(t && (t.state === 'ready' || t.state === 'error') && t.heights);
  }

  unload(t) {
    t.cancelled = true;
    this.tiles.delete(t.key);
    if (t.state === 'ready') {
      this.scene.remove(t.group);
      for (const d of t.disposables) d.dispose();
      this.fog.releaseTexture(t.tx, t.ty);
      this.onPlacesRemoved && this.onPlacesRemoved(t.key);
    }
  }

  // Frees a tile that was unloaded while it was still being built.
  discard(t) {
    for (const d of t.disposables) d.dispose();
    t.disposables.length = 0;
    this.fog.releaseTexture(t.tx, t.ty);
  }

  // Terrain height at a world position (metres).
  heightAt(x, z) {
    const { tx, ty } = this.proj.tileAt(x, z);
    const t = this.tiles.get(tileKey(this.proj.z, tx, ty));
    if (!t || !t.heights) return this.lastHeight;
    const tm = this.proj.tileMeters;
    const h = this.sampleGrid(t, (x - t.origin.x) / tm, (z - t.origin.z) / tm);
    this.lastHeight = h;
    return h;
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

  async loadElevation(tx, ty, z) {
    const url = CONFIG.terrainUrl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await img.decode();
      const { ctx } = makeCanvas(256, true);
      ctx.drawImage(img, 0, 0, 256, 256);
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const out = new Float32Array(256 * 256);
      for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      return out;
    } catch (e) {
      console.warn('Elevation tile failed', tx, ty, e);
      return null;
    }
  }

  async loadVector(tx, ty, z) {
    if (!this.vectorUrl) return null;
    const url = this.vectorUrl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
    try {
      const res = await fetch(url);
      if (res.status === 204 || res.status === 404) return null; // empty sea tile
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      return new VectorTile(new Pbf(new Uint8Array(buf)));
    } catch (e) {
      console.warn('Vector tile failed', tx, ty, e);
      return null;
    }
  }

  /* ---------------------------------------------------------------- building */

  async build(t) {
    t.state = 'loading';
    const z = this.proj.z;
    const [elev, vt] = await Promise.all([this.loadElevation(t.tx, t.ty, z), this.loadVector(t.tx, t.ty, z)]);
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
    await nextFrame();
    if (t.cancelled) return this.discard(t);

    // 2. paint the ground
    const paint = this.paint(vt, q.texSize, tm, rand);
    const tex = new THREE.CanvasTexture(paint.color);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const waterTex = new THREE.CanvasTexture(paint.water);
    t.disposables.push(tex, waterTex);
    await nextFrame();
    if (t.cancelled) return this.discard(t);

    // 3. terrain mesh
    const reveal = this.fog.texture(t.tx, t.ty);
    const fogOpts = { reveal, origin: t.origin, size: tm };
    const terrainMat = patchTileMaterial(
      new THREE.MeshStandardMaterial({ map: tex, flatShading: true, roughness: 0.95, side: THREE.DoubleSide }),
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
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.receiveShadow = q.shadows;
    terrain.userData.isTerrain = true;
    t.group.add(terrain);
    const skirt = new THREE.Mesh(this.skirtGeometry(hg, seg, tm), terrainMat);
    t.group.add(skirt);
    t.terrain = terrain;
    t.disposables.push(geo, skirt.geometry, terrainMat);

    // 4. trees
    this.buildTrees(t, paint.density, rand, fogOpts);
    await nextFrame();
    if (t.cancelled) return this.discard(t);

    // 5. buildings
    if (vt) await this.buildBuildings(t, vt, rand, fogOpts);
    if (t.cancelled) return this.discard(t);

    // 6. places
    if (vt) t.places = this.collectPlaces(t, vt);

    this.scene.add(t.group);
    t.state = 'ready';
    this.onPlacesAdded && this.onPlacesAdded(t.key, t.places);
  }

  // A strip hanging down from the tile edges hides cracks between neighbouring tiles.
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
    g.computeVertexNormals();
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
  paint(vt, size, tm, rand) {
    const { canvas: color, ctx: c } = makeCanvas(size);
    const { canvas: water, ctx: w } = makeCanvas(256);
    const { canvas: dens, ctx: d } = makeCanvas(128, true);
    c.lineJoin = c.lineCap = 'round';
    w.lineJoin = w.lineCap = 'round';
    d.lineJoin = d.lineCap = 'round';

    c.fillStyle = GROUND.base;
    c.fillRect(0, 0, size, size);
    for (let i = 0; i < size * 3; i++) {
      c.fillStyle = rand() < 0.5 ? GROUND.speckleA : GROUND.speckleB;
      const r = 1 + (rand() * size) / 170;
      c.fillRect(rand() * size, rand() * size, r, r);
    }
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

  buildTrees(t, density, rand, fogOpts) {
    const q = this.quality;
    const tm = this.proj.tileMeters;
    const max = q.trees;
    const pines = new THREE.InstancedMesh(this.pineGeo, null, max);
    const rounds = new THREE.InstancedMesh(this.roundGeo, null, max);
    const trunks = new THREE.InstancedMesh(this.trunkGeo, null, max * 2);
    const leafMat1 = patchTileMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.85 }), this.fog, fogOpts);
    const leafMat2 = patchTileMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.85 }), this.fog, fogOpts);
    const trunkMat = patchTileMaterial(new THREE.MeshStandardMaterial({ color: '#6A4A33', flatShading: true, roughness: 0.9 }), this.fog, fogOpts);
    pines.material = leafMat1;
    rounds.material = leafMat2;
    trunks.material = trunkMat;
    const mtx = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let np = 0;
    let nr = 0;
    let nt = 0;
    const attempts = max * 4;
    for (let a = 0; a < attempts && np + nr < max; a++) {
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
      if (rand() < TREES.pineShare) {
        pines.setMatrixAt(np, mtx);
        pines.setColorAt(np, col);
        np++;
      } else {
        rounds.setMatrixAt(nr, mtx);
        rounds.setColorAt(nr, col);
        nr++;
      }
      trunks.setMatrixAt(nt++, mtx);
    }
    pines.count = np;
    rounds.count = nr;
    trunks.count = nt;
    for (const im of [pines, rounds, trunks]) {
      im.castShadow = q.shadows;
      im.receiveShadow = q.shadows;
      im.frustumCulled = false; // instances spread over the whole tile
      if (im.count > 0) t.group.add(im);
    }
    t.disposables.push(leafMat1, leafMat2, trunkMat, pines, rounds, trunks);
  }

  async buildBuildings(t, vt, rand, fogOpts) {
    const layer = vt.layers.building;
    if (!layer) return;
    const tm = this.proj.tileMeters;
    const ext = layer.extent || 4096;
    const k = tm / ext;
    const geoms = [];
    const wall = new THREE.Color();
    const roof = new THREE.Color();
    for (let i = 0; i < layer.length && geoms.length < this.quality.buildings; i++) {
      if (i % 300 === 299) {
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

        const pts = ring.map((pt) => new THREE.Vector2(pt.x * k, -pt.y * k));
        const shape = new THREE.Shape(pts);
        const h = clamp(Number(props.render_height) || BUILDING.defaultHeight, BUILDING.minHeight, BUILDING.maxHeight);
        let base = Infinity;
        for (const pt of ring) base = Math.min(base, this.sampleGrid(t, pt.x / ext, pt.y / ext));
        let g;
        try {
          g = new THREE.ExtrudeGeometry(shape, { depth: h + 1, bevelEnabled: false });
        } catch {
          continue; // broken footprint in the source data
        }
        g.rotateX(-Math.PI / 2);
        g.translate(0, base - 1, 0);
        wall.set(BUILDING.walls[Math.floor(rand() * BUILDING.walls.length)]);
        roof.set(BUILDING.roofs[Math.floor(rand() * BUILDING.roofs.length)]);
        const nrm = g.attributes.normal;
        const colors = new Float32Array(nrm.count * 3);
        for (let v = 0; v < nrm.count; v++) {
          const c = nrm.getY(v) > 0.5 ? roof : wall;
          colors[v * 3] = c.r;
          colors[v * 3 + 1] = c.g;
          colors[v * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geoms.push(g);
      }
    }
    if (!geoms.length) return;
    const merged = mergeGeometries(geoms, false);
    for (const g of geoms) g.dispose();
    if (!merged) return;
    const mat = patchTileMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 }), this.fog, fogOpts);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = this.quality.shadows;
    mesh.receiveShadow = this.quality.shadows;
    t.group.add(mesh);
    t.disposables.push(merged, mat);
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
