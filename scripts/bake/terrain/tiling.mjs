// Geodetic TMS tiling math for quantized-mesh terrain (EPSG:4326 scheme: 2^(z+1) cols x 2^z rows,
// tile span 180/2^z deg, y counts from SOUTH). Twin of src/lib/geo/terrainTiles.ts — the runtime
// needs the same fully-inside/range arithmetic and plain `node` can't import TS, so the two copies
// are pinned by test/terrain-tiles.test.ts (parity over a coordinate grid). Change BOTH or the test fails.

/** Tile span in degrees at level z. */
export const tileSpanDeg = (z) => 180 / 2 ** z;

/** Tile x/y containing (lonDeg, latDeg) at level z. */
export function tileAt(lonDeg, latDeg, z) {
  const span = tileSpanDeg(z);
  return {
    x: Math.min(Math.floor((lonDeg + 180) / span), 2 ** (z + 1) - 1),
    y: Math.min(Math.floor((latDeg + 90) / span), 2 ** z - 1),
  };
}

/** [west, south, east, north] extent of tile (z, x, y) in degrees. */
export function tileBbox(z, x, y) {
  const span = tileSpanDeg(z);
  return [x * span - 180, y * span - 90, (x + 1) * span - 180, (y + 1) * span - 90];
}

/** Inclusive x/y range of tiles INTERSECTING bbox [w,s,e,n] at level z. */
export function tileRange(bbox, z) {
  const span = tileSpanDeg(z);
  const [w, s, e, n] = bbox;
  return {
    startX: Math.max(0, Math.floor((w + 180) / span)),
    endX: Math.min(2 ** (z + 1) - 1, Math.ceil((e + 180) / span) - 1),
    startY: Math.max(0, Math.floor((s + 90) / span)),
    endY: Math.min(2 ** z - 1, Math.ceil((n + 90) / span) - 1),
  };
}

/** Inclusive x/y range of tiles FULLY INSIDE bbox [w,s,e,n] at level z (empty → null). */
export function tileRangeInside(bbox, z) {
  const span = tileSpanDeg(z);
  const [w, s, e, n] = bbox;
  const startX = Math.ceil((w + 180) / span);
  const endX = Math.floor((e + 180) / span) - 1;
  const startY = Math.ceil((s + 90) / span);
  const endY = Math.floor((n + 90) / span) - 1;
  return startX > endX || startY > endY ? null : { startX, endX, startY, endY };
}

/** True when tile (z,x,y) lies fully inside bbox. */
export function tileInside(bbox, z, x, y) {
  const r = tileRangeInside(bbox, z);
  return !!r && x >= r.startX && x <= r.endX && y >= r.startY && y <= r.endY;
}

/** Serve-set rule twin of src/lib/geo/terrainTiles.ts patchServesTile — pinned by the parity test. */
export function patchServesTile(cfg, z, x, y) {
  const inR = (r) => !!r && x >= r.startX && x <= r.endX && y >= r.startY && y <= r.endY;
  if (z > cfg.maxDepth) return false;
  if (z > cfg.extentMaxDepth) return inR(tileRange(cfg.cityBbox, z));
  return inR(tileRangeInside(cfg.extentBbox, z));
}
