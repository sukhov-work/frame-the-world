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

/** One side of a day's rise / set: the instant and how many CLOCK days after the row's day it falls on
 *  (0 = today, 1 = tomorrow — the flights' "+1" arrival notation). */
export interface DayEvent {
  ms: number;
  dayOffset: number;
}
export interface DayRiseSet {
  rise: DayEvent | null;
  set: DayEvent | null;
  /** The clock day [start, end) the pair was solved for (browser-local midnight to midnight). */
  dayStartMs: number;
  dayEndMs: number;
}

const DAY_MS = 86_400_000;

/** The BROWSER-LOCAL calendar day [start, end) holding `ms` — the day of the clock the /m row prints
 *  (`localTimeStr`), midnight to midnight, DST-safe (a 23 / 25 h day keeps its true end). Deliberately NOT
 *  `dayArc.localDayWindow` (the planner's whole-hour SOLAR day at the observer's longitude: Dnipro's starts
 *  at 01:00 on a summer clock) — the owner's rule is the clock's midnight. */
export function clockDayWindow(ms: number): { startMs: number; endMs: number } {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const startMs = d.getTime();
  const e = new Date(startMs);
  e.setDate(e.getDate() + 1);
  return { startMs, endMs: e.getTime() };
}

/**
 * THE DAY'S rise and set of `target` — the clock day's own events, not the next ones (owner 2026-10-25c:
 * "until the end of the day, so until 00:00, keep calculating all pairs for the CURRENT day; if the moon
 * rises today but sets tomorrow, add a micro indication like (+1)").
 *
 * Why the row printed tomorrow's times before: it was built on `nextRiseSet` — the ALMANAC "next event"
 * semantics of 2026-09-16 ("the object's NEXT rise ↑ and NEXT set ↓"), a watch's "next alarm": strictly
 * after scene time. At 15:00 the sun's next rise is tomorrow's, and once the moon is up its next rise is
 * tomorrow's 16:08 while today's 15:45 has already happened. A timetable reads the other way: today's
 * rise even if it has passed, today's set, and a "+1" where the set (or the rise) only comes tomorrow.
 *
 * Each side is the FIRST event at or after the day's start within 48 h (two days always hold one of each
 * when they exist — a moonrise can skip a calendar day); an event past the day's end carries the number
 * of clock days it lies ahead. Null when the object never crosses in the window (circumpolar / never up).
 */
export function dayRiseSet(
  target: SkyTarget,
  nowMs: number,
  latDeg: number,
  lonDeg: number,
  opts: RiseSetOptions = {},
): DayRiseSet {
  const { startMs, endMs } = clockDayWindow(nowMs);
  // `nextRiseSet` is strictly-after: a crossing exactly at midnight is still today's.
  const rs = nextRiseSet(target, startMs - 1, latDeg, lonDeg, { scanHours: 48, ...opts });
  const tag = (ms: number | null): DayEvent | null =>
    ms === null
      ? null
      : { ms, dayOffset: ms < endMs ? 0 : Math.round((clockDayWindow(ms).startMs - startMs) / DAY_MS) };
  return { rise: tag(rs.riseMs), set: tag(rs.setMs), dayStartMs: startMs, dayEndMs: endMs };
}
