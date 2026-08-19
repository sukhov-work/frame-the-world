/**
 * Rough proximity ranking (owner 2026-08-19b: "MY PLACES always ordered by rough proximity
 * to the current position on the map") — equirectangular squared distance in degrees²,
 * longitude wrapped and cos-mid-latitude corrected. SORTING ONLY: monotonic with true
 * distance at city-to-country scale; no metres ever come out of this (use lib/geo/projection
 * for real geometry).
 */

export function roughDistDeg2(
  aLatDeg: number,
  aLonDeg: number,
  bLatDeg: number,
  bLonDeg: number,
): number {
  const dLat = aLatDeg - bLatDeg;
  let dLon = Math.abs(aLonDeg - bLonDeg) % 360;
  if (dLon > 180) dLon = 360 - dLon;
  dLon *= Math.cos((((aLatDeg + bLatDeg) / 2) * Math.PI) / 180);
  return dLat * dLat + dLon * dLon;
}

/** Stable nearest-first copy of `rows` as seen from (latDeg, lonDeg). */
export function sortByProximity<T extends { latDeg: number; lonDeg: number }>(
  rows: readonly T[],
  latDeg: number,
  lonDeg: number,
): T[] {
  return rows
    .map((row, i) => ({ row, i, d: roughDistDeg2(row.latDeg, row.lonDeg, latDeg, lonDeg) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.row);
}
