// Downloads with an on-device cache, so revisiting an area costs no data and
// works offline. Uses the Cache API (needs https or localhost); if it isn't
// available, everything falls back to plain fetch.

import { CONFIG } from './config.js';

const CACHE_NAME = 'tw-tiles-v1';
let cachePromise = null;
let putsSinceTrim = 0;

function openCache() {
  if (!cachePromise) {
    cachePromise = typeof caches !== 'undefined' && window.isSecureContext
      ? caches.open(CACHE_NAME).catch(() => null)
      : Promise.resolve(null);
  }
  return cachePromise;
}

// Keeps the cache to CONFIG.tileCacheEntries, dropping the oldest entries first.
async function trim(cache) {
  try {
    const keys = await cache.keys(); // insertion order, oldest first
    const extra = keys.length - CONFIG.tileCacheEntries;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  } catch {
    /* ignore */
  }
}

function remember(cache, url, res) {
  if (!cache || !res.ok) return;
  cache.put(url, res.clone()).catch(() => {});
  if (++putsSinceTrim >= 40) {
    putsSinceTrim = 0;
    trim(cache);
  }
}

// Cache first: map tiles at a given URL never change.
export async function cachedFetch(url, { signal } = {}) {
  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return hit;
    } catch {
      /* ignore */
    }
  }
  const res = await fetch(url, { signal, mode: 'cors' });
  remember(cache, url, res);
  return res;
}

// Network first, cache as a fallback: for the TileJSON, which can change.
export async function freshFetch(url) {
  const cache = await openCache();
  try {
    const res = await fetch(url, { mode: 'cors' });
    remember(cache, url, res);
    return res;
  } catch (e) {
    const hit = cache && (await cache.match(url).catch(() => null));
    if (hit) return hit;
    throw e;
  }
}
