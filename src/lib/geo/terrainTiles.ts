/**
 * Geodetic TMS tiling math for the quantized-mesh terrain-patch composite (design ruling
 * 2026-08-18, GLO-30 bake slice). EPSG:4326 scheme: 2^(z+1) cols x 2^z rows, tile span
 * 180/2^z deg, y counts from SOUTH. TWIN of scripts/bake/terrain/tiling.mjs (plain `node`
 * can't import TS) — test/terrain-tiles.test.ts pins the two copies over a coordinate grid.
 *
 * The serve-set rule (which tiles the runtime FORCES onto the patch CDN instead of CWT):
 *   z <= extentMaxDepth → the tile must lie FULLY INSIDE the bake's extentBbox (straddlers keep
 *                   CWT; the bake rim-blends patch heights into CWT toward the extent edge, so
 *                   the spatial seam between a served tile and its CWT neighbour is height-continuous)
 *   extentMaxDepth < z <= maxDepth → the tile must INTERSECT cityBbox (deep detail is baked/kept
 *                   only over the city rectangle; equal depths ⇒ this clause is dormant)
 *   z > maxDepth → never (virtual upsampling continues from patch parents automatically)
 */

export type LonLatBbox = [west: number, south: number, east: number, north: number];

/** One baked terrain patch — the runtime registry entry (src/lib/globe/regions.ts). */
export interface TerrainPatchCfg {
  /** Path segment under the terrain CDN base (…/terrain/<path>/{z}/{x}/{y}.terrain). */
  path: string;
  /** Bake raster domain — the serve area up to extentMaxDepth (whole GLO-30 input tiles). */
  extentBbox: LonLatBbox;
  /** Deepest level served across the whole extent. */
  extentMaxDepth: number;
  /** Deep-detail rectangle — the only area with tiles above extentMaxDepth (pruned elsewhere). */
  cityBbox: LonLatBbox;
  maxDepth: number;
}

export const tileSpanDeg = (z: number): number => 180 / 2 ** z;

/** Inclusive x/y range of tiles INTERSECTING bbox at level z. */
export function tileRange(bbox: LonLatBbox, z: number) {
  const span = tileSpanDeg(z);
  const [w, s, e, n] = bbox;
  return {
    startX: Math.max(0, Math.floor((w + 180) / span)),
    endX: Math.min(2 ** (z + 1) - 1, Math.ceil((e + 180) / span) - 1),
    startY: Math.max(0, Math.floor((s + 90) / span)),
    endY: Math.min(2 ** z - 1, Math.ceil((n + 90) / span) - 1),
  };
}

/** Inclusive x/y range of tiles FULLY INSIDE bbox at level z (null when none fits). */
export function tileRangeInside(bbox: LonLatBbox, z: number) {
  const span = tileSpanDeg(z);
  const [w, s, e, n] = bbox;
  const startX = Math.ceil((w + 180) / span);
  const endX = Math.floor((e + 180) / span) - 1;
  const startY = Math.ceil((s + 90) / span);
  const endY = Math.floor((n + 90) / span) - 1;
  return startX > endX || startY > endY ? null : { startX, endX, startY, endY };
}

const inRange = (r: { startX: number; endX: number; startY: number; endY: number } | null, x: number, y: number) =>
  !!r && x >= r.startX && x <= r.endX && y >= r.startY && y <= r.endY;

/** Does the serve-set rule claim tile (z,x,y) for the patch? Pure; O(1). */
export function patchServesTile(cfg: TerrainPatchCfg, z: number, x: number, y: number): boolean {
  if (z > cfg.maxDepth) return false;
  if (z > cfg.extentMaxDepth) return inRange(tileRange(cfg.cityBbox, z), x, y);
  return inRange(tileRangeInside(cfg.extentBbox, z), x, y);
}

/** Patch tile URI for (z,x,y) under `base` (no trailing slash), or null when CWT keeps the tile. */
export function patchTileUri(cfg: TerrainPatchCfg, base: string, z: number, x: number, y: number): string | null {
  if (!patchServesTile(cfg, z, x, y)) return null;
  return `${base}/${cfg.path}/${z}/${x}/${y}.terrain`;
}
