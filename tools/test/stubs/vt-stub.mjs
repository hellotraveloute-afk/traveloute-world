// Fake vector tile with the layers tiles.js reads. Geometry in tile units (extent 4096).
const R = (x, y, w, h) => [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]];
function layer(features) { return { length: features.length, extent: 4096, feature: (i) => ({ ...features[i], loadGeometry: () => features[i].geom.map((r) => r.map((p) => ({ ...p }))) }) }; }
export class VectorTile {
  constructor() {
    const b = [];
    // a grid of 30 x 30 small buildings spread across the tile, plus an L-shape and a courtyard
    for (let j = 0; j < 30; j++) for (let i = 0; i < 30; i++) b.push({ type: 3, properties: { render_height: 5 + ((i * j) % 20) }, geom: R(40 + i * 134, 40 + j * 134, 40, 30) });
    b.push({ type: 3, properties: {}, geom: [[{ x: 2000, y: 2000 }, { x: 2100, y: 2000 }, { x: 2100, y: 2040 }, { x: 2040, y: 2040 }, { x: 2040, y: 2100 }, { x: 2000, y: 2100 }, { x: 2000, y: 2000 }]] });
    b.push({ type: 3, properties: {}, geom: [R(3000, 3000, 200, 200)[0], [{ x: 3050, y: 3050 }, { x: 3050, y: 3150 }, { x: 3150, y: 3150 }, { x: 3150, y: 3050 }, { x: 3050, y: 3050 }]] });
    b.push({ type: 3, properties: {}, geom: R(4090, 100, 40, 40) }); // centre in the next tile: skipped
    this.layers = {
      building: layer(b),
      landcover: layer([{ type: 3, properties: { class: 'wood' }, geom: R(0, 0, 2048, 4096) }, { type: 3, properties: { class: 'farmland' }, geom: R(2048, 3200, 900, 800) }]),
      landuse: layer([{ type: 3, properties: { class: 'residential' }, geom: R(2048, 1200, 1500, 1800) }]),
      park: layer([{ type: 3, properties: {}, geom: R(3600, 3600, 400, 400) }]),
      water: layer([{ type: 3, properties: {}, geom: R(3000, 100, 500, 500) }]),
      transportation: layer([{ type: 2, properties: { class: 'primary' }, geom: [[{ x: 0, y: 2048 }, { x: 4096, y: 2048 }]] }, { type: 2, properties: { class: 'rail' }, geom: [[{ x: 100, y: 0 }, { x: 100, y: 4096 }]] }]),
      poi: layer([
        { type: 1, properties: { name: 'Test Viewpoint', class: 'viewpoint' }, geom: [[{ x: 1000, y: 1000 }]] },
        { type: 1, properties: { name: 'Nine Arch Bridge', class: 'attraction' }, geom: [[{ x: 1010, y: 1010 }]] },
      ]),
    };
  }
}
