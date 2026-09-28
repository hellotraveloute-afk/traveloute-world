// Fog of war: each map tile has a small grid of how much has been explored.
// Grids are saved per tile so the map remembers where you have been.

import * as THREE from 'three';
import { loadBytes, saveBytes } from './storage.js';
import { smooth } from './util.js';
import { FOG, LANDCOVER, WATER } from './rules.js';

export const FOG_RES = 128;

function cloudShadowRatio() {
  const a = new THREE.Color(FOG.cloud);
  const b = new THREE.Color(FOG.shadow);
  return [b.r / a.r, b.g / a.g, b.b / a.b];
}

export class FogOfWar {
  constructor(proj) {
    this.proj = proj;
    this.grids = new Map();
    this.textures = new Map(); // key -> { tex, refs }
    this.dirty = new Set();
    // Shared by every tile material. uTime drives animation; the sun and the
    // reference height (ground under the player) drive the toon terrain tint.
    this.uniforms = {
      uFowColor: { value: new THREE.Color(FOG.cloud) },
      // shadow colour as a ratio of the cloud colour, so it follows the time of day
      uFowShadow: { value: new THREE.Vector3(...cloudShadowRatio()) },
      uFowEdge: { value: new THREE.Color(FOG.edge) },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.35, 1, 0.3) },
      uSunColor: { value: new THREE.Color('#FFF1D6') },
      uRefHeight: { value: 0 },
    };
  }

  key(tx, ty) {
    return `fog.${this.proj.z}.${tx}.${ty}`;
  }

  grid(tx, ty) {
    const k = this.key(tx, ty);
    let g = this.grids.get(k);
    if (!g) {
      g = loadBytes(k, FOG_RES * FOG_RES);
      if (!g || g.length !== FOG_RES * FOG_RES) g = new Uint8Array(FOG_RES * FOG_RES);
      this.grids.set(k, g);
    }
    return g;
  }

  // The fog texture of a tile. Reference-counted: a tile can be unloaded and
  // loaded again while its old build is still finishing, and both share it.
  texture(tx, ty) {
    const k = this.key(tx, ty);
    let e = this.textures.get(k);
    if (!e) {
      const tex = new THREE.DataTexture(this.grid(tx, ty), FOG_RES, FOG_RES, THREE.RedFormat, THREE.UnsignedByteType);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      e = { tex, refs: 0 };
      this.textures.set(k, e);
    }
    e.refs++;
    return e.tex;
  }

  releaseTexture(tx, ty) {
    const k = this.key(tx, ty);
    const e = this.textures.get(k);
    if (!e) return;
    if (--e.refs > 0) return;
    e.tex.dispose();
    this.textures.delete(k);
  }

  // Clears fog in a soft circle. Returns true if anything changed.
  stamp(x, z, radius) {
    const tm = this.proj.tileMeters;
    const a = this.proj.tileAt(x - radius, z - radius);
    const b = this.proj.tileAt(x + radius, z + radius);
    let changed = false;
    for (let ty = a.ty; ty <= b.ty; ty++) {
      for (let tx = a.tx; tx <= b.tx; tx++) {
        const g = this.grid(tx, ty);
        const o = this.proj.tileOrigin(tx, ty);
        const cell = tm / FOG_RES;
        const i0 = Math.max(0, Math.floor((x - radius - o.x) / cell));
        const i1 = Math.min(FOG_RES - 1, Math.ceil((x + radius - o.x) / cell));
        const j0 = Math.max(0, Math.floor((z - radius - o.z) / cell));
        const j1 = Math.min(FOG_RES - 1, Math.ceil((z + radius - o.z) / cell));
        let tileChanged = false;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const cx = o.x + (i + 0.5) * cell;
            const cz = o.z + (j + 0.5) * cell;
            const d = Math.hypot(cx - x, cz - z);
            if (d > radius) continue;
            const v = Math.round(255 * (1 - smooth(radius * 0.55, radius, d)));
            const idx = j * FOG_RES + i;
            if (v > g[idx]) {
              g[idx] = v;
              tileChanged = true;
            }
          }
        }
        if (tileChanged) {
          changed = true;
          const k = this.key(tx, ty);
          this.dirty.add(k);
          const e = this.textures.get(k);
          if (e) e.tex.needsUpdate = true;
        }
      }
    }
    return changed;
  }

  at(x, z) {
    const c = this.cell(x, z);
    return c.grid[c.idx] / 255;
  }

  // The grid and cell index under (x, z). Grids live for the whole session, so
  // callers can keep the result and read `grid[idx]` without any lookups.
  cell(x, z) {
    const { tx, ty } = this.proj.tileAt(x, z);
    const grid = this.grid(tx, ty);
    const o = this.proj.tileOrigin(tx, ty);
    const size = this.proj.tileMeters / FOG_RES;
    const i = Math.min(FOG_RES - 1, Math.max(0, Math.floor((x - o.x) / size)));
    const j = Math.min(FOG_RES - 1, Math.max(0, Math.floor((z - o.z) / size)));
    return { grid, idx: j * FOG_RES + i };
  }

  // Share of the tile under (x, z) that has been explored, 0–100.
  percentAt(x, z) {
    const { tx, ty } = this.proj.tileAt(x, z);
    const g = this.grid(tx, ty);
    let n = 0;
    for (let i = 0; i < g.length; i++) if (g[i] > 140) n++;
    return (n / g.length) * 100;
  }

  save() {
    for (const k of this.dirty) {
      const g = this.grids.get(k);
      if (g) saveBytes(k, g);
    }
    this.dirty.clear();
  }
}

