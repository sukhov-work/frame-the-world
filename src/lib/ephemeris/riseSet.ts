/**
 * NEXT RISE / NEXT SET of any SkyTarget (owner 2026-09-16 — the /m target peek's two small
 * stacked times). Almanac semantics, the way every planning app prints them:
 *   · sun / moon — astronomy-engine's own `SearchRiseSet` (34′ refraction + the disc's radius +
 *     the eye-height dip), the SAME call the LIGHT PLANNER's SUNRISE / MOONSET chips make
 *     (`planner.dayEvents`), through the same `planElevationsM` clamp — so the peek and the dock
 *     never print two different sunrises;
 *   · everything else (planets, comets, asteroids, stars, DSOs, radiants) — the first crossings
 *     of the REFRACTED horizon (`HORIZON_ALT_DEG`, −34′: a point source has no radius) found by
 *     scanning `targetAzAlt` — the one topocentric face the marker, the trail and the panel read
 *     — at `SCAN_STEP_MIN`, then bisected to the second.
 *
 * "Next" means strictly after `fromMs`, within `scanHours`. An object that never crosses in the
 * window (circumpolar from this latitude, or never up) reports null for that side; the UI shows
 * an em dash. Pure and three-free.
 */

import { Body, Observer, SearchRiseSet } from "astronomy-engine";
import { targetAzAlt, type SkyTarget } from "./targets";
import { planElevationsM } from "./planner";

/** Refracted geometric horizon for a POINT source (deg): the standard 34′ of refraction. */
export const HORIZON_ALT_DEG = -34 / 60;
/** Scan step (min). The horizon crossing is bracketed at this resolution, then bisected —
 *  8-min scans at planning latitudes never skip a crossing (the moon's fastest altitude rate is
 *  ~15°/h; a bracket needs a sign change, not accuracy). */
const SCAN_STEP_MIN = 10;
/** Bisection depth: 600 s / 2¹⁶ ≈ 9 ms — well under the minute the readout prints. */
const BISECT_STEPS = 16;

export interface RiseSet {
  /** Next rise strictly after `fromMs` (UTC ms) — null when none in the window. */
  riseMs: number | null;
  /** Next set strictly after `fromMs` (UTC ms) — null when none in the window. */
  setMs: number | null;
}

export interface RiseSetOptions {
  /** How far ahead to look (h). Default 48: a same-latitude object rises once a day, and a
   *  moonrise can skip a calendar day — two days always holds one of each when they exist. */
  scanHours?: number;
  /** Observer ground height above the ellipsoid (m) — parallax only; default sea level. */
  groundAltM?: number;
  /** Eye above ground (m) — the sun/moon dip term (the planner's 1.6 m pedestrian default). */
  eyeAboveGroundM?: number;
}

/** True for the two disc bodies astronomy-engine has its own rise/set finder for. */
function sunMoonBody(target: SkyTarget): Body | null {
  if (target.kind === "sun") return Body.Sun;
  if (target.kind === "moon") return Body.Moon;
  return null;
}

/**
 * The next rise and the next set of `target` after `fromMs` for an observer at lat/lon.
 */
export function nextRiseSet(
  target: SkyTarget,
  fromMs: number,
  latDeg: number,
  lonDeg: number,
  opts: RiseSetOptions = {},
): RiseSet {
  const scanHours = opts.scanHours ?? 48;
  const body = sunMoonBody(target);
  if (body !== null) {
    // The planner's normalisation (T32): the clamped observer AND the eye it may subtract come
    // from ONE writer, so `obsM − eyeM` is inside the library's band by construction.
    const { obsM, eyeM } = planElevationsM({
      latDeg,
      lonDeg,
      groundAltM: opts.groundAltM ?? 0,
      eyeAboveGroundM: opts.eyeAboveGroundM ?? 1.6,
    });
    const obs = new Observer(latDeg, lonDeg, obsM);
    const start = new Date(fromMs);
    const days = scanHours / 24;
    const find = (dir: 1 | -1): number | null =>
      SearchRiseSet(body, obs, dir, start, days, eyeM)?.date.getTime() ?? null;
    return { riseMs: find(1), setMs: find(-1) };
  }
  return scanCrossings(target, fromMs, latDeg, lonDeg, scanHours);
}

/** Refracted altitude of a point target above the horizon datum (deg; > 0 = up). */
const altAbove = (target: SkyTarget, t: number, latDeg: number, lonDeg: number): number =>
  targetAzAlt(target, t, latDeg, lonDeg).altDeg - HORIZON_ALT_DEG;

function scanCrossings(
  target: SkyTarget,
  fromMs: number,
  latDeg: number,
  lonDeg: number,
  scanHours: number,
): RiseSet {
  const stepMs = SCAN_STEP_MIN * 60_000;
  const endMs = fromMs + scanHours * 3_600_000;
  let riseMs: number | null = null;
  let setMs: number | null = null;
  let tPrev = fromMs;
  let aPrev = altAbove(target, tPrev, latDeg, lonDeg);
  for (let t = fromMs + stepMs; t <= endMs + 1 && (riseMs === null || setMs === null); t += stepMs) {
    const a = altAbove(target, t, latDeg, lonDeg);
    // A sign change (or a landing exactly on the datum) brackets a crossing; the direction of
    // the altitude tells rise from set. `aPrev <= 0 < a` keeps a rise that starts exactly on
    // the horizon (the object was "not up" at fromMs, so its rise is the next event).
    if (riseMs === null && aPrev <= 0 && a > 0) riseMs = bisect(target, tPrev, t, latDeg, lonDeg, 1);
    if (setMs === null && aPrev > 0 && a <= 0) setMs = bisect(target, tPrev, t, latDeg, lonDeg, -1);
    tPrev = t;
    aPrev = a;
  }
  return { riseMs, setMs };
}

/** Bisect the bracket [t0, t1] onto the datum; `dir` +1 = altitude rising through it. */
function bisect(
  target: SkyTarget,
  t0: number,
  t1: number,
  latDeg: number,
  lonDeg: number,
  dir: 1 | -1,
): number {
  let lo = t0;
  let hi = t1;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    const a = altAbove(target, mid, latDeg, lonDeg) * dir;
    // For a rise (dir +1) the altitude is ≤ 0 at lo and > 0 at hi; a set mirrors through dir.
    if (a > 0) hi = mid;
    else lo = mid;
  }
  return Math.round((lo + hi) / 2);
}
