/**
 * Eclipses — CONTINUOUS per-instant geometry (what the renderer needs) + DISCRETE predictions
 * (what the panel lists). Pure and three-free, like every module here.
 *
 * Two faces, one core:
 *  • `solarEclipseFromDiscs` / `lunarEclipseFromState` take geometry the CALLER already holds, so
 *    the globe can derive the eclipse from the very vectors it draws with — the "never a second
 *    ephemeris" rule (`dayArc.ts` header) taken one step further: not even a second *sample*.
 *  • `solarEclipseAt` / `lunarEclipseAt` wrap them on `bodies.ts` for the panel and the tests.
 *
 * WHY TOPOCENTRIC IS NOT OPTIONAL (the whole reason eclipses never worked here). At the owner's
 * repro instant — 2026-08-12T18:35:22Z from Burgos, the real Spanish totality — the GEOCENTRIC
 * sun/moon separation is 1.006° against radii of 0.263°/0.272°: the discs do not touch at all.
 * The TOPOCENTRIC separation is 0.062° — 88% of the sun covered. Lunar parallax (≈1°) is the same
 * order as the whole phenomenon, so a geocentric eclipse test reports "no eclipse" during totality.
 * `bodyStatesAt().moonDir` is geocentric by contract (bodies.ts:5-9); the SCENE is topocentric only
 * because `scene/sky.ts` re-derives the moon direction as `moonPos − camera.position`.
 *
 * LUNAR eclipses are the mirror case: the Earth's shadow is a geocentric object, so the umbra math
 * takes geocentric vectors and the observer only decides whether the moon is up to watch it.
 *
 * TRAPS (all bought with real debugging elsewhere in this repo — see the header of `bodies.ts`):
 *  • `MakeTime(number)` reads J2000 DAYS, not epoch ms. Every entry point wraps `new Date(ms)`.
 *  • astronomy-engine's eclipse searches throw raw STRINGS, not Errors (`astronomy.js:8775` and
 *    friends) — never read `.message` off a caught value here.
 *  • `SearchLocalSolarEclipse` has an UNBOUNDED `for (;;)` (astronomy.js:8771) where its global and
 *    lunar siblings cap at 12 lunations. Every walker below carries its own iteration cap.
 *  • `LocalSolarEclipseInfo.peak` is an `EclipseEvent` (`.time` is the AstroTime) but
 *    `LunarEclipseInfo.peak` IS the AstroTime — the `Next*` continuation argument differs.
 *  • `sd_*` are SEMI-durations in minutes ("half of the amount of time", astronomy.d.ts:2732-2735),
 *    and 0 means the phase is never reached.
 *  • An ANNULAR eclipse populates `total_begin`/`total_end` and reports obscuration < 1 — the
 *    `kind` discriminates totality, never the presence of the window.
 */

import {
  Body,
  EclipseKind,
  Equator,
  Horizon,
  KM_PER_AU,
  MakeTime,
  NextLocalSolarEclipse,
  NextLunarEclipse,
  Observer,
  SearchLocalSolarEclipse,
  SearchLunarEclipse,
  type LocalSolarEclipseInfo,
  type LunarEclipseInfo,
} from "astronomy-engine";
import {
  angularRadiusRad,
  bodyStatesAt,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  type BodyStates,
} from "./bodies";
import { clampObserverElevationM, type PlanObserver } from "./planner";
import type { Vec3 } from "../geo/projection";

/** IUGG mean equatorial Earth radius (km) — the shadow-cone geometry's only Earth constant. */
export const EARTH_RADIUS_KM = 6_378.137;

/**
 * Danjon/Chauvenet enlargement of the Earth's shadow (the classical 1/50 rule, Meeus
 * *Astronomical Algorithms* ch. 54): the atmosphere makes the geometric umbra ~2% wider. Dropping
 * it shifts the modelled contact times by minutes — with it in, this model's umbral magnitude
 * crosses 1.0 at 06:26Z and 07:31Z for the 2025-03-14 total lunar eclipse, which are the published
 * totality contacts to the minute (see `test/lib/ephemeris/eclipse.test.ts`).
 */
export const SHADOW_ENLARGEMENT = 1.02;

export type SolarEclipsePhase = "none" | "partial" | "annular" | "total";
export type LunarEclipsePhase = "none" | "penumbral" | "partial" | "total";

