// Small shared helpers.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Stable 32-bit hash of a string (FNV-1a).
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Seeded random number generator, so a tile always gets the same trees.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// '#RRGGBB' made darker by `k` (0–1), or lighter for negative `k`. Cached: rules
// colours are few and this runs per painted polygon.
const shades = new Map();
export function shadeHex(hex, k) {
  const key = hex + k;
  let out = shades.get(key);
  if (out) return out;
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v) => {
    const c = k >= 0 ? v * (1 - k) : v + (255 - v) * -k;
    return Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0');
  };
  out = `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
  shades.set(key, out);
  return out;
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
