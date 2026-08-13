// Milky-Way season calendar + darkness score (Phase 8a P3) — pure, three-free.
//
// Per LOCAL night: the best Galactic-Centre window (`targetWindows` with sun < −18° = the
// astronomical-darkness gate, GC above a low open-sky floor — GC peaks at only ~12.5° from
// Dnipro), moon interference from the K&S relative-irradiance curve (`moonlight.ts`, full
// moon = 1) sampled at the window peak, and
//
//   score = usable darkness minutes × (1 − moon interference)
//
// CONVENTION NOTE: this deliberately differs from planner's `finishWindow` score (the ad-hoc
// `0.8·illum·√sin(moonAlt)` penalty behind TargetPanel's ★ bars). This module is the ONE
// definition for the MW-season surface; the two scores are not comparable and never mix.
// Window edges are step-quantized (planner contract) — minutes are understated by ≤ stepMin.

import { MakeTime } from "astronomy-engine";
import { bodyStatesAt, ecefFrameAt, horizontal } from "./bodies";
import { localDayWindow } from "./dayArc";
import { azAltToEnu } from "./dayArc";
import { moonPhaseIntensity } from "./moonlight";
import { targetWindows, type PlanObserver } from "./planner";
import { galacticToEquatorial } from "./stars";
import { topoAzAlt } from "./topo";
import type { SkyTarget } from "./targets";

/** Astronomical darkness — the P3 gate (planner's default is −15°; MW work wants true dark). */
export const MW_DARK_SUN_DEG = -18;
/** Open-sky floor for the GC (deg) — it never climbs past ~12.5° from ~48°N. */
export const MW_MIN_ALT_DEG = 5;

export interface MwNight {
  /** Start of the local solar day whose EVENING begins this night (localDayWindow anchor). */
  dayStartMs: number;
  /** Longest qualifying window of the night, or null (out of season / moon-independent). */
  window: {
    startMs: number;
    endMs: number;
    peakMs: number;
    peakAltDeg: number;
    peakAzDeg: number;
  } | null;
  usableMinutes: number;
  /** 0..1 — K&S relative lunar irradiance at the window peak while the moon is up, else 0.
   *  No altitude scaling: a risen moon counts at its phase weight (documented choice). */
  moonInterference: number;
  /** usableMinutes × (1 − moonInterference); 0 when no window. */
  score: number;
}

export interface MwSeasonOptions {
  /** Nights to scan (default 14 — two moon quarters of calendar). */
  days?: number;
  /** Sample step (min, default 15 — the TargetPanel windows cadence). */
  stepMin?: number;
  minAltDeg?: number;
}

/**
 * One row per local night from the night containing/after `fromMs`. Cost ≈ days × the planner's
 * documented ~1–2 ms/night scan — memoise per (day, anchor) in consumers, never per frame.
 */
export function mwSeason(
  fromMs: number,
  observer: PlanObserver,
  target: SkyTarget,
  opts: MwSeasonOptions = {},
): MwNight[] {
  const days = opts.days ?? 14;
  const stepMin = opts.stepMin ?? 15;
  const minAltDeg = opts.minAltDeg ?? MW_MIN_ALT_DEG;
  const nights: MwNight[] = [];
  const DAY_MS = 24 * 3600_000;
  for (let i = 0; i < days; i++) {
    const day = localDayWindow(fromMs + i * DAY_MS, observer.lonDeg);
    // Scan noon→noon so one call covers exactly one night (windows never straddle local noon).
    const noonMs = day.startMs + DAY_MS / 2;
    const wins = targetWindows(noonMs, observer, target, {
      days: 1,
      stepMin,
      darkSunDeg: MW_DARK_SUN_DEG,
      minAltDeg,
      limit: 4,
    });
    const best = wins.reduce<(typeof wins)[number] | null>(
      (a, w) => (a == null || w.endMs - w.startMs > a.endMs - a.startMs ? w : a),
      null,
    );
    if (!best) {
      nights.push({
        dayStartMs: day.startMs,
        window: null,
        usableMinutes: 0,
        moonInterference: 0,
        score: 0,
      });
      continue;
    }
    const moonUp = horizontal("moon", best.peakMs, observer.latDeg, observer.lonDeg).altDeg > 0;
    const interference = moonUp
      ? moonPhaseIntensity(bodyStatesAt(best.peakMs).moonPhaseAngleDeg)
      : 0;
    const usableMinutes = (best.endMs - best.startMs) / 60_000;
    nights.push({
      dayStartMs: day.startMs,
      window: {
        startMs: best.startMs,
        endMs: best.endMs,
        peakMs: best.peakMs,
        peakAltDeg: best.peakAltDeg,
        peakAzDeg: best.peakAzDeg,
      },
      usableMinutes,
      moonInterference: interference,
      score: usableMinutes * (1 - interference),
    });
  }
  return nights;
}

/** Az/alt of the galactic-equator point at longitude l, J2000 → of-date → observer ENU. */
function bandAzAlt(lDeg: number, utcMs: number, latDeg: number, lonDeg: number) {
  const [x, y, z] = galacticToEquatorial(lDeg, 0);
  const [ex, ey, ez] = ecefFrameAt(MakeTime(new Date(utcMs))).toEcef({ x, y, z });
  return topoAzAlt([ex, ey, ez], null, latDeg, lonDeg, 0);
}

/**
 * Tilt of the Milky-Way arc vs the horizon (deg, 0 = lying flat, 90 = standing vertical) at the
 * band point of galactic longitude `lDeg` (default 0 = the Galactic Centre) — the "arc tilt at
 * time T" readout (PhotoPills only reveals this by manual scrubbing). Computed as the angle
 * between the galactic equator's local great-circle tangent (projected into the observer's sky)
 * and the horizontal plane.
 */
export function mwArcTiltDeg(utcMs: number, latDeg: number, lonDeg: number, lDeg = 0): number {
  const EPS_DEG = 1;
  const a = bandAzAlt(lDeg - EPS_DEG, utcMs, latDeg, lonDeg);
  const b = bandAzAlt(lDeg + EPS_DEG, utcMs, latDeg, lonDeg);
  const va = azAltToEnu(a.azDeg, a.altDeg);
  const vb = azAltToEnu(b.azDeg, b.altDeg);
  // Tangent of the great circle at the midpoint: remove the radial component of the chord.
  const mid: [number, number, number] = [va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]];
  const ml = Math.hypot(...mid);
  const m = [mid[0] / ml, mid[1] / ml, mid[2] / ml];
  const chord = [vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]];
  const cm = chord[0] * m[0] + chord[1] * m[1] + chord[2] * m[2];
  const t = [chord[0] - cm * m[0], chord[1] - cm * m[1], chord[2] - cm * m[2]];
  const tl = Math.hypot(...t);
  if (tl === 0) return 0;
  // ENU z = up: the tangent's vertical share is the sine of the tilt.
  return (Math.asin(Math.min(1, Math.abs(t[2]) / tl)) * 180) / Math.PI;
}
