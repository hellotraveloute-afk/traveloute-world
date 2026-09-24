// Traveloute World: boots a session, runs the game loop and handles input.
//
// Two ways to run:
//   - In a browser: the web HUD, start screen and browser GPS are used.
//   - Inside the app (?embed=1): the app draws the HUD, owns the GPS and the
//     game rules, and talks to the world through js/bridge.js.

import * as THREE from 'three';
import { CONFIG, PRESETS, detectQuality } from './config.js';
import { Projection } from './geo.js';
import { FogOfWar } from './fog.js';
import { createWorld } from './world.js';
import { TileManager } from './tiles.js';
import { Landmarks } from './landmarks.js';
import { makeAvatar, animateAvatar } from './avatar.js';
import { GAMEPLAY, TIMES, timeIndexForHour, titleFor } from './rules.js';
import { store } from './storage.js';
import * as hud from './hud.js';
import * as bridge from './bridge.js';
import { clamp, lerp, fmt, escapeHtml } from './util.js';

const $ = hud.$;
const EMBED = bridge.EMBED;
let quality = detectQuality();
const profile = store.get('profile', { stars: 0, xp: 0, level: 1, stamps: [] });
// In the app, claims (and their cooldowns) come from the app with `setClaimed`.
const claims = EMBED ? {} : store.get('claims', {});

let proj, fog, world, tiles, landmarks, player;
let mode = 'explore';
let timeIndex = 1;
let gpsWatch = null;
let gpsTarget = null;
let gpsAccuracy = null;
let pendingFix = null;
let moveTarget = null;
let busy = false;
let started = false;
let hudLive = false;
let lastStamp = new THREE.Vector3(1e9, 0, 0);
let tileTimer = 0;
let lastStatusKey = '';
let saveTimer = 0;
let scanUntil = 0;
let gpsTapHintShown = false;
const keys = new Set();
const cam = { yaw: 0.6, pitch: 0.8, dist: 115, target: new THREE.Vector3() };
const bursts = [];
let destMarker, scanRing;

/* ======================================================= start screen */

function renderStart() {
  const grid = $('#presetGrid');
  grid.innerHTML = PRESETS.map(
    (p) => `<button class="preset" data-lat="${p.lat}" data-lon="${p.lon}"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.sub)}</span></button>`
  ).join('');
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b) return;
    hud.ensureAudio();
    startSession(Number(b.dataset.lat), Number(b.dataset.lon), 'explore');
  });
  $('#gpsStart').addEventListener('click', () => {
    hud.ensureAudio();
    if (!navigator.geolocation) {
      $('#startError').textContent = 'This browser cannot share your location. Pick a place below instead.';
      return;
    }
    $('#gpsStart').disabled = true;
    $('#gpsStart').textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      (pos) => startSession(pos.coords.latitude, pos.coords.longitude, 'gps'),
      (err) => {
        $('#gpsStart').disabled = false;
        $('#gpsStart').textContent = 'Use my location';
        $('#startError').textContent =
          err.code === 1
            ? 'Location permission was denied. Allow it in your browser settings, or pick a place below.'
            : 'Could not get your location. Check that location is on, or pick a place below.';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  });
  $('#coordForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const m = $('#coordInput').value.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) {
      $('#startError').textContent = 'Enter coordinates as latitude, longitude, for example 6.8667, 81.0466.';
      return;
    }
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) > 84 || Math.abs(lon) > 180) {
      $('#startError').textContent = 'Those coordinates are outside the map. Latitude must be between -84 and 84.';
      return;
    }
    hud.ensureAudio();
    startSession(lat, lon, 'explore');
  });
  $('#qualityNote').textContent = `Graphics: ${quality.level === 'high' ? 'high' : 'battery saver'} (add ?quality=low or ?quality=high to the link to change)`;

  const params = new URLSearchParams(location.search);
  const preset = PRESETS.find((p) => p.key === params.get('place'));
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (preset) startSession(preset.lat, preset.lon, 'explore');
  else if (params.has('lat') && params.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)) startSession(lat, lon, 'explore');
}

/* ======================================================= session */

