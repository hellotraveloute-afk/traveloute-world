export function despikeOld(h) {
  const out = new Float32Array(h);
  const nb = new Float32Array(8);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx > 255 || yy > 255) continue;
          nb[n++] = h[yy * 256 + xx];
        }
      }
      const arr = Array.from(nb.subarray(0, n)).sort((a, b) => a - b);
      const med = arr[n >> 1];
      if (Math.abs(h[y * 256 + x] - med) > 40) out[y * 256 + x] = med;
    }
  }
  return out;
}
