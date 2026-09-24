// Bridge between the world and the Traveloute app (Flutter WebView).
//
// Open the page with ?embed=1 to run inside the app: the web HUD is hidden,
// the start screen is skipped and the world waits for a `start` message.
//
//   World -> app:  window.TravelouteBridge.postMessage(JSON.stringify(msg))
//   App -> world:  window.traveloute.receive(msg)
//
// Every message is a JSON object with a `type` field. See docs/BRIDGE.md.

export const PROTOCOL = 1;
export const VERSION = '1.1';
export const EMBED = new URLSearchParams(location.search).get('embed') === '1';

const handlers = new Map();

// Sends a message to the app. Outside the app it is only logged, so the page
// still works in a normal browser for testing.
export function send(msg) {
  const channel = window.TravelouteBridge;
  if (channel && typeof channel.postMessage === 'function') {
    try {
      channel.postMessage(JSON.stringify(msg));
    } catch (e) {
      console.warn('Bridge send failed', e);
    }
  } else if (EMBED) {
    console.debug('[bridge] ->', msg);
  }
}

// Registers the handler for one command type from the app.
export function on(type, fn) {
  handlers.set(type, fn);
}

function receive(msg) {
  let m = msg;
  if (typeof m === 'string') {
    try {
      m = JSON.parse(m);
    } catch {
      console.warn('[bridge] malformed message', msg);
      return false;
    }
  }
  if (!m || typeof m.type !== 'string') {
    console.warn('[bridge] message without a type', msg);
    return false;
  }
  const fn = handlers.get(m.type);
  if (!fn) {
    console.debug('[bridge] unknown command ignored:', m.type);
    return false;
  }
  try {
    fn(m);
  } catch (e) {
    console.error('[bridge] command failed', m.type, e);
    send({ type: 'error', message: `Command ${m.type} failed: ${e && e.message ? e.message : e}` });
  }
  return true;
}

window.traveloute = { receive, protocol: PROTOCOL, version: VERSION };

// Plain summary of a place for the app. Positions in the world stay private.
export function placeJson(item) {
  const p = item.p;
  return { id: p.id, name: p.name, kind: p.kind, rarity: p.rarity, stars: p.stars, lat: p.lat, lon: p.lon, status: item.status || undefined };
}
