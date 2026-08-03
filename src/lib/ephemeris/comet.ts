/**
 * Comet 10P/Tempel 2 — the one sky guest the scene tracks (temporal addition, 2026-08-02: the
 * comet reaches perihelion TODAY and passes 0.414 au from Earth the next night, its best
 * apparition of the decade).
 *
 * astronomy-engine (ADR D6) has no small-body support, so this module carries its own two-body
 * propagator over JPL-baked osculating elements — but it does NOT become a second ephemeris:
 * Earth's heliocentric position comes from astronomy-engine, and the EQJ → ECEF landing uses the
 * SAME `ecefFrameAt` the sun and moon go through (`bodies.ts`). Pure and three-free like its
 * siblings; the globe converts the Vec3 tuples at the use site.
 *
 * ACCURACY (measured against the JPL Horizons API, 2026-08-02 research pass — see
 * `scripts/build-comet-elements.mjs` to re-bake and re-check):
 *   · geocentric astrometric RA/Dec — ≤ 3″ across 2026-06 … 2026-11 (the whole apparition)
 *   · topocentric az/alt at Dnipro   — 0.004° / 0.003° @ 2026-08-02 00:00Z
 *   · total magnitude (M1/K1 law)    — 0.001 mag vs Horizons T-mag
 *   · two-body drift away from epoch — ≤ 0.35′ within ±1.5 yr, 0.7′ at +2 yr, 2.1′ at +3 yr
 * i.e. exact for pointing a scope this season, and honest-but-softening for far scrubs (the panel
 * says so past `ELEMENTS_TRUST_DAYS`).
 *
 * TRAP (bodies.ts:13, again): `MakeTime(number)` reads J2000 DAYS — always wrap `new Date(ms)`.
 */

import { Body, HelioVector, MakeTime } from "astronomy-engine";
import { ecefFrameAt, KM_PER_AU } from "./bodies";
import { enuBasis, geodeticToEcef, type Vec3 } from "../geo/projection";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
/** IAU76 obliquity of the J2000 ecliptic (arcsec 84381.448) — the frame Horizons elements use. */
const OBLIQUITY_RAD = 23.4392911 * DEG;
/** Light speed in the propagator's units (AU/day) — the light-time correction loop. */
const C_AU_PER_DAY = 173.1446326846693;
/** Julian date of the Unix epoch. */
const JD_UNIX_EPOCH = 2440587.5;
/** TDB − UTC (s) for this decade: 32.184 + (TAI−UTC = 37). TDB−TT is ≤ 2 ms — irrelevant here. */
const TDB_MINUS_UTC_S = 69.184;
export { KM_PER_AU }; // re-exported so a consumer needs ONE import for the comet's numbers

/** Heliocentric osculating elements, Horizons/SBDB naming (ecliptic + equinox J2000). */
export interface CometElements {
  /** Osculating epoch (Julian date, TDB) — two-body error grows away from it. */
  epochJdTdb: number;
  /** Eccentricity. */
  e: number;
  /** Semi-major axis (AU). */
  aAu: number;
  /** Perihelion distance (AU). */
  qAu: number;
  /** Inclination to the J2000 ecliptic (deg). */
  iDeg: number;
  /** Longitude of the ascending node (deg). */
  nodeDeg: number;
  /** Argument of perihelion (deg). */
  periDeg: number;
  /** Time of perihelion passage (Julian date, TDB). */
  tpJdTdb: number;
  /** Mean motion (deg/day). */
  nDegPerDay: number;
  /** Sidereal period (days). */
  periodDays: number;
  /** Total (coma-inclusive) absolute magnitude — Horizons M1. */
  m1: number;
  /** Total magnitude slope — Horizons k1. `m = M1 + 5·log10(Δ) + k1·log10(r)`. */
  k1: number;
}

/**
 * Observed light curve — `m = h + 5·log10(Δ) + 2.5·n·log10(r)` fitted to REAL total-magnitude
 * estimates (COBS), which is a different thing from `CometElements.m1/k1`.
 *
 * WHY THIS EXISTS (owner catch 2026-08-03, and the lesson generalises to every future object):
 * JPL's M1/k1 are an automated fit ("autocmod") to the magnitudes attached to ASTROMETRIC
 * submissions — overwhelmingly CCD frames measured through a tight photometric aperture, which
 * misses most of a big diffuse coma. For 10P in 2026 that model says **12.8** while observers
 * with binoculars and wide-field scopes were reporting **8.2–9.0 on the same nights**: ~4
 * magnitudes, i.e. the difference between "telescope only" and "raise your binoculars". For an
 * app whose whole point is planning a session, the observed curve is the honest number and the
 * JPL fit is the labelled faint bound.
 */
