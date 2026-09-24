// Map maths: latitude/longitude <-> map tiles <-> world metres.
//
// World units are metres. The world origin (0, 0, 0) is where the session starts.
// +x points east, +z points south (so north is -z), +y is up.

const EARTH_CIRCUMFERENCE = 40075016.686;

export function lonLatToTileXY(lon, lat, z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

export function tileXYToLonLat(x, y, z) {
  const n = 2 ** z;
  return {
    lon: (x / n) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
  };
}

export class Projection {
  constructor(lat, lon, zoom) {
    this.z = zoom;
    this.lat0 = lat;
    this.lon0 = lon;
    const t = lonLatToTileXY(lon, lat, zoom);
    this.X0 = t.x;
    this.Y0 = t.y;
    this.tileMeters = (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  }
  toWorld(lat, lon) {
    const t = lonLatToTileXY(lon, lat, this.z);
    return { x: (t.x - this.X0) * this.tileMeters, z: (t.y - this.Y0) * this.tileMeters };
  }
  toLatLon(x, z) {
    return tileXYToLonLat(this.X0 + x / this.tileMeters, this.Y0 + z / this.tileMeters, this.z);
  }
  tileAt(x, z) {
    return { tx: Math.floor(this.X0 + x / this.tileMeters), ty: Math.floor(this.Y0 + z / this.tileMeters) };
  }
  // World position of a tile's north-west corner.
  tileOrigin(tx, ty) {
    return { x: (tx - this.X0) * this.tileMeters, z: (ty - this.Y0) * this.tileMeters };
  }
}

export const tileKey = (z, x, y) => `${z}/${x}/${y}`;
