// Crystals on real places: hidden in the fog until discovered, then claimable.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { GAMEPLAY } from './rules.js';
import { escapeHtml } from './util.js';

const S = 3; // crystal scale in metres

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
    this.beamMats = new Map();
  }

  beam(color) {
    if (!this.beamMats.has(color)) this.beamMats.set(color, beamMaterial(color, this.fog.uniforms.uTime));
    return this.beamMats.get(color);
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
      const cmat = new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 1.3, roughness: 0.25, flatShading: true });
      const crystal = new THREE.Mesh(this.crysGeo, cmat);
      crystal.scale.set(1, 1.55, 1);
      crystal.position.y = 4;
      crystal.castShadow = true;
      body.add(crystal);
      const ringMat = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const ring = new THREE.Mesh(this.ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.78;
      body.add(ring);
      const beam = new THREE.Mesh(this.beamGeo, this.beam(p.color));
      beam.position.y = 85 + 3;
      g.add(beam);
      this.scene.add(g);

      const el = document.createElement('div');
      el.className = 'tag';
      el.style.display = 'none';
      this.labelsEl.appendChild(el);

      const item = { p, g, body, crystal, cmat, ring, ringMat, beam, el, status: '', labelHtml: '', tileKey };
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
      it.cmat.dispose();
      it.ringMat.dispose();
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
    return this.fog.at(item.p.x, item.p.z) > 0.45 ? 'open' : 'mystery';
  }

  setStatus(item, status, silent = false) {
    if (item.status === status) return;
    item.status = status;
    const c = item.p.color;
    if (status === 'mystery') {
      item.cmat.color.set('#6D6696');
      item.cmat.emissive.set('#3A3470');
      item.cmat.emissiveIntensity = 0.5;
      item.ringMat.color.set('#6D6696');
      item.beam.visible = false;
    } else if (status === 'open') {
      item.cmat.color.set(c);
      item.cmat.emissive.set(c);
      item.cmat.emissiveIntensity = 1.3;
      item.ringMat.color.set(c);
      item.beam.visible = true;
      if (!silent && this.onDiscover) this.onDiscover(item);
    } else {
      item.cmat.color.set('#AFC0CC');
      item.cmat.emissive.set('#5E7A8C');
      item.cmat.emissiveIntensity = 0.4;
      item.ringMat.color.set('#7F95A6');
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
    item.el.className = cls;
  }

  claim(item) {
    this.claims[item.p.id] = Date.now();
    this.setStatus(item, 'claimed');
  }

  update(dt, t, player, camera) {
    const tmp = new THREE.Vector3();
    const shown = [];
    for (const it of this.items.values()) {
      it.crystal.rotation.y += dt * (it.status === 'open' ? 1.4 : 0.5);
      it.crystal.position.y = 4 + Math.sin(t * 2 + it.p.x * 0.01) * 0.35;
      it.ring.scale.setScalar(1 + Math.sin(t * 3 + it.p.z * 0.01) * 0.06);
      const st = this.statusFor(it);
      if (st !== it.status) this.setStatus(it, st);
      const d = Math.hypot(it.p.x - player.x, it.p.z - player.z);
      const limit = it.status === 'mystery' ? CONFIG.labelDistance * 0.45 : CONFIG.labelDistance;
      if (d < limit) shown.push({ it, d });
      else it.el.style.display = 'none';
    }
    shown.sort((a, b) => a.d - b.d);
    shown.forEach(({ it, d }, idx) => {
      if (idx >= CONFIG.maxLabels) {
        it.el.style.display = 'none';
        return;
      }
      tmp.set(it.p.x, it.p.y + 8 * S, it.p.z).project(camera);
      if (tmp.z > 1 || Math.abs(tmp.x) > 1.15 || Math.abs(tmp.y) > 1.15) {
        it.el.style.display = 'none';
        return;
      }
      const x = (tmp.x * 0.5 + 0.5) * innerWidth;
      const y = (-tmp.y * 0.5 + 0.5) * innerHeight;
      it.el.style.display = '';
      it.el.style.opacity = String(Math.max(0.35, 1.3 - d / CONFIG.labelDistance));
      it.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%) scale(${Math.max(0.72, 1.12 - d / 2000)})`;
    });
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
    return [...this.items.values()].map((it) => it.crystal);
  }
}