/* -------------------------------------------------------------------------------------------- */
/* Disc geometry                                                                                  */
/* -------------------------------------------------------------------------------------------- */

/**
 * Fraction of disc A's AREA hidden behind disc B — the circle-circle "lens" formula.
 * `sep`, `rA`, `rB` share any one angular unit. This is the same quantity astronomy-engine calls
 * *obscuration*, and it agrees with the library's own value to <0.003 across the 2025-2028 lunar
 * series (the test pins it).
 *
 * The three regimes matter and are all reachable during a real eclipse:
 *   • disjoint → 0;
 *   • B swallows A (total solar / total lunar) → 1;
 *   • A swallows B (ANNULAR — the moon is smaller than the sun) → the area ratio, never 1.
 */
export function discCoverage(sep: number, rA: number, rB: number): number {
  if (!(rA > 0) || !(rB > 0) || !Number.isFinite(sep)) return 0;
  const d = Math.abs(sep);
  if (d >= rA + rB) return 0;
  if (d <= Math.abs(rA - rB)) return rB >= rA ? 1 : (rB * rB) / (rA * rA);
  const a2 = rA * rA;
  const b2 = rB * rB;
  const d2 = d * d;
  const clamp1 = (x: number) => Math.min(1, Math.max(-1, x));
  const alpha = Math.acos(clamp1((d2 + a2 - b2) / (2 * d * rA)));
  const beta = Math.acos(clamp1((d2 + b2 - a2) / (2 * d * rB)));
  const lens = a2 * (alpha - Math.sin(2 * alpha) / 2) + b2 * (beta - Math.sin(2 * beta) / 2);
  return Math.min(1, lens / (Math.PI * a2));
}

/** Angle (rad) between two unit vectors, via the chord — stable at the sub-arcminute separations
 *  an eclipse lives at, where `acos(dot)` loses most of its float precision. */
export function unitAngleRad(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return 2 * Math.asin(Math.min(1, Math.hypot(dx, dy, dz) / 2));
}

/* -------------------------------------------------------------------------------------------- */
/* Solar — the moon in front of the sun                                                           */
/* -------------------------------------------------------------------------------------------- */

export interface SolarEclipseState {
  phase: SolarEclipsePhase;
  /** Fraction of the sun's DISC AREA hidden, 0..1 — the light-loss driver (astronomy-engine's
   *  "obscuration"). Peaks below 1 for an annular eclipse. */
  coverage: number;
  /** Eclipse MAGNITUDE — the fraction of the sun's DIAMETER covered. Exceeds 1 during totality;
   *  this is the number almanacs print, and it is NOT the coverage. */
  magnitude: number;
  /** Topocentric centre-to-centre separation (rad). */
  sepRad: number;
  sunRadRad: number;
  moonRadRad: number;
}

const NO_SOLAR: SolarEclipseState = {
  phase: "none",
  coverage: 0,
  magnitude: 0,
  sepRad: Math.PI,
  sunRadRad: 0,
  moonRadRad: 0,
};

/**
 * The scene-side face: classify from discs the caller already has. `scene/sky.ts` calls this every
 * frame with its OWN vectors (geocentric sun anchor × topocentric moon anchor), so the darkness and
 * the carved silhouette can never disagree with the pixels — the rendered separation sits 2.6″ from
 * the true topocentric one, 0.28% of a solar radius.
 */
export function solarEclipseFromDiscs(
  sepRad: number,
  sunRadRad: number,
  moonRadRad: number,
): SolarEclipseState {
  if (!(sunRadRad > 0) || !(moonRadRad > 0) || !Number.isFinite(sepRad)) return NO_SOLAR;
  const coverage = discCoverage(sepRad, sunRadRad, moonRadRad);
  const magnitude = sepRad >= sunRadRad + moonRadRad ? 0 : (sunRadRad + moonRadRad - sepRad) / (2 * sunRadRad);
  let phase: SolarEclipsePhase = "none";
  if (coverage > 0) {
    // Fully inside the moon's disc: total if the moon is the bigger disc, annular if it is not.
    phase =
      sepRad <= Math.abs(moonRadRad - sunRadRad)
        ? moonRadRad >= sunRadRad
          ? "total"
          : "annular"
        : "partial";
  }
  return { phase, coverage, magnitude, sepRad, sunRadRad, moonRadRad };
}

