// ============================================================================
// THE RULES
// ----------------------------------------------------------------------------
// This file decides how real map data looks and plays in Traveloute.
// Nothing in the world is placed by hand: every tile is painted and populated
// from these tables. Change a rule here and the whole planet changes.
//
// Map data follows the OpenMapTiles schema (layers: landcover, landuse, park,
// water, waterway, transportation, building, poi, mountain_peak).
// ============================================================================

import { hashStr } from './util.js';

/* ---------- rarity ---------- */
export const RARITY = {
  Common: { color: '#6EC8FF', stars: 10 },
  Rare: { color: '#5CE1C6', stars: 25 },
  Epic: { color: '#FFC857', stars: 45 },
  Legendary: { color: '#FF7A59', stars: 80 },
};

/* ---------- ground ---------- */
// Used where the map has nothing: a meadow, so there are never empty holes.
export const GROUND = { base: '#8FD35B', speckleA: '#7FC64E', speckleB: '#A6E06E' };

// `trees` is tree density from 0 (none) to 255 (dense forest).
// `decor: 'town'` scatters grass tufts and flowers over the area (see DECOR).
export const LANDCOVER = {
  wood: { fill: '#3FA650', trees: 235 },
  grass: { fill: '#A8E06A', trees: 35 },
  farmland: { fill: '#9BD65A', stripe: '#6FB847', trees: 10, pattern: 'terrace' }, // tea estates and fields
  wetland: { fill: '#6FC39A', trees: 30 },
  sand: { fill: '#FFE3A1', trees: 3 },
  rock: { fill: '#B9B2A6', trees: 0 },
  ice: { fill: '#F2F8FB', trees: 0 },
};

export const LANDUSE = {
  residential: { fill: '#F2DDB0', trees: 45, decor: 'town' },
  suburb: { fill: '#F2DDB0', trees: 45, decor: 'town' },
  neighbourhood: { fill: '#F2DDB0', trees: 45, decor: 'town' },
  commercial: { fill: '#F7CFA0', trees: 10, decor: 'town' },
  retail: { fill: '#F7CFA0', trees: 10, decor: 'town' },
  industrial: { fill: '#D7D0C4', trees: 5 },
  garages: { fill: '#D7D0C4', trees: 0 },
  railway: { fill: '#D9CDB6', trees: 0 },
  cemetery: { fill: '#9ACB7C', trees: 60 },
  hospital: { fill: '#F4E1CF', trees: 15, decor: 'town' },
  school: { fill: '#F4E2BC', trees: 20, decor: 'town' },
  college: { fill: '#F4E2BC', trees: 20, decor: 'town' },
  university: { fill: '#F4E2BC', trees: 25, decor: 'town' },
  kindergarten: { fill: '#F4E2BC', trees: 15, decor: 'town' },
  stadium: { fill: '#7FD35A', trees: 0 },
  pitch: { fill: '#7FD35A', trees: 0 },
  playground: { fill: '#A8E06A', trees: 20 },
  track: { fill: '#EDA97A', trees: 0 },
  military: { fill: '#C6C4A6', trees: 20 },
  quarry: { fill: '#CFC5B3', trees: 0 },
  zoo: { fill: '#A8E06A', trees: 70 },
  theme_park: { fill: '#A8E06A', trees: 40 },
  dam: { fill: '#CFC8BA', trees: 0 },
};

export const PARK = { fill: '#7FD35A', trees: 110 };

// How painted areas are finished. Sizes are fractions of the ground texture size,
// so low and high quality textures look alike.
//   edge       soft darker band inside every land area, so areas read as shapes
//   edgeDarken how much darker than the fill the band is (0–1)
export const PAINT = { edge: 1 / 340, edgeDarken: 0.16 };

// Grass tufts and flower dots scattered over areas with `decor: 'town'`, so towns
// aren't flat cream. Counts are for a whole tile; sizes are radii in texels of a
// 1024 texture (about 2.4 m each).
export const DECOR = {
  town: {
    patches: { colors: ['#B9E68A', '#A6E06E'], count: 1800, size: [2.5, 6], alpha: 0.75 },
    tufts: { colors: ['#7FC64E', '#8FD35B'], count: 5000, size: [1, 2] },
    flowers: { colors: ['#FF8FB1', '#FFE066', '#FFFFFF', '#FFB36B'], count: 3500, size: [0.7, 1.1] },
  },
};

