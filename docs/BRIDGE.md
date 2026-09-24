# App bridge (embed mode)

The Traveloute app shows this world inside a WebView and draws its own game HUD on top. Open the page with `?embed=1` to run in that mode:

- The start screen is skipped. The world waits for a `start` message.
- The web HUD (top bar, dock, context card, toasts, sheets, modal, hint, how-to-play card, loader) is hidden. The map attribution stays visible.
- The browser is never asked for location. Position comes from the app with `setPlayer`.
- The app owns stars, XP, stamps and claim rules. The world only shows things and reports what the player is near.

Code: [`js/bridge.js`](../js/bridge.js) (transport) and the `initEmbed()` section of [`js/main.js`](../js/main.js) (commands).

## Transport

- **World → app:** `window.TravelouteBridge.postMessage(JSON.stringify(msg))`. Outside the app, the message is only logged to the console.
- **App → world:** `window.traveloute.receive(msg)`. `msg` can be an object or a JSON string.

Every message is a JSON object with a `type`. Unknown types are ignored and logged. The protocol version is sent in `ready`. It is `1`.

The app must not send commands before `ready`. After a reload, the world starts from nothing, so the app must send `start` (and `setClaimed`, `setSound`) again after every `ready`.

## World → app

| type | payload | when |
|---|---|---|
| `ready` | `{ protocol: 1, version }` | Scripts loaded. Waiting for `start` |
| `worldReady` | `{ timeIndex }` | The tile under the player is built. `timeIndex` is the time of day picked from the local clock |
| `status` | `{ tilesReady, tilesTotal }` | Tile loading progress, only when it changes |
| `context` | `{ kind, place?, distanceM?, radiusM? }` | What the player is near: `claim`, `claimed`, `near` or `none`. Sent when the kind, the place or the distance (in 5 m steps) changes, at most every 250 ms |
| `discovered` | `{ place }` | A hidden place became visible |
| `placeTapped` | `{ place }` | The player tapped a crystal. Check `place.status`: a `mystery` place is still hidden |
| `scanResult` | `{ found, place?, distanceM?, direction?, bearing? }` | After `scan`. `found: false` with a `place` means nothing hidden is near but that open place is |
| `nearby` | `{ places: [Place + distanceM] }` | After `listNearby`, nearest first |
| `explored` | `{ percent }` | Share of the current tile uncovered, every 3 s when it changes |
| `fps` | `{ value, min, quality }` | Average frame rate over 5 s, and the worst 1 s inside it |
| `error` | `{ message, fatal? }` | Tile or script failures. `fatal: true` means the world cannot run (for example no WebGL) |

`Place`:

```json
{
  "id": "Nine Arch Bridge@6.8768,81.0608",
  "name": "Nine Arch Bridge",
  "kind": "attraction",
  "rarity": "Legendary",
  "stars": 84,
  "lat": 6.8768,
  "lon": 81.0608,
  "status": "open"
}
```

`status` is `mystery` (hidden in the fog), `open` or `claimed`. IDs are `name@lat,lon` with 4 decimals and are stable across sessions.

## App → world

| type | payload | purpose |
|---|---|---|
| `start` | `{ lat, lon, mode: "gps" \| "explore", quality?: "low" \| "high" }` | Build the world here. Ignored after the first time |
| `setPlayer` | `{ lat, lon, accuracyM }` | New GPS fix. Used in GPS mode. A fix sent before `start` finishes is kept and applied |
| `setMode` | `{ mode }` | `gps` or `explore` |
| `setTime` | `{ index }` or `{ preset: "Night" }` | Time of day: `Dawn`, `Day`, `Golden hour`, `Night` (index 0–3) |
| `scan` | `{}` | Scan pulse. Answered with `scanResult` |
| `claimResult` | `{ placeId, ok, stars }` | `ok: true` plays the claim effect and marks the crystal claimed. `ok: false` shows nothing |
| `setClaimed` | `{ ids: [...] }` | Places on cooldown. Replaces the previous list |
| `walkTo` | `{ placeId }` | Walk to a place. Switches to Explore mode |
| `faceNorth` | `{}` | Turn the camera to face north |
| `setSound` | `{ on }` | Mute or unmute world sound effects |
| `listNearby` | `{ limit? }` | Ask for the nearest places (default 40, max 100). Answered with `nearby` |

## Try it in a browser

Open `index.html?embed=1` from a local server and use the console:

```js
traveloute.receive({ type: 'start', lat: 6.8768, lon: 81.0608, mode: 'explore' });
traveloute.receive({ type: 'listNearby', limit: 5 });
```

Messages the world sends are logged with `[bridge] ->`.
