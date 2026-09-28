// Soft cloud puffs floating over unexplored land near the edge of what you've
// explored. One instanced draw for all of them; they fade out as the land under
// them is revealed. High quality only (quality.fogClouds), and an automatic
// quality step can switch them off.

import * as THREE from 'three';
import { FOG } from './rules.js';

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// A puffy cloud drawn once into a small canvas: overlapping soft circles.
function cloudTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size / 2;
  const c = cv.getContext('2d');
  const puffs = [[0.3, 0.62, 0.2], [0.5, 0.5, 0.27], [0.7, 0.6, 0.2], [0.42, 0.66, 0.2], [0.6, 0.68, 0.18]];
  for (const [x, y, r] of puffs) {
    const g = c.createRadialGradient(x * size, y * size * 0.5, 0, x * size, y * size * 0.5, r * size);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, size, size / 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class FogClouds {
  constructor({ scene, fog, quality, heightAt }) {
    Object.assign(this, { scene, fog, quality, heightAt });
    const rule = FOG.billboards;
    this.max = rule.max;
    this.items = Array.from({ length: this.max }, () => ({ on: false, x: 0, y: 0, z: 0, s: 1, a: 0, vx: 0 }));
    this.alpha = new Float32Array(this.max);
    const geo = new THREE.PlaneGeometry(1, 0.5);
    geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: cloudTexture() }, uColor: fog.uniforms.uFowColor, uShadow: fog.uniforms.uFowShadow },
      // billboards: each instance is a point; the quad is laid out in view space
      vertexShader: `attribute float aAlpha; varying vec2 vUv; varying float vA; varying float vDist;
        void main() {
          vUv = uv; vA = aAlpha;
          vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          c.xy += position.xy * s;
          vDist = -c.z;
          gl_Position = projectionMatrix * c;
        }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform vec3 uShadow; varying vec2 vUv; varying float vA; varying float vDist;
        void main() {
          float m = texture2D(uMap, vUv).a;
          vec3 col = mix(uColor * uShadow, uColor, smoothstep(0.1, 0.8, vUv.y));
          float a = m * vA * 0.85 * (1.0 - smoothstep(1100.0, 1700.0, vDist));
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.max);
    this.mesh.frustumCulled = false; // they follow the player; bounds would change every frame
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.sv = new THREE.Vector3();
    this.spawnTimer = 0;
    this.seed = 1;
  }

  rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  // Tries to place one cloud over unexplored land around the player.
  spawn(px, pz) {
    const it = this.items.find((c) => !c.on);
    if (!it) return;
    const { spawnRadius: r, size, height } = FOG.billboards;
    const ang = this.rand() * Math.PI * 2;
    const d = r[0] + this.rand() * (r[1] - r[0]);
    const x = px + Math.cos(ang) * d;
    const z = pz + Math.sin(ang) * d;
    if (this.fog.at(x, z) > 0.05) return; // explored: no cloud here
    it.on = true;
    it.x = x;
    it.z = z;
    it.y = this.heightAt(x, z) + height[0] + this.rand() * (height[1] - height[0]);
    it.s = size[0] + this.rand() * (size[1] - size[0]);
    it.a = 0;
    it.vx = REDUCED_MOTION ? 0 : 1.5 + this.rand() * 2;
  }

  // Moves one cloud with the wind and fades it out when the land below is
  // revealed or the player walked away.
  drift(it, dt, player) {
    it.x += it.vx * dt;
    const far = FOG.billboards.spawnRadius[1] * 1.4;
    const d = Math.hypot(it.x - player.x, it.z - player.z);
    const want = this.fog.at(it.x, it.z) < 0.25 && d < far ? 1 : 0;
    it.a += (want - it.a) * Math.min(1, dt * (want ? 0.6 : 2.5));
    if (!want && it.a < 0.02) it.on = false;
  }

  update(dt, player) {
    const enabled = !!this.quality.fogClouds;
    this.mesh.visible = enabled;
    if (!enabled) return;
    this.spawnTimer += dt;
    if (this.spawnTimer > 0.6) {
      this.spawnTimer = 0;
      this.spawn(player.x, player.z);
    }
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (it.on) this.drift(it, dt, player);
      this.alpha[i] = it.on ? it.a : 0;
      this.m.compose(this.v.set(it.x, it.y, it.z), this.q, this.sv.setScalar(it.on ? it.s : 0));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
