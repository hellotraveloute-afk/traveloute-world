// Just enough browser for the tile pipeline.
class Ctx2D {
  constructor(c) { this.c = c; this.ops = 0; }
  getImageData(x, y, w, h) { const d = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = (j * w + i) * 4; d[k] = 128; d[k + 1] = (i + j) % 256; d[k + 2] = 0; d[k + 3] = 255; } return { data: d }; }
  createPattern() { return {}; }
}
for (const m of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillRect', 'setLineDash', 'drawImage']) Ctx2D.prototype[m] = function () { this.ops++; };
globalThis.Path2D = class { rect() {} };
globalThis.document = { createElement: (tag) => { const c = { tag, width: 0, height: 0, style: {}, className: '', innerHTML: '', children: [], appendChild(e) { this.children.push(e); e.parent = this; }, remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }, classList: { toggle() {}, add() {}, remove() {} } }; c.getContext = () => new Ctx2D(c); return c; }, body: { classList: { toggle() {} } } };
globalThis.window = globalThis;
globalThis.location = { search: '' };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', deviceMemory: 8, hardwareConcurrency: 8 }, configurable: true });
globalThis.devicePixelRatio = 2;
globalThis.innerWidth = 400; globalThis.innerHeight = 800;
globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0);
globalThis.createImageBitmap = async () => ({ close() {} });
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), _mem: mem };
export const net = { requests: 0, aborted: 0, delay: 5 };
globalThis.fetch = (url, opts = {}) => new Promise((res, rej) => {
  net.requests++;
  const t = setTimeout(() => res({ ok: true, status: 200, url, json: async () => ({ tiles: ['https://t/{z}/{x}/{y}.pbf'] }), blob: async () => ({}), arrayBuffer: async () => new ArrayBuffer(8), clone() { return this; } }), net.delay);
  if (opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); net.aborted++; const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
});
