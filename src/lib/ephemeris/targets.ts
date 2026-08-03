/**
 * Sky targets — ONE interface over every kind of celestial object the instrument can track
 * (ASTRO ENGINE phase A, owner ask 2026-08-03: "search and track any object in the sky").
 *
 * The shipped 10P comet tracer (`comet.ts`, 2026-08-02) is the reference implementation; this
 * module lifts its seam so that a planet, a star, a galaxy and a comet all land in the scene
 * through the SAME `stateAt(utcMs) → { dir, … }` contract. Three position providers:
 *
 *   · fixed  — catalog J2000 RA/Dec (stars, DSOs). Precession/nutation + the sidereal spin come
 *              from `ecefFrameAt` — the ONE frame conversion every body already goes through.
 *   · engine — astronomy-engine bodies (planets + Pluto): `GeoVector` (EQJ, light-time corrected)
 *              + `Illumination` (magnitude/phase; Saturn's mag includes ring tilt).
 *   · kepler — osculating elements through the comet propagator (`comet.ts`). astronomy-engine
 *              has NO small-body support (verified in the .d.ts), so the propagator stays ours.
 *
 * Pure and three-free like its siblings — the globe converts the Vec3 tuples at the use site,
 * and everything here is directly unit-testable against independent references.
 *
 * MAGNITUDE HONESTY (the 2026-08-03 comet lesson, carried from day one): every brightness is a
 * MODEL. `TargetState.magnitudeModel` says which one produced the number, and the panel prints
 * the label next to it — never a bare magnitude.
 */

import { Body, GeoVector, Illumination, MakeTime } from "astronomy-engine";
import { angularRadiusRad, ecefFrameAt, KM_PER_AU } from "./bodies";
import {
  cometStateAt,
  ELEMENTS_TRUST_DAYS,
  TEMPEL2,
  type CometProfile,
} from "./comet";
import { enuBasis, geodeticToEcef, type Vec3 } from "../geo/projection";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Every category requirement 2 names — `other` is the SIMBAD-fallback catch-all (phase B). */
export type TargetKind =
  | "planet"
  | "moon"
  | "star"
  | "comet"
  | "asteroid"
  | "galaxy"
  | "nebula"
  | "cluster"
  | "shower"
  | "other";

/** Which model produced a magnitude — the label the UI must show alongside the number. */
export type TargetMagnitudeModel =
  | "observed" // fitted to real observations (the comet's COBS light curve)
  | "jpl" // JPL M1/k1 fit (systematically faint for an extended coma — labelled)
  | "engine" // astronomy-engine planetary magnitude model
  | "catalog"; // a fixed catalog value (stars, DSOs — no phase/distance dependence)

/** Everything the scene and the readouts need about a target at ONE instant. */
export interface TargetState {
  /** Unit direction TO the target, ECEF (geocentric) — the one thing the scene renders along. */
  dir: Vec3;
  /** Astrometric-class right ascension, J2000 (deg) — push-to coordinates for a scope. */
  raDeg: number;
  /** Declination, J2000 (deg). */
  decDeg: number;
  /** Geocentric distance (AU) — null for fixed targets (effectively at infinity). */
  distanceAu: number | null;
  /** Heliocentric distance (AU) — null where it means nothing (fixed targets). */
  sunDistanceAu: number | null;
  /** Predicted visual magnitude — null when no model applies (e.g. meteor-shower radiant). */
  magnitude: number | null;
  magnitudeModel: TargetMagnitudeModel;
  /** ± band to print; null = the model carries no honest spread (catalog values). */
  magnitudeUncertainty: number | null;
  /** Sun–Earth–target elongation (deg): 180 = opposition, 0 = in the glare. */
  elongationDeg: number;
  /** Illuminated fraction 0..1 — planets/moons only, null elsewhere. */
  phaseFraction: number | null;
  /** Apparent equatorial angular diameter (arcsec) — engine bodies only. */
  angularDiamArcsec: number | null;
  /** Unit ECEF anti-sunward direction — comets only (where the tail points). */
  tailDir: Vec3 | null;
}

