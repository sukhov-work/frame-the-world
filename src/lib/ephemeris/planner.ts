/**
 * "When is the light right" planner (Pass 3 WS4-C — the PhotoPills/Stellarium moat, ADR D6).
 *
 * Pure event finders over the SAME ephemeris as the scene (astronomy-engine; never a second
 * ephemeris — dayArc.ts rule). Two layers:
 *   · astronomy-engine's own root-finders for the almanac events — `SearchRiseSet` (refraction
 *     + body radius + eye-height dip), `SearchAltitude` (geometric sun elevation → golden/civil
 *     boundaries, matching the GLSL golden bell which is also geometric), `SearchHourAngle`
 *     (culminations — SearchAltitude is documented-unreliable near extremes), `SearchMoonPhase`;
 *   · an own scan+bisect for the skyline crossings `altDeg(t) = profile(azDeg(t))` — the money
 *     feature "when does the sun/moon clear that actual rooftop", with the profile injected as a
 *     plain function so this stays decoupled from lib/geo.
 *
 * Times are UTC epoch ms in and out. TRAP (bodies.ts:13): astronomy-engine's `MakeTime(number)`
 * reads J2000 DAYS — every entry point wraps `new Date(ms)`.
 *
 * Golden-hour thresholds are DERIVED from the scene's own `GoldenCurve` (tuning.GOLDEN): the
 * bell is smoothstep-in × (1−smoothstep-out) over sin(elevation), so bell = 0.5 exactly at the
 * two band midpoints — chips land where the render actually turns golden.
 */

import {
  Body,
  Observer,
  SearchAltitude,
  SearchHourAngle,
  SearchMoonPhase,
  SearchRiseSet,
} from "astronomy-engine";
import { bodyStatesAt, horizontal, type AzAlt } from "./bodies";
import { cometAzAlt, TEMPEL2, type CometProfile } from "./comet";
import { targetAzAlt, type SkyTarget } from "./targets";
import { localDayWindow } from "./dayArc";
import type { GoldenCurve } from "./golden";

export type PlanBody = "sun" | "moon";

export type PlanEventKind =
  | "sunrise"
  | "sunset"
  | "civilDawn"
  | "civilDusk"
  | "goldenAmStart"
  | "goldenAmEnd"
  | "goldenPmStart"
  | "goldenPmEnd"
  | "sunNoon"
  | "moonrise"
  | "moonset"
  | "moonCulmination"
  | "fullMoon"
  | "newMoon";

export interface PlanEvent {
  kind: PlanEventKind;
  utcMs: number;
  body: PlanBody;
  /** Body az/alt at the event instant (airless topocentric — annotation for the chip UI). */
  azDeg: number;
  altDeg: number;
}

export interface PlanObserver {
  latDeg: number;
  lonDeg: number;
  /** Anchor ground elevation (m, the rendered-terrain datum) — Observer height for parallax. */
  groundAltM: number;
  /** Eye above the ground (m) — drives the rise/set horizon dip. */
  eyeAboveGroundM: number;
}

/** Civil twilight boundary (deg, geometric sun elevation). */
export const CIVIL_TWILIGHT_DEG = -6;

const toObserver = (o: PlanObserver): Observer =>
  new Observer(o.latDeg, o.lonDeg, Math.max(-400, o.groundAltM + o.eyeAboveGroundM));

const DEG = 180 / Math.PI;

/** The sun elevations (deg) where the golden bell crosses 0.5 — rising edge `loDeg`, falling
 *  edge `hiDeg`. Curve fields are SINES of elevation (tuning.GOLDEN contract). */
export function goldenElevationsDeg(c: GoldenCurve): { loDeg: number; hiDeg: number } {
  return {
    loDeg: Math.asin((c.fadeInLo + c.fadeInHi) / 2) * DEG,
    hiDeg: Math.asin((c.fadeOutLo + c.fadeOutHi) / 2) * DEG,
  };
}

