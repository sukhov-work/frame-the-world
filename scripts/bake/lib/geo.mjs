// WGS84 + local-ENU projection for the Dnipro-enrichment bake.
//
// Mirrors src/lib/geo/projection.ts and scripts/build-sample-dnipro-tiles.mjs (the browser-VERIFIED
// Slice-0 writer): the tileset root carries an ENU→ECEF transform at the bake origin, and every
// building is authored in LOCAL ENU metres relative to that origin. Geometry is baked at ellipsoid
// h = 0; scene/enrichedBuildings.ts re-seats the whole group onto the rendered Cesium World Terrain
// at runtime (strategy R1), so we bake only RELATIVE geometry, never absolute Z.

const WGS84_A = 6378137.0;
const WGS84_B = 6356752.314245;
const E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);
export const DEG = Math.PI / 180;

/** Geodetic (deg, deg, m ellipsoidal) → ECEF metres. */
export function geodeticToEcef(latDeg, lonDeg, hM = 0) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return [
    (N + hM) * cosLat * Math.cos(lon),
    (N + hM) * cosLat * Math.sin(lon),
    (N * (1 - E2) + hM) * sinLat,
  ];
}

/** Local East/North/Up basis (unit vectors) + origin ECEF at a geodetic point (h = 0). */
export function enuBasis(latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  return {
    east: [-sinLon, cosLon, 0],
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    up: [cosLat * cosLon, cosLat * sinLon, sinLat],
    origin: geodeticToEcef(latDeg, lonDeg, 0),
  };
}

/** Column-major 4×4 ENU→ECEF at a geodetic origin — the 3D-Tiles root `transform`. Columns are the
 *  East / North / Up basis vectors then the origin ECEF (glTF/3D-Tiles matrices are column-major). */
export function enuToEcefMatrix(latDeg, lonDeg, hM = 0) {
  const b = enuBasis(latDeg, lonDeg);
  const o = hM === 0 ? b.origin : geodeticToEcef(latDeg, lonDeg, hM);
  // prettier-ignore
  return [
    b.east[0],  b.east[1],  b.east[2],  0,
    b.north[0], b.north[1], b.north[2], 0,
    b.up[0],    b.up[1],    b.up[2],    0,
    o[0],       o[1],       o[2],       1,
  ];
}

/** Project a geodetic point to LOCAL ENU horizontal metres [e, n] relative to `basis`'s origin.
 *  Exact (ECEF difference projected onto the E/N basis) — over a few km the vertical curvature drop
 *  is sub-metre and irrelevant (buildings seat at u = 0 and are re-clamped to terrain at runtime). */
