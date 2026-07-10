/**
 * Golden-hour bell (Phase 4, ADR D6/D14) — one curve, three consumers. The signal is the SINE of
 * the sun's elevation at a surface point (`dot(surfaceNormal, sunDir)` — exactly what the earth and
 * ground shaders already compute for the terminator). The bell rises through civil twilight, peaks
 * with the sun on the horizon, and dies as the sun climbs out of the "first/last hour" band.
 *
 * The GLSL twins in scene/baseEarth + scene/imageryGround + scene/atmosphere bake the SAME curve
 * via glf() (keep them in sync with tuning.GOLDEN); this JS version drives the building key-light
 * colour on the CPU and is the unit-testable face of the curve.
 */

export interface GoldenCurve {
  /** Bell fade-in over sin(elevation): 0 below `fadeInLo`, 1 above `fadeInHi`. */
  fadeInLo: number;
  fadeInHi: number;
  /** Bell fade-out: still 1 below `fadeOutLo`, 0 above `fadeOutHi`. */
  fadeOutLo: number;
  fadeOutHi: number;
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** 0..1 golden-hour factor for a sun-elevation sine (= dot(surfaceUp, sunDir)). */
export function goldenFactor(sinElev: number, c: GoldenCurve): number {
  return (
    smoothstep(c.fadeInLo, c.fadeInHi, sinElev) *
    (1 - smoothstep(c.fadeOutLo, c.fadeOutHi, sinElev))
  );
}