/** Static, kind-specific card content — the panel renders from this typed union. */
export type TargetFacts =
  | {
      kind: "planet";
      /** IAU equatorial radius (km) — also the angular-size source. */
      radiusKm: number;
      /** One-line card blurb (orbital period, what to look for). */
      blurb: string;
    }
  | {
      kind: "comet";
      /** The full baked profile — the panel keeps its perihelion/windows treatment. */
      profile: CometProfile;
    }
  | {
      kind: "dso";
      /** OpenNGC type code (G, OCl, GCl, PN, SNR, Neb, HII, **, Dup…). */
      dsoType: string;
      /** Human label for the type ("SPIRAL GALAXY", "OPEN CLUSTER"…). */
      typeLabel: string;
      /** IAU constellation abbreviation, if known. */
      constellation: string | null;
      /** Common names beyond the primary one. */
      names: string[];
    };

/** ONE interface every category satisfies — the load-bearing abstraction of the astro engine. */
export interface SkyTarget {
  /** Stable id, namespaced by provider: `planet:mars` · `comet:10P` · `dso:M31`. */
  id: string;
  name: string;
  kind: TargetKind;
  /** Search aliases (catalog cross-ids, common names) — the index matches against these too. */
  aliases: string[];
  /** ECEF direction + everything the readouts show, at an instant. */
  stateAt(utcMs: number): TargetState;
  facts: TargetFacts;
  /** Apparent size + orientation for extended objects — why a DSO can render as a real ellipse. */
  apparent?: { majorArcmin: number; minorArcmin: number; paDeg: number };
  /** Provenance line the panel prints (data source + solution/catalog). */
  source: string;
}

// ------------------------------------------------------------------------------------------
// engine provider — astronomy-engine bodies (planets + Pluto)
// ------------------------------------------------------------------------------------------

/** The engine bodies the search offers (Earth excluded for the obvious reason; the sun and moon
 *  already have first-class scene treatment + HUD chips, so they are not re-listed here). */
export type PlanetId =
  | "mercury"
  | "venus"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "pluto";

interface PlanetSpec {
  body: Body;
  name: string;
  /** IAU equatorial radius (km) — angular size = 2·asin(r/Δ). */
  radiusKm: number;
  aliases: string[];
  blurb: string;
}

export const PLANETS: Record<PlanetId, PlanetSpec> = {
  mercury: {
    body: Body.Mercury,
    name: "Mercury",
    radiusKm: 2439.7,
    aliases: ["mercury"],
    blurb: "INNERMOST PLANET · 88 D ORBIT · ONLY EVER SEEN IN TWILIGHT NEAR THE SUN",
  },
  venus: {
    body: Body.Venus,
    name: "Venus",
    radiusKm: 6051.8,
    aliases: ["venus", "morning star", "evening star"],
    blurb: "BRIGHTEST PLANET · 225 D ORBIT · SHOWS MOON-LIKE PHASES IN ANY SMALL SCOPE",
  },
  mars: {
    body: Body.Mars,
    name: "Mars",
    radiusKm: 3396.2,
    aliases: ["mars", "red planet"],
    blurb: "THE RED PLANET · 687 D ORBIT · BEST NEAR OPPOSITION EVERY 26 MONTHS",
  },
  jupiter: {
    body: Body.Jupiter,
    name: "Jupiter",
    radiusKm: 71492,
    aliases: ["jupiter"],
    blurb: "LARGEST PLANET · 11.9 YR ORBIT · FOUR GALILEAN MOONS VISIBLE IN BINOCULARS",
  },
  saturn: {
    body: Body.Saturn,
    name: "Saturn",
    radiusKm: 60268,
    aliases: ["saturn", "ringed planet"],
    blurb: "THE RINGED PLANET · 29.4 YR ORBIT · RINGS RESOLVE AT ~25× MAGNIFICATION",
  },
  uranus: {
    body: Body.Uranus,
    name: "Uranus",
    radiusKm: 25559,
    aliases: ["uranus"],
    blurb: "ICE GIANT · 84 YR ORBIT · BINOCULAR OBJECT AT MAG ~5.7, A DISC ONLY IN A SCOPE",
  },
  neptune: {
    body: Body.Neptune,
    name: "Neptune",
    radiusKm: 24764,
    aliases: ["neptune"],
    blurb: "OUTERMOST GIANT · 165 YR ORBIT · MAG ~7.8 — BINOCULARS AND A FINDER CHART",
  },
  pluto: {
    body: Body.Pluto,
    name: "Pluto",
    radiusKm: 1188.3,
    aliases: ["pluto", "134340"],
    blurb: "DWARF PLANET · 248 YR ORBIT · MAG ~14.5 — A LARGE-SCOPE / IMAGING TARGET",
  },
} as const;

