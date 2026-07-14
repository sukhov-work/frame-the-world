/**
 * Horizon / skyline profile (Pass 3 WS4-B + Dnipro enrichment Slice 5).
 *
 * A per-azimuth-bin MAX apparent elevation of everything that blocks the sky around an anchor
 * eye: terrain (marched through an injected `heightAt` sampler), building silhouettes and tree
 * canopies (swept in by `lib/geo/occlusion.ts`). Once built, "is the sun/moon blocked?" is an
 * O(1) lookup — `bodyAltDeg < sampleProfile(profile, bodyAzDeg)` — for ANY scene time, which is
 * what makes the PlanPanel's skyline chips scrub-safe (no raycasts after build).
 *
 * Pure and three-free. Azimuth convention matches `lib/ephemeris/bodies.AzAlt`: deg [0,360),
 * N=0 E=90. Elevations are APPARENT terrestrial angles: the terrain march subtracts the earth
 * curvature drop `d²(1−k)/(2R)` (geometry minus standard refraction, k = PLAN.refractionK);
 * ECEF mesh sweeps get curvature exactly from the geometry and add only the `k·d²/(2R)` lift.
 *
 * HONESTY CONTRACT (the streamed-LOD caveat, RENDERING_QUALITY_PASS.md WS4): `heightAt` reads
 * the RENDERED terrain, which exists only where tiles are loaded — bins whose samples all
 * returned null stay `known = 0` and report the open-sky floor. Consumers must surface partial
 * coverage (`profileCoverage`) instead of pretending the skyline is complete.
 */

import type { Vec3 } from "./projection";

/** Mean earth radius for curvature/refraction terms (m) — spherical is plenty at ≤30 km range. */
export const R_MEAN_M = 6_371_000;

export interface HorizonProfile {
  /** Number of azimuth bins (bin i covers [i·360/n, (i+1)·360/n) deg). */
  binCount: number;
  /** Per-bin max apparent elevation of the skyline (deg). */
  altDeg: Float32Array;
  /** Per-bin evidence flag: 0 = nothing sampled (value is the open-sky floor), 1 = sampled. */
  known: Uint8Array;
  /** The open-sky floor bins start at (deg) — the eye-height horizon dip, ≤ 0. */
  openSkyAltDeg: number;
}

/** Eye-height geometric horizon dip (deg, ≤0) with the k-factor refraction recovery —
 *  `√(2·h·(1−k)/R)` rad. h ≤ 0 → 0. */
export function horizonDipDeg(eyeAboveGroundM: number, refractionK: number): number {
  const h = Math.max(0, eyeAboveGroundM);
  return -(Math.sqrt((2 * h * (1 - refractionK)) / R_MEAN_M) * 180) / Math.PI;
}

export function createProfile(binCount: number, openSkyAltDeg: number): HorizonProfile {
  const altDeg = new Float32Array(binCount).fill(openSkyAltDeg);
  return { binCount, altDeg, known: new Uint8Array(binCount), openSkyAltDeg };
}

export function binIndex(p: HorizonProfile, azDeg: number): number {
  const az = ((azDeg % 360) + 360) % 360;
  return Math.min(p.binCount - 1, Math.floor((az / 360) * p.binCount));
}

/** Raise a bin to at least `altDeg` and mark it sampled. The profile only ever RISES —
 *  sources merge by max, so sweep order is irrelevant. */
export function raiseBin(p: HorizonProfile, azDeg: number, altDeg: number): void {
  const i = binIndex(p, azDeg);
  if (altDeg > p.altDeg[i]) p.altDeg[i] = altDeg;
  p.known[i] = 1;
}

/** Skyline elevation at an azimuth — linear interpolation between neighbouring bin centres
 *  (wrapping). Between a known and an unknown bin the interpolation still runs; honesty lives
 *  in `profileCoverage`, not in per-sample gaps. */
export function sampleProfile(p: HorizonProfile, azDeg: number): number {
  const az = ((azDeg % 360) + 360) % 360;
  const x = (az / 360) * p.binCount - 0.5; // bin CENTRES at i + 0.5
  const i0 = Math.floor(x);
  const t = x - i0;
  const a = p.altDeg[((i0 % p.binCount) + p.binCount) % p.binCount];
  const b = p.altDeg[(((i0 + 1) % p.binCount) + p.binCount) % p.binCount];
  return a + (b - a) * t;
}

