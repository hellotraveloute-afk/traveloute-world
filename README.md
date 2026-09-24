# Traveloute World

A game world built from the real map. Walk anywhere on Earth, clear the fog, and claim stars at real places.

This is **Phase 1** of the plan in [`docs/PLAN.md`](docs/PLAN.md): proving that a Three.js world generated automatically from real map data looks and feels like a game.

## What it does

- Builds a stylised low-poly 3D world **from real map data wherever you are**: terrain with real hills, land use, water, roads, railways, trees and buildings.
- Loads new map tiles as you move, so the world has no edge.
- **GPS mode:** your avatar follows your real location. **Explore mode:** tap the ground (or use WASD) to walk anywhere.
- Crystals appear on real places (viewpoints, waterfalls, temples, peaks, museums, attractions), hidden in the fog until you get close.
- Claim with star bursts, flying stars and a stamp; level up; scan for hidden places.
- Time of day follows your clock; tap the sun button to change it.
- Progress (stars, stamps, explored fog) is saved **in your browser only** for now.

## Put it online with GitHub Pages

You need a free GitHub account.

1. Go to [github.com/new](https://github.com/new) and create a repository, for example `traveloute-world`. Make it **Public** (GitHub Pages on the free plan needs a public repo).
2. On the new repository page, click **uploading an existing file**.
3. Drag in **everything inside this folder** (`index.html`, `css`, `js`, `docs`, `README.md`, `.nojekyll`), not the folder itself. `index.html` must be at the top level of the repository.
   - `.nojekyll` is a hidden file. If you can't see it on your computer, create it on GitHub later with **Add file → Create new file**, name it `.nojekyll`, and leave it empty.
4. Click **Commit changes**.
5. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, **Branch** to `main` and folder `/ (root)`, then **Save**.
6. Wait a minute or two, then refresh the Pages settings. Your link appears at the top, like `https://YOUR-NAME.github.io/traveloute-world/`.
7. Open the link on your phone. GPS needs the `https://` link, which GitHub Pages gives you automatically.

### Using git from the command line instead

```bash
cd traveloute-world
git init
git add .
git commit -m "Traveloute World phase 1"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/traveloute-world.git
git push -u origin main
```

Then do step 5 above.

### Handy links

- Jump straight to a place: `...github.io/traveloute-world/?place=ella` (also `ninearch`, `haputale`, `galle`, `kandy`, `sigiriya`, `colombo`, `mirissa`).
- Any coordinates: `?lat=6.8667&lon=81.0466`
- Force graphics quality: `?quality=low` (battery saver) or `?quality=high`. Combine with `&`, e.g. `?place=galle&quality=low`.

## Run it on your computer

The app uses JavaScript modules, so it must be served over HTTP (opening `index.html` directly won't work).

```bash
cd traveloute-world
python3 -m http.server 8080
```

Open <http://localhost:8080>. GPS mode only works on `https://` or `localhost`.

## Project layout

```
index.html        page, HUD markup, library import map
css/style.css     all styling
js/main.js        start screen, game loop, input, claiming, scanning
js/rules.js       THE RULES: how map data looks and plays (edit this to restyle the world)
js/tiles.js       downloads tiles and builds terrain, ground texture, trees, buildings, places
js/landmarks.js   crystals, discovery, labels
js/fog.js         fog of war (saved per tile) and the terrain shader tweaks
js/world.js       renderer, sky, lights, time of day, bloom
js/avatar.js      low-poly explorer avatars
js/geo.js         latitude/longitude ↔ tiles ↔ metres
js/config.js      technical settings, start presets, graphics quality
js/hud.js         toasts, rewards, stamp modal, sheets, sound
js/storage.js     saving progress in the browser
docs/PLAN.md      the master plan
```

## Changing how the world looks

Open `js/rules.js`. Every table there is a rule. For example:

- Make forests denser: raise `LANDCOVER.wood.trees` (0–255).
- Change road colours: edit `ROADS`.
- Make temples rarer or more valuable: edit `classifyPlace` or `RARITY`.
- Add a famous place as Legendary: add its name to `HERO_LANDMARKS`.

Commit the change and GitHub Pages updates the live link within a minute or two.

## Data sources and credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
- Vector tiles from [OpenFreeMap](https://openfreemap.org) (OpenMapTiles schema). Free and without an API key; for a production app, plan to self-host tiles or use a paid provider (see the plan, section 7.1).
- Elevation from [Terrain Tiles on AWS Open Data](https://registry.opendata.aws/terrain-tiles/).
- 3D: [three.js](https://threejs.org). Vector tile decoding: [@mapbox/vector-tile](https://github.com/mapbox/vector-tile-js) and [pbf](https://github.com/mapbox/pbf). Libraries load from the jsDelivr CDN.

## Known limits of this phase

- Progress is stored only in this browser; nothing talks to the Traveloute backend yet.
- No other players, gatherings or crews yet (phases 4–5).
- Famous landmarks use generic crystals; custom models come later.
- How rich an area looks depends on OpenStreetMap coverage there.
- Performance on budget phones is exactly what phase 2 will measure. If it's slow, try `?quality=low`.

## If something doesn't work

Open the browser console (on a computer: right-click → Inspect → Console) and look for red errors. Common causes:

- **Blank or "terrain only" world:** the map tile service didn't respond. Check your connection and reload.
- **GPS button does nothing:** the page must be opened over `https://` and location permission allowed.
- **Very slow:** add `?quality=low` to the link.
