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
import { topoAzAlt } from "./topo";
import type { Vec3 } from "../geo/projection";

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

/** Heliocentric osculating elements, Horizons/SBDB naming (ecliptic + equinox J2000).
 *  Phase B (2026-08-10): the propagator is now universal-variable (perihelion-anchored: only
 *  `qAu`/`e`/`tpJdTdb` + angles drive the position), so near-parabolic and hyperbolic element
 *  sets (most C/ comets) work; `aAu`/`nDegPerDay`/`periodDays` are derived/COSMETIC for e ≥ 1
 *  (a < 0, period Infinity — `nextPerihelionMs` guards). Brightness-free — asteroids ride this
 *  directly (their H/G law lives on the profile); comets extend it with the m1/k1 model. */
export interface KeplerElements {
  /** Osculating epoch (Julian date, TDB) — two-body error grows away from it. */
  epochJdTdb: number;
  /** Eccentricity (any conic — the universal propagator handles e ⋛ 1). */
  e: number;
  /** Semi-major axis (AU) — NEGATIVE for hyperbolic orbits (q/(1−e)). */
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
  /** Mean motion (deg/day) — |a|-derived for e ≥ 1 (informational only). */
  nDegPerDay: number;
  /** Sidereal period (days) — Infinity for e ≥ 1. */
  periodDays: number;
}

