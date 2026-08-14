// Twilight bands (Phase 8a P1) — pure sun-altitude threshold math, three-free.
//
// Standard definitions (USNO): civil twilight sun altitude ≥ −6°, nautical ≥ −12°, astronomical
// ≥ −18°; below −18° is astronomical darkness ("night" here — the darkness gate every planning
// feature downstream reuses, e.g. the Milky Way darkness score). The day boundary is the
// GEOMETRIC horizon (0°, airless) — consistent with `bodies.horizontal()` which is airless by
// contract; true refracted sunrise (−0.833°) is deliberately NOT modelled (≤ ~4 min shift).
//
// All functions are pure (explicit epoch ms in, no Date.now()) and cheap enough to recompute on
// scrubber-window changes (~300 `horizontal()` calls per 24 h window; sub-ms each) — consumers
// memoise per (window, lat, lon), never per frame.

import { horizontal } from "./bodies";

/** Sun-altitude thresholds (deg, geometric/airless) — literature constants, not taste. */
export const TWILIGHT_DEG = {
  day: 0,
  civil: -6,
  nautical: -12,
  astro: -18,
} as const;

/** Darkness phases, brightest → darkest. "civil" = the civil-twilight band (−6°..0°), etc. */
export type TwilightPhase = "day" | "civil" | "nautical" | "astro" | "night";

/** Phase boundaries in descending altitude order; a 5-min sample step can cross at most one
 *  (max sun altitude rate ≈ 0.25°/min ⇒ ≤ 1.25°/step, bands are 6° tall). */
const PHASE_ORDER: readonly TwilightPhase[] = ["day", "civil", "nautical", "astro", "night"];

function phaseOfAlt(altDeg: number): TwilightPhase {
  if (altDeg >= TWILIGHT_DEG.day) return "day";
  if (altDeg >= TWILIGHT_DEG.civil) return "civil";
  if (altDeg >= TWILIGHT_DEG.nautical) return "nautical";
  if (altDeg >= TWILIGHT_DEG.astro) return "astro";
  return "night";
}

/** Sun altitude (deg, airless) — the one sampler everything in this module derives from. */
export function sunAltDeg(utcMs: number, latDeg: number, lonDeg: number): number {
  return horizontal("sun", utcMs, latDeg, lonDeg).altDeg;
}

export function twilightPhaseAt(utcMs: number, latDeg: number, lonDeg: number): TwilightPhase {
  return phaseOfAlt(sunAltDeg(utcMs, latDeg, lonDeg));
}

export interface TwilightSegment {
  startMs: number;
  endMs: number;
  phase: TwilightPhase;
}

const COARSE_STEP_MS = 5 * 60_000;
const REFINE_TOL_MS = 1_000;

/** The altitude threshold separating two adjacent phases (for boundary refinement). */
function boundaryAltDeg(a: TwilightPhase, b: TwilightPhase): number {
  const darker = PHASE_ORDER[Math.max(PHASE_ORDER.indexOf(a), PHASE_ORDER.indexOf(b))];
  // The boundary above the darker phase: night→astro at −18, astro→nautical at −12, …
  if (darker === "night") return TWILIGHT_DEG.astro;
  if (darker === "astro") return TWILIGHT_DEG.nautical;
  if (darker === "nautical") return TWILIGHT_DEG.civil;
  return TWILIGHT_DEG.day; // darker === "civil" (day|civil boundary)
}

/**
 * Partition [startMs, endMs] into contiguous twilight segments for an observer. Segments tile the
 * window exactly (first startMs = startMs, last endMs = endMs, no gaps). Boundaries are bisected
 * to ≤ 1 s. Polar edge cases fall out naturally (midnight sun → one "day" segment).
 */
export function twilightSegments(
  startMs: number,
  endMs: number,
  latDeg: number,
  lonDeg: number,
): TwilightSegment[] {
  if (!(endMs > startMs)) return [];
  const segments: TwilightSegment[] = [];
  let segStart = startMs;
  let prevPhase = twilightPhaseAt(startMs, latDeg, lonDeg);
  let prevT = startMs;
  for (let t = startMs + COARSE_STEP_MS; ; t = Math.min(t + COARSE_STEP_MS, endMs)) {
    const clamped = Math.min(t, endMs);
    const phase = twilightPhaseAt(clamped, latDeg, lonDeg);
    if (phase !== prevPhase) {
      const crossing = refineCrossing(prevT, clamped, boundaryAltDeg(prevPhase, phase), latDeg, lonDeg);
      segments.push({ startMs: segStart, endMs: crossing, phase: prevPhase });
      segStart = crossing;
      prevPhase = phase;
    }
    prevT = clamped;
    if (clamped >= endMs) break;
  }
  segments.push({ startMs: segStart, endMs, phase: prevPhase });
  return segments;
}

