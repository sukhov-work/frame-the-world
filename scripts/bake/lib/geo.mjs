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
