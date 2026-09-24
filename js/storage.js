// Saves progress in this browser only (stars, claims, explored fog).
// Every access is wrapped because storage can be blocked (private mode etc.).

const PREFIX = 'tw.';

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: progress just isn't saved */
    }
  },
};

export function loadBytes(key) {
  try {
    const s = localStorage.getItem(PREFIX + key);
    if (!s) return null;
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function saveBytes(key, bytes) {
  try {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    localStorage.setItem(PREFIX + key, btoa(s));
  } catch {
    /* ignore */
  }
}