/** Topocentric solar-eclipse state for an observer — the panel/test face. */
export function solarEclipseAt(
  utcMs: number,
  latDeg: number,
  lonDeg: number,
  elevM = 0,
): SolarEclipseState {
  const time = MakeTime(new Date(utcMs));
  const observer = new Observer(latDeg, lonDeg, clampObserverElevationM(elevM));
  const dirOf = (body: Body): { dir: Vec3; distKm: number } => {
    // of-date, aberration-corrected, TOPOCENTRIC (the two `true`s) — bodies.ts `horizontal()` uses
    // the identical call; we keep the vector instead of the az/alt so the separation stays exact.
    const eq = Equator(body, time, observer, true, true);
    const ra = eq.ra * 15 * (Math.PI / 180);
    const dec = eq.dec * (Math.PI / 180);
    return {
      dir: [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)] as const,
      distKm: eq.vec.Length() * KM_PER_AU,
    };
  };
  const sun = dirOf(Body.Sun);
  const moon = dirOf(Body.Moon);
  return solarEclipseFromDiscs(
    unitAngleRad(sun.dir, moon.dir),
    angularRadiusRad(SUN_RADIUS_KM, sun.distKm),
    angularRadiusRad(MOON_RADIUS_KM, moon.distKm),
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Lunar — the moon inside the Earth's shadow                                                     */
/* -------------------------------------------------------------------------------------------- */

export interface LunarEclipseState {
  phase: LunarEclipsePhase;
  /** Fraction of the lunar disc's AREA inside the UMBRA, 0..1. */
  umbralCoverage: number;
  /** Umbral magnitude — lunar diameters of umbra crossed. >1 = total, <0 = umbra not touched. */
  umbralMag: number;
  /** Penumbral magnitude, on the same scale. A penumbral eclipse is real and visible even though
   *  astronomy-engine reports `obscuration: 0` for it (astronomy.d.ts:2726-2727), which is exactly
   *  why the tint cannot be driven off that one scalar. */
  penumbralMag: number;
  /** Moon-centre → shadow-axis separation (rad) and the three radii, all angular at the moon. */
  sepRad: number;
  moonRadRad: number;
  umbraRadRad: number;
  penumbraRadRad: number;
  /** Unit direction to the shadow centre = the ANTISOLAR point, geocentric ECEF. The renderer
   *  projects this into the moon disc's own basis to draw the curved shadow edge. */
  axisDir: Vec3;
}

/** The neutral "no eclipse" state. Exported so a consumer can seed itself without taking a
 *  throwaway ephemeris sample — the globe orchestrator has to declare its eclipse state ABOVE its
 *  own ephemeris seam (a TDZ ReferenceError there silently disables the entire real-Earth globe). */
export const NO_LUNAR_ECLIPSE: LunarEclipseState = {
  phase: "none",
  umbralCoverage: 0,
  umbralMag: 0,
  penumbralMag: 0,
  sepRad: Math.PI,
  moonRadRad: 0,
  umbraRadRad: 0,
  penumbraRadRad: 0,
  axisDir: [0, 0, 1] as const,
};

/**
 * Earth-shadow state from an ephemeris sample the caller already took — the orchestrator's 1 Hz
 * `bodyStatesAt` result feeds this directly, so a lunar eclipse costs no extra ephemeris work.
 *
 * The shadow cone in angular measure at the moon (Meeus ch. 54): with π_m = Earth's angular radius
 * seen from the moon, π_s the same for the sun, and s_s the solar semidiameter,
 *   umbra = k·(π_m + π_s − s_s),  penumbra = k·(π_m + π_s + s_s),  k = SHADOW_ENLARGEMENT.
 * At mean distance that is 0.70° and 1.24° against a 0.26° lunar disc — the umbra is ~2.7 lunar
 * radii, which is why a partial umbral phase shows a curved bite rather than a straight edge.
 */
export function lunarEclipseFromState(s: BodyStates): LunarEclipseState {
  const sunKm = s.sunDistanceAu * KM_PER_AU;
  const moonKm = s.moonDistanceKm;
  if (!(sunKm > 0) || !(moonKm > 0)) return NO_LUNAR_ECLIPSE;
  // The shadow axis is the antisolar direction (geocentric — the shadow belongs to the Earth).
  const axisDir: Vec3 = [-s.sunDir[0], -s.sunDir[1], -s.sunDir[2]] as const;
  const sepRad = unitAngleRad(axisDir, s.moonDir);

  const piMoon = angularRadiusRad(EARTH_RADIUS_KM, moonKm); // Earth as seen from the moon
  const piSun = angularRadiusRad(EARTH_RADIUS_KM, sunKm); // solar horizontal parallax
  const sSun = angularRadiusRad(SUN_RADIUS_KM, sunKm); // solar semidiameter
  const umbraRadRad = SHADOW_ENLARGEMENT * (piMoon + piSun - sSun);
  const penumbraRadRad = SHADOW_ENLARGEMENT * (piMoon + piSun + sSun);
  const moonRadRad = angularRadiusRad(MOON_RADIUS_KM, moonKm);

  const umbralMag = (umbraRadRad + moonRadRad - sepRad) / (2 * moonRadRad);
  const penumbralMag = (penumbraRadRad + moonRadRad - sepRad) / (2 * moonRadRad);
  const umbralCoverage = discCoverage(sepRad, moonRadRad, umbraRadRad);

  const phase: LunarEclipsePhase =
    umbralMag >= 1 ? "total" : umbralMag > 0 ? "partial" : penumbralMag > 0 ? "penumbral" : "none";

  return {
    phase,
    umbralCoverage,
    umbralMag,
    penumbralMag,
    sepRad,
    moonRadRad,
    umbraRadRad,
    penumbraRadRad,
    axisDir,
  };
}

/** Geocentric lunar-eclipse state at an instant — the panel/test face. */
export function lunarEclipseAt(utcMs: number): LunarEclipseState {
  return lunarEclipseFromState(bodyStatesAt(utcMs));
}

/* -------------------------------------------------------------------------------------------- */
/* Predictions — the PREDICTED ECLIPSES panel rows                                                */
/* -------------------------------------------------------------------------------------------- */

export interface EclipseRow {
  /** "solar" rows are local-circumstance (this observer); "lunar" rows are global events that the
   *  observer may or may not be facing. */
  body: "sun" | "moon";
  phase: SolarEclipsePhase | LunarEclipsePhase;
  /** Greatest eclipse, epoch ms. */
  peakMs: number;
  /** Fraction of the disc covered at peak, 0..1 (solar: of the sun; lunar: of the moon by umbra). */
  coverage: number;
  /** First/last contact of the visible phase, epoch ms — the row's span. */
  startMs: number;
  endMs: number;
  /** Totality/annularity window, epoch ms — null when the phase is never reached. */
  totalStartMs: number | null;
  totalEndMs: number | null;
  /** Body altitude at peak (deg). Negative = below the horizon here at greatest eclipse. */
  peakAltDeg: number;
  /** True when the body is above the horizon for at least one contact — i.e. worth flying to. */
  visible: boolean;
}

/** Iteration caps. `SearchLocalSolarEclipse`'s own loop is unbounded, and a *total* eclipse recurs
 *  at a given site only about every 360 years, so any filtered walk needs a hard stop of its own. */
const MAX_STEPS = 24;

const eventMs = (e: { time: { date: Date } }): number => e.time.date.getTime();

const toObserver = (o: PlanObserver): Observer =>
  new Observer(o.latDeg, o.lonDeg, clampObserverElevationM(o.groundAltM + (o.eyeAboveGroundM || 0)));

const solarPhaseOf = (k: EclipseKind): SolarEclipsePhase =>
  k === EclipseKind.Total
    ? "total"
    : k === EclipseKind.Annular
      ? "annular"
      : k === EclipseKind.Partial
        ? "partial"
        : "none";

const lunarPhaseOf = (k: EclipseKind): LunarEclipsePhase =>
  k === EclipseKind.Total
    ? "total"
    : k === EclipseKind.Partial
      ? "partial"
      : k === EclipseKind.Penumbral
        ? "penumbral"
        : "none";

/**
 * The next `count` solar eclipses VISIBLE FROM THIS SITE (any magnitude). Local circumstances, so
 * every row's contact times and obscuration are this observer's, not the global event's.
 *
 * Cost: ~6 ms per eclipse found (measured, node 20 / M-series). Callers memoize on a day bucket.
 */
export function nextSolarEclipses(
  fromMs: number,
  observer: PlanObserver,
  count: number,
): EclipseRow[] {
  const out: EclipseRow[] = [];
  if (count <= 0) return out;
  const obs = toObserver(observer);
  try {
    let e: LocalSolarEclipseInfo = SearchLocalSolarEclipse(new Date(fromMs), obs);
    for (let i = 0; i < MAX_STEPS && out.length < count; i++) {
      const alts = [e.partial_begin.altitude, e.peak.altitude, e.partial_end.altitude];
      out.push({
        body: "sun",
        phase: solarPhaseOf(e.kind),
        peakMs: eventMs(e.peak),
        coverage: e.obscuration,
        startMs: eventMs(e.partial_begin),
        endMs: eventMs(e.partial_end),
        totalStartMs: e.total_begin ? eventMs(e.total_begin) : null,
        totalEndMs: e.total_end ? eventMs(e.total_end) : null,
        peakAltDeg: e.peak.altitude,
        // The library already filters on "some contact above the horizon"; keep the flag so a row
        // whose GREATEST phase happens below the horizon can say so.
        visible: alts.some((a) => a > 0),
      });
      if (out.length >= count) break;
      e = NextLocalSolarEclipse(e.peak.time, obs); // LOCAL: peak is an EclipseEvent → .time
    }
  } catch {
    // astronomy-engine throws raw strings from the eclipse searches — a failed long-range walk
    // must degrade to the rows already found, never take the panel down.
  }
  return out;
}

/**
 * The next `count` lunar eclipses, annotated with whether the moon is up HERE at greatest eclipse.
 * Lunar eclipses are global (everyone on the night side sees the same event), so unlike the solar
 * walk this one does not filter — an "below the horizon" row is still useful planning information.
 */
export function nextLunarEclipses(
  fromMs: number,
  observer: PlanObserver,
  count: number,
): EclipseRow[] {
  const out: EclipseRow[] = [];
  if (count <= 0) return out;
  const obs = toObserver(observer);
  try {
    let e: LunarEclipseInfo = SearchLunarEclipse(new Date(fromMs));
    for (let i = 0; i < MAX_STEPS && out.length < count; i++) {
      const peakMs = e.peak.date.getTime();
      const time = MakeTime(e.peak);
      const eq = Equator(Body.Moon, time, obs, true, true);
      const alt = Horizon(time, obs, eq.ra, eq.dec).altitude; // airless, the house contract
      // `sd_*` are SEMI-durations in MINUTES and 0 means "phase never reached" — double them, and
      // prefer the widest phase that actually occurred for the row's span.
      const halfMs = (min: number) => min * 60_000;
      const outerHalf = halfMs(e.sd_penum);
      const totalHalf = halfMs(e.sd_total);
      out.push({
        body: "moon",
        phase: lunarPhaseOf(e.kind),
        peakMs,
        // Penumbral events report obscuration 0 by definition; fall back to the modelled state so
        // the row still carries a number the tint and the UI can both use.
        coverage: e.obscuration > 0 ? e.obscuration : lunarEclipseAt(peakMs).umbralCoverage,
        startMs: peakMs - outerHalf,
        endMs: peakMs + outerHalf,
        totalStartMs: e.sd_total > 0 ? peakMs - totalHalf : null,
        totalEndMs: e.sd_total > 0 ? peakMs + totalHalf : null,
        peakAltDeg: alt,
        visible: alt > 0,
      });
      if (out.length >= count) break;
      e = NextLunarEclipse(e.peak); // LUNAR: peak IS the AstroTime
    }
  } catch {
    // See nextSolarEclipses — raw-string throws, degrade to what we have.
  }
  return out;
}

/* -------------------------------------------------------------------------------------------- */
/* Look model — the ONE place the physics turns into render numbers                               */
/* -------------------------------------------------------------------------------------------- */

/**
 * Daylight remaining under a partial solar eclipse, 0..1.
 *
 * Straight `1 − coverage` is the honest photometric answer for a UNIFORM disc, but the sun is
 * limb-darkened: the last sliver to be covered is the bright centre, so real-world illumination
 * holds up through the partial phases and then collapses. (The lived experience is exactly this —
 * 80% covered is barely noticeable; the light goes strange only in the final minute.) A gamma on
 * the remaining fraction reproduces that shape with one tunable, and `floor` keeps totality at a
 * deep-twilight glow rather than true black — during totality the sky is still lit by the
 * uneclipsed atmosphere well outside the umbral spot.
 */
export function eclipseDaylightK(coverage: number, gamma: number, floor: number): number {
  const remaining = Math.min(1, Math.max(0, 1 - coverage));
  return floor + (1 - floor) * Math.pow(remaining, gamma);
}