/** Fraction of bins with real evidence, 0..1. */
export function profileCoverage(p: HorizonProfile): number {
  let n = 0;
  for (let i = 0; i < p.binCount; i++) n += p.known[i];
  return n / p.binCount;
}

/** Is a body at (azDeg, altDeg) behind the skyline? */
export function isBlocked(p: HorizonProfile, azDeg: number, altDeg: number): boolean {
  return altDeg < sampleProfile(p, azDeg);
}

// ---------------------------------------------------------------------------------------------
// Terrain march
// ---------------------------------------------------------------------------------------------

export interface TerrainMarchOptions {
  /** First sample distance (m). */
  minRangeM: number;
  /** Last sample distance (m). */
  maxRangeM: number;
  /** Geometric step growth per sample (>1). */
  stepGrowth: number;
  /** Terrestrial refraction coefficient k (standard 0.13). */
  refractionK: number;
}

export interface TerrainAnchor {
  latDeg: number;
  lonDeg: number;
  /** Eye altitude in the SAME datum `heightAt` reports (rendered-terrain / ellipsoidal m). */
  eyeAltM: number;
}

/**
 * March the injected terrain sampler outward along one azimuth and fold the max apparent
 * elevation into the profile. Returns how many samples had real terrain under them — 0 leaves
 * the bin unknown (tiles exist only in-frustum; a null march is NOT an empty horizon).
 *
 * Small-angle geodesic destination (spherical direct problem) — at ≤30 km the error vs a true
 * geodesic is far below one bin width.
 */
export function marchTerrainBin(
  p: HorizonProfile,
  anchor: TerrainAnchor,
  azDeg: number,
  heightAt: (latDeg: number, lonDeg: number) => number | null,
  opts: TerrainMarchOptions,
): number {
  const azRad = (azDeg * Math.PI) / 180;
  const sinAz = Math.sin(azRad);
  const cosAz = Math.cos(azRad);
  const degPerMLat = 180 / Math.PI / R_MEAN_M;
  const degPerMLon = degPerMLat / Math.cos((anchor.latDeg * Math.PI) / 180);
  const drop = (1 - opts.refractionK) / (2 * R_MEAN_M);
  let sampled = 0;
  let best = -Infinity;
  for (let d = opts.minRangeM; d <= opts.maxRangeM; d *= opts.stepGrowth) {
    const lat = anchor.latDeg + d * cosAz * degPerMLat;
    const lon = anchor.lonDeg + d * sinAz * degPerMLon;
    const h = heightAt(lat, lon);
    if (h == null) continue;
    sampled++;
    const alt = (Math.atan2(h - anchor.eyeAltM - d * d * drop, d) * 180) / Math.PI;
    if (alt > best) best = alt;
  }
  if (sampled > 0) raiseBin(p, azDeg, best);
  return sampled;
}

// ---------------------------------------------------------------------------------------------
// ENU frame for the ECEF sweeps (occlusion.ts) and body lookups
// ---------------------------------------------------------------------------------------------

export interface SilhouetteFrame {
  /** Anchor eye, ECEF m. */
  originEcef: Vec3;
  east: Vec3;
  north: Vec3;
  up: Vec3;
  /** Refraction coefficient shared with the terrain march. */
  refractionK: number;
}

/** Az/alt/dist of an ECEF point seen from the frame's eye. ECEF→ENU is EXACT geometry (earth
 *  curvature included); only the refraction lift `k·d²/(2R)` is added. */
export function azAltOfEcef(
  frame: SilhouetteFrame,
  x: number,
  y: number,
  z: number,
): { azDeg: number; altDeg: number; distM: number } {
  const dx = x - frame.originEcef[0];
  const dy = y - frame.originEcef[1];
  const dz = z - frame.originEcef[2];
  const e = dx * frame.east[0] + dy * frame.east[1] + dz * frame.east[2];
  const n = dx * frame.north[0] + dy * frame.north[1] + dz * frame.north[2];
  const u = dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2];
  const dh = Math.hypot(e, n);
  const lift = (frame.refractionK * dh * dh) / (2 * R_MEAN_M);
  const azDeg = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360;
  const altDeg = (Math.atan2(u + lift, dh) * 180) / Math.PI;
  return { azDeg, altDeg, distM: Math.hypot(dx, dy, dz) };
}
