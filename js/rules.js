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
export const GROUND = { base: '#93CF66', speckleA: '#86C45C', speckleB: '#A2D873' };

// `trees` is tree density from 0 (none) to 255 (dense forest).
export const LANDCOVER = {
  wood: { fill: '#3F8C4B', trees: 235 },
  grass: { fill: '#A3D86C', trees: 35 },
  farmland: { fill: '#B5D26A', trees: 10, pattern: 'terrace' }, // tea estates and fields
  wetland: { fill: '#6FB08E', trees: 30 },
  sand: { fill: '#EBD6A0', trees: 3 },
  rock: { fill: '#A9A293', trees: 0 },
  ice: { fill: '#EEF5F8', trees: 0 },
};

export const LANDUSE = {
  residential: { fill: '#D9CFA7', trees: 45 },
  suburb: { fill: '#D9CFA7', trees: 45 },
  neighbourhood: { fill: '#D9CFA7', trees: 45 },
  commercial: { fill: '#E3CAA5', trees: 10 },
  retail: { fill: '#E3CAA5', trees: 10 },
  industrial: { fill: '#C9C0B0', trees: 5 },
  garages: { fill: '#C9C0B0', trees: 0 },
  railway: { fill: '#C4B8A2', trees: 0 },
  cemetery: { fill: '#95B97A', trees: 60 },
  hospital: { fill: '#E7D7C5', trees: 15 },
  school: { fill: '#E7D7B3', trees: 20 },
  college: { fill: '#E7D7B3', trees: 20 },
  university: { fill: '#E7D7B3', trees: 25 },
  kindergarten: { fill: '#E7D7B3', trees: 15 },
  stadium: { fill: '#7CC46A', trees: 0 },
  pitch: { fill: '#7CC46A', trees: 0 },
  playground: { fill: '#A8D878', trees: 20 },
  track: { fill: '#D7A77A', trees: 0 },
  military: { fill: '#B9B8A0', trees: 20 },
  quarry: { fill: '#BDB3A1', trees: 0 },
  zoo: { fill: '#B6DA7C', trees: 70 },
  theme_park: { fill: '#B6DA7C', trees: 40 },
  dam: { fill: '#BDB6A8', trees: 0 },
};

export const PARK = { fill: '#8ED063', stroke: '#6FB54E', trees: 110 };

/* ---------- water ---------- */
export const WATER = { fill: '#3AA9D8', shore: '#9ED9EE' };
// Width in metres by waterway class.
export const WATERWAY = { river: 14, canal: 10, stream: 4, drain: 2.5, ditch: 2 };

/* ---------- roads and railways ---------- */
// Width in metres. `dash` draws a dashed trail instead of a solid road.
export const ROADS = {
  motorway: { w: 18, fill: '#FFD978', casing: '#C8962E' },
  trunk: { w: 16, fill: '#FFDF8C', casing: '#C8962E' },
  primary: { w: 13, fill: '#FFF0C4', casing: '#C7A870' },
  secondary: { w: 11, fill: '#FFF4D6', casing: '#C7AE80' },
  tertiary: { w: 9, fill: '#FBF3DE', casing: '#C9B48C' },
  minor: { w: 7, fill: '#F6EEDA', casing: '#C9BA96' },
  service: { w: 5, fill: '#F2EAD6', casing: '#C9BA96' },
  busway: { w: 9, fill: '#FBF3DE', casing: '#C9B48C' },
  raceway: { w: 10, fill: '#E7C9A2', casing: '#B28F63' },
  track: { w: 3.5, fill: '#D6BE8E', dash: [6, 5] },
  path: { w: 2.2, fill: '#EFE1B6', dash: [3, 3] },
};
export const RAIL = { w: 4, fill: '#7A5E44', tie: '#4F3B2A', classes: ['rail', 'transit'] };

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
  { name: 'Dawn', top: '#34508E', hor: '#F7C49A', sunC: '#FFC89A', sunI: 1.5, dir: [0.9, 0.32, -0.2], hemiS: '#FFE0C8', hemiG: '#40583E', hemiI: 0.85, fow: '#1B2240', exp: 1.0, stars: 0, bloom: 0.5 },
  { name: 'Day', top: '#3C8EE6', hor: '#C6E9F7', sunC: '#FFF4E0', sunI: 2.4, dir: [0.35, 1, 0.3], hemiS: '#DDF0FF', hemiG: '#5C7A48', hemiI: 1.05, fow: '#1D2A44', exp: 1.0, stars: 0, bloom: 0.32 },
  { name: 'Golden hour', top: '#3A3F82', hor: '#F59F6E', sunC: '#FFB27A', sunI: 2.0, dir: [-0.85, 0.38, 0.25], hemiS: '#FFD9C0', hemiG: '#3A553A', hemiI: 0.9, fow: '#171C38', exp: 1.05, stars: 0.15, bloom: 0.55 },
  { name: 'Night', top: '#050A1C', hor: '#1B2B4E', sunC: '#9DB4FF', sunI: 0.55, dir: [0.3, 0.8, -0.4], hemiS: '#6F86C8', hemiG: '#10182A', hemiI: 0.5, fow: '#060B16', exp: 0.95, stars: 1, bloom: 0.9 },
];
// Follows the real local clock by default.
export function timeIndexForHour(h) {
  if (h >= 5 && h < 7) return 0;
  if (h >= 7 && h < 16) return 1;
  if (h >= 16 && h < 18.5) return 2;
  return 3;
}