/** Elongation (deg) between two geocentric EQJ vectors — sun vs target, both seen from Earth. */
function elongationDeg(
  gx: number,
  gy: number,
  gz: number,
  sx: number,
  sy: number,
  sz: number,
): number {
  const cos =
    (gx * sx + gy * sy + gz * sz) / (Math.hypot(gx, gy, gz) * Math.hypot(sx, sy, sz));
  return Math.acos(Math.max(-1, Math.min(1, cos))) * RAD;
}

/** astronomy-engine planet (or Pluto) as a SkyTarget — the `engine` provider. */
export function planetTarget(id: PlanetId): SkyTarget {
  const spec = PLANETS[id];
  return {
    id: `planet:${id}`,
    name: spec.name,
    kind: "planet",
    aliases: spec.aliases,
    facts: { kind: "planet", radiusKm: spec.radiusKm, blurb: spec.blurb },
    source: "ASTRONOMY-ENGINE 2.1.19 (VSOP87/TOP2013 CLASS) · MAGNITUDE: PLANETARY MODEL",
    stateAt(utcMs: number): TargetState {
      const time = MakeTime(new Date(utcMs));
      const g = GeoVector(spec.body, time, true); // EQJ AU, light-time + aberration
      const sun = GeoVector(Body.Sun, time, true);
      const frame = ecefFrameAt(time);
      const [ex, ey, ez] = frame.toEcef(g);
      const d = Math.hypot(ex, ey, ez);
      const il = Illumination(spec.body, time);
      return {
        dir: [ex / d, ey / d, ez / d] as const,
        raDeg: ((Math.atan2(g.y, g.x) * RAD) % 360 + 360) % 360,
        decDeg: Math.asin(g.z / d) * RAD,
        distanceAu: d,
        sunDistanceAu: il.helio_dist,
        magnitude: il.mag,
        magnitudeModel: "engine",
        magnitudeUncertainty: null,
        elongationDeg: elongationDeg(g.x, g.y, g.z, sun.x, sun.y, sun.z),
        phaseFraction: il.phase_fraction,
        angularDiamArcsec:
          2 * angularRadiusRad(spec.radiusKm, d * KM_PER_AU) * RAD * 3600,
        tailDir: null,
      };
    },
  };
}

// ------------------------------------------------------------------------------------------
// fixed provider — catalog J2000 RA/Dec (stars, DSOs)
// ------------------------------------------------------------------------------------------

export interface FixedTargetSpec {
  id: string;
  name: string;
  kind: TargetKind;
  aliases: string[];
  /** J2000 right ascension (decimal DEGREES — hours × 15). */
  raDeg: number;
  /** J2000 declination (deg). */
  decDeg: number;
  /** Catalog visual magnitude — null when the catalog has none. */
  vmag: number | null;
  apparent?: { majorArcmin: number; minorArcmin: number; paDeg: number };
  facts: TargetFacts;
  source: string;
}

/**
 * Catalog object at fixed J2000 RA/Dec — the `fixed` provider. Precession + nutation to the
 * scene instant ride `ecefFrameAt` (its Rotation_EQJ_EQD step — matters at arcminute scale over
 * decades of scrubbing); proper motion is ignored (≤ arcsec/yr even for Barnard's star).
 */
export function fixedTarget(spec: FixedTargetSpec): SkyTarget {
  const ra = spec.raDeg * DEG;
  const dec = spec.decDeg * DEG;
  // J2000 unit vector, EQJ — the frame ecefFrameAt takes in.
  const jx = Math.cos(dec) * Math.cos(ra);
  const jy = Math.cos(dec) * Math.sin(ra);
  const jz = Math.sin(dec);
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    aliases: spec.aliases,
    facts: spec.facts,
    apparent: spec.apparent,
    source: spec.source,
    stateAt(utcMs: number): TargetState {
      const time = MakeTime(new Date(utcMs));
      const sun = GeoVector(Body.Sun, time, true);
      const frame = ecefFrameAt(time);
      const [ex, ey, ez] = frame.toEcef({ x: jx, y: jy, z: jz });
      const d = Math.hypot(ex, ey, ez); // 1 up to rotation round-off — normalize anyway
      return {
        dir: [ex / d, ey / d, ez / d] as const,
        raDeg: spec.raDeg,
        decDeg: spec.decDeg,
        distanceAu: null,
        sunDistanceAu: null,
        magnitude: spec.vmag,
        magnitudeModel: "catalog",
        magnitudeUncertainty: null,
        elongationDeg: elongationDeg(jx, jy, jz, sun.x, sun.y, sun.z),
        phaseFraction: null,
        angularDiamArcsec: null,
        tailDir: null,
      };
    },
  };
}