/* ---------- water ---------- */
export const WATER = { fill: '#35B6EC', shore: '#E9FBFF' };
// Width in metres by waterway class.
export const WATERWAY = { river: 14, canal: 10, stream: 4, drain: 2.5, ditch: 2 };

/* ---------- roads and railways ---------- */
// Width in metres. `dash` draws a dashed trail instead of a solid road.
// `centre` draws a faint dashed centre line in that colour.
export const ROADS = {
  motorway: { w: 18, fill: '#FFE89A', casing: '#E5A94A', centre: '#F2C66E' },
  trunk: { w: 16, fill: '#FFEFB0', casing: '#E5B05A', centre: '#F2C66E' },
  primary: { w: 13, fill: '#FFF7E0', casing: '#E5B96A', centre: '#F0CD8A' },
  secondary: { w: 11, fill: '#FFF7E0', casing: '#E5B96A', centre: '#F0CD8A' },
  tertiary: { w: 9, fill: '#FFFDF4', casing: '#E8D2A8' },
  minor: { w: 7, fill: '#FFFDF4', casing: '#E8D2A8' },
  service: { w: 5, fill: '#FFFDF4', casing: '#E8D2A8' },
  busway: { w: 9, fill: '#FFFDF4', casing: '#E8D2A8' },
  raceway: { w: 10, fill: '#F7D6AE', casing: '#D9A36A' },
  track: { w: 3.5, fill: '#EDD29C', dash: [6, 5] },
  path: { w: 2.2, fill: '#F6E3B4', dash: [3, 3] },
};
export const RAIL = { w: 4, fill: '#8B5E3C', tie: '#5B3A24', classes: ['rail', 'transit'] };

/* ---------- buildings ---------- */
export const BUILDING = {
  defaultHeight: 6,
  minHeight: 3.5,
  maxHeight: 90,
  minArea: 12, // square metres; smaller shapes are skipped
  footprint: '#B4A588',
  walls: ['#F4EEE2', '#EFE3CC', '#F7D9C4', '#DDEBE6', '#F1E6B8', '#E9E4F2'],
  roofs: ['#C2573A', '#A8452F', '#3F7F8C', '#6C8F4E', '#B5654A', '#8D5A9E'],
};

/* ---------- trees ---------- */
export const TREES = {
  colors: ['#2F7D46', '#3C9150', '#4FA35A', '#2A6B3F', '#5BAF5E', '#468F3F'],
  unmappedDensity: 30, // a few trees wherever the map has no data
  pineShare: 0.55,
};

/* ---------- places (crystals) ---------- */
// Famous places get Legendary rarity. Later these also get custom 3D models.
export const HERO_LANDMARKS = [
  /sigiriya/i,
  /nine arch/i,
  /temple of the (sacred )?tooth|sri dalada/i,
  /adam'?s peak|sri pada/i,
  /galle fort/i,
  /galle (fort )?lighthouse/i,
  /dambulla (cave|rock|royal)/i,
  /ruwanwelisaya/i,
  /jaya sri maha bodhi/i,
  /horton plains/i,
  /ravana falls/i,
];

const RARE_KINDS = new Set([
  'viewpoint', 'waterfall', 'castle', 'fort', 'ruins', 'monument', 'archaeological_site',
  'museum', 'memorial', 'cave_entrance', 'peak', 'volcano', 'battlefield', 'city_gate', 'tomb',
]);
const COMMON_KINDS = new Set([
  'place_of_worship', 'attraction', 'zoo', 'aquarium', 'theme_park', 'gallery', 'artwork',
  'temple', 'shrine', 'church', 'mosque', 'buddhist', 'hindu', 'christian', 'muslim', 'wayside_shrine',
]);

export const PLACE_MERGE_DISTANCE = 40; // metres; closer duplicates are merged

export function placeName(p) {
  return p['name:en'] || p.name_en || p['name:latin'] || p.name || '';
}