function annotate(kind: PlanEventKind, body: PlanBody, utcMs: number, o: PlanObserver): PlanEvent {
  const pos = horizontal(body, utcMs, o.latDeg, o.lonDeg);
  return { kind, utcMs, body, azDeg: pos.azDeg, altDeg: pos.altDeg };
}

/**
 * All almanac chips for the LOCAL SOLAR DAY containing `sceneUtcMs` (the dayArc window — same
 * convention the scrubber's EXIF seeding uses). Finders that find nothing in the window (polar
 * day/night, sun never reaching the golden ceiling, moon skipping a rise) simply contribute no
 * chip. Sorted by time.
 */
export function dayEvents(
  sceneUtcMs: number,
  o: PlanObserver,
  golden: GoldenCurve,
): PlanEvent[] {
  const { startMs, endMs } = localDayWindow(sceneUtcMs, o.lonDeg);
  const obs = toObserver(o);
  const start = new Date(startMs);
  const windowDays = (endMs - startMs) / 86_400_000;
  const events: PlanEvent[] = [];

  const inWindow = (ms: number | undefined | null): ms is number =>
    ms != null && ms >= startMs && ms < endMs;
  const push = (kind: PlanEventKind, body: PlanBody, ms: number | null | undefined) => {
    if (inWindow(ms)) events.push(annotate(kind, body, ms, o));
  };

  const riseSet = (body: Body, dir: 1 | -1): number | null =>
    SearchRiseSet(body, obs, dir, start, windowDays, o.eyeAboveGroundM)?.date.getTime() ?? null;
  push("sunrise", "sun", riseSet(Body.Sun, 1));
  push("sunset", "sun", riseSet(Body.Sun, -1));
  push("moonrise", "moon", riseSet(Body.Moon, 1));
  push("moonset", "moon", riseSet(Body.Moon, -1));

  const sunAlt = (alt: number, dir: 1 | -1): number | null =>
    SearchAltitude(Body.Sun, obs, dir, start, windowDays, alt)?.date.getTime() ?? null;
  push("civilDawn", "sun", sunAlt(CIVIL_TWILIGHT_DEG, 1));
  push("civilDusk", "sun", sunAlt(CIVIL_TWILIGHT_DEG, -1));
  const g = goldenElevationsDeg(golden);
  push("goldenAmStart", "sun", sunAlt(g.loDeg, 1));
  push("goldenAmEnd", "sun", sunAlt(g.hiDeg, 1));
  push("goldenPmStart", "sun", sunAlt(g.hiDeg, -1));
  push("goldenPmEnd", "sun", sunAlt(g.loDeg, -1));

  push("sunNoon", "sun", SearchHourAngle(Body.Sun, obs, 0, start).time.date.getTime());
  push("moonCulmination", "moon", SearchHourAngle(Body.Moon, obs, 0, start).time.date.getTime());

  return events.sort((a, b) => a.utcMs - b.utcMs);
}

/** Next full and new moon after the scene instant (chips beyond the day window). */
export function moonPhaseEvents(sceneUtcMs: number, o: PlanObserver): PlanEvent[] {
  const start = new Date(sceneUtcMs);
  const events: PlanEvent[] = [];
  const full = SearchMoonPhase(180, start, 40)?.date.getTime();
  const nw = SearchMoonPhase(0, start, 40)?.date.getTime();
  if (full != null) events.push(annotate("fullMoon", "moon", full, o));
  if (nw != null) events.push(annotate("newMoon", "moon", nw, o));
  return events.sort((a, b) => a.utcMs - b.utcMs);
}

// ---------------------------------------------------------------------------------------------
// Target observing windows — "when is my next session on X" (2026-08-02 for the comet;
// generalised to any SkyTarget 2026-08-03, ASTRO ENGINE phase A)
// ---------------------------------------------------------------------------------------------