async function startSession(lat, lon, startMode, qualityOverride) {
  if (started) return;
  started = true;
  mode = startMode;
  if (qualityOverride) quality = detectQuality(qualityOverride);
  $('#start').hidden = true;
  $('#loader').hidden = false;
  $('#loaderText').textContent = 'Downloading the map around you…';

  proj = new Projection(lat, lon, CONFIG.zoom);
  fog = new FogOfWar(proj);
  try {
    world = createWorld($('#scene'), quality, fog);
  } catch (e) {
    console.error(e);
    $('#loaderText').textContent = 'This device or browser does not support WebGL, which the 3D world needs.';
    if (EMBED) bridge.send({ type: 'error', message: 'This device does not support WebGL, which the 3D world needs.', fatal: true });
    return;
  }
  landmarks = new Landmarks({
    scene: world.scene,
    labelsEl: $('#labels'),
    fog,
    claims,
    onDiscover: (it) => {
      hud.sfx('discover');
      if (EMBED) bridge.send({ type: 'discovered', place: bridge.placeJson(it) });
      else hud.toast(`Discovered <b>${escapeHtml(it.p.name)}</b>`, it.p.color, 'eye');
    },
  });
  tiles = new TileManager({
    scene: world.scene,
    proj,
    quality,
    fog,
    onPlacesAdded: (k, places) => landmarks.add(k, places),
    onPlacesRemoved: (k) => landmarks.remove(k),
    onStatus: (ready, total) => {
      hud.setStatus(ready < total ? `Building world ${ready}/${total}` : null);
      const key = `${ready}/${total}`;
      if (EMBED && key !== lastStatusKey) {
        lastStatusKey = key;
        bridge.send({ type: 'status', tilesReady: ready, tilesTotal: total });
      }
    },
    onError: (message) => EMBED && bridge.send({ type: 'error', message }),
  });
  const hasMap = await tiles.init();

  player = makeAvatar({ jacket: '#FF7A59', pack: '#FFC857', hat: '#E9D8A6' }, CONFIG.avatarScale);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 2, 40),
    new THREE.MeshBasicMaterial({ color: '#5CE1C6', transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  player.add(ring);
  player.userData.ring = ring;
  world.scene.add(player);

  destMarker = new THREE.Mesh(
    new THREE.RingGeometry(2.5, 4, 32),
    new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false })
  );
  destMarker.rotation.x = -Math.PI / 2;
  destMarker.visible = false;
  world.scene.add(destMarker);
  scanRing = new THREE.Mesh(
    new THREE.RingGeometry(0.96, 1, 128),
    new THREE.MeshBasicMaterial({ color: '#5CE1C6', transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
  );
  scanRing.rotation.x = -Math.PI / 2;
  scanRing.renderOrder = 5;
  world.scene.add(scanRing);

  const h = new Date();
  timeIndex = timeIndexForHour(h.getHours() + h.getMinutes() / 60);
  world.setTime(timeIndex, true);

  if (pendingFix) {
    applyFix(pendingFix);
    pendingFix = null;
  }

  fog.stamp(0, 0, GAMEPLAY.revealRadius * 1.8);
  tiles.update(0, 0);
  addEventListener('resize', () => world.resize());
  requestAnimationFrame(frame);

  // wait for the tile under the player before revealing the world
  const t0 = performance.now();
  await new Promise((resolve) => {
    const check = () => {
      if (tiles.isReadyAt(0, 0) || performance.now() - t0 > 30000) resolve();
      else setTimeout(check, 150);
    };
    check();
  });
  player.position.y = tiles.heightAt(0, 0);
  cam.target.copy(player.position);
  $('#loader').classList.add('done');
  setTimeout(() => ($('#loader').hidden = true), 700);
  hudLive = true;
  if (EMBED) {
    bridge.send({ type: 'worldReady', timeIndex });
    if (!hasMap) bridge.send({ type: 'error', message: 'Map details could not load, so only terrain is shown.' });
  } else {
    for (const id of ['hud', 'dock', 'quests']) $('#' + id).hidden = false;
    $('#hint').hidden = mode === 'gps';
    hud.setStars(profile.stars);
    refreshProfile();
    updateModeButton();
    if (!hasMap) hud.toast('Map details could not load, so only terrain is shown. Check your connection and reload.', '#FF7A59', 'alert');
  }
  if (mode === 'gps') startGps();
}

function refreshProfile() {
  hud.setProfile({ level: profile.level, xp: profile.xp, xpNext: GAMEPLAY.xpForLevel(profile.level), title: titleFor(profile.level) });
}
function saveProfile() {
  store.set('profile', profile);
  store.set('claims', claims);
}

/* ======================================================= GPS */

// In the app the position comes from `setPlayer`; the browser is never asked.
function startGps() {
  if (EMBED) return;
  if (!navigator.geolocation) {
    hud.toast('Location is not available in this browser.', '#FF7A59', 'alert');
    setMode('explore');
    return;
  }
  if (gpsWatch !== null) return;
  gpsWatch = navigator.geolocation.watchPosition(
    (pos) => applyFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
    (err) => {
      hud.toast(err.code === 1 ? 'Location permission denied. Switched to Explore mode.' : 'Lost your location. Switched to Explore mode.', '#FF7A59', 'alert');
      setMode('explore');
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
  );
}
function stopGps() {
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
  gpsTarget = null;
}
function applyFix({ lat, lon, accuracyM }) {
  const w = proj.toWorld(lat, lon);
  gpsTarget = new THREE.Vector3(w.x, 0, w.z);
  gpsAccuracy = Number.isFinite(accuracyM) ? accuracyM : null;
}
function setMode(m) {
  if (m !== 'gps' && m !== 'explore') return;
  mode = m;
  if (!started || !destMarker) return;
  if (m === 'gps') {
    moveTarget = null;
    destMarker.visible = false;
    startGps();
    if (!EMBED) hud.toast('GPS mode: walk in real life to move', '#5CE1C6', 'pin');
  } else {
    stopGps();
    if (!EMBED) hud.toast('Explore mode: tap the ground to walk', '#5CE1C6', 'pin');
  }
  updateModeButton();
}
function updateModeButton() {
  const b = $('#modeBtn');
  b.textContent = mode === 'gps' ? 'GPS' : 'Explore';
  b.setAttribute('aria-label', mode === 'gps' ? 'GPS mode on. Switch to Explore mode' : 'Explore mode on. Switch to GPS mode');
}

/* ======================================================= input */

const canvas = $('#scene');
const pointers = new Map();
let drag = null;
let pinch0 = 0;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

canvas.addEventListener('pointerdown', (e) => {
  if (!player) return;
  hud.ensureAudio();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) drag = { moved: 0 };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
    drag = null;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0) cam.dist = clamp((cam.dist * pinch0) / d, 40, 420);
    pinch0 = d;
    return;
  }
  if (drag) {
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 8) {
      canvas.classList.add('dragging');
      cam.yaw -= dx * 0.006;
      cam.pitch = clamp(cam.pitch + dy * 0.004, 0.35, 1.35);
    }
  }
});
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (drag && drag.moved <= 8 && pointers.size === 0) tapAt(e.clientX, e.clientY);
  if (pointers.size === 0) {
    drag = null;
    canvas.classList.remove('dragging');
  }
  if (pointers.size < 2) pinch0 = 0;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    cam.dist = clamp(cam.dist * (1 + e.deltaY * 0.001), 40, 420);
  },
  { passive: false }
);
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
addEventListener('keydown', (e) => {
  if (!player || hud.sheetOpen() || !$('#modal').hidden || e.target.closest('input')) return;
  const k = e.key.toLowerCase();
  if (MOVE_KEYS.includes(k)) {
    if (mode === 'gps') return;
    keys.add(k);
    moveTarget = null;
    destMarker.visible = false;
    $('#hint').classList.add('gone');
    e.preventDefault();
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function tapAt(x, y) {
  if (hud.sheetOpen()) {
    hud.closeSheet();
    return;
  }
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, world.camera);
  const hitCrystal = raycaster.intersectObjects(landmarks.crystals(), false)[0];
  let target;
  if (hitCrystal) {
    const item = hitCrystal.object.userData.item;
    if (EMBED) bridge.send({ type: 'placeTapped', place: bridge.placeJson(item) });
    target = new THREE.Vector3(item.p.x + 6, 0, item.p.z + 6);
  } else {
    const meshes = [...tiles.tiles.values()].filter((t) => t.terrain && t.state === 'ready').map((t) => t.terrain);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return;
    target = hit.point;
  }
  if (mode === 'gps') {
    if (!gpsTapHintShown && !EMBED) {
      hud.toast('In GPS mode you move by walking. Switch to Explore to tap-walk.', '#5CE1C6', 'pin');
      gpsTapHintShown = true;
    }
    return;
  }
  walkTo(target.x, target.z);
}
function walkTo(x, z) {
  moveTarget = new THREE.Vector3(x, 0, z);
  destMarker.position.set(x, tiles.heightAt(x, z) + 0.6, z);
  destMarker.visible = true;
  destMarker.userData.t = 0;
  hud.sfx('tap');
  $('#hint').classList.add('gone');
}
function walkToPlace(item) {
  if (mode === 'gps') setMode('explore');
  walkTo(item.p.x + 6, item.p.z + 6);
}

/* ======================================================= HUD buttons (browser only) */

$('#actionBtn').addEventListener('click', () => {
  hud.ensureAudio();
  const near = claimable();
  if (near) claim(near.item);
  else scan();
});
$('#timeBtn').addEventListener('click', () => {
  setTime((timeIndex + 1) % TIMES.length);
  hud.toast(TIMES[timeIndex].name, '#FFC857', 'sun');
  hud.sfx('tap');
});
let soundOn = true;
function setSound(on) {
  soundOn = on;
  hud.setSound(soundOn);
  $('#soundBtn').setAttribute('aria-pressed', String(soundOn));
  $('#soundBtn').setAttribute('aria-label', soundOn ? 'Mute sound' : 'Turn sound on');
  $('#soundIcon').innerHTML = soundOn
    ? '<path d="M4 9h4l5-4v14l-5-4H4z"></path><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"></path>'
    : '<path d="M4 9h4l5-4v14l-5-4H4z"></path><path d="M17 9l5 6M22 9l-5 6"></path>';
}
$('#soundBtn').addEventListener('click', () => setSound(!soundOn));
$('#compassBtn').addEventListener('click', () => {
  cam.yaw = 0;
  hud.sfx('tap');
});
$('#modeBtn').addEventListener('click', () => setMode(mode === 'gps' ? 'explore' : 'gps'));
$('#placeBtn').addEventListener('click', () => {
  fog && fog.save();
  location.href = location.pathname;
});
$('#questToggle').addEventListener('click', () => {
  const q = $('#quests');
  q.classList.toggle('collapsed');
  $('#questToggle').setAttribute('aria-expanded', String(!q.classList.contains('collapsed')));
});
if (innerWidth < 520) {
  $('#quests').classList.add('collapsed');
  $('#questToggle').setAttribute('aria-expanded', 'false');
}

function setTime(idx) {
  timeIndex = ((idx % TIMES.length) + TIMES.length) % TIMES.length;
  if (world) world.setTime(timeIndex);
}

document.querySelectorAll('.dock .tab').forEach((b) =>
  b.addEventListener('click', () => {
    hud.ensureAudio();
    hud.sfx('tap');
    const tab = b.dataset.tab;
    if (tab === 'nearby') hud.openSheet(nearbySheet());
    else if (tab === 'passport') hud.openSheet(passportSheet());
    else if (tab === 'explored') {
      hud.toast(`You have uncovered <b>${fog.percentAt(player.position.x, player.position.z).toFixed(1)}%</b> of this area`, '#5CE1C6', 'eye');
    }
  })
);
$('#profileBtn').addEventListener('click', () => hud.openSheet(passportSheet()));
$('#sheet').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) {
    hud.closeSheet();
    return;
  }
  const go = e.target.closest('[data-go]');
  if (go) {
    const it = landmarks.items.get(go.dataset.go);
    if (it) {
      walkToPlace(it);
      hud.closeSheet();
    }
  }
});

