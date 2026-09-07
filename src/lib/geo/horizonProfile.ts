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
 * HONESTY CONTRACT (the streamed-LOD caveat, rendering/RENDERING_QUALITY_PASS.md WS4): `heightAt` reads
 * the RENDERED terrain, which exists only where tiles are loaded — bins whose samples all
 * returned null stay `known = 0` and report the open-sky floor. Consumers must surface partial
 * coverage (`profileCoverage`) instead of pretending the skyline is complete.
 *
 * BEST EFFORT, PER BIN (T112, owner ruling 2026-09-07d): honesty moved from the whole profile
 * to the bin. A profile is never withheld for low coverage — every bin with evidence answers
 * exactly, and only a bin with NO evidence answers `null` (`sampleBinsKnown`); between a known
 * and an unknown bin the known one is HELD, never sagged toward the floor. `skylineSamplerFor`
 * is the one gate every consumer (radars, scrubber, FIND, THIS FRAME) goes through: a real eye,
 * within the guard distance — no coverage clause.
 *
 * FINE BINS (T110, 2026-09-07d): `binCount` is the FINE resolution the mesh sweeps write at
 * (`PLAN.azBins`); terrain is marched on a coarser profile (`PLAN.terrainAzBins`) and folded in
 * by `foldCoarseProfile`. A 500 mm frame spans ~4° — at 3° a mast raised a whole bin and a gap
 * between two towers vanished; at the fine width the frame holds many bins.
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

/** Skyline elevation at an azimuth over a BARE bin array — the interpolation core of
 *  `sampleProfile`, callable on the plain array `store/plan.profileBins` mirrors to React
 *  consumers (the QoL-1 rail trace; the QoL-2 frameFinder profileFn). */
export function sampleBins(altDeg: ArrayLike<number>, azDeg: number): number {
  const n = altDeg.length;
  const az = ((azDeg % 360) + 360) % 360;
  const x = (az / 360) * n - 0.5; // bin CENTRES at i + 0.5
  const i0 = Math.floor(x);
  const t = x - i0;
  const a = altDeg[((i0 % n) + n) % n];
  const b = altDeg[(((i0 + 1) % n) + n) % n];
  return a + (b - a) * t;
}

/** A per-azimuth skyline sampler: apparent elevation (deg) where the profile has evidence,
 *  `null` where it has none (T112 — the consumer decides what "unknown" looks like). */
export type SkylineSampler = (azDeg: number) => number | null;

/** The known-aware interpolation core (T112). Both neighbouring centres known → linear
 *  interpolation exactly as `sampleBins`; only one known → that bin answers for ITS OWN span
 *  with its own value (no lerp toward an unswept neighbour, no sag toward the floor — and no
 *  claim over the unknown bin's span either); the sample inside an unknown bin whose other
 *  neighbour is unknown too → `null`. */
export function sampleBinsKnown(
  altDeg: ArrayLike<number>,
  known: ArrayLike<number>,
  azDeg: number,
): number | null {
  const n = altDeg.length;
  const az = ((azDeg % 360) + 360) % 360;
  const x = (az / 360) * n - 0.5; // bin CENTRES at i + 0.5
  const i0 = Math.floor(x);
  const t = x - i0;
  const ia = ((i0 % n) + n) % n;
  const ib = (((i0 + 1) % n) + n) % n;
  const ka = known[ia] !== 0;
  const kb = known[ib] !== 0;
  if (ka && kb) return altDeg[ia] + (altDeg[ib] - altDeg[ia]) * t;
  // t < 0.5 ⇒ the sample lies inside bin ia's span; t ≥ 0.5 ⇒ inside bin ib's.
  if (t < 0.5) return ka ? altDeg[ia] : null;
  return kb ? altDeg[ib] : null;
}

/** Skyline elevation at an azimuth where the profile has evidence, else `null`. */
export function sampleProfileKnown(p: HorizonProfile, azDeg: number): number | null {
  return sampleBinsKnown(p.altDeg, p.known, azDeg);
}