/** One dark-sky window where the target stands above the observer's minimum altitude. */
export interface TargetWindow {
  /** Window bounds (UTC ms) — sun below `darkSunDeg` AND target above `minAltDeg`. */
  startMs: number;
  endMs: number;
  /** Best instant inside the window (target culmination, or a clipped edge). */
  peakMs: number;
  peakAltDeg: number;
  peakAzDeg: number;
  /** Predicted magnitude at the peak — null when the target carries no brightness model. */
  magnitude: number | null;
  /** Moon altitude (deg) and illuminated fraction at the peak — the interference read. */
  moonAltDeg: number;
  moonIllum: number;
  /** 0..1 session quality: altitude × moon interference × how long the window lasts. */
  score: number;
}

/** Back-compat name from the 2026-08-02 comet session — same shape. */
export type CometWindow = TargetWindow;

export interface TargetWindowOptions {
  /** How many days ahead to scan. */
  days?: number;
  /** Sample cadence (minutes) — also the window-edge granularity. */
  stepMin?: number;
  /** Sun must be BELOW this altitude (deg). −15 ≈ deep nautical dark; −18 = astronomical. */
  darkSunDeg?: number;
  /** Target must be ABOVE this altitude (deg) — the open-sky floor before any skyline profile. */
  minAltDeg?: number;
  /** Stop after this many windows. */
  limit?: number;
}

export interface CometWindowOptions extends TargetWindowOptions {
  profile?: CometProfile;
}

/** Altitude (deg) at which a window scores a full altitude mark (10P culminates low from 48°N —
 *  a generous full-mark bar keeps low-declination targets honestly scoreable). */
const WINDOW_ALT_FULL_DEG = 30;
/** A window this long (hours) scores full on duration. */
const WINDOW_DURATION_FULL_H = 3;

/** One topocentric sample of whatever the scan is hunting — injected so the scan itself stays
 *  provider-agnostic (the plan's "never a second ephemeris" rule applies to the SAMPLER). */
type WindowSample = { azDeg: number; altDeg: number; magnitude: number | null };

/**
 * Next dark-sky windows on a target for an observer. A pure forward scan (no root-finder: kepler
 * and fixed targets are not astronomy-engine bodies, and 10-minute granularity is finer than any
 * real observing plan) over the SAME topocentric ephemeris the panel and the scene read.
 *
 * Cost is ~1 sun evaluation per step plus a target evaluation only while it is dark — a 10-day /
 * 10-minute scan is a few tens of ms, which is why callers memoize it per anchor+day.
 */
function scanWindows(
  fromMs: number,
  o: PlanObserver,
  opts: TargetWindowOptions,
  sample: (utcMs: number, eyeM: number) => WindowSample,
): TargetWindow[] {
  const days = opts.days ?? 10;
  const stepMs = (opts.stepMin ?? 10) * 60_000;
  const darkSunDeg = opts.darkSunDeg ?? -15;
  const minAltDeg = opts.minAltDeg ?? 5;
  const limit = opts.limit ?? 6;
  const eyeM = o.groundAltM + o.eyeAboveGroundM;

  const out: TargetWindow[] = [];
  let open: TargetWindow | null = null;
  const endScanMs = fromMs + days * 86_400_000;

  for (let t = fromMs; t <= endScanMs && out.length < limit; t += stepMs) {
    const dark = horizontal("sun", t, o.latDeg, o.lonDeg).altDeg < darkSunDeg;
    const c = dark ? sample(t, eyeM) : null;
    const up = c != null && c.altDeg > minAltDeg;
    if (up && c) {
      if (!open) {
        open = {
          startMs: t,
          endMs: t,
          peakMs: t,
          peakAltDeg: -90,
          peakAzDeg: 0,
          magnitude: c.magnitude,
          moonAltDeg: 0,
          moonIllum: 0,
          score: 0,
        };
      }
      open.endMs = t;
      if (c.altDeg > open.peakAltDeg) {
        open.peakAltDeg = c.altDeg;
        open.peakAzDeg = c.azDeg;
        open.peakMs = t;
        open.magnitude = c.magnitude;
      }
    } else if (open) {
      out.push(finishWindow(open, o));
      open = null;
    }
  }
  if (open && out.length < limit) out.push(finishWindow(open, o));
  return out;
}

