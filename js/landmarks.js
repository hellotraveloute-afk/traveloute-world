// Crystals on real places: hidden in the fog until discovered, then claimable.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { GAMEPLAY } from './rules.js';
import { escapeHtml } from './util.js';

const S = 3; // crystal scale in metres

// Looks of each status. Open crystals use their rarity colour.
const LOOK = {
  mystery: { color: '#6D6696', emissive: '#3A3470', intensity: 0.5, ring: '#6D6696' },
  claimed: { color: '#AFC0CC', emissive: '#5E7A8C', intensity: 0.4, ring: '#7F95A6' },
};

function beamMaterial(color, time) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: time, uAlpha: { value: 0.5 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.6) * uAlpha; a *= 0.75 + 0.25 * sin(uTime * 3.0 + vUv.y * 14.0); gl_FragColor = vec4(uColor * 1.4, a); }',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

export class Landmarks {
  constructor({ scene, labelsEl, fog, claims, onDiscover }) {
    Object.assign(this, { scene, labelsEl, fog, claims, onDiscover });
    this.items = new Map();
    this.byTile = new Map();
    this.pedGeo = new THREE.CylinderGeometry(1.7, 2.1, 0.7, 8);
    this.pedMat = new THREE.MeshStandardMaterial({ color: '#D2C8B6', flatShading: true, roughness: 0.9 });
    this.crysGeo = new THREE.OctahedronGeometry(1.35, 0);
    this.beamGeo = new THREE.CylinderGeometry(1.5, 4.5, 170, 16, 1, true);
    this.ringGeo = new THREE.RingGeometry(2.6, 3.1, 48);
    // Materials are shared by every crystal with the same look (a handful in total)
    // instead of two new materials per crystal.
    this.mats = new Map();
    this.tmp = new THREE.Vector3();
    this.shown = [];
  }

