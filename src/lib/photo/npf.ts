// Spot Stars exposure math (QoL-3 P5, PLANNING_QOL_PLAN §1.1 R14, owner 2026-08-14):
// the NPF rule (Frédéric Michaud, sahavre.fr/regle-npf-rule) as the primary number and the
// 500 rule as the legacy ghost. FTW beat vs PhotoPills: the declination term comes FREE from
// the FPV frustum — the fastest-moving sky point IN FRAME sets the worst case, no user input.
// Pure trig, no three.js, no Date.now().

/** Simplified NPF: t = (35·N + 30·p) / f  (seconds; p in µm, f in mm).
 *  Test vector (MOBILE_PLAN §5): D850 p = 4.35 µm, 14 mm f/2.8 → ≈ 16.3 s. */
export function npfSimpleSec(apertureN: number, focalMm: number, pixelPitchUm: number): number {
  return (35 * apertureN + 30 * pixelPitchUm) / focalMm;
}

/** Full NPF with declination: t = k·(16.856·N + 0.0997·f + 13.713·p) / (f·cos δ).
 *  k = 1 sharp stars … 3 relaxed (visible-but-acceptable trailing). cosDec is the LARGEST
 *  cos δ in frame (celestial-equator stars move fastest → shortest exposure). */
export function npfFullSec(
  apertureN: number,
  focalMm: number,
  pixelPitchUm: number,
  cosDec = 1,
  k = 1,
): number {
  return (
    (k * (16.856 * apertureN + 0.0997 * focalMm + 13.713 * pixelPitchUm)) /
    (focalMm * Math.max(cosDec, 0.05))
  );
}

/** The 500 legacy ghost: t = 500 / (crop factor · focal). */
export function rule500Sec(focalMm: number, cropFactor = 1): number {
  return 500 / (cropFactor * focalMm);
}

/** Declination (deg) of the sky point at az/alt for an observer latitude — the standard
 *  equatorial↔horizontal identity: sin δ = sin φ·sin a + cos φ·cos a·cos A (A from north). */
export function decAtAzAlt(latDeg: number, azDeg: number, altDeg: number): number {
  const phi = (latDeg * Math.PI) / 180;
  const a = (altDeg * Math.PI) / 180;
  const A = (azDeg * Math.PI) / 180;
  const sinDec = Math.sin(phi) * Math.sin(a) + Math.cos(phi) * Math.cos(a) * Math.cos(A);
  return (Math.asin(Math.min(1, Math.max(-1, sinDec))) * 180) / Math.PI;
}

export interface NpfPose {
  headingDeg: number;
  pitchDeg: number;
  /** VERTICAL fov (deg) — the FpvHud/frameFinder convention. */
  fovDeg: number;
  aspect: number;
}

/** Worst-case (largest) cos δ inside the frame for the NPF declination term — sampled at the
 *  centre, corners and edge midpoints of the roll-free frustum; if the sampled declinations
 *  change sign the celestial equator crosses the frame and cos δ = 1 exactly. */
export function maxCosDecInFrame(pose: NpfPose, latDeg: number): number {
  const heading = (pose.headingDeg * Math.PI) / 180;
  const pitch = (pose.pitchDeg * Math.PI) / 180;
  const tanV = Math.tan(((pose.fovDeg * Math.PI) / 180) / 2);
  const tanH = tanV * pose.aspect;
  // Roll-free ENU basis (east, north, up): forward from heading/pitch, right level.
  const cp = Math.cos(pitch);
  const f = [Math.sin(heading) * cp, Math.cos(heading) * cp, Math.sin(pitch)];
  const r = [Math.cos(heading), -Math.sin(heading), 0];
  const u = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  let maxCos = 0;
  let sawPos = false;
  let sawNeg = false;
  for (const [x, y] of [
    [0, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
    [0, -1], [0, 1], [-1, 0], [1, 0],
  ]) {
    const dx = f[0] + r[0] * tanH * x + u[0] * tanV * y;
    const dy = f[1] + r[1] * tanH * x + u[1] * tanV * y;
    const dz = f[2] + r[2] * tanH * x + u[2] * tanV * y;
    const L = Math.hypot(dx, dy, dz);
    const altDeg = (Math.asin(dz / L) * 180) / Math.PI;
    const azDeg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const dec = decAtAzAlt(latDeg, azDeg, altDeg);
    if (dec >= 0) sawPos = true;
    if (dec <= 0) sawNeg = true;
    maxCos = Math.max(maxCos, Math.cos((dec * Math.PI) / 180));
  }
  return sawPos && sawNeg ? 1 : maxCos;
}