// Decides whether a map feature becomes a crystal, and how rare it is.
export function classifyPlace(layer, p) {
  const name = placeName(p);
  if (!name) return null;
  const vary = hashStr(name) % 6; // small stable variation so places differ
  const make = (rarity) => ({ rarity, stars: RARITY[rarity].stars + vary });

  if (HERO_LANDMARKS.some((r) => r.test(name) || (p.name && r.test(p.name)))) return make('Legendary');
  if (layer === 'mountain_peak') return make('Rare');
  if (layer !== 'poi') return null;

  const c = p.class;
  const s = p.subclass;
  if (RARE_KINDS.has(s) || RARE_KINDS.has(c)) return make('Rare');
  if ((c === 'attraction' || s === 'attraction') && (p.rank ?? 99) <= 4) return make('Epic');
  if (COMMON_KINDS.has(s) || COMMON_KINDS.has(c)) return make('Common');
  return null;
}

/* ---------- fog of war ---------- */
// Unexplored land is covered by a drifting cloud veil. The veil is see-through
// on purpose: the player should still make out hills, rivers and towns ahead.
//   cloud / shadow  colours of the veil in daylight (other times: TIMES[].fow)
//   veil            how much the cloud covers unexplored land (0 clear – 1 solid)
//   edge            glow where fog is being cleared
//   sparkle         burst colour when you clear fog
//   billboards      soft cloud puffs floating over unexplored land (high quality)
export const FOG = {
  cloud: '#E9E6FF',
  shadow: '#B9B2E8',
  veil: 0.62,
  edge: '#8FF0DC',
  sparkle: '#C9B8FF',
  billboards: { max: 20, size: [70, 130], height: [45, 80], spawnRadius: [170, 520] },
};

/* ---------- gameplay ---------- */
export const GAMEPLAY = {
  claimRadius: { gps: 40, explore: 35 }, // metres
  cooldownMs: 2 * 24 * 60 * 60 * 1000, // 2 days per place
  revealRadius: 75, // fog cleared around you, metres
  revealOnClaim: 140,
  xpPerClaim: 120,
  xpForLevel: (level) => 1000 + level * 250,
  scanRange: 1500,
  scanCooldownMs: 2500,
  titles: [
    [1, 'Newcomer'], [3, 'Wanderer'], [6, 'Trail Seeker'], [10, 'Hill Country Wanderer'],
    [15, 'Trailblazer'], [20, 'Pathfinder'], [30, 'Legend of Lanka'],
  ],
};
export function titleFor(level) {
  let t = GAMEPLAY.titles[0][1];
  for (const [lv, name] of GAMEPLAY.titles) if (level >= lv) t = name;
  return t;
}

/* ---------- time of day ---------- */
export const TIMES = [
  { name: 'Dawn', top: '#34508E', hor: '#F7C49A', sunC: '#FFC89A', sunI: 1.5, dir: [0.9, 0.32, -0.2], hemiS: '#FFE0C8', hemiG: '#40583E', hemiI: 0.85, fow: '#F3DCEB', exp: 1.0, stars: 0, bloom: 0.5 },
  { name: 'Day', top: '#3C8EE6', hor: '#C6E9F7', sunC: '#FFF4E0', sunI: 2.4, dir: [0.35, 1, 0.3], hemiS: '#DDF0FF', hemiG: '#5C7A48', hemiI: 1.05, fow: '#E9E6FF', exp: 1.0, stars: 0, bloom: 0.32 },
  { name: 'Golden hour', top: '#3A3F82', hor: '#F59F6E', sunC: '#FFB27A', sunI: 2.0, dir: [-0.85, 0.38, 0.25], hemiS: '#FFD9C0', hemiG: '#3A553A', hemiI: 0.9, fow: '#F4D6E2', exp: 1.05, stars: 0.15, bloom: 0.55 },
  { name: 'Night', top: '#050A1C', hor: '#1B2B4E', sunC: '#9DB4FF', sunI: 0.55, dir: [0.3, 0.8, -0.4], hemiS: '#6F86C8', hemiG: '#10182A', hemiI: 0.5, fow: '#4B4E8C', exp: 0.95, stars: 1, bloom: 0.9 },
];
// Follows the real local clock by default.
export function timeIndexForHour(h) {
  if (h >= 5 && h < 7) return 0;
  if (h >= 7 && h < 16) return 1;
  if (h >= 16 && h < 18.5) return 2;
  return 3;
}