function nearbySheet() {
  const rows = landmarks.list(player.position).slice(0, 40);
  const body = rows.length
    ? rows
        .map(({ it, d }) => {
          const hidden = it.status === 'mystery';
          const name = hidden ? 'Hidden place' : escapeHtml(it.p.name);
          const sub = hidden ? 'Walk closer to uncover it' : `${escapeHtml(it.p.kind)} · ${it.status === 'claimed' ? 'claimed' : '★' + it.p.stars}`;
          return `<div class="card place-row"><span class="rar" style="background:${hidden ? '#8E86C4' : it.p.color}">${hidden ? '???' : it.p.rarity.toUpperCase()}</span><span class="grow"><b>${name}</b><span class="muted">${sub}</span></span><span class="dist">${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}</span><button class="go" data-go="${escapeHtml(it.p.id)}" aria-label="Walk to ${name}">Go</button></div>`;
        })
        .join('')
    : '<p class="muted">No places found in the loaded area yet. Walk around or wait for the map to finish loading.</p>';
  return `<div class="sheet-head"><h2>Nearby</h2>${hud.closeButton()}</div><p class="muted" style="margin:4px 0 12px">Places from OpenStreetMap around you. "Go" walks you there in Explore mode.</p>${body}`;
}

function passportSheet() {
  const stamps = [...profile.stamps].reverse();
  const list = stamps.length
    ? `<div class="stamps">${stamps
        .slice(0, 60)
        .map(
          (s) =>
            `<div class="stamp" style="color:${s.color}"><div class="disc"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${s.color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${hud.iconForKind(s.kind || '')}</svg></div><span style="color:var(--ink)">${escapeHtml(s.name)}<small>${new Date(s.at).toLocaleDateString()}</small></span></div>`
        )
        .join('')}</div>`
    : '<p class="muted">No stamps yet. Find a glowing crystal and claim it.</p>';
  return `<div class="sheet-head"><h2>Passport</h2>${hud.closeButton()}</div>
    <p class="muted" style="margin:4px 0 0">Level ${profile.level} · ${titleFor(profile.level)} · ${fmt(profile.xp)} / ${fmt(GAMEPLAY.xpForLevel(profile.level))} XP</p>
    <div class="statgrid"><div><b>${fmt(profile.stars)}</b><span>Stars</span></div><div><b>${profile.stamps.length}</b><span>Stamps</span></div><div><b>${fog.percentAt(player.position.x, player.position.z).toFixed(1)}%</b><span>Area uncovered</span></div></div>
    <h3>Stamps</h3>${list}<p class="muted" style="margin-top:16px">Progress is saved in this browser only for now.</p>`;
}

/* ======================================================= claiming + scanning */

function claimRadius() {
  return GAMEPLAY.claimRadius[mode];
}
function claimable() {
  return landmarks.nearest(player.position, claimRadius(), (it) => it.status === 'open');
}

// The visual part of a claim: mark the crystal, clear fog, sound and star burst.
// Returns the screen point of the burst.
function playClaimEffect(item) {
  const p = item.p;
  landmarks.claim(item);
  fog.stamp(p.x, p.z, GAMEPLAY.revealOnClaim);
  hud.sfx('claim');
  const at = new THREE.Vector3(p.x, p.y + 12, p.z);
  burst(at, p.color);
  const sp = at.clone().project(world.camera);
  return { x: (sp.x * 0.5 + 0.5) * innerWidth, y: (-sp.y * 0.5 + 0.5) * innerHeight };
}

// Browser-only claim: the page keeps its own stars, stamps and XP.
function claim(item) {
  if (busy) return;
  busy = true;
  const p = item.p;
  const sp = playClaimEffect(item);
  profile.stars += p.stars;
  profile.stamps.push({ id: p.id, name: p.name, kind: p.kind, rarity: p.rarity, color: p.color, at: Date.now() });
  saveProfile();
  hud.flyStars(sp.x, sp.y, () => hud.setStars(profile.stars, true));
  setTimeout(
    () =>
      hud.stampModal(p, p.stars, GAMEPLAY.xpPerClaim, () => {
        busy = false;
        addXp(GAMEPLAY.xpPerClaim);
      }),
    650
  );
}

function addXp(n) {
  profile.xp += n;
  let leveled = false;
  while (profile.xp >= GAMEPLAY.xpForLevel(profile.level)) {
    profile.xp -= GAMEPLAY.xpForLevel(profile.level);
    profile.level++;
    leveled = true;
  }
  saveProfile();
  refreshProfile();
  if (leveled) hud.levelUp(profile.level, titleFor(profile.level));
}

const DIRECTIONS = ['behind you', 'behind-right', 'to the right', 'ahead-right', 'ahead', 'ahead-left', 'to the left', 'behind-left'];

// Plays the scan pulse and finds the nearest hidden place.
// Returns { found, item?, d?, direction?, bearing? }. When nothing hidden is
// near, `item` is the nearest open place (if any) so the player gets a hint.
function runScan() {
  scanRing.userData = { t: 0, x: player.position.x, z: player.position.z };
  hud.sfx('scan');
  const near = landmarks.nearest(player.position, GAMEPLAY.scanRange, (it) => it.status === 'mystery');
  if (near) {
    const dx = near.item.p.x - player.position.x;
    const dz = near.item.p.z - player.position.z;
    // direction relative to where the camera is looking
    const ang = Math.atan2(dx, dz) - cam.yaw;
    const idx = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
    // compass bearing: +x is east, -z is north
    const bearing = (((Math.atan2(dx, -dz) * 180) / Math.PI) + 360) % 360;
    return { found: true, item: near.item, d: near.d, direction: DIRECTIONS[idx], bearing };
  }
  const open = landmarks.nearest(player.position, GAMEPLAY.scanRange, (it) => it.status === 'open');
  return open ? { found: false, item: open.item, d: open.d } : { found: false };
}

function scan() {
  if (performance.now() < scanUntil) return;
  scanUntil = performance.now() + GAMEPLAY.scanCooldownMs;
  const r = runScan();
  if (r.found) hud.toast(`Something hidden <b>${fmtDist(r.d)}</b> ${r.direction}`, '#B69CFF', 'radar');
  else hud.toast(r.item ? `Nothing hidden nearby. <b>${escapeHtml(r.item.p.name)}</b> is ${fmtDist(r.d)} away.` : 'Nothing found nearby. Try another direction.', '#5CE1C6', 'radar');
}
const fmtDist = (d) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);

