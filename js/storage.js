// Saves progress in this browser only (stars, claims, explored fog).
// Every access is wrapped because storage can be blocked (private mode etc.).

const PREFIX = 'tw.';
const RLE_MARK = '~'; // not in the base64 alphabet, so old raw saves are still recognised

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

/* ---------- byte arrays (fog grids) ---------- */
// Fog grids are mostly long runs of 0 (unexplored) or 255 (explored), so they are
// stored as (value, run length) pairs. A typical tile shrinks from ~22 KB to well
// under 1 KB, which keeps localStorage from filling up after a few hundred tiles.

export function rleEncode(bytes) {
  const out = new Uint8Array(bytes.length * 2);
  let n = 0;
  for (let i = 0; i < bytes.length; ) {
    const v = bytes[i];
    let run = 1;
    while (run < 255 && i + run < bytes.length && bytes[i + run] === v) run++;
    out[n++] = v;
    out[n++] = run;
    i += run;
  }
  return out.subarray(0, n);
}

export function rleDecode(pairs, length) {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i + 1 < pairs.length && o < length; i += 2) {
    const v = pairs[i];
    const end = Math.min(length, o + pairs[i + 1]);
    out.fill(v, o, end);
    o = end;
  }
  return o === length ? out : null;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(s);
}

function fromBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// `length` is the expected size; compressed saves need it to decode.
export function loadBytes(key, length) {
  try {
    const s = localStorage.getItem(PREFIX + key);
    if (!s) return null;
    if (s[0] === RLE_MARK) return length ? rleDecode(fromBase64(s.slice(1)), length) : null;
    return fromBase64(s); // older, uncompressed save
  } catch {
    return null;
  }
}

export function saveBytes(key, bytes) {
  try {
    const rle = rleEncode(bytes);
    const s = rle.length < bytes.length ? RLE_MARK + toBase64(rle) : toBase64(bytes);
    localStorage.setItem(PREFIX + key, s);
  } catch {
    /* ignore */
  }
}