// ------------------------------------------------------------------------------------------
// kepler provider — osculating elements through the comet propagator
// ------------------------------------------------------------------------------------------

/**
 * Comet profile as a SkyTarget — the `kepler` provider. 10P stops being a special case: the
 * scene and the panel track `cometTarget(TEMPEL2)` through the same seam as everything else,
 * and the next comet is one baked profile away (`scripts/build-comet-elements.mjs`).
 */
export function cometTarget(profile: CometProfile = TEMPEL2): SkyTarget {
  const short = profile.designation.split("/")[0]; // "10P"
  return {
    id: `comet:${short}`,
    name: profile.designation,
    kind: "comet",
    aliases: [
      short.toLowerCase(),
      profile.designation.toLowerCase(),
      ...profile.designation.toLowerCase().split("/"),
      "comet",
    ],
    facts: { kind: "comet", profile },
    source: profile.source.toUpperCase(),
    stateAt(utcMs: number): TargetState {
      const s = cometStateAt(utcMs, profile);
      return {
        dir: s.dir,
        raDeg: s.raDeg,
        decDeg: s.decDeg,
        distanceAu: s.distanceAu,
        sunDistanceAu: s.sunDistanceAu,
        magnitude: s.magnitude,
        magnitudeModel: s.magnitudeModel,
        magnitudeUncertainty: s.magnitudeUncertainty,
        elongationDeg: s.elongationDeg,
        phaseFraction: null,
        angularDiamArcsec: null,
        tailDir: s.tailDir,
      };
    },
  };
}

export { ELEMENTS_TRUST_DAYS };

/** The shortest honest designation for pills / edge chips — "10P" · "Mars" · "M31". */
export function targetShortName(target: SkyTarget): string {
  const f = target.facts;
  if (f.kind === "comet") return f.profile.designation.split("/")[0];
  if (f.kind === "dso") return target.id.slice(4); // "dso:M31" → the catalog id
  return target.name;
}

// ------------------------------------------------------------------------------------------
// Topocentric az/alt — the almanac-checkable face, shared by the panel and the planner
// ------------------------------------------------------------------------------------------

export interface TargetAzAlt {
  /** Azimuth deg [0,360), N=0 E=90. */
  azDeg: number;
  /** Altitude deg [−90,90], geometric/airless (matches almanac "airless" rows). */
  altDeg: number;
  /** The geocentric state the sample came from (magnitude, distances, …). */
  state: TargetState;
}

/**
 * Topocentric az/alt of a target for an observer. Solar-system bodies get the full diurnal
 * parallax (subtract the observer's ECEF position at the true distance — the comet lesson: it is
 * free and makes the numbers match Horizons to 3 decimals); fixed targets are at infinity, so
 * their geocentric direction IS the topocentric one.
 */
export function targetAzAlt(
  target: SkyTarget,
  utcMs: number,
  latDeg: number,
  lonDeg: number,
  altM = 0,
): TargetAzAlt {
  const s = target.stateAt(utcMs);
  let x = s.dir[0];
  let y = s.dir[1];
  let z = s.dir[2];
  if (s.distanceAu != null) {
    const dKm = s.distanceAu * KM_PER_AU;
    const [ox, oy, oz] = geodeticToEcef(latDeg, lonDeg, altM); // metres
    x = s.dir[0] * dKm - ox / 1000;
    y = s.dir[1] * dKm - oy / 1000;
    z = s.dir[2] * dKm - oz / 1000;
  }
  const d = Math.hypot(x, y, z);
  const { east, north, up } = enuBasis(latDeg, lonDeg);
  const u = (x * up[0] + y * up[1] + z * up[2]) / d;
  const e = (x * east[0] + y * east[1] + z * east[2]) / d;
  const n = (x * north[0] + y * north[1] + z * north[2]) / d;
  return {
    azDeg: ((Math.atan2(e, n) * RAD) % 360 + 360) % 360,
    altDeg: Math.asin(Math.max(-1, Math.min(1, u))) * RAD,
    state: s,
  };
}
