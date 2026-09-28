// Renderer, sky, lights, time of day and post-processing.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TIMES } from './rules.js';
import { smooth, lerp } from './util.js';

const SKY_RADIUS = 4200; // inside the camera's far plane
const CAMERA_FAR = 4600; // covers the loaded 3 x 3 tiles, so distant crystal beams stay visible

// Bloom with its buffers scaled down (0.5 = a quarter of the pixels). The glow is
// soft anyway, so this is hard to see and much cheaper on phones.
class ScaledBloomPass extends UnrealBloomPass {
  constructor(resolution, strength, radius, threshold, scale) {
    super(new THREE.Vector2(resolution.x * scale, resolution.y * scale), strength, radius, threshold);
    this.scale = scale;
  }
  setSize(width, height) {
    const s = this.scale || 1;
    super.setSize(Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s)));
  }
}

export function createWorld(canvas, quality, fog) {
  // With bloom, the scene renders into an off-screen buffer, so anti-aliasing has
  // to happen there (multisampling). Asking the canvas for it would be wasted.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.level === 'high' && !quality.bloom,
    stencil: false,
    powerPreference: 'high-performance',
  });
  let pixelRatio = quality.pixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = quality.mobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#F59F6E', 420, 1900);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 2, CAMERA_FAR);

  // sky dome, drawn after the ground so it only shades the pixels the ground leaves uncovered
  const skyU = {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    bottom: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Color() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyU,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // below the horizon the sky stays the fog colour for a little while, so it
      // blends with fully fogged ground in the distance
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 c = y > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.6, y), 0.8)) : mix(horizon, bottom, smoothstep(-0.06, -0.3, y));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += sunCol * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.35);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  sky.renderOrder = 1000;
  sky.frustumCulled = false;
  scene.add(sky);

  // stars for night
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  const starR = SKY_RADIUS * 0.9;
  for (let i = 0; i < 1500; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 0.95);
    sp.push(Math.sin(ph) * Math.cos(th) * starR, Math.cos(ph) * starR, Math.sin(ph) * Math.sin(th) * starR);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: '#FFFFFF', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.visible = false;
  scene.add(stars);

  // lights
  const hemi = new THREE.HemisphereLight('#FFE3C8', '#3A5A3A', 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#FFB07A', 2);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const SHADOW_HALF = 220;
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 10, far: 1500 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 1.5;
  scene.add(sun, sun.target);

  // post-processing
  let composer = null;
  let bloom = null;
  let bloomOn = false;
  function buildComposer() {
    // EffectComposer reads its CSS size from this target and applies the pixel ratio itself
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
      type: THREE.HalfFloatType,
      samples: quality.level === 'high' ? 4 : 0,
    });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pixelRatio);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new ScaledBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.82, quality.bloomScale);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  if (quality.bloom) {
    buildComposer();
    bloomOn = true;
  }

  // time of day
  const now = { top: new THREE.Color(), hor: new THREE.Color(), sunC: new THREE.Color(), hemiS: new THREE.Color(), hemiG: new THREE.Color(), fow: new THREE.Color(), dir: new THREE.Vector3(), sunI: 0, hemiI: 0, exp: 1, stars: 0, bloom: 0.5 };
  let from = null;
  let t = 1;
  const COLOR_KEYS = ['top', 'hor', 'sunC', 'hemiS', 'hemiG', 'fow'];
  const NUM_KEYS = ['sunI', 'hemiI', 'exp', 'stars', 'bloom'];

  function push() {
    skyU.top.value.copy(now.top);
    skyU.horizon.value.copy(now.hor);
    skyU.bottom.value.copy(now.hor).multiplyScalar(0.35);
    skyU.sunDir.value.copy(now.dir);
    skyU.sunCol.value.copy(now.sunC);
    scene.fog.color.copy(now.hor);
    sun.color.copy(now.sunC);
    sun.intensity = now.sunI;
    hemi.color.copy(now.hemiS);
    hemi.groundColor.copy(now.hemiG);
    hemi.intensity = now.hemiI;
    fog.uniforms.uFowColor.value.copy(now.fow);
    fog.uniforms.uSunDir.value.copy(now.dir);
    fog.uniforms.uSunColor.value.copy(now.sunC).multiplyScalar(Math.min(1, now.sunI / 2));
    renderer.toneMappingExposure = now.exp;
    starMat.opacity = now.stars;
    stars.visible = now.stars > 0.01; // 1,500 points skipped in daylight
    if (bloom) bloom.strength = now.bloom;
  }

  const toDir = new THREE.Vector3();
  function setTime(idx, instant = false) {
    const p = TIMES[idx];
    if (instant) {
      for (const k of COLOR_KEYS) now[k].set(p[k]);
      now.dir.set(...p.dir).normalize();
      for (const k of NUM_KEYS) now[k] = p[k];
      push();
      return;
    }
    from = { to: p, dir: now.dir.clone() };
    for (const k of COLOR_KEYS) from[k] = now[k].clone();
    for (const k of NUM_KEYS) from[k] = now[k];
    toDir.set(...p.dir).normalize();
    t = 0;
  }

  const tmpC = new THREE.Color();
  function updateTime(dt) {
    if (!from || t >= 1) return;
    t = Math.min(1, t + dt / 1.6);
    const e = smooth(0, 1, t);
    const p = from.to;
    for (const k of COLOR_KEYS) now[k].copy(from[k]).lerp(tmpC.set(p[k]), e);
    now.dir.copy(from.dir).lerp(toDir, e).normalize();
    for (const k of NUM_KEYS) now[k] = lerp(from[k], p[k], e);
    push();
  }

  // The shadow camera follows the player. Its position is snapped to whole
  // shadow-map texels, so shadows don't crawl and shimmer while you walk.
  const UP = new THREE.Vector3(0, 1, 0);
  const lx = new THREE.Vector3();
  const ly = new THREE.Vector3();
  const snapped = new THREE.Vector3();
  function follow(target) {
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    snapped.copy(target);
    if (sun.castShadow) {
      const texel = (SHADOW_HALF * 2) / sun.shadow.mapSize.x;
      lx.crossVectors(UP, now.dir).normalize(); // shadow camera's x axis
      ly.crossVectors(now.dir, lx); // and y axis
      const a = target.dot(lx);
      const b = target.dot(ly);
      snapped.addScaledVector(lx, Math.round(a / texel) * texel - a).addScaledVector(ly, Math.round(b / texel) * texel - b);
    }
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(now.dir, 700);
  }

  function render() {
    if (bloomOn) composer.render();
    else renderer.render(scene, camera);
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (composer) composer.setSize(innerWidth, innerHeight);
  }

  /* ---------- runtime quality controls (used by the automatic quality steps) ---------- */
  function setPixelRatio(pr) {
    pixelRatio = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(innerWidth, innerHeight);
    if (composer) {
      composer.setPixelRatio(pr);
      composer.setSize(innerWidth, innerHeight);
    }
  }
  function setBloom(on) {
    if (on && !composer) buildComposer();
    bloomOn = on && !!composer;
  }
  function setShadows(on) {
    renderer.shadowMap.enabled = on;
    sun.castShadow = on; // changes the light state, so materials recompile once
  }

  return {
    renderer, scene, camera, setTime, updateTime, follow, render, resize, timeNow: now,
    setPixelRatio, setBloom, setShadows,
    get pixelRatio() { return pixelRatio; },
    get bloomOn() { return bloomOn; },
    get shadowsOn() { return renderer.shadowMap.enabled; },
  };
}