export interface CometLightCurve {
  /** Absolute total magnitude of the fit. */
  h: number;
  /** Activity slope (the `n` in `2.5·n·log10 r`). */
  n: number;
  /** RMS of the fit residuals (mag) — comet magnitudes genuinely scatter this much. */
  rmsMag: number;
  /** Observations the fit used. */
  nObs: number;
  /** Validity window (ISO dates). A steep apparition fit is NOT a general law — outside this
   *  window the caller falls back to the JPL model and says so. */
  fromIso: string;
  toIso: string;
  source: string;
}

/** The static, human-facing card for the object (JPL SBDB + the literature it cites). */
export interface CometProfile {
  /** IAU designation. */
  designation: string;
  /** Dynamical class. */
  family: string;
  discovery: string;
  /** Effective nucleus diameter (km) — Lamy et al. 2004, Comets II pp. 223–264. */
  nucleusKm: number;
  /** Synodic rotation period (h) — LCDB rev. 2023-10 / Warner et al. 2009. */
  rotationHours: number;
  /** Provenance of the baked elements (Horizons solution + query date). */
  source: string;
  elements: CometElements;
  /** Observed light curve for the current apparition (null = only the JPL model is available). */
  lightCurve: CometLightCurve | null;
}

/**
 * 10P/Tempel 2 — baked from JPL Horizons `DES=10P; CAP` osculating elements at 2026-Aug-01.0 TDB
 * (solution JPL#K265/43, soln. date 2026-07-28, 6347 observations, arc 2003–2026), queried
 * 2026-08-02. Re-bake with `node scripts/build-comet-elements.mjs`.
 */
export const TEMPEL2: CometProfile = {
  designation: "10P/Tempel 2",
  family: "Jupiter-family comet",
  discovery: "1873-07-03 · Wilhelm Tempel · Milan",
  nucleusKm: 10.6,
  rotationHours: 8.93,
  source: "JPL Horizons · soln JPL#K265/43 (2026-07-28) · epoch 2026-08-01 TDB",
  elements: {
    epochJdTdb: 2461253.5,
    e: 0.5374521953618221,
    aAu: 3.065062238548651,
    qAu: 1.417737809520057,
    iDeg: 12.02723670268361,
    nodeDeg: 117.797505656995,
    periDeg: 195.468145326466,
    tpJdTdb: 2461254.615211494733,
    nDegPerDay: 0.1836729187513333,
    periodDays: 1960.005875920054,
    m1: 13.7,
    k1: 6.5,
  },
  // Fitted 2026-08-03 to the COBS wide-field/visual subset (aperture ≤15 cm or ICQ method T —
  // the observations that actually capture the whole coma; large-aperture CCD rows are a
  // different photometric system and drag the fit ~2 mag faint). Re-bake:
  // `node scripts/fit-comet-lightcurve.mjs 10P 2026-04-01 <today>`.
  // Monthly residuals vs the observed medians: May −0.1 · Jun +0.2 · Jul +0.0 · Aug −0.6.
  // n = 29 is NOT a general law — it is this apparition's steep activity ramp, which is exactly
  // why the window is narrow. WHERE THE WINDOW STARTS IS PHYSICS, not fit-shopping: before May the
  // coma is still small, a CCD aperture captures most of it and JPL's model is the ACCURATE one
  // (April: JPL 15.9 vs observed 16.0, while this curve would say 17.0). The two models swap
  // places as the coma inflates — so April and earlier deliberately fall through to JPL.
  // `toIso` runs past the fit data on the symmetry of the post-perihelion leg; the ± band and the
  // model label carry that honestly, and a re-bake tightens it.
  lightCurve: {
    h: -0.76,
    n: 29.3,
    rmsMag: 0.8,
    nObs: 215,
    fromIso: "2026-05-01",
    toIso: "2026-10-31",
    source: "COBS visual/wide-field observations (cobs.si), fitted 2026-08-03",
  },
};

