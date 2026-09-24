// Fog of war: each map tile has a small grid of how much has been explored.
// Grids are saved per tile so the map remembers where you have been.

import * as THREE from 'three';
import { loadBytes, saveBytes } from './storage.js';
import { smooth } from './util.js';

export const FOG_RES = 128;

export class FogOfWar {
  constructor(proj) {
    this.proj = proj;
    this.grids = new Map();
    this.textures = new Map();
    this.dirty = new Set();
    this.uniforms = { uFowColor: { value: new THREE.Color('#171C38') }, uTime: { value: 0 } };
  }

  key(tx, ty) {
    return `fog.${this.proj.z}.${tx}.${ty}`;
  }

  grid(tx, ty) {
    const k = this.key(tx, ty);
    let g = this.grids.get(k);
    if (!g) {
      g = loadBytes(k);
      if (!g || g.length !== FOG_RES * FOG_RES) g = new Uint8Array(FOG_RES * FOG_RES);
      this.grids.set(k, g);
    }
    return g;
  }

  texture(tx, ty) {
    const k = this.key(tx, ty);
    let t = this.textures.get(k);
    if (!t) {
      t = new THREE.DataTexture(this.grid(tx, ty), FOG_RES, FOG_RES, THREE.RedFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      this.textures.set(k, t);
    }
    return t;
  }

  releaseTexture(tx, ty) {
    const k = this.key(tx, ty);
    const t = this.textures.get(k);
    if (t) {
      t.dispose();
      this.textures.delete(k);
    }
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
          const t = this.textures.get(k);
          if (t) t.needsUpdate = true;
        }
      }
    }
    return changed;
  }

  at(x, z) {
    const { tx, ty } = this.proj.tileAt(x, z);
    const g = this.grid(tx, ty);
    const o = this.proj.tileOrigin(tx, ty);
    const cell = this.proj.tileMeters / FOG_RES;
    const i = Math.min(FOG_RES - 1, Math.max(0, Math.floor((x - o.x) / cell)));
    const j = Math.min(FOG_RES - 1, Math.max(0, Math.floor((z - o.z) / cell)));
    return g[j * FOG_RES + i] / 255;
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

// Adds fog of war (and for terrain: water shimmer and rocky slopes) to a standard material.
export function patchTileMaterial(mat, fog, { reveal, origin, size, terrain = false, waterMask = null, strength = 0.86 }) {
  const u = {
    uReveal: { value: reveal },
    uTileOrigin: { value: new THREE.Vector2(origin.x, origin.z) },
    uTileSize: { value: size },
    uFowStrength: { value: strength },
    uFowColor: fog.uniforms.uFowColor,
    uTime: fog.uniforms.uTime,
    uWaterMask: { value: waterMask },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFowPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fowWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fowWp = instanceMatrix * fowWp;
        #endif
        vFowPos = (modelMatrix * fowWp).xyz;`
      );
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
      ${terrain ? 'uniform sampler2D uWaterMask;' : ''}`
    );
    if (terrain) {
      frag = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float wm = texture2D(uWaterMask, vMapUv).r;
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float steep = 1.0 - abs(dot(normal, upV));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.54, 0.49), smoothstep(0.30, 0.55, steep) * (1.0 - wm));
          float wave = sin(vFowPos.x * 0.35 + uTime * 1.7) * sin(vFowPos.z * 0.29 - uTime * 1.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.23, 0.66, 0.85) + wave * 0.04, wm * 0.85);
          roughnessFactor = mix(roughnessFactor, 0.12, wm);
          totalEmissiveRadiance += vec3(0.6, 0.9, 1.0) * smoothstep(0.8, 1.0, wave) * wm * 0.4;
        }`
      );
    }
    frag = frag.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      vec2 fuv = clamp((vFowPos.xz - uTileOrigin) / uTileSize, 0.0, 1.0);
      float rev = texture2D(uReveal, fuv).r;
      float swirl = sin(vFowPos.x * 0.012 + uTime * 0.35) * sin(vFowPos.z * 0.011 - uTime * 0.28) * 0.5 + 0.5;
      float edge = smoothstep(0.12, 0.5, rev) * (1.0 - smoothstep(0.5, 0.95, rev));
      vec3 fogCol = uFowColor + vec3(0.06, 0.07, 0.14) * swirl;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, (1.0 - rev) * uFowStrength);
      gl_FragColor.rgb += vec3(0.35, 0.8, 0.75) * edge * 0.14;`
    );
    sh.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => (terrain ? 'tw-terrain' : 'tw-object');
  return mat;
}
