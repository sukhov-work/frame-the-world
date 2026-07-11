/**
 * Compass-heading math (moved out of store/camera in the pre-S7 refactor, B6 — pure, unit-tested,
 * and needed by both the orchestrator and the panels without importing the store). Heading is
 * degrees clockwise from north (0 = north, 90 = east).
 */

/** Normalize a heading to [0, 360). */
export function wrapHeadingDeg(deg: number): number {
  const w = deg % 360;
  return w < 0 ? w + 360 : w;
}

/** Shortest signed arc from `fromDeg` to `toDeg` (−180..180] — the glide direction. */
export function headingDeltaDeg(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