/** Dark-sky windows on any SkyTarget — the generic face (TargetPanel's NEXT SESSIONS). */
export function targetWindows(
  fromMs: number,
  o: PlanObserver,
  target: SkyTarget,
  opts: TargetWindowOptions = {},
): TargetWindow[] {
  return scanWindows(fromMs, o, opts, (t, eyeM) => {
    const s = targetAzAlt(target, t, o.latDeg, o.lonDeg, eyeM);
    return { azDeg: s.azDeg, altDeg: s.altDeg, magnitude: s.state.magnitude };
  });
}

/** The 2026-08-02 comet face, kept verbatim-compatible (comet.test.ts locks it). */
export function cometWindows(
  fromMs: number,
  o: PlanObserver,
  opts: CometWindowOptions = {},
): CometWindow[] {
  const profile = opts.profile ?? TEMPEL2;
  return scanWindows(fromMs, o, opts, (t, eyeM) =>
    cometAzAlt(t, o.latDeg, o.lonDeg, eyeM, profile),
  );
}

function finishWindow(w: TargetWindow, o: PlanObserver): TargetWindow {
  const moon = horizontal("moon", w.peakMs, o.latDeg, o.lonDeg);
  const moonIllum = bodyStatesAt(w.peakMs).moonIllumination;
  // A moon below the horizon costs nothing; above it, the penalty follows brightness × how high
  // it stands (a low gibbous scatters far less sky glow than the same moon at the zenith).
  const moonFactor =
    moon.altDeg <= 0
      ? 1
      : 1 - 0.8 * moonIllum * Math.sqrt(Math.sin(Math.min(90, moon.altDeg) * (Math.PI / 180)));
  const altScore = Math.min(1, Math.max(0, w.peakAltDeg / WINDOW_ALT_FULL_DEG));
  const durationH = (w.endMs - w.startMs) / 3_600_000;
  const durationScore = Math.min(1, durationH / WINDOW_DURATION_FULL_H);
  return {
    ...w,
    moonAltDeg: moon.altDeg,
    moonIllum,
    score: altScore * moonFactor * (0.5 + 0.5 * durationScore),
  };
}

// ---------------------------------------------------------------------------------------------
// Skyline crossings — WS4-C's "body clears the REAL skyline" over the cached horizon profile
// ---------------------------------------------------------------------------------------------

/** Skyline elevation (deg) at an azimuth — `sampleProfile` bound to the cached profile. */
export type ProfileSampleFn = (azDeg: number) => number;

export interface SkylineState {
  /** Body vs skyline at the scene instant. */
  blockedNow: boolean;
  azDeg: number;
  altDeg: number;
  /** Skyline elevation at the body's current azimuth (deg). */
  skylineAltDeg: number;
  /** Next emerge/hide crossings after the scene instant, or null within the search horizon. */
  nextClearMs: number | null;
  nextBlockMs: number | null;
}

export interface SkylineSearchOptions {
  /** How far ahead to scan (days). */
  horizonDays?: number;
  /** Coarse scan step (minutes) — crossings shorter than this can be skipped. */
  scanStepMin?: number;
}

/** Topocentric az/alt at an instant — the skyline scan's injected position source (the same
 *  provider-agnostic move `scanWindows` made for the window sampler). */
export type AzAltSampler = (utcMs: number) => AzAlt;

