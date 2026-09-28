# Performance

The world has to hold the budgets in [PLAN.md §15](PLAN.md): 30 FPS on a budget Android phone, 60 FPS on a good one, inside a WebView. This page explains what the code does to get there, why, and how to measure it.

## How to measure

Measure on real phones, in the Traveloute app (the WebView is slower than Chrome).

1. Start with automatic quality steps **off**, so you see what the phone really does: `?adaptive=0` in a browser, or `adaptive: false` in the app's `start` message.
2. Walk for 2 minutes in a dense place (Kandy or Colombo) and in a forest (Ella). Read the `fps` bridge message: `value` is the 5 s average, `min` the worst second.
3. Then run again with steps on (the default) and note the `tier` the phone settles at. A budget phone that ends at tier 0–2 is fine. One that runs out of steps and still sits below 30 FPS is the case where PLAN.md says to consider Unity.

Chrome remote debugging (`chrome://inspect`) works with Android WebViews built in debug mode; the Performance panel shows whether a slow frame is JavaScript (tile building) or GPU.

`tools/test/run.sh` runs the tile pipeline in Node with stubbed three.js and network, to catch regressions without a phone.

## Where the time went, and what changed

### Drawing

**Trees were drawn even when out of sight.** Each tile had up to three `InstancedMesh` objects with frustum culling turned off, and up to 25 tiles stay loaded (`keepRadius: 2`). Every tree in 25 km² went through the vertex shader twice per frame (camera and shadow pass). Now each tile's trees are split into 4 × 4 chunks (`CONFIG.chunksPerTile`) with correct bounding spheres, so three.js skips chunks outside the view, and `tiles.cull()` hides chunks beyond the tree distance (900 m on low quality) and whole tiles that are fully inside the fog. The trunk is merged into the crown geometry, so one tree kind is one draw per chunk instead of two.

**Buildings were one mesh per tile.** A single building on screen meant the whole tile's buildings were drawn and cast shadows. They are now chunked the same way.

**Anti-aliasing was paid for twice.** With bloom on, the canvas MSAA was wasted because the scene is drawn into an off-screen target first. MSAA is now on the canvas only when there's no bloom, and on the render target (4 samples) when there is. Bloom runs at half resolution on phones.

**Shadows.** 1024² shadow map on phones (was 2048²), PCF instead of PCF-soft on phones, and the shadow camera snaps to whole texels so shadows don't shimmer while walking. Terrain normals are only computed when shadows are on.

**Sky and stars.** The sky dome is drawn last (so the depth test rejects every pixel already covered by ground, instead of shading the whole screen), and the star field is hidden when it's invisible in daytime.

**Crystals.** They shared nothing: two materials per crystal. Materials are now shared per look (a handful in total), and crystals beyond 900 m draw only their light beam.

**Low quality uses Lambert shading** instead of the physically based material, which is much cheaper per pixel on budget GPUs.

**High refresh screens.** A 120 Hz phone rendered 120 frames per second, draining battery for frames nobody asked for. Frames are now capped at 60 (or `maxFps`) with an even rhythm.

**HUD blur.** `backdrop-filter: blur()` over a moving WebGL canvas forces an extra blur pass per element every frame. On low quality the HUD uses solid glass instead. The Flutter app should avoid blur widgets over the WebView for the same reason.

### Building tiles (main thread)

**Height clean-up** created a sorted array for every one of 65 536 pixels. It now sorts 8 neighbours in place: 80 ms → 5.6 ms per tile on a desktop CPU (identical output, `tools/test/test_despike.mjs`). Expect roughly 5× those numbers on a budget phone.

**Buildings** went through `THREE.ExtrudeGeometry` (with hidden floor caps) and a merge. `js/extrude.js` writes walls and roof straight into typed arrays, with a fast path for convex footprints (most buildings) and the triangulator only for the rest.

**Downloading and building are separate.** Up to 6 tiles download at once while one tile builds, in small steps with a frame between them. Leaving an area cancels its downloads (`AbortController`).

**Canvas memory.** The ground texture is uploaded to the GPU as soon as it's painted, and the canvas is shrunk to 1 × 1, instead of keeping a 1024 × 1024 canvas (4 MB) per tile in memory.

**Tap to walk** raycast every terrain triangle. It now marches along the height grid.

### Per-frame JavaScript

No objects are created per frame in the camera, movement and label code. Crystal labels and the compass only touch the DOM when their value changes. The "what's nearby" check runs 10 times a second, not every frame. Culling runs 5 times a second.

### Network and storage

**Tiles are cached on the device** with the Cache API (`js/net.js`), as PLAN.md asked: revisiting an area needs no network. The cache keeps the newest 400 tiles.

**Fog of war** was saved as raw base64 (~22 KB per tile), which fills localStorage after about 200 tiles and then silently stops saving. It is now run-length encoded (typically under 1 KB); old saves still load.

**Page load.** The minified three.js build is used, fonts no longer block the first paint, and the engine and game modules are preloaded in parallel.

### Bug fixed along the way

If a tile was unloaded and loaded again while its first build was still running, the first build released the fog texture the second one was using, leaving a tile with a disposed texture. Fog textures are now reference-counted.

## Automatic quality steps

`js/perf.js` watches the frame rate in 2 s windows (ignoring windows while a tile is being built, or after the app was in the background). After two slow windows in a row it takes one step down, and never goes back up during a session:

1. bloom off
2. render resolution −0.25
3. shadows off
4. more resolution steps, down to 0.75 (low) or 1.0 (high)
5. trees drawn to 1000 m, then 650 m

The target is 88 % of 30 FPS on low quality or 60 FPS on high (capped by `maxFps`). The current step is reported as `tier` in the `fps` message.

## Budgets now

| | Low | High |
|---|---|---|
| Trees per tile | 1 200 | 3 500 |
| Buildings per tile | 1 500 | 4 000 |
| Ground texture | 512² | 1024² |
| Shading | Lambert | Standard (PBR) |
| Shadows / bloom | off / off | on / on (half-res bloom on phones) |
| Tree draw distance | 900 m | whole fog radius |
| Pixel ratio | ≤ 1.25 | ≤ 1.75 phone, ≤ 2 desktop |

## Not done yet (next candidates)

- **Build tiles in a Web Worker** with `OffscreenCanvas`. It would remove the remaining building hitch on budget phones. The pipeline is already split into download and build, so the build step is the part to move.
- **One instanced mesh for all crystals** (only matters in dense cities with 100+ crystals).
- **A `setQuality` bridge command**, so the app can lower quality when the phone gets hot or the battery is low.
- **Self-hosting three.js and the decoders** in the app bundle, so the first launch doesn't depend on jsDelivr.
