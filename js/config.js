// Technical settings. Game look and gameplay rules live in rules.js.

export const CONFIG = {
  zoom: 14, // map tile zoom level (~2.4 km per tile near Sri Lanka)
  tileJsonUrl: 'https://tiles.openfreemap.org/planet', // OpenStreetMap vector tiles, free, no key
  terrainUrl: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', // AWS Terrain Tiles
  loadRadius: 1, // tiles loaded around the player (1 = 3 x 3)
  keepRadius: 2, // tiles further than this are unloaded
  maxParallelLoads: 2,
  heightScale: 1.3, // exaggerate hills a little for drama
  minHeight: -3, // clamp ocean depth so coasts stay flat
  avatarScale: 3.2,
  exploreSpeed: 32, // metres per second when tapping to walk
  gpsMaxSpeed: 30, // how fast the avatar catches up with your real position
  gpsTeleport: 800, // jump instead of walking if GPS moves further than this
  labelDistance: 950,
  maxLabels: 26,
  fogSaveIntervalMs: 5000,
};

// Places you can jump to from the start screen.
export const PRESETS = [
  { key: 'ella', name: 'Ella', sub: 'Hill country town', lat: 6.8667, lon: 81.0466 },
  { key: 'ninearch', name: 'Nine Arch Bridge', sub: 'Ella', lat: 6.8768, lon: 81.0608 },
  { key: 'haputale', name: 'Haputale', sub: 'Tea country ridge', lat: 6.7684, lon: 80.9589 },
  { key: 'galle', name: 'Galle Fort', sub: 'South coast', lat: 6.0269, lon: 80.2170 },
  { key: 'kandy', name: 'Kandy', sub: 'Temple of the Tooth', lat: 7.2936, lon: 80.6413 },
  { key: 'sigiriya', name: 'Sigiriya', sub: 'Lion Rock', lat: 7.9570, lon: 80.7603 },
  { key: 'colombo', name: 'Colombo', sub: 'Galle Face', lat: 6.9271, lon: 79.8450 },
  { key: 'mirissa', name: 'Mirissa', sub: 'Beach town', lat: 5.9483, lon: 80.4716 },
];

// Picks graphics settings for the device. Override with ?quality=low or ?quality=high,
// or (in the app) with the `quality` field of the `start` message.
export function detectQuality(override) {
  const param = override || new URLSearchParams(location.search).get('quality');
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const memory = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const weak = mobile && (memory <= 4 || cores <= 4);
  const level = param === 'low' || param === 'high' ? param : weak ? 'low' : 'high';
  if (level === 'low') {
    return { level, texSize: 512, seg: 96, trees: 1200, buildings: 1500, shadows: false, bloom: false, pixelRatio: Math.min(devicePixelRatio, 1.25) };
  }
  return { level, texSize: 1024, seg: 128, trees: 3500, buildings: 4000, shadows: true, bloom: true, pixelRatio: Math.min(devicePixelRatio, mobile ? 1.75 : 2) };
}