/** Days either side of the element epoch where the two-body fit stays sub-arcminute (measured). */
export const ELEMENTS_TRUST_DAYS = 550;

export const jdTdbFromUtcMs = (utcMs: number): number =>
  JD_UNIX_EPOCH + (utcMs + TDB_MINUS_UTC_S * 1000) / 86_400_000;

export const utcMsFromJdTdb = (jdTdb: number): number =>
  (jdTdb - JD_UNIX_EPOCH) * 86_400_000 - TDB_MINUS_UTC_S * 1000;

/** Newton–Raphson on Kepler's equation `M = E − e·sin E` (rad). Converges in <10 its at e≈0.54. */
export function solveKepler(meanAnomalyRad: number, e: number): number {
  let E = e < 0.8 ? meanAnomalyRad : Math.PI;
  for (let i = 0; i < 40; i++) {
    const step = (E - e * Math.sin(E) - meanAnomalyRad) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return E;
}

/**
 * Heliocentric position (AU) in the EQJ frame (equatorial J2000 — the frame astronomy-engine's
 * `HelioVector` returns, so the two can be differenced directly).
 */
export function helioEqjAu(jdTdb: number, el: CometElements = TEMPEL2.elements): Vec3 {
  const twoPi = 2 * Math.PI;
  const M =
    ((((el.nDegPerDay * (jdTdb - el.tpJdTdb) * DEG) % twoPi) + twoPi * 2) % twoPi);
  const E = solveKepler(M, el.e);
  // Perifocal plane (x toward perihelion).
  const xp = el.aAu * (Math.cos(E) - el.e);
  const yp = el.aAu * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const om = el.nodeDeg * DEG;
  const w = el.periDeg * DEG;
  const inc = el.iDeg * DEG;
  const co = Math.cos(om);
  const so = Math.sin(om);
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  // Perifocal → ecliptic J2000 (Rz(−Ω)·Rx(−i)·Rz(−ω)).
  const xe = (co * cw - so * sw * ci) * xp + (-co * sw - so * cw * ci) * yp;
  const ye = (so * cw + co * sw * ci) * xp + (-so * sw + co * cw * ci) * yp;
  const ze = sw * si * xp + cw * si * yp;
  // Ecliptic J2000 → equatorial J2000 (rotate about +X by the obliquity).
  return [
    xe,
    ye * Math.cos(OBLIQUITY_RAD) - ze * Math.sin(OBLIQUITY_RAD),
    ye * Math.sin(OBLIQUITY_RAD) + ze * Math.cos(OBLIQUITY_RAD),
  ] as const;
}

export interface CometState {
  /** Unit direction TO the comet, ECEF (geocentric) — what the scene renders along. */
  dir: Vec3;
  /** Unit ECEF direction the dust/ion tail points (anti-sunward, i.e. sun → comet). */
  tailDir: Vec3;
  /** Geocentric distance Δ (AU). */
  distanceAu: number;
  /** Heliocentric distance r (AU). */
  sunDistanceAu: number;
  /** Astrometric right ascension, J2000 (deg) — push-to coordinates for a scope. */
  raDeg: number;
  /** Astrometric declination, J2000 (deg). */
  decDeg: number;
  /** Predicted total magnitude — the OBSERVED curve where one is valid (see `CometLightCurve`). */
  magnitude: number;
  /** Which curve produced it + how much it can be trusted. */
  magnitudeModel: MagnitudeModel;
  magnitudeUncertainty: number;
  /** Sun–Earth–comet elongation (deg): 180 = opposition, 0 = in the glare. */
  elongationDeg: number;
  /** Days since perihelion (negative = before). */
  daysFromPerihelion: number;
  /** |scene time − element epoch| in days — the honesty gauge for far scrubs. */
  elementsAgeDays: number;
}

/** Which curve produced a magnitude — the label the UI must show alongside the number. */
export type MagnitudeModel = "observed" | "jpl";

export interface CometBrightness {
  /** Predicted total (coma-inclusive) magnitude. */
  magnitude: number;
  model: MagnitudeModel;
  /** 1σ-ish spread to print as ±: the fit RMS, or the honest "model only" band for JPL. */
  uncertaintyMag: number;
}

/** JPL's Horizons T-mag law — `M1 + 5·log10(Δ) + k1·log10(r)` (note: k1 direct, NOT 2.5·k1). */
export function jplMagnitude(
  distanceAu: number,
  sunDistanceAu: number,
  el: CometElements = TEMPEL2.elements,
): number {
  return el.m1 + 5 * Math.log10(distanceAu) + el.k1 * Math.log10(sunDistanceAu);
}

/** Observed-light-curve magnitude — `h + 5·log10(Δ) + 2.5·n·log10(r)`. */
export function observedMagnitude(
  distanceAu: number,
  sunDistanceAu: number,
  lc: CometLightCurve,
): number {
  return lc.h + 5 * Math.log10(distanceAu) + 2.5 * lc.n * Math.log10(sunDistanceAu);
}

/**
 * The magnitude to SHOW: the observed curve inside its validity window, the JPL model outside it
 * (labelled, and with a wide band — it is systematically faint for an extended coma).
 */
export function cometBrightness(
  utcMs: number,
  distanceAu: number,
  sunDistanceAu: number,
  profile: CometProfile = TEMPEL2,
): CometBrightness {
  const lc = profile.lightCurve;
  if (lc && utcMs >= Date.parse(lc.fromIso) && utcMs <= Date.parse(lc.toIso)) {
    return {
      magnitude: observedMagnitude(distanceAu, sunDistanceAu, lc),
      model: "observed",
      uncertaintyMag: lc.rmsMag,
    };
  }
  return {
    magnitude: jplMagnitude(distanceAu, sunDistanceAu, profile.elements),
    model: "jpl",
    // The CCD-aperture bias runs one way only (too faint) and ran ~4 mag for this comet.
    uncertaintyMag: 2,
  };
}

/** What it takes to see something this bright — the answer a session planner actually wants. */
export function visibilityClass(magnitude: number): string {
  if (magnitude < 2) return "NAKED EYE — BRILLIANT";
  if (magnitude < 6) return "NAKED EYE UNDER DARK SKY";
  if (magnitude < 9.5) return "BINOCULARS (10×50)";
  if (magnitude < 12.5) return "SMALL TELESCOPE (100–150 MM)";
  if (magnitude < 15) return "LARGE AMATEUR SCOPE (250 MM+)";
  return "IMAGING ONLY";
}

/**
 * Full comet state at a UTC instant. Light-time corrected (3 fixed iterations — the comet moves
 * ~0.3°/day, so this converges instantly), which is what makes the RA/Dec ASTROMETRIC and
 * directly comparable to Horizons' quantity 1.
 */
export function cometStateAt(utcMs: number, profile: CometProfile = TEMPEL2): CometState {
  const el = profile.elements;
  const time = MakeTime(new Date(utcMs));
  const earth = HelioVector(Body.Earth, time); // EQJ, AU
  const jd = jdTdbFromUtcMs(utcMs);

  let helio: Vec3 = [0, 0, 0];
  let gx = 0;
  let gy = 0;
  let gz = 0;
  let tauDays = 0;
  for (let i = 0; i < 3; i++) {
    helio = helioEqjAu(jd - tauDays, el);
    gx = helio[0] - earth.x;
    gy = helio[1] - earth.y;
    gz = helio[2] - earth.z;
    tauDays = Math.hypot(gx, gy, gz) / C_AU_PER_DAY;
  }
  const distanceAu = Math.hypot(gx, gy, gz);
  const sunDistanceAu = Math.hypot(helio[0], helio[1], helio[2]);
  const earthSunAu = Math.hypot(earth.x, earth.y, earth.z);

  const frame = ecefFrameAt(time);
  const [ex, ey, ez] = frame.toEcef({ x: gx, y: gy, z: gz });
  const ed = Math.hypot(ex, ey, ez);
  const [tx, ty, tz] = frame.toEcef({ x: helio[0], y: helio[1], z: helio[2] });
  const td = Math.hypot(tx, ty, tz);

  // Elongation: angle at Earth between the sun (−earth vector) and the comet.
  const cosElong =
    (-earth.x * gx - earth.y * gy - earth.z * gz) / (earthSunAu * distanceAu);
  const bright = cometBrightness(utcMs, distanceAu, sunDistanceAu, profile);
  return {
    dir: [ex / ed, ey / ed, ez / ed] as const,
    tailDir: [tx / td, ty / td, tz / td] as const,
    distanceAu,
    sunDistanceAu,
    raDeg: ((Math.atan2(gy, gx) * RAD) % 360 + 360) % 360,
    decDeg: Math.asin(gz / distanceAu) * RAD,
    magnitude: bright.magnitude,
    magnitudeModel: bright.model,
    magnitudeUncertainty: bright.uncertaintyMag,
    elongationDeg: Math.acos(Math.max(-1, Math.min(1, cosElong))) * RAD,
    daysFromPerihelion: jd - el.tpJdTdb,
    elementsAgeDays: Math.abs(jd - el.epochJdTdb),
  };
}

export interface CometAzAlt {
  /** Azimuth deg [0,360), N=0 E=90. */
  azDeg: number;
  /** Altitude deg [−90,90], geometric/airless (matches the almanac "airless" rows). */
  altDeg: number;
  distanceAu: number;
  sunDistanceAu: number;
  magnitude: number;
}

/**
 * Topocentric az/alt for an observer — the almanac-checkable face, and what the planner scans.
 * Diurnal parallax is only ~21″ at Δ = 0.41 au but it is free here (subtract the observer's ECEF
 * position), so the numbers match Horizons to the third decimal.
 */
export function cometAzAlt(
  utcMs: number,
  latDeg: number,
  lonDeg: number,
  altM = 0,
  profile: CometProfile = TEMPEL2,
): CometAzAlt {
  const s = cometStateAt(utcMs, profile);
  const dKm = s.distanceAu * KM_PER_AU;
  const [ox, oy, oz] = geodeticToEcef(latDeg, lonDeg, altM); // metres
  // Geocentric direction × distance − observer position, all in km.
  const x = s.dir[0] * dKm - ox / 1000;
  const y = s.dir[1] * dKm - oy / 1000;
  const z = s.dir[2] * dKm - oz / 1000;
  const d = Math.hypot(x, y, z);
  const { east, north, up } = enuBasis(latDeg, lonDeg);
  const u = (x * up[0] + y * up[1] + z * up[2]) / d;
  const e = (x * east[0] + y * east[1] + z * east[2]) / d;
  const n = (x * north[0] + y * north[1] + z * north[2]) / d;
  return {
    azDeg: ((Math.atan2(e, n) * RAD) % 360 + 360) % 360,
    altDeg: Math.asin(Math.max(-1, Math.min(1, u))) * RAD,
    distanceAu: d / KM_PER_AU,
    sunDistanceAu: s.sunDistanceAu,
    magnitude: s.magnitude,
  };
}

/** Perihelion instant of the baked apparition (UTC ms). */
export function perihelionMs(profile: CometProfile = TEMPEL2): number {
  return utcMsFromJdTdb(profile.elements.tpJdTdb);
}

/** The following perihelion (UTC ms) — one sidereal period on, honest to ~a few days. */
export function nextPerihelionMs(profile: CometProfile = TEMPEL2): number {
  return utcMsFromJdTdb(profile.elements.tpJdTdb + profile.elements.periodDays);
}

/**
 * Minimum geocentric distance in a window around an instant — the "closest approach" card.
 * Coarse 6 h scan then a golden-free ternary refine to ~1 min (Δ(t) is smooth and unimodal near
 * the minimum, which is all the refine needs).
 */
export function closestApproach(
  aroundMs: number,
  spanDays = 45,
  profile: CometProfile = TEMPEL2,
): { utcMs: number; distanceAu: number } {
  const stepMs = 6 * 3_600_000;
  const halfMs = (spanDays / 2) * 86_400_000;
  let bestMs = aroundMs;
  let bestAu = Infinity;
  for (let t = aroundMs - halfMs; t <= aroundMs + halfMs; t += stepMs) {
    const d = cometStateAt(t, profile).distanceAu;
    if (d < bestAu) {
      bestAu = d;
      bestMs = t;
    }
  }
  let lo = bestMs - stepMs;
  let hi = bestMs + stepMs;
  for (let i = 0; i < 24 && hi - lo > 60_000; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (cometStateAt(m1, profile).distanceAu < cometStateAt(m2, profile).distanceAu) hi = m2;
    else lo = m1;
  }
  const utcMs = Math.round((lo + hi) / 2);
  return { utcMs, distanceAu: cometStateAt(utcMs, profile).distanceAu };
}
