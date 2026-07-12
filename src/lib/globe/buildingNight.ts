/**
 * Night factor for the building window emissive (RENDERING_QUALITY_PASS R2/R3 — Dnipro identity).
 *
 * The base earth and imagery ground compute their terminator in-shader as
 * `1 - smoothstep(EARTH.lightsBand[0], EARTH.lightsBand[1], dot(up, sunDir))` over the SINE of the
 * sun's elevation (scene/baseEarth.ts, scene/imageryGround.ts). This lifts that exact curve onto the
 * CPU so the building window glow lights up in step with the SAME terminator the city ground fades
 * across — but as a pure, three-free function it can be unit-tested (unlike the shader twins). The
 * per-building "which windows are lit" variation still happens in-shader (a hash of the batch id);
 * only the day↔night factor is computed here, once per frame, and pushed as a uniform.
 */

/** GLSL-identical smoothstep (clamped Hermite) so this CPU factor matches the shader terminator to
 *  float precision. `edge0 === edge1` is a hard step (mirrors GLSL's undefined-but-conventional edge). */
export function smoothstep01(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Night factor in [0,1] from the sine of the sun's elevation at the view focus:
 * 1 = full night (windows fully lit), 0 = daylight (windows off), eased across `band`
 * (= EARTH.lightsBand `[sinLo, sinHi]`, the same band the earth's VIIRS city-lights term uses).
 */
export function buildingNightFactor(sunElevSin: number, band: readonly [number, number]): number {
  return 1 - smoothstep01(band[0], band[1], sunElevSin);
}