/* ---------- star burst particles ---------- */
let starTexture = null;
function getStarTexture() {
  if (starTexture) return starTexture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.translate(32, 32);
  c.fillStyle = '#FFFFFF';
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 12 : 30;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
  c.fill();
  starTexture = new THREE.CanvasTexture(cv);
  return starTexture;
}
function burst(pos, color) {
  const N = 70;
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(N * 3);
  const vel = [];
  for (let i = 0; i < N; i++) {
    arr.set([pos.x, pos.y, pos.z], i * 3);
    const a = Math.random() * Math.PI * 2;
    const s = 15 + Math.random() * 30;
    vel.push(new THREE.Vector3(Math.cos(a) * s, 30 + Math.random() * 40, Math.sin(a) * s));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const mat = new THREE.PointsMaterial({ map: getStarTexture(), color, size: 5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const pts = new THREE.Points(geo, mat);
  world.scene.add(pts);
  bursts.push({ pts, vel, life: 0 });
}
function updateBursts(dt) {
  for (let b = bursts.length - 1; b >= 0; b--) {
    const B = bursts[b];
    B.life += dt;
    const a = B.pts.geometry.attributes.position;
    for (let i = 0; i < B.vel.length; i++) {
      B.vel[i].y -= 60 * dt;
      a.setXYZ(i, a.getX(i) + B.vel[i].x * dt, a.getY(i) + B.vel[i].y * dt, a.getZ(i) + B.vel[i].z * dt);
    }
    a.needsUpdate = true;
    B.pts.material.opacity = 1 - B.life / 1.6;
    if (B.life > 1.6) {
      world.scene.remove(B.pts);
      B.pts.geometry.dispose();
      B.pts.material.dispose();
      bursts.splice(b, 1);
    }
  }
}

/* ======================================================= context */

// What the player is near right now: claim | claimed | near | none.
function currentContext() {
  const near = claimable();
  if (near) return { kind: 'claim', item: near.item, d: near.d };
  const claimed = landmarks.nearest(player.position, claimRadius(), (it) => it.status === 'claimed');
  if (claimed) return { kind: 'claimed', item: claimed.item, d: claimed.d };
  const close = landmarks.nearest(player.position, 160, (it) => it.status === 'open');
  if (close) return { kind: 'near', item: close.item, d: close.d };
  return { kind: 'none' };
}

function updateContext(ctx) {
  if (ctx.kind === 'claim') {
    const p = ctx.item.p;
    hud.setAction('claim', `CLAIM\n★${p.stars}`);
    hud.setContext(
      `<div class="ctx-row"><span class="rar" style="background:${p.color}">${p.rarity.toUpperCase()}</span><span class="ctx-sub">${Math.round(ctx.d)} m away</span></div><div class="ctx-title">${escapeHtml(p.name)}</div><div class="ctx-sub" style="text-transform:capitalize">${escapeHtml(p.kind)} · ★${p.stars}</div>`,
      'gold'
    );
    return;
  }
  hud.setAction('scan', 'SCAN');
  if (ctx.kind === 'claimed') {
    hud.setContext(`<div class="ctx-row"><span class="ctx-eyebrow" style="color:var(--muted)">CLAIMED</span></div><div class="ctx-title">${escapeHtml(ctx.item.p.name)}</div><div class="ctx-sub">Come back in 2 days to claim again.</div>`);
    return;
  }
  if (ctx.kind === 'near') {
    const p = ctx.item.p;
    hud.setContext(
      `<div class="ctx-row"><span class="rar" style="background:${p.color}">${p.rarity.toUpperCase()}</span><span class="ctx-sub">${Math.round(ctx.d)} m away</span></div><div class="ctx-title">${escapeHtml(p.name)}</div><div class="ctx-sub">Walk within ${claimRadius()} m to claim ★${p.stars}</div>`
    );
    return;
  }
  if (mode === 'gps' && gpsAccuracy && gpsAccuracy > 60) {
    hud.setContext(`<div class="ctx-row"><span class="ctx-eyebrow" style="color:var(--coral)">WEAK GPS</span></div><div class="ctx-sub">Location accuracy is about ${Math.round(gpsAccuracy)} m. Claims work best outdoors.</div>`, 'coral');
    return;
  }
  hud.setContext('');
}

// Sends `context` to the app only when the kind, the place, or the distance
// (in 5 m steps) changes, and at most every 250 ms.
let lastContextKey = '';
let lastContextAt = 0;
function reportContext(ctx) {
  const now = performance.now();
  if (now - lastContextAt < 250) return;
  const key = `${ctx.kind}|${ctx.item ? ctx.item.p.id : ''}|${ctx.item ? Math.round(ctx.d / 5) : ''}`;
  if (key === lastContextKey) return;
  lastContextKey = key;
  lastContextAt = now;
  const msg = { type: 'context', kind: ctx.kind };
  if (ctx.item) {
    msg.place = bridge.placeJson(ctx.item);
    msg.distanceM = Math.round(ctx.d);
    msg.radiusM = claimRadius();
  }
  bridge.send(msg);
}

/* ---------- reports for the app: explored share and frame rate ---------- */
let exploredTimer = 0;
let lastExplored = -1;
function reportExplored(dt) {
  exploredTimer += dt;
  if (exploredTimer < 3) return;
  exploredTimer = 0;
  const percent = Math.round(fog.percentAt(player.position.x, player.position.z) * 10) / 10;
  if (percent === lastExplored) return;
  lastExplored = percent;
  bridge.send({ type: 'explored', percent });
}

// Average frame rate over 5 s windows, plus the worst 1 s inside the window.
const fpsStats = { frames: 0, time: 0, secFrames: 0, secTime: 0, min: Infinity };
function reportFps(rawDt) {
  fpsStats.frames++;
  fpsStats.time += rawDt;
  fpsStats.secFrames++;
  fpsStats.secTime += rawDt;
  if (fpsStats.secTime >= 1) {
    fpsStats.min = Math.min(fpsStats.min, fpsStats.secFrames / fpsStats.secTime);
    fpsStats.secFrames = 0;
    fpsStats.secTime = 0;
  }
  if (fpsStats.time >= 5) {
    const value = Math.round((fpsStats.frames / fpsStats.time) * 10) / 10;
    const min = Number.isFinite(fpsStats.min) ? Math.round(fpsStats.min * 10) / 10 : value;
    bridge.send({ type: 'fps', value, min, quality: quality.level });
    fpsStats.frames = 0;
    fpsStats.time = 0;
    fpsStats.min = Infinity;
  }
}

/* ======================================================= loop */

const clock = new THREE.Clock();
const tmpDir = new THREE.Vector3();

function updatePlayer(dt, t) {
  tmpDir.set(0, 0, 0);
  let speed = CONFIG.exploreSpeed;
  if (mode === 'explore' && keys.size) {
    const fx = -Math.sin(cam.yaw);
    const fz = -Math.cos(cam.yaw);
    if (keys.has('w') || keys.has('arrowup')) tmpDir.add(new THREE.Vector3(fx, 0, fz));
    if (keys.has('s') || keys.has('arrowdown')) tmpDir.sub(new THREE.Vector3(fx, 0, fz));
    if (keys.has('d') || keys.has('arrowright')) tmpDir.add(new THREE.Vector3(-fz, 0, fx));
    if (keys.has('a') || keys.has('arrowleft')) tmpDir.sub(new THREE.Vector3(-fz, 0, fx));
  } else if (mode === 'explore' && moveTarget) {
    tmpDir.set(moveTarget.x - player.position.x, 0, moveTarget.z - player.position.z);
    if (tmpDir.length() < 1.5) {
      moveTarget = null;
      destMarker.visible = false;
      tmpDir.set(0, 0, 0);
    }
  } else if (mode === 'gps' && gpsTarget) {
    tmpDir.set(gpsTarget.x - player.position.x, 0, gpsTarget.z - player.position.z);
    const d = tmpDir.length();
    if (d > CONFIG.gpsTeleport) {
      player.position.x = gpsTarget.x;
      player.position.z = gpsTarget.z;
      tmpDir.set(0, 0, 0);
    } else if (d < 1.5) tmpDir.set(0, 0, 0);
    else speed = Math.min(CONFIG.gpsMaxSpeed, d * 1.5);
  }
  const moving = tmpDir.lengthSq() > 0;
  if (moving) {
    const len = tmpDir.length();
    const step = Math.min(speed * dt, mode === 'explore' && !keys.size ? len : Infinity);
    tmpDir.normalize();
    player.position.x += tmpDir.x * step;
    player.position.z += tmpDir.z * step;
    const want = Math.atan2(tmpDir.x, tmpDir.z);
    let dy = want - player.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    player.rotation.y += dy * Math.min(1, dt * 12);
  }
  const gy = tiles.heightAt(player.position.x, player.position.z);
  player.position.y = lerp(player.position.y, gy, Math.min(1, dt * 12));
  animateAvatar(player, t, moving);
  player.userData.ring.material.opacity = 0.45 + Math.sin(t * 4) * 0.25;

  if (player.position.distanceTo(lastStamp) > 4) {
    lastStamp.copy(player.position);
    fog.stamp(player.position.x, player.position.z, GAMEPLAY.revealRadius);
  }
  if (destMarker.visible) {
    destMarker.userData.t += dt;
    const k = (destMarker.userData.t * 1.5) % 1;
    destMarker.scale.setScalar(1 + k * 0.8);
    destMarker.material.opacity = 0.9 - k * 0.7;
  }
}

function updateCamera(dt) {
  cam.target.lerp(new THREE.Vector3(player.position.x, player.position.y + 6, player.position.z), Math.min(1, dt * 6));
  const cp = Math.cos(cam.pitch);
  const desired = new THREE.Vector3(
    cam.target.x + Math.sin(cam.yaw) * cp * cam.dist,
    cam.target.y + Math.sin(cam.pitch) * cam.dist,
    cam.target.z + Math.cos(cam.yaw) * cp * cam.dist
  );
  const minY = tiles.heightAt(desired.x, desired.z) + 10;
  if (desired.y < minY) desired.y = minY;
  world.camera.position.lerp(desired, Math.min(1, dt * 8));
  world.scene.fog.near = cam.dist + 300;
  world.scene.fog.far = cam.dist + 1800;
  world.camera.lookAt(cam.target);
  $('#compassIcon').style.transform = `rotate(${(cam.yaw * 180) / Math.PI}deg)`;
}

function updateScanRing(dt) {
  const u = scanRing.userData;
  if (u.t === undefined || u.t >= 1) {
    scanRing.material.opacity = 0;
    return;
  }
  u.t += dt / 1.8;
  scanRing.scale.setScalar(10 + u.t * GAMEPLAY.scanRange * 0.5);
  scanRing.material.opacity = (1 - u.t) * 0.9;
  scanRing.position.set(u.x, player.position.y + 3, u.z);
}

function frame() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const t = clock.elapsedTime;
  fog.uniforms.uTime.value = t;
  updatePlayer(dt, t);
  tileTimer += dt;
  if (tileTimer > 0.4) {
    tileTimer = 0;
    tiles.update(player.position.x, player.position.z);
  }
  landmarks.update(dt, t, player.position, world.camera);
  updateBursts(dt);
  updateScanRing(dt);
  world.updateTime(dt);
  updateCamera(dt);
  world.follow(player.position);
  if (hudLive) {
    const ctx = currentContext();
    if (EMBED) {
      reportContext(ctx);
      reportExplored(dt);
      reportFps(rawDt);
    } else updateContext(ctx);
  }
  saveTimer += dt * 1000;
  if (saveTimer > CONFIG.fogSaveIntervalMs) {
    saveTimer = 0;
    fog.save();
  }
  world.render();
  requestAnimationFrame(frame);
}

addEventListener('pagehide', () => fog && fog.save());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && fog) fog.save();
});