  materials(status, color) {
    const key = status === 'open' ? `open|${color}` : status;
    let m = this.mats.get(key);
    if (!m) {
      const look = LOOK[status] || { color, emissive: color, intensity: 1.3, ring: color };
      m = {
        crystal: new THREE.MeshStandardMaterial({ color: look.color, emissive: look.emissive, emissiveIntensity: look.intensity, roughness: 0.25, flatShading: true }),
        ring: new THREE.MeshBasicMaterial({ color: look.ring, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
        beam: status === 'open' ? beamMaterial(color, this.fog.uniforms.uTime) : null,
      };
      this.mats.set(key, m);
    }
    return m;
  }

  add(tileKey, places) {
    const ids = [];
    for (const p of places) {
      if (this.items.has(p.id)) continue;
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      const body = new THREE.Group();
      body.scale.setScalar(S);
      g.add(body);
      const ped = new THREE.Mesh(this.pedGeo, this.pedMat);
      ped.position.y = 0.35;
      ped.castShadow = true;
      body.add(ped);
      const open = this.materials('open', p.color);
      const crystal = new THREE.Mesh(this.crysGeo, open.crystal);
      crystal.scale.set(1, 1.55, 1);
      crystal.position.y = 4;
      crystal.castShadow = true;
      body.add(crystal);
      const ring = new THREE.Mesh(this.ringGeo, open.ring);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.78;
      body.add(ring);
      const beam = new THREE.Mesh(this.beamGeo, open.beam);
      beam.position.y = 85 + 3;
      g.add(beam);
      this.scene.add(g);

      const el = document.createElement('div');
      el.className = 'tag';
      el.style.display = 'none';
      this.labelsEl.appendChild(el);

      const item = {
        p, g, body, crystal, ring, beam, el, status: '', labelHtml: '', labelCls: '', tileKey,
        fogCell: this.fog.cell(p.x, p.z), // where to read this place's fog, found once
        css: { display: 'none', opacity: '', transform: '' }, // last values written to the label
      };
      crystal.userData.item = item;
      this.items.set(p.id, item);
      ids.push(p.id);
      this.setStatus(item, this.statusFor(item), true);
    }
    this.byTile.set(tileKey, (this.byTile.get(tileKey) || []).concat(ids));
  }

  remove(tileKey) {
    for (const id of this.byTile.get(tileKey) || []) {
      const it = this.items.get(id);
      if (!it) continue;
      this.scene.remove(it.g);
      it.el.remove();
      this.items.delete(id);
    }
    this.byTile.delete(tileKey);
  }

  isOnCooldown(id) {
    const at = this.claims[id];
    return !!at && Date.now() - at < GAMEPLAY.cooldownMs;
  }

  statusFor(item) {
    if (this.isOnCooldown(item.p.id)) return 'claimed';
    const c = item.fogCell;
    return c.grid[c.idx] > 0.45 * 255 ? 'open' : 'mystery';
  }

  setStatus(item, status, silent = false) {
    if (item.status === status) return;
    item.status = status;
    const m = this.materials(status, item.p.color);
    item.crystal.material = m.crystal;
    item.ring.material = m.ring;
    if (status === 'open') {
      item.beam.material = m.beam;
      item.beam.visible = true;
      if (!silent && this.onDiscover) this.onDiscover(item);
    } else {
      item.beam.visible = false;
    }
    this.renderLabel(item);
  }

  renderLabel(item) {
    const p = item.p;
    let cls = 'tag';
    let html;
    if (item.status === 'mystery') {
      cls += ' mystery';
      html = '<span class="dot" style="background:#8E86C4"></span>??? <span class="chip" style="color:#C9C3EA">★?</span>';
    } else if (item.status === 'claimed') {
      html = `<span class="dot" style="background:#AFC0CC"></span>${escapeHtml(p.name)} <span class="chip" style="color:#AFC0CC">Claimed</span>`;
    } else {
      html = `<span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)} <span class="chip">★${p.stars}</span>`;
    }
    if (html !== item.labelHtml) {
      item.el.innerHTML = html;
      item.labelHtml = html;
    }
    if (cls !== item.labelCls) {
      item.el.className = cls;
      item.labelCls = cls;
    }
  }

  claim(item) {
    this.claims[item.p.id] = Date.now();
    this.setStatus(item, 'claimed');
  }

  // Label styles are only written when they change, so a still camera costs no DOM work.
  css(it, display, opacity, transform) {
    const c = it.css;
    const s = it.el.style;
    if (c.display !== display) s.display = c.display = display;
    if (display === 'none') return;
    if (c.opacity !== opacity) s.opacity = c.opacity = opacity;
    if (c.transform !== transform) s.transform = c.transform = transform;
  }

  update(dt, t, player, camera, showLabels = true) {
    const tmp = this.tmp;
    const shown = this.shown;
    shown.length = 0;
    const W = innerWidth;
    const H = innerHeight;
    for (const it of this.items.values()) {
      const st = this.statusFor(it);
      if (st !== it.status) this.setStatus(it, st);
      const d = Math.hypot(it.p.x - player.x, it.p.z - player.z);
      // far crystals are a few pixels tall: skip their meshes, keep the beam
      const near = d < CONFIG.crystalDrawDistance;
      it.body.visible = near;
      if (near) {
        it.crystal.rotation.y += dt * (it.status === 'open' ? 1.4 : 0.5);
        it.crystal.position.y = 4 + Math.sin(t * 2 + it.p.x * 0.01) * 0.35;
        it.ring.scale.setScalar(1 + Math.sin(t * 3 + it.p.z * 0.01) * 0.06);
      }
      const limit = it.status === 'mystery' ? CONFIG.labelDistance * 0.45 : CONFIG.labelDistance;
      if (showLabels && d < limit) {
        it.dist = d;
        shown.push(it);
      } else this.css(it, 'none');
    }
    if (!showLabels) return;
    shown.sort((a, b) => a.dist - b.dist);
    for (let idx = 0; idx < shown.length; idx++) {
      const it = shown[idx];
      const d = it.dist;
      if (idx >= CONFIG.maxLabels) {
        this.css(it, 'none');
        continue;
      }
      tmp.set(it.p.x, it.p.y + 8 * S, it.p.z).project(camera);
      if (tmp.z > 1 || Math.abs(tmp.x) > 1.15 || Math.abs(tmp.y) > 1.15) {
        this.css(it, 'none');
        continue;
      }
      const x = Math.round((tmp.x * 0.5 + 0.5) * W * 2) / 2;
      const y = Math.round((-tmp.y * 0.5 + 0.5) * H * 2) / 2;
      const opacity = String(Math.round(Math.max(0.35, 1.3 - d / CONFIG.labelDistance) * 50) / 50);
      const scale = Math.round(Math.max(0.72, 1.12 - d / 2000) * 100) / 100;
      this.css(it, '', opacity, `translate(${x}px,${y}px) translate(-50%,-100%) scale(${scale})`);
    }
  }

  nearest(player, radius, filter) {
    let best = null;
    let bd = radius;
    for (const it of this.items.values()) {
      if (filter && !filter(it)) continue;
      const d = Math.hypot(it.p.x - player.x, it.p.z - player.z);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best ? { item: best, d: bd } : null;
  }

  list(player) {
    return [...this.items.values()]
      .map((it) => ({ it, d: Math.hypot(it.p.x - player.x, it.p.z - player.z) }))
      .sort((a, b) => a.d - b.d);
  }

  crystals() {
    const out = [];
    for (const it of this.items.values()) if (it.body.visible) out.push(it.crystal);
    return out;
  }
}