export function projectEN(latDeg, lonDeg, basis) {
  const p = geodeticToEcef(latDeg, lonDeg, 0);
  const dx = p[0] - basis.origin[0], dy = p[1] - basis.origin[1], dz = p[2] - basis.origin[2];
  return [
    dx * basis.east[0] + dy * basis.east[1] + dz * basis.east[2],
    dx * basis.north[0] + dy * basis.north[1] + dz * basis.north[2],
  ];
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * RC16 — the ONE grid-binning rule, shared by both bakers.
 *
 * Until 2026-08-26d the rule lived inline in each baker's `main()` and the two DISAGREED at the
 * bbox edge: bake.mjs clamped a centroid-outside feature into the nearest edge cell and kept it
 * whole, while bake-osm2world.mjs dropped it (`droppedOutside`). Since `dnipro` ships BOTH
 * variants, the default and its A/B fallback had different edge behaviour — and neither rule was
 * importable or covered by a test.
 *
 * THE RULE, and why it is this one. The runtime seam is `bboxClipPrismEcef`
 * (src/lib/globe/enrichedMask.ts): four ECEF planes that discard Cesium-OSM fragments INSIDE the
 * bake bbox. So the contract the bake has to honour is exactly "the enriched tileset draws
 * whatever the prism removed":
 *
 *   OWNERSHIP is by INTERSECTION with the bbox, never by the centroid. A feature that pokes into
 *   the prism at all has its inside part erased from Cesium, so if the bake does not carry it the
 *   result is a HOLE — a half-building notch at eye level.
 *
 *   PLACEMENT is the clamped centroid cell. Ownership already guarantees the feature touches the
 *   bbox, so its centroid sits at most one feature-radius outside and the clamp moves it by at
 *   most one cell. The clamp is a clamp, not a teleport.
 *
 * WHY THE OLD CENTROID DROP LOOKED NECESSARY, measured on the shipped intermediates
 * (`scripts/bake/measure-straddlers.mjs`): `droppedOutside` was two populations wearing one name.
 * Only 123 / 61 / 1 of dnipro-o2w's 2,741, st-albans-o2w's 289 and chernobyl-o2w's 1,664 are real
 * straddlers; the other 2,618 / 228 / 1,663 sit a MEDIAN 761 m / 40 km / 36 km outside (max 55 km /
 * 653 km / 149 km) because OSM2World renders its whole relation-recursed extract, whose data
 * bounds inflate far past the sub-box. Dropping those is right and this rule still drops them —
 * it just stops taking the other 185 features down with them.
 *
 * The extruder measures FAR = 0 at all three cities, because `way["building"](bbox)` only returns
 * ways intersecting the bbox. Its unbounded clamp was therefore safe by a property of its INPUT,
 * not of its code; the explicit `far` branch below makes that guarantee local.
 *
 * KNOWN RESIDUAL (measured, not hand-waved): an owned feature that pokes outside is still drawn
 * twice out there — once by the bake, once by unclipped Cesium — on 0.03–0.42 % of features per
 * bake (212 dnipro, 229 dnipro-o2w, 96 st-albans, 111 st-albans-o2w, 1 chernobyl), poking a median
 * 3–10 m past the edge. That is a coincident-sliver duplicate, not a hole, and closing it needs
 * the margin/crossfade ring the audit sketched. Growing the prism instead is NOT the fix: it
 * would blank Cesium over a ring the bake does not cover, which punches a real hole.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** A feature's lon/lat extent in DEGREES. */
/** @typedef {{minLon:number,maxLon:number,minLat:number,maxLat:number}} LonLatBounds */

/** Do `bounds` touch the bbox `[w,s,e,n]` at all? Inclusive on the edges, matching the runtime
 *  prism's inclusive `bboxContainsRad`. */
export function bboxIntersects(bbox, bounds) {
  const [w, s, e, n] = bbox;
  return !(bounds.maxLon < w || bounds.minLon > e || bounds.maxLat < s || bounds.minLat > n);
}

/** Are `bounds` wholly inside the bbox (no edge crossing)? */
export function bboxContainsBounds(bbox, bounds) {
  const [w, s, e, n] = bbox;
  return bounds.minLon >= w && bounds.maxLon <= e && bounds.minLat >= s && bounds.maxLat <= n;
}

/** The grid cell of a lon/lat, clamped to `[0, grid-1]` on both axes. */
export function cellOf(bbox, grid, lon, lat) {
  const [w, s, e, n] = bbox;
  const spanLon = e - w, spanLat = n - s;
  const gi = spanLon > 0 ? Math.min(grid - 1, Math.max(0, Math.floor(((lon - w) / spanLon) * grid))) : 0;
  const gj = spanLat > 0 ? Math.min(grid - 1, Math.max(0, Math.floor(((lat - s) / spanLat) * grid))) : 0;
  return { gi, gj, key: `${gi},${gj}` };
}

/**
 * Bin ONE feature. `bounds` is its full lon/lat extent; `cLon`/`cLat` its centroid (each baker
 * keeps its own centroid definition — the extruder averages footprint ring vertices, the adapter
 * averages the density-weighted 3D soup — because only ownership has to agree across the A/B
 * seam; placement of an owned feature differs by at most a cell either way).
 *
 * @returns {{bucket:"in"|"straddle"|"far", gi:number, gj:number, key:string}
 *          | {bucket:"far", gi:null, gj:null, key:null}}
 *   `bucket === "far"` means DROP: nothing of this feature is inside the prism, so Cesium still
 *   draws it and baking it would be a coincident duplicate.
 */
export function binFeature(bbox, grid, bounds, cLon, cLat) {
  if (!bboxIntersects(bbox, bounds)) return { bucket: "far", gi: null, gj: null, key: null };
  const bucket = bboxContainsBounds(bbox, bounds) ? "in" : "straddle";
  return { bucket, ...cellOf(bbox, grid, cLon, cLat) };
}