// Toon lighting: the sun's light falls into three soft bands instead of a smooth
// ramp. Patched into the light function of both the Lambert and the Standard
// material, so it costs the same as before.
const TOON_GLSL = `
float twToon(float x) {
  float t = smoothstep(0.0, 0.1, x) * 0.5 + smoothstep(0.3, 0.45, x) * 0.5;
  return mix(x, t, 0.72);
}`;
const DOT_NL = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
function toonLights(frag, lambert) {
  const chunk = lambert ? 'lights_lambert_pars_fragment' : 'lights_physical_pars_fragment';
  const src = THREE.ShaderChunk[chunk];
  if (!src || !src.includes(DOT_NL)) return frag; // a three.js update changed the chunk: plain lighting
  return frag.replace(`#include <${chunk}>`, `${TOON_GLSL}\n${src.replace(DOT_NL, 'float dotNL = twToon( saturate( dot( geometryNormal, directLight.direction ) ) );')}`);
}

const ROCK_COLOR = new THREE.Color(LANDCOVER.rock.fill);
const WATER_COLOR = new THREE.Color(WATER.fill);

// Adds fog of war (and for terrain: water shimmer, rocky slopes, height tint and
// rim light) to a tile material, plus toon lighting.
// Works with MeshStandardMaterial and the cheaper MeshLambertMaterial.
// `trunkColor`: for merged tree geometry, vertices with aTrunk = 1 use this colour
// instead of the per-tree leaf colour.
export function patchTileMaterial(mat, fog, { reveal, origin, size, terrain = false, waterMask = null, strength = FOG.veil, trunkColor = null, toon = terrain }) {
  const lambert = !!mat.isMeshLambertMaterial;
  const u = {
    uReveal: { value: reveal },
    uTileOrigin: { value: new THREE.Vector2(origin.x, origin.z) },
    uTileSize: { value: size },
    uFowStrength: { value: strength },
    uFowColor: fog.uniforms.uFowColor,
    uFowShadow: fog.uniforms.uFowShadow,
    uFowEdge: fog.uniforms.uFowEdge,
    uTime: fog.uniforms.uTime,
    uSunDir: fog.uniforms.uSunDir,
    uSunColor: fog.uniforms.uSunColor,
    uRefHeight: fog.uniforms.uRefHeight,
    uWaterMask: { value: waterMask },
    uRockColor: { value: ROCK_COLOR },
    uWaterColor: { value: WATER_COLOR },
    uTrunkColor: { value: trunkColor || new THREE.Color() },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    let vert = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFowPos;${trunkColor ? '\nattribute float aTrunk;\nuniform vec3 uTrunkColor;' : ''}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fowWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fowWp = instanceMatrix * fowWp;
        #endif
        vFowPos = (modelMatrix * fowWp).xyz;`
      );
    if (trunkColor) {
      vert = vert.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz = mix(vColor.xyz, uTrunkColor, aTrunk);
        #endif`
      );
    }
    sh.vertexShader = vert;
    let frag = sh.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec3 vFowPos;
      uniform sampler2D uReveal;
      uniform vec2 uTileOrigin;
      uniform float uTileSize;
      uniform float uFowStrength;
      uniform vec3 uFowColor;
      uniform float uTime;
      uniform vec3 uFowShadow;
      uniform vec3 uFowEdge;
      float twHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float twNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 s = f * f * (3.0 - 2.0 * f);
        return mix(mix(twHash(i), twHash(i + vec2(1.0, 0.0)), s.x), mix(twHash(i + vec2(0.0, 1.0)), twHash(i + vec2(1.0, 1.0)), s.x), s.y);
      }
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uRefHeight;
      ${terrain ? 'uniform sampler2D uWaterMask;\nuniform vec3 uRockColor;\nuniform vec3 uWaterColor;' : ''}`
    );
    if (toon) frag = toonLights(frag, lambert);
    if (terrain) {
      frag = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float wm = texture2D(uWaterMask, vMapUv).r;
          float land = 1.0 - wm;
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float steep = 1.0 - abs(dot(normal, upV));
          diffuseColor.rgb = mix(diffuseColor.rgb, uRockColor, smoothstep(0.30, 0.55, steep) * land);
          // warmer in valleys, cooler and bluer up high (relative to the player's ground)
          float hk = clamp((vFowPos.y - uRefHeight) / 220.0, -1.0, 1.0);
          vec3 tint = hk < 0.0 ? vec3(1.07, 1.03, 0.84) : vec3(0.88, 1.0, 1.08);
          diffuseColor.rgb *= mix(vec3(1.0), tint, abs(hk) * 0.75 * land);
          // warm rim light on slopes that face the sun
          vec3 nW = inverseTransformDirection(normal, viewMatrix);
          float toSun = saturate(dot(nW, normalize(uSunDir)));
          float rim = smoothstep(0.15, 0.6, steep) * toSun * toSun * (0.6 + 0.4 * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0));
          totalEmissiveRadiance += uSunColor * diffuseColor.rgb * rim * land * 0.3;
          float wave = sin(vFowPos.x * 0.35 + uTime * 1.7) * sin(vFowPos.z * 0.29 - uTime * 1.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, uWaterColor + wave * 0.04, wm * 0.85);
          ${lambert ? '' : 'roughnessFactor = mix(roughnessFactor, 0.12, wm);'}
          totalEmissiveRadiance += vec3(0.6, 0.9, 1.0) * smoothstep(0.8, 1.0, wave) * wm * ${lambert ? '0.55' : '0.4'};
        }`
      );
    }
    // Cloud veil over unexplored land: two octaves of value noise drifting in world
    // space, between the cloud and its shadow colour. Applied before the distance
    // haze, so far clouds still fade into the horizon.
    frag = frag.replace(
      '#include <fog_fragment>',
      `{
        vec2 fuv = clamp((vFowPos.xz - uTileOrigin) / uTileSize, 0.0, 1.0);
        float rev = texture2D(uReveal, fuv).r;
        vec2 cp = vFowPos.xz * 0.0075 + vec2(uTime * 0.018, uTime * 0.011);
        float n = twNoise(cp) * 0.65 + twNoise(cp * 2.3 + vec2(7.1, 3.7) - uTime * 0.013) * 0.35;
        vec3 cloud = mix(uFowColor * uFowShadow, uFowColor, smoothstep(0.3, 0.75, n));
        float veil = (1.0 - rev) * uFowStrength * (0.78 + 0.34 * n);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(cloud, 1.0)).rgb, clamp(veil, 0.0, 0.92));
        float edge = smoothstep(0.15, 0.35, rev) * (1.0 - smoothstep(0.4, 0.65, rev));
        float pulse = 0.75 + 0.25 * sin(uTime * 2.2 + (vFowPos.x + vFowPos.z) * 0.02);
        gl_FragColor.rgb += linearToOutputTexel(vec4(uFowEdge, 1.0)).rgb * edge * pulse * 0.32;
      }
      #include <fog_fragment>`
    );
    sh.fragmentShader = frag;
  };
  const kind = terrain ? 'terrain' : trunkColor ? 'tree' : 'object';
  mat.customProgramCacheKey = () => `tw-${kind}${lambert ? '-l' : ''}${toon ? '-t' : ''}`;
  return mat;
}
