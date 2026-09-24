// Everything on screen above the 3D world: HUD, toasts, rewards, sheets and sounds.

import { escapeHtml, fmt } from './util.js';

export const $ = (s) => document.querySelector(s);
const STAR_PATH = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.3l-5.9 3.2 1.2-6.5L2.5 9.4l6.6-.9z';

/* ---------- sound (synthesised, no audio files) ---------- */
let actx = null;
let soundOn = true;
export function ensureAudio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      actx = null;
    }
  }
  if (actx && actx.state === 'suspended') actx.resume();
}
export function setSound(on) {
  soundOn = on;
}
function tone(f, t0, dur, type = 'triangle', vol = 0.1) {
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(actx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}
export function sfx(name) {
  if (!soundOn || !actx) return;
  const t = actx.currentTime;
  if (name === 'claim') [659, 784, 988, 1319].forEach((f, i) => tone(f, t + i * 0.075, 0.5));
  else if (name === 'discover') [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.09, 0.7, 'sine', 0.09));
  else if (name === 'level') [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, t + i * 0.08, 0.8, 'square', 0.045));
  else if (name === 'tick') tone(1760, t, 0.12, 'sine', 0.04);
  else if (name === 'tap') tone(880, t, 0.07, 'sine', 0.04);
  else if (name === 'scan') {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.6);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + 1);
  }
}

/* ---------- toasts ---------- */
const TOAST_ICON = {
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
};
export function toast(html, color = '#5CE1C6', icon = 'check') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="ti" style="background:${color}33;color:${color}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TOAST_ICON[icon] || TOAST_ICON.check}</svg></span><span>${html}</span>`;
  const box = $('#toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 360);
  }, 3400);
}

/* ---------- profile + stars ---------- */
let shownStars = 0;
export function setStars(n, animate = false) {
  const el = $('#starCount');
  if (!animate) {
    shownStars = n;
    el.textContent = fmt(n);
    return;
  }
  const from = shownStars;
  shownStars = n;
  const t0 = performance.now();
  const pill = $('#starsPill');
  pill.classList.remove('pop');
  void pill.offsetWidth;
  pill.classList.add('pop');
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 700);
    el.textContent = fmt(from + (n - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function setProfile({ level, xp, xpNext, title }) {
  $('#lvBadge').textContent = level;
  $('#ptitle').textContent = title;
  $('#xpRing').setAttribute('stroke-dashoffset', String(157.1 * (1 - Math.min(1, xp / xpNext))));
}

export function levelUp(level, title) {
  const b = document.createElement('div');
  b.className = 'levelup';
  b.innerHTML = `LEVEL ${level}<small>${escapeHtml(title)}</small>`;
  $('#app').appendChild(b);
  sfx('level');
  setTimeout(() => b.remove(), 2700);
}

export function flyStars(sx, sy, done) {
  const target = $('#starIcon').getBoundingClientRect();
  const tx = target.left + target.width / 2;
  const ty = target.top + target.height / 2;
  let finished = 0;
  for (let i = 0; i < 9; i++) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('class', 'fly');
    el.innerHTML = `<path d="${STAR_PATH}" fill="#FFC857" stroke="#B36A00" stroke-width="1.2"></path>`;
    $('#app').appendChild(el);
    const mx = sx + (Math.random() - 0.5) * 180;
    const my = sy - 60 - Math.random() * 120;
    const anim = el.animate(
      [
        { transform: `translate(${sx}px,${sy}px) scale(.4) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${mx}px,${my}px) scale(1.3) rotate(180deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${tx}px,${ty}px) scale(.6) rotate(360deg)`, opacity: 1 },
      ],
      { duration: 850 + i * 70, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' }
    );
    anim.onfinish = () => {
      el.remove();
      finished++;
      if (finished === 1 && done) done();
      if (finished % 3 === 0) sfx('tick');
    };
  }
}

/* ---------- stamp modal ---------- */
const KIND_ICONS = {
  mountain: '<path d="M2 19l7-12 4 6 3-4 6 10z"/>',
  falls: '<path d="M6 4h12M8 4v9M12 4v12M16 4v9M4 20c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 4-1.5"/>',
  temple: '<path d="M12 3v3M8 12a4 4 0 0 1 8 0M6 12h12l-1 4H7zM5 20h14M9 16v4M15 16v4"/>',
  museum: '<path d="M3 9l9-5 9 5M5 9v9M9 9v9M15 9v9M19 9v9M3 20h18"/>',
  fort: '<path d="M4 20V8h3v3h3V8h4v3h3V8h3v12zM10 20v-4h4v4"/>',
  star: `<path d="${STAR_PATH}"/>`,
};
export function iconForKind(kind) {
  const k = kind.toLowerCase();
  if (/peak|viewpoint|volcano|cave/.test(k)) return KIND_ICONS.mountain;
  if (/waterfall/.test(k)) return KIND_ICONS.falls;
  if (/worship|temple|shrine|buddhist|hindu|church|mosque|christian|muslim/.test(k)) return KIND_ICONS.temple;
  if (/museum|gallery|memorial|monument/.test(k)) return KIND_ICONS.museum;
  if (/castle|fort|ruins|archaeolog|gate|battlefield|tomb/.test(k)) return KIND_ICONS.fort;
  return KIND_ICONS.star;
}
const iconSvg = (kind, size, color) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconForKind(kind)}</svg>`;

export function stampModal(p, stars, xp, onClose) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="stampTitle" style="border-color:${p.color}88">
    <div class="modal-eyebrow" style="color:${p.color}">NEW STAMP · ${p.rarity.toUpperCase()}</div>
    <div class="big-stamp" style="border-color:${p.color};color:${p.color}"><div class="inner">${iconSvg(p.kind, 50, p.color)}<span>${escapeHtml(p.name.toUpperCase())}</span></div></div>
    <div class="modal-title" id="stampTitle">${escapeHtml(p.name)}</div>
    <div class="muted" style="justify-content:center;text-transform:capitalize">${escapeHtml(p.kind)}</div>
    <div class="rewards"><span class="reward-chip" style="color:var(--gold)">+★${stars}</span><span class="reward-chip" style="color:var(--mint)">+${xp} XP</span></div>
    <button class="pill-btn" id="collectBtn">Collect</button></div>`;
  m.hidden = false;
  const btn = $('#collectBtn');
  btn.focus({ preventScroll: true });
  btn.addEventListener('click', () => {
    m.hidden = true;
    onClose && onClose();
  });
}

/* ---------- action button, context card, status ---------- */
let lastAction = '';
export function setAction(mode, label) {
  const key = mode + label;
  if (key === lastAction) return;
  lastAction = key;
  const b = $('#actionBtn');
  b.className = 'action ' + mode;
  b.textContent = label;
  b.setAttribute('aria-label', label.replace('\n', ' '));
}

let lastContext = '';
export function setContext(html, tone = '') {
  const key = tone + '|' + html;
  if (key === lastContext) return;
  lastContext = key;
  const el = $('#context');
  if (!html) {
    el.className = 'context';
    return;
  }
  el.innerHTML = html;
  el.className = 'context show ' + tone;
}

export function setStatus(text) {
  const el = $('#status');
  if (!text) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

/* ---------- sheets ---------- */
export function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.add('open');
}
export function closeSheet() {
  $('#sheet').classList.remove('open');
}
export function sheetOpen() {
  return $('#sheet').classList.contains('open');
}
export const closeButton = () =>
  '<button class="close" data-close aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFF8EC" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