/** Signed clearance: body altitude − skyline altitude at the body's azimuth (deg). */
function clearanceDeg(
  sample: AzAltSampler,
  utcMs: number,
  profile: ProfileSampleFn,
): { c: number; pos: AzAlt } {
  const pos = sample(utcMs);
  return { c: pos.altDeg - profile(pos.azDeg), pos };
}

function bisectCrossing(
  sample: AzAltSampler,
  profile: ProfileSampleFn,
  loMs: number,
  hiMs: number,
  risingToClear: boolean,
): number {
  let lo = loMs;
  let hi = hiMs;
  for (let i = 0; i < 22 && hi - lo > 500; i++) {
    const mid = (lo + hi) / 2;
    const { c } = clearanceDeg(sample, mid, profile);
    const clearAtMid = c > 0;
    if (clearAtMid === risingToClear) hi = mid;
    else lo = mid;
  }
  return Math.round((lo + hi) / 2);
}

/**
 * Where the sampled body stands vs the skyline NOW, plus the next clear/block instants. Coarse
 * scan + bisection (±0.5 s) instead of astronomy-engine `Search` because the profile is a
 * piecewise bin function — no derivative smoothness for its quadratic interpolation to exploit.
 * "Blocked" includes below the open-sky horizon (profile bins floor at the eye-height dip).
 */
export function sampledSkylineState(
  sample: AzAltSampler,
  sceneUtcMs: number,
  profile: ProfileSampleFn,
  opts: SkylineSearchOptions = {},
): SkylineState {
  const horizonMs = (opts.horizonDays ?? 1.5) * 86_400_000;
  const stepMs = (opts.scanStepMin ?? 10) * 60_000;
  const now = clearanceDeg(sample, sceneUtcMs, profile);
  const blockedNow = now.c <= 0;
  let nextClearMs: number | null = null;
  let nextBlockMs: number | null = null;
  let prevMs = sceneUtcMs;
  let prevClear = !blockedNow;
  for (let t = sceneUtcMs + stepMs; t <= sceneUtcMs + horizonMs; t += stepMs) {
    const clear = clearanceDeg(sample, t, profile).c > 0;
    if (clear !== prevClear) {
      const ms = bisectCrossing(sample, profile, prevMs, t, clear);
      if (clear && nextClearMs == null) nextClearMs = ms;
      if (!clear && nextBlockMs == null) nextBlockMs = ms;
      if (nextClearMs != null && nextBlockMs != null) break;
    }
    prevClear = clear;
    prevMs = t;
  }
  return {
    blockedNow,
    azDeg: now.pos.azDeg,
    altDeg: now.pos.altDeg,
    skylineAltDeg: now.pos.altDeg - now.c,
    nextClearMs,
    nextBlockMs,
  };
}

/** Sun/moon vs the skyline — the WS4-C face (planFeed's sun/moon rows), output unchanged. */
export function skylineState(
  body: PlanBody,
  sceneUtcMs: number,
  o: PlanObserver,
  profile: ProfileSampleFn,
  opts: SkylineSearchOptions = {},
): SkylineState {
  return sampledSkylineState(
    (t) => horizontal(body, t, o.latDeg, o.lonDeg),
    sceneUtcMs,
    profile,
    opts,
  );
}

/** Any tracked SkyTarget vs the skyline (ASTRO ENGINE phase E) — same topocentric face the
 *  marker/trail/panel read (`targetAzAlt`), so the verdict can never disagree with the scene. */
export function targetSkylineState(
  target: SkyTarget,
  sceneUtcMs: number,
  o: PlanObserver,
  profile: ProfileSampleFn,
  opts: SkylineSearchOptions = {},
): SkylineState {
  const eyeM = o.groundAltM + o.eyeAboveGroundM;
  return sampledSkylineState(
    (t) => {
      const s = targetAzAlt(target, t, o.latDeg, o.lonDeg, eyeM);
      return { azDeg: s.azDeg, altDeg: s.altDeg };
    },
    sceneUtcMs,
    profile,
    opts,
  );
}