/* ======================================================= app bridge (embed mode) */

function initEmbed() {
  document.body.classList.add('embed');
  $('#start').hidden = true;

  bridge.on('start', (m) => {
    const lat = Number(m.lat);
    const lon = Number(m.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 84 || Math.abs(lon) > 180) {
      bridge.send({ type: 'error', message: 'Invalid start position.', fatal: true });
      return;
    }
    hud.ensureAudio();
    const q = m.quality === 'low' || m.quality === 'high' ? m.quality : undefined;
    startSession(lat, lon, m.mode === 'gps' ? 'gps' : 'explore', q);
  });
  bridge.on('setPlayer', (m) => {
    const fix = { lat: Number(m.lat), lon: Number(m.lon), accuracyM: Number(m.accuracyM) };
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return;
    if (proj) applyFix(fix);
    else pendingFix = fix;
  });
  bridge.on('setMode', (m) => setMode(m.mode));
  bridge.on('setTime', (m) => {
    if (Number.isInteger(m.index)) setTime(m.index);
    else if (typeof m.preset === 'string') {
      const idx = TIMES.findIndex((x) => x.name.toLowerCase() === m.preset.toLowerCase());
      if (idx >= 0) setTime(idx);
    }
  });
  bridge.on('scan', () => {
    if (!hudLive) return;
    const r = runScan();
    const msg = { type: 'scanResult', found: r.found };
    if (r.item) {
      msg.place = bridge.placeJson(r.item);
      msg.distanceM = Math.round(r.d);
    }
    if (r.direction) {
      msg.direction = r.direction;
      msg.bearing = Math.round(r.bearing);
    }
    bridge.send(msg);
  });
  bridge.on('claimResult', (m) => {
    if (!m.ok || typeof m.placeId !== 'string') return;
    const item = landmarks && landmarks.items.get(m.placeId);
    if (item) playClaimEffect(item);
    else claims[m.placeId] = Date.now();
  });
  bridge.on('setClaimed', (m) => {
    const ids = Array.isArray(m.ids) ? m.ids : [];
    for (const k of Object.keys(claims)) delete claims[k];
    const now = Date.now();
    for (const id of ids) if (typeof id === 'string') claims[id] = now;
  });
  bridge.on('walkTo', (m) => {
    const item = landmarks && landmarks.items.get(m.placeId);
    if (item) walkToPlace(item);
  });
  bridge.on('faceNorth', () => {
    cam.yaw = 0;
  });
  bridge.on('setSound', (m) => setSound(!!m.on));
  bridge.on('listNearby', (m) => {
    const limit = Number.isInteger(m.limit) ? clamp(m.limit, 1, 100) : 40;
    const rows = player && landmarks ? landmarks.list(player.position).slice(0, limit) : [];
    bridge.send({ type: 'nearby', places: rows.map(({ it, d }) => ({ ...bridge.placeJson(it), distanceM: Math.round(d) })) });
  });

  addEventListener('error', (e) => bridge.send({ type: 'error', message: String(e.message || 'Script error') }));
  addEventListener('unhandledrejection', (e) => bridge.send({ type: 'error', message: String((e.reason && e.reason.message) || e.reason || 'Unhandled error') }));

  bridge.send({ type: 'ready', protocol: bridge.PROTOCOL, version: bridge.VERSION });
}

if (EMBED) initEmbed();
else renderStart();