/** Comet element set = orbit + the MPC/Horizons total-magnitude model. */
export interface CometElements extends KeplerElements {
  /** Total (coma-inclusive) absolute magnitude — Horizons M1 (MPC "H" → M1, k1 = 2.5·G). */
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

/** The static, human-facing card for the object (JPL SBDB + the literature it cites).
 *  Phase B: the MPC-baked catalog comets carry only what CometEls provides — the physical/
 *  discovery fields are null there and the panel skips those lines. */
export interface CometProfile {
  /** IAU designation. */
  designation: string;
  /** Dynamical class. */
  family: string;
  discovery: string | null;
  /** Effective nucleus diameter (km) — null when unmeasured. */
  nucleusKm: number | null;
  /** Synodic rotation period (h) — null when unmeasured. */
  rotationHours: number | null;
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

/** Newton–Raphson on Kepler's equation `M = E − e·sin E` (rad). Converges in <10 its at e≈0.54.
 *  (Kept exported for reference/tests — the propagator itself moved to universal variables.) */
export function solveKepler(meanAnomalyRad: number, e: number): number {
  let E = e < 0.8 ? meanAnomalyRad : Math.PI;
  for (let i = 0; i < 40; i++) {
    const step = (E - e * Math.sin(E) - meanAnomalyRad) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return E;
}

/** Gaussian gravitational constant k (rad/day) → μ☉ = k² (AU³/day²). */
const GAUSS_K = 0.01720209895;
const MU_SUN = GAUSS_K * GAUSS_K;

/** Stumpff c2/c3 (ψ = α·χ²): the universal-variable trig kernel, series-stabilised near 0. */
function stumpff(psi: number): { c2: number; c3: number } {
  if (psi > 1e-8) {
    const s = Math.sqrt(psi);
    return { c2: (1 - Math.cos(s)) / psi, c3: (s - Math.sin(s)) / (s * psi) };
  }
  if (psi < -1e-8) {
    const s = Math.sqrt(-psi);
    return { c2: (Math.cosh(s) - 1) / -psi, c3: (Math.sinh(s) - s) / (s * -psi) };
  }
  return { c2: 1 / 2 - psi / 24, c3: 1 / 6 - psi / 120 };
}

/**
 * Perifocal position (AU; x toward perihelion) at a TDB instant — universal-variable Kepler
 * anchored at perihelion (r₀ = q, r₀·v₀ = 0), Vallado's formulation. ONE code path for every
 * conic: the elliptic case wraps Δt to the nearest perihelion first; parabolic/hyperbolic run
 * unwrapped. Newton on χ is globally safe here because dF/dχ = r > 0 (F strictly increasing);
 * a bisection fallback guards pathological steps anyway.
 */
function perifocalAt(jdTdb: number, el: KeplerElements): { x: number; y: number } {
  const q = el.qAu;
  const e = el.e;
  const alpha = (1 - e) / q; // 1/a (AU⁻¹) — >0 elliptic · 0 parabolic · <0 hyperbolic
  const sqrtMu = Math.sqrt(MU_SUN);
  let dt = jdTdb - el.tpJdTdb; // days from perihelion
  if (alpha > 0) {
    const period = (2 * Math.PI) / (sqrtMu * Math.pow(alpha, 1.5)); // 2π√(a³/μ)
    dt -= Math.round(dt / period) * period;
  }
  const target = sqrtMu * dt;
  // Universal Kepler at the perihelion anchor: F(χ) = χ³·c3(ψ) + q·χ·(1 − ψ·c3(ψ)) = √μ·Δt.
  const F = (chi: number): { f: number; r: number } => {
    const psi = alpha * chi * chi;
    const { c2, c3 } = stumpff(psi);
    return {
      f: chi * chi * chi * c3 + q * chi * (1 - psi * c3) - target,
      r: chi * chi * c2 + q * (1 - psi * c2), // dF/dχ = current radius (always > 0)
    };
  };
  let chi =
    alpha > 0
      ? target * alpha // Vallado's elliptic seed
      : Math.cbrt(6 * target); // parabolic asymptote (χ³·c3 → χ³/6 dominates)
  for (let i = 0; i < 60; i++) {
    const { f, r } = F(chi);
    const step = f / Math.max(r, 1e-12);
    chi -= step;
    if (!Number.isFinite(chi)) {
      chi = 0; // degenerate seed — restart from perihelion; monotone F recovers
    }
    if (Math.abs(step) < 1e-12) break;
  }
  const psi = alpha * chi * chi;
  const { c2, c3 } = stumpff(psi);
  const fLag = 1 - ((chi * chi) / q) * c2;
  const gLag = dt - (chi * chi * chi * c3) / sqrtMu;
  const vPeri = Math.sqrt((MU_SUN * (1 + e)) / q); // perihelion speed, along perifocal +y
  return { x: fLag * q, y: gLag * vPeri };
}

/**
 * Heliocentric position (AU) in the EQJ frame (equatorial J2000 — the frame astronomy-engine's
 * `HelioVector` returns, so the two can be differenced directly).
 */
export function helioEqjAu(jdTdb: number, el: KeplerElements = TEMPEL2.elements): Vec3 {
  const { x: xp, y: yp } = perifocalAt(jdTdb, el);
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
type MagnitudeModel = "observed" | "jpl";

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

/**
 * IAU two-parameter (H,G) asteroid magnitude — Bowell et al. 1989 (Asteroids II, pp. 524–556;
 * adopted by IAU Comm. 20, 1985): V = H + 5·log10(r·Δ) − 2.5·log10[(1−G)·Φ1 + G·Φ2] with
 * Φi = exp(−Ai·tan(α/2)^Bi), A1=3.33 B1=0.63, A2=1.87 B2=1.22. Valid α < 120° (every
 * earth-observable main-belt geometry); G defaults 0.15 when unmeasured (MPC 17257 convention).
 * This is NOT the comet m1/k1 law — asteroids are point reflectors and the phase angle matters.
 */
export function hgMagnitude(
  distanceAu: number,
  sunDistanceAu: number,
  earthSunAu: number,
  h: number,
  g = 0.15,
): number {
  const cosA =
    (sunDistanceAu * sunDistanceAu + distanceAu * distanceAu - earthSunAu * earthSunAu) /
    (2 * sunDistanceAu * distanceAu);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const t = Math.tan(alpha / 2);
  const phi1 = Math.exp(-3.33 * Math.pow(t, 0.63));
  const phi2 = Math.exp(-1.87 * Math.pow(t, 1.22));
  const phase = (1 - g) * phi1 + g * phi2;
  return (
    h + 5 * Math.log10(sunDistanceAu * distanceAu) - 2.5 * Math.log10(Math.max(phase, 1e-9))
  );
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

/** Light-time-corrected geometry of ANY kepler small body at a UTC instant — the element-only
 *  half of `cometStateAt`, shared with the asteroid provider (phase B). */
export interface SmallBodyGeometry {
  /** Unit direction TO the body, ECEF (geocentric). */
  dir: Vec3;
  /** Unit ECEF direction sun → body (the comet anti-sunward tail; unused for asteroids). */
  antiSunDir: Vec3;
  distanceAu: number;
  sunDistanceAu: number;
  earthSunAu: number;
  raDeg: number;
  decDeg: number;
  elongationDeg: number;
  /** TDB Julian date of the instant (perihelion/epoch arithmetic reuses it). */
  jdTdb: number;
}

export function smallBodyGeometryAt(utcMs: number, el: KeplerElements): SmallBodyGeometry {
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

  // Elongation: angle at Earth between the sun (−earth vector) and the body.
  const cosElong =
    (-earth.x * gx - earth.y * gy - earth.z * gz) / (earthSunAu * distanceAu);
  return {
    dir: [ex / ed, ey / ed, ez / ed] as const,
    antiSunDir: [tx / td, ty / td, tz / td] as const,
    distanceAu,
    sunDistanceAu,
    earthSunAu,
    raDeg: ((Math.atan2(gy, gx) * RAD) % 360 + 360) % 360,
    decDeg: Math.asin(gz / distanceAu) * RAD,
    elongationDeg: Math.acos(Math.max(-1, Math.min(1, cosElong))) * RAD,
    jdTdb: jd,
  };
}

/**
 * Full comet state at a UTC instant. Light-time corrected (3 fixed iterations — the comet moves
 * ~0.3°/day, so this converges instantly), which is what makes the RA/Dec ASTROMETRIC and
 * directly comparable to Horizons' quantity 1.
 */
export function cometStateAt(utcMs: number, profile: CometProfile = TEMPEL2): CometState {
  const el = profile.elements;
  const g = smallBodyGeometryAt(utcMs, el);
  const bright = cometBrightness(utcMs, g.distanceAu, g.sunDistanceAu, profile);
  return {
    dir: g.dir,
    tailDir: g.antiSunDir,
    distanceAu: g.distanceAu,
    sunDistanceAu: g.sunDistanceAu,
    raDeg: g.raDeg,
    decDeg: g.decDeg,
    magnitude: bright.magnitude,
    magnitudeModel: bright.model,
    magnitudeUncertainty: bright.uncertaintyMag,
    elongationDeg: g.elongationDeg,
    daysFromPerihelion: g.jdTdb - el.tpJdTdb,
    elementsAgeDays: Math.abs(g.jdTdb - el.epochJdTdb),
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
  // ONE ENU projection for every provider — lib/ephemeris/topo.ts (audit A6).
  const t = topoAzAlt(s.dir, s.distanceAu, latDeg, lonDeg, altM);
  return {
    azDeg: t.azDeg,
    altDeg: t.altDeg,
    distanceAu: t.topoDistanceAu ?? s.distanceAu,
    sunDistanceAu: s.sunDistanceAu,
    magnitude: s.magnitude,
  };
}

/** Perihelion instant of the baked apparition (UTC ms). */
export function perihelionMs(profile: CometProfile = TEMPEL2): number {
  return utcMsFromJdTdb(profile.elements.tpJdTdb);
}

/** The following perihelion (UTC ms) — one sidereal period on, honest to ~a few days.
 *  Null for open orbits (e ≥ 1 — there is no next perihelion). */
export function nextPerihelionMs(profile: CometProfile = TEMPEL2): number | null {
  if (!Number.isFinite(profile.elements.periodDays)) return null;
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
