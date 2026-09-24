// Renderer, sky, lights, time of day and post-processing.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TIMES } from './rules.js';
import { smooth, lerp } from './util.js';

export function createWorld(canvas, quality, fog) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.level === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#F59F6E', 420, 1900);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 8000);

  // sky dome
  const skyU = {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    bottom: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Color() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyU,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 c = y > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.6, y), 0.8)) : mix(horizon, bottom, smoothstep(0.0, -0.25, y));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += sunCol * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.35);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // stars for night
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 1500; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 0.95);
    sp.push(Math.sin(ph) * Math.cos(th) * 4500, Math.cos(ph) * 4500, Math.sin(ph) * Math.sin(th) * 4500);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: '#FFFFFF', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // lights
  const hemi = new THREE.HemisphereLight('#FFE3C8', '#3A5A3A', 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#FFB07A', 2);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 10, far: 1500 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 1.5;
  scene.add(sun, sun.target);

  // post-processing
  let composer = null;
  let bloom = null;
  if (quality.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.5, 0.55, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
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
    renderer.toneMappingExposure = now.exp;
    starMat.opacity = now.stars;
    if (bloom) bloom.strength = now.bloom;
  }

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
    t = 0;
  }

  const tmpC = new THREE.Color();
  function updateTime(dt) {
    if (!from || t >= 1) return;
    t = Math.min(1, t + dt / 1.6);
    const e = smooth(0, 1, t);
    const p = from.to;
    for (const k of COLOR_KEYS) now[k].copy(from[k]).lerp(tmpC.set(p[k]), e);
    now.dir.copy(from.dir).lerp(new THREE.Vector3(...p.dir).normalize(), e).normalize();
    for (const k of NUM_KEYS) now[k] = lerp(from[k], p[k], e);
    push();
  }

  function follow(target) {
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    sun.position.copy(target).addScaledVector(now.dir, 700);
    sun.target.position.copy(target);
  }

  function render() {
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (composer) {
      composer.setSize(innerWidth, innerHeight);
      bloom.resolution.set(innerWidth / 2, innerHeight / 2);
    }
  }

  return { renderer, scene, camera, setTime, updateTime, follow, render, resize, timeNow: now };
}
