// Technical settings. Game look and gameplay rules live in rules.js.

export const CONFIG = {
  zoom: 14, // map tile zoom level (~2.4 km per tile near Sri Lanka)
  tileJsonUrl: "https://tiles.openfreemap.org/planet", // OpenStreetMap vector tiles, free, no key
  terrainUrl:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", // AWS Terrain Tiles
  loadRadius: 1, // tiles loaded around the player (1 = 3 x 3)
  keepRadius: 2, // tiles further than this are unloaded
  maxParallelDownloads: 6, // tiles downloading at once (network is the slow part)
  maxParallelBuilds: 1, // tiles being built at once (building runs on the main thread)
  chunksPerTile: 4, // trees and buildings are split 4 x 4 per tile so off-screen parts are skipped
  // downloaded tiles kept on the device (Cache API) for revisits and offline use; fewer on phones to save storage
  tileCacheEntries:
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")
      ? 200
      : 400,
  heightScale: 1.3, // exaggerate hills a little for drama
  minHeight: -3, // clamp ocean depth so coasts stay flat
  avatarScale: 3.2,
  exploreSpeed: 32, // metres per second when tapping to walk
  gpsMaxSpeed: 30, // how fast the avatar catches up with your real position
  gpsTeleport: 800, // jump instead of walking if GPS moves further than this
  labelDistance: 950,
  maxLabels: 26,
  crystalDrawDistance: 900, // crystal bodies further than this are hidden (their light beams stay)
  fogSaveIntervalMs: 5000,
};

// Places you can jump to from the start screen.
export const PRESETS = [
  {
    key: "ella",
    name: "Ella",
    sub: "Hill country town",
    lat: 6.8667,
    lon: 81.0466,
  },
  {
    key: "ninearch",
    name: "Nine Arch Bridge",
    sub: "Ella",
    lat: 6.8768,
    lon: 81.0608,
  },
  {
    key: "haputale",
    name: "Haputale",
    sub: "Tea country ridge",
    lat: 6.7684,
    lon: 80.9589,
  },
  {
    key: "galle",
    name: "Galle Fort",
    sub: "South coast",
    lat: 6.0269,
    lon: 80.217,
  },
  {
    key: "kandy",
    name: "Kandy",
    sub: "Temple of the Tooth",
    lat: 7.2936,
    lon: 80.6413,
  },
  {
    key: "sigiriya",
    name: "Sigiriya",
    sub: "Lion Rock",
    lat: 7.957,
    lon: 80.7603,
  },
  {
    key: "colombo",
    name: "Colombo",
    sub: "Galle Face",
    lat: 6.9271,
    lon: 79.845,
  },
  {
    key: "mirissa",
    name: "Mirissa",
    sub: "Beach town",
    lat: 5.9483,
    lon: 80.4716,
  },
];

// Picks graphics settings for the device.
//   ?quality=low | high   force a preset (in the app: `quality` in the `start` message)
//   ?fps=30               cap the frame rate (in the app: `maxFps`)
//   ?adaptive=0           turn off automatic quality steps, for benchmarking (in the app: `adaptive: false`)
//
// Fields:
//   texSize        ground texture per tile (px)
//   seg            terrain grid per tile
//   trees          max trees per tile
//   buildings      max buildings per tile
//   treeDistance   trees further than this (metres) are hidden; Infinity = only where the fog hides them anyway
//   lambert        cheaper lighting for tiles (no specular); used on weak phones
//   shadows        sun shadows; shadowMapSize is the shadow texture size
//   bloom          glow post-processing; bloomScale shrinks its buffers (0.5 = quarter the pixels)
//   fogClouds      soft cloud puffs floating over unexplored land
//   pixelRatio     starting render resolution; minPixelRatio is the floor for automatic steps
//   maxFps         frame-rate cap, so 90/120 Hz screens don't render frames nobody needs
//   adaptive       step quality down automatically if the frame rate stays low
export function detectQuality(override, extra = {}) {
  const params = new URLSearchParams(location.search);
  const param = override || params.get("quality");
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const memory = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const weak = mobile && (memory <= 4 || cores <= 4);
  const level =
    param === "low" || param === "high" ? param : weak ? "low" : "high";
  const dpr = window.devicePixelRatio || 1;

  const fpsParam = Number(extra.maxFps ?? params.get("fps"));
  const maxFps =
    Number.isFinite(fpsParam) && fpsParam >= 15 && fpsParam <= 240
      ? fpsParam
      : 60;
  const adaptive =
    extra.adaptive !== undefined
      ? extra.adaptive !== false
      : params.get("adaptive") !== "0";

  if (level === "low") {
    return {
      level,
      mobile,
      texSize: 512,
      seg: 96,
      trees: 1200,
      buildings: 1500,
      treeDistance: 900,
      lambert: true,
      anisotropy: 2,
      shadows: false,
      shadowMapSize: 1024,
      bloom: false,
      bloomScale: 0.5,
      fogClouds: false,
      pixelRatio: Math.min(dpr, 1.25),
      minPixelRatio: Math.min(dpr, 0.75),
      maxFps,
      adaptive,
    };
  }
  return {
    level,
    mobile,
    texSize: 1024,
    seg: 128,
    trees: 3500,
    buildings: 4000,
    treeDistance: Infinity,
    lambert: false,
    anisotropy: 4,
    shadows: true,
    shadowMapSize: mobile ? 1024 : 2048,
    bloom: true,
    bloomScale: mobile ? 0.5 : 1,
    fogClouds: true,
    pixelRatio: Math.min(dpr, mobile ? 1.75 : 2),
    minPixelRatio: Math.min(dpr, 1),
    maxFps,
    adaptive,
  };
}