/** Skyline elevation at an azimuth, BEST EFFORT: the known-aware interpolation where there is
 *  evidence, the open-sky floor where there is none (a body there reads geometrically "up").
 *  The store mirror's twin is `sampleBinsKnown(bins, known, az) ?? floor`. */
export function sampleProfile(p: HorizonProfile, azDeg: number): number {
  return sampleProfileKnown(p, azDeg) ?? p.openSkyAltDeg;
}

/**
 * T110 — fold a COARSE profile (the terrain march at `coarse.binCount` centres) into a finer
 * one by the same known-aware interpolation the samplers use: a fine bin between two known
 * coarse centres takes the interpolated elevation, one beside a single known centre holds it,
 * one between two unknown centres stays unknown. Max-merge, so mesh evidence already in the
 * fine profile survives. Identical bin counts copy exactly.
 */
export function foldCoarseProfile(fine: HorizonProfile, coarse: HorizonProfile): void {
  const n = fine.binCount;
  for (let i = 0; i < n; i++) {
    const v = sampleBinsKnown(coarse.altDeg, coarse.known, ((i + 0.5) * 360) / n);
    if (v == null) continue;
    if (v > fine.altDeg[i]) fine.altDeg[i] = v;
    fine.known[i] = 1;
  }
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

/** Everything a consumer knows about the mirrored profile, at the moment it paints. */
export interface SkylineGate {
  /** `store/plan.profileReady`. */
  ready: boolean;
  /** `store/plan.profileBins` — the mirrored per-bin skyline, or null. */
  bins: readonly number[] | null;
  /** `store/plan.profileKnown` — the per-bin evidence flags beside the bins (T112), or null.
   *  Absent (undefined) ⇒ every bin is treated as known (the pre-T112 shape). */
  known?: readonly number[] | null;
  /** `store/plan.profileCoverage` — fraction of bins with real evidence, 0..1 (a hint only;
   *  it gates nothing since T112). */
  coverage: number;
  /** The eye the profile was SWEPT at (photo apex / FPV eye). `null` — or a "focus" anchor,
   *  which owns no profile — means there is nothing to claim. */
  eye: { latDeg: number; lonDeg: number } | null;
  /** Where this surface is seated. */
  anchor: { latDeg: number; lonDeg: number };
  /** `AIMCONES.skylineGuardM` — how far the surface may sit from the swept eye. */
  guardM: number;
}

/** What `skylineSamplerFor` hands a consumer: the best-effort sampler plus the evidence
 *  behind it, so a surface can show "N % MAPPED" without re-deriving anything. */
export interface SkylineView {
  /** Apparent elevation (deg) where the profile has evidence, `null` where it has none. */
  altAt: SkylineSampler;
  /** `Σknown / n`, 0..1. */
  coverage: number;
  /** `coverage < 1` — some azimuth answers `null`. */
  partial: boolean;
  bins: readonly number[];
  known: readonly number[] | null;
}

/**
 * THE skyline gate — one rule, every consumer (audit #3 A1-16, 2026-08-22; re-shaped by T112
 * on 2026-09-07d, owner ruling "best effort even below 50 %").
 *
 * Returns the sampler a surface may fracture its bands / classify its rows with, or `null` for
 * "make no skyline claim at all". Two conditions, both the HONESTY CONTRACT above:
 *
 *  1. **a profile exists** and was swept at a real eye (a `focus` anchor never owns one);
 *  2. **the eye is this surface's eye** — within `guardM`. A far-away eye must not lend its
 *     skyline to another point's radar.
 *
 * The A1-16 coverage clause (a < 50 %-covered profile claimed nothing) is GONE: it threw away
 * every true gap in the swept half to avoid drawing ignorance as clear sky in the other. The
 * per-bin answer does both honestly — the sampler is exact where a bin has evidence and `null`
 * where it has none, and each consumer renders `null` as its own "unknown" (a radar keeps the
 * plain band there, a row shows "—", the trace draws the geometric path).
 */
export function skylineSamplerFor(g: SkylineGate): SkylineView | null {
  if (!g.ready || !g.bins || !g.eye) return null;
  if (!withinGuard(g)) return null;
  const bins = g.bins;
  const known = g.known ?? null;
  let coverage = 1;
  if (known) {
    let k = 0;
    for (let i = 0; i < known.length; i++) k += known[i] !== 0 ? 1 : 0;
    coverage = known.length ? k / known.length : 0;
  }
  const altAt: SkylineSampler = known
    ? (azDeg) => sampleBinsKnown(bins, known, azDeg)
    : (azDeg) => sampleBins(bins, azDeg);
  return { altAt, coverage, partial: coverage < 1, bins, known };
}

/**
 * The store-mirror sampler for a consumer whose eye IS the plan anchor (the scrubber, FIND,
 * THIS FRAME, the plan sheet all pose at `store/plan.anchor`, so the guard distance is zero
 * by construction and a focus anchor has already nulled the bins). Best effort per bin
 * (T112): exact where `known`, `null` where not; without flags every bin counts as known.
 * Memoise on the two arrays' identities — planFeed publishes fresh ones once per build.
 */
export function mirrorSampler(
  bins: readonly number[] | null,
  known: readonly number[] | null | undefined,
): SkylineSampler | null {
  if (!bins) return null;
  if (!known) return (azDeg) => sampleBins(bins, azDeg);
  return (azDeg) => sampleBinsKnown(bins, known, azDeg);
}

/** The guard-distance clause on its own (2-D equirectangular metres) — one arithmetic for every
 *  entry point, so the radars and the rows can never disagree about "this eye". */
export function withinGuard(g: Pick<SkylineGate, "eye" | "anchor" | "guardM">): boolean {
  if (!g.eye) return false;
  const dN = (g.anchor.latDeg - g.eye.latDeg) * 111_320;
  const dE =
    (g.anchor.lonDeg - g.eye.lonDeg) * 111_320 * Math.cos((g.anchor.latDeg * Math.PI) / 180);
  return dN * dN + dE * dE <= g.guardM * g.guardM;
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

/** The (azDeg, altDeg, distM) triple `azAltOfEcefInto` writes — a reusable scratch so a
 *  million-sample sweep allocates nothing (T110). */
export interface AzAltScratch {
  azDeg: number;
  altDeg: number;
  distM: number;
}

/** Az/alt/dist of a point given EYE-RELATIVE ECEF deltas, written into `out`. ECEF→ENU is
 *  EXACT geometry (earth curvature included); only the refraction lift `k·d²/(2R)` is added. */
export function azAltOfRelInto(
  frame: SilhouetteFrame,
  dx: number,
  dy: number,
  dz: number,
  out: AzAltScratch,
): AzAltScratch {
  const e = dx * frame.east[0] + dy * frame.east[1] + dz * frame.east[2];
  const n = dx * frame.north[0] + dy * frame.north[1] + dz * frame.north[2];
  const u = dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2];
  const dh = Math.hypot(e, n);
  const lift = (frame.refractionK * dh * dh) / (2 * R_MEAN_M);
  out.azDeg = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360;
  out.altDeg = (Math.atan2(u + lift, dh) * 180) / Math.PI;
  out.distM = Math.hypot(dx, dy, dz);
  return out;
}

/** Az/alt/dist of an ECEF point seen from the frame's eye (allocating form of
 *  `azAltOfRelInto`). */
export function azAltOfEcef(
  frame: SilhouetteFrame,
  x: number,
  y: number,
  z: number,
): { azDeg: number; altDeg: number; distM: number } {
  return azAltOfRelInto(
    frame,
    x - frame.originEcef[0],
    y - frame.originEcef[1],
    z - frame.originEcef[2],
    { azDeg: 0, altDeg: 0, distM: 0 },
  );
}
