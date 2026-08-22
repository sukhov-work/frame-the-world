/**
 * Slippy-map (web-mercator XYZ) tile math for the U3 fullscreen MapWindow — pure and
 * three-free so the panel needs no globe imports (the design fence). The globe's own raster
 * drape goes through the 3d-tiles-renderer overlay plugin; this canvas map is the only other
 * consumer of XYZ tiles, so the math lives here in lib rather than under components/globe.
 */

/** Fractional web-mercator tile coordinates of a lon/lat at zoom z (unit-tested). */
export function lonLatToTileF(
  lonDeg: number,
  latDeg: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (latDeg * Math.PI) / 180;
  return {
    x: ((lonDeg + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

/** Lon/lat of fractional tile coordinates at zoom z — the inverse of lonLatToTileF
 *  (unit-tested; integer coords give the tile's NW corner). */
export function tileFToLonLat(x: number, y: number, z: number): { lonDeg: number; latDeg: number } {
  const n = 2 ** z;
  return {
    lonDeg: (x / n) * 360 - 180,
    latDeg: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
  };
}

/** Ground metres per tile PIXEL (256-px tiles) at a latitude and zoom (unit-tested). */
export function metersPerTilePx(latDeg: number, z: number): number {
  return (40_075_016.686 * Math.cos((latDeg * Math.PI) / 180)) / (256 * 2 ** z);
}

/** The zoom whose tile-pixel density best matches a target of metres-per-CSS-px — used to pick
 *  the MapWindow's initial zoom from a camera altitude (unit-tested; clamped). */
export function zoomForMetersPerPx(
  latDeg: number,
  targetMPerPx: number,
  minZ: number,
  maxZ: number,
): number {
  const z = Math.log2((40_075_016.686 * Math.cos((latDeg * Math.PI) / 180)) / (256 * targetMPerPx));
  return Math.min(maxZ, Math.max(minZ, Math.round(z)));
}

/**
 * THE chart rotation transform (audit #3 C8 → T35, hoisted 2026-08-22).
 *
 * The expanded chart can be TWISTED with two fingers (batch #4 item 4b), and every consumer —
 * the tile blit, the pan, point→lat/lon, tap-promote, the radar and the focal cone — runs
 * through one rotation-aware pair. That pair lived inside a `useEffect` closure in
 * `panels/MapWindow`, which made it UNIMPORTABLE: `chartWalkAzRad`'s round-trip test had to
 * hand-transcribe it, so a sign flip in the app would have left the test green. It is the same
 * arithmetic, lifted here and delegated to.
 *
 * Tile space is east +x, **SOUTH +y** (so north is −y at rot 0); `scale` is device px per tile.
 * Forward: `screen = R(rot) · tileΔ · scale`. Inverse rides the transpose.
 */
export interface ChartTransform {
  readonly rotRad: number;
  readonly scale: number;
  /** Tile-space delta from centre → device-px delta from canvas centre. */
  fwd(vx: number, vy: number): [number, number];
  /** Device-px delta from canvas centre → tile-space delta (Rᵀ). */
  inv(dx: number, dy: number): [number, number];
}

export function chartTransform(rotRad: number, scale: number): ChartTransform {
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  return {
    rotRad,
    scale,
    fwd: (vx, vy) => [(vx * cos - vy * sin) * scale, (vx * sin + vy * cos) * scale],
    inv: (dx, dy) => [(dx * cos + dy * sin) / scale, (-dx * sin + dy * cos) / scale],
  };
}

/** One-shot forward/inverse (the test + any caller that doesn't hold a transform). The factory
 *  above is the ONE definition — these delegate so the pair cannot fork. */
export const rotFwd = (vx: number, vy: number, rotRad: number, scale = 1): [number, number] =>
  chartTransform(rotRad, scale).fwd(vx, vy);
export const rotInv = (dx: number, dy: number, rotRad: number, scale = 1): [number, number] =>
  chartTransform(rotRad, scale).inv(dx, dy);

/** QA slice B (owner 2026-08-21g-end): SCREEN-relative walk on the expanded chart — the
 *  compass azimuth (rad) a screen-space walk input steers toward on a chart twisted by
 *  `rotRad` (screen-CCW; MapWindow `view.rot`). Input is (x right, y UP) — the joystick/arrow
 *  sense, not canvas +y-down. The chart's forward transform is screen = R(rot)·tileΔ with
 *  tile north = −y, so screen-up at rot 0 is north and a screen direction de-rotates by rot:
 *  az = atan2(x, y) − rot. The orchestrator builds its ENU walk basis from this (fwd = az of
 *  (0,1), right = fwd + π/2) so stick-up tracks chart-up exactly, world-correct (unit-tested). */
export function chartWalkAzRad(x: number, y: number, rotRad: number): number {
  return Math.atan2(x, y) - rotRad;
}