/** Bisect the time where the sun crosses `altDeg` between t0 and t1 (altitudes straddle it). */
function refineCrossing(
  t0: number,
  t1: number,
  altDeg: number,
  latDeg: number,
  lonDeg: number,
): number {
  let lo = t0;
  let hi = t1;
  const loAbove = sunAltDeg(lo, latDeg, lonDeg) >= altDeg;
  while (hi - lo > REFINE_TOL_MS) {
    const mid = (lo + hi) / 2;
    if (sunAltDeg(mid, latDeg, lonDeg) >= altDeg === loAbove) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

// ── Full light phases (QoL-1 scrubber v2, PLANNING_QOL_PLAN §3.1.A) ───────────────────────────
//
// The photographic partition: golden hour = sun −4°..+6°, blue hour = −6°..−4° (the standard
// PhotoPills-era convention). Together with the USNO twilight floors this tiles every altitude:
// day > +6° > golden > −4° > blue > −6° > nautical > −12° > astro > −18° > night.
// DELIBERATELY NOT derived from the render GOLDEN bell (goldenElevationsDeg spans −6.5°..+15.4°
// as measured 2026-08-14) — that curve is a widened scene-grading device, not the photographer's
// golden hour; painting it as a band would label most of a summer day "golden".

/** Sun-altitude edges of the photographic light phases (deg, geometric/airless). */
export const LIGHT_DEG = {
  goldenHi: 6,
  goldenLo: -4,
  blue: -6,
  nautical: -12,
  astro: -18,
} as const;

/** Light phases, brightest → darkest — the scrubber v2 band vocabulary. */
export type LightPhase = "day" | "golden" | "blue" | "nautical" | "astro" | "night";

const LIGHT_ORDER: readonly LightPhase[] = ["day", "golden", "blue", "nautical", "astro", "night"];
/** LIGHT_BOUNDS[i] separates LIGHT_ORDER[i] (above) from LIGHT_ORDER[i+1] (below). */
const LIGHT_BOUNDS: readonly number[] = [
  LIGHT_DEG.goldenHi,
  LIGHT_DEG.goldenLo,
  LIGHT_DEG.blue,
  LIGHT_DEG.nautical,
  LIGHT_DEG.astro,
];

function lightIndexOfAlt(altDeg: number): number {
  for (let i = 0; i < LIGHT_BOUNDS.length; i++) if (altDeg >= LIGHT_BOUNDS[i]) return i;
  return LIGHT_ORDER.length - 1;
}

/** Point query: the photographic light phase at one instant (QoL-2 frameFinder annotations). */
export function lightPhaseAt(utcMs: number, latDeg: number, lonDeg: number): LightPhase {
  return LIGHT_ORDER[lightIndexOfAlt(sunAltDeg(utcMs, latDeg, lonDeg))];
}

export interface LightSegment {
  startMs: number;
  endMs: number;
  phase: LightPhase;
}

/**
 * Partition [startMs, endMs] into contiguous LIGHT phases (the twilightSegments contract: exact
 * tiling, ≤1 s boundaries, polar cases degenerate naturally). One coarse step can cross MORE
 * than one boundary here (blue is only 2° tall) — every crossed boundary is refined in order so
 * the sliver segments are never skipped.
 */
export function lightSegments(
  startMs: number,
  endMs: number,
  latDeg: number,
  lonDeg: number,
): LightSegment[] {
  if (!(endMs > startMs)) return [];
  const out: LightSegment[] = [];
  let segStart = startMs;
  let prevIdx = lightIndexOfAlt(sunAltDeg(startMs, latDeg, lonDeg));
  let prevT = startMs;
  for (let t = startMs + COARSE_STEP_MS; ; t = Math.min(t + COARSE_STEP_MS, endMs)) {
    const clamped = Math.min(t, endMs);
    const idx = lightIndexOfAlt(sunAltDeg(clamped, latDeg, lonDeg));
    if (idx !== prevIdx) {
      const dir = idx > prevIdx ? 1 : -1;
      let lo = prevT;
      for (let j = prevIdx; j !== idx; j += dir) {
        const boundAlt = LIGHT_BOUNDS[dir > 0 ? j : j - 1];
        const crossing = refineCrossing(lo, clamped, boundAlt, latDeg, lonDeg);
        out.push({ startMs: segStart, endMs: crossing, phase: LIGHT_ORDER[j] });
        segStart = crossing;
        lo = crossing;
      }
      prevIdx = idx;
    }
    prevT = clamped;
    if (clamped >= endMs) break;
  }
  out.push({ startMs: segStart, endMs, phase: LIGHT_ORDER[prevIdx] });
  return out;
}

/** Astronomical-darkness windows (sun < −18°) inside [startMs, endMs] — the P3 darkness gate. */
export function darkWindows(
  startMs: number,
  endMs: number,
  latDeg: number,
  lonDeg: number,
): Array<{ startMs: number; endMs: number }> {
  return twilightSegments(startMs, endMs, latDeg, lonDeg)
    .filter((s) => s.phase === "night")
    .map(({ startMs: s, endMs: e }) => ({ startMs: s, endMs: e }));
}
