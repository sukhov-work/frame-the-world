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
import { topoAzAlt } from "./topo";
import {
  cometStateAt,
  ELEMENTS_TRUST_DAYS,
  TEMPEL2,
  hgMagnitude,
  smallBodyGeometryAt,
  type CometProfile,
  type KeplerElements,
} from "./comet";
import { radiantAt, type ShowerRow } from "./showers";
import type { Vec3 } from "../geo/projection";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Every category requirement 2 names — `other` is the SIMBAD-fallback catch-all (phase B).
 *  "sun" joined 2026-08-14 (owner: "anything should be searchable") — the sun/moon became
 *  first-class trackable targets (`bodyTarget`), not just scene impostors + HUD chips. */
export type TargetKind =
  | "sun"
  | "planet"
  | "moon"
  | "star"
  | "comet"
  | "asteroid"
  | "galaxy"
  | "nebula"
  | "cluster"
  | "constellation"
  | "shower"
  | "other";

/** Which model produced a magnitude — the label the UI must show alongside the number. */
type TargetMagnitudeModel =
  | "observed" // fitted to real observations (the comet's COBS light curve)
  | "jpl" // JPL M1/k1 fit (systematically faint for an extended coma — labelled)
  | "engine" // astronomy-engine planetary magnitude model
  | "catalog" // a fixed catalog value (stars, DSOs — no phase/distance dependence)
  | "hg"; // IAU (H,G) asteroid phase law (Bowell 1989) — phase B

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
type TargetFacts =
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
    }
  | {
      kind: "asteroid";
      /** MPC number ("1" Ceres … ) — null for unnumbered. */
      number: number | null;
      /** Absolute magnitude H + slope G of the (H,G) phase law. */
      h: number;
      g: number;
      /** The baked element set (epoch honesty + perihelion arithmetic). */
      elements: KeplerElements;
    }
  | {
      kind: "star";
      /** Primary catalog designation ("HR 7001"). */
      designation: string;
      /** Bayer-style id + constellation ("alp Lyr"), when the catalog has one. */
      bayer: string | null;
      constellation: string | null;
      /** Cross-catalog numbers for the card (null where absent). */
      hr: number | null;
      hip: number | null;
      hd: number | null;
    }
  | {
      kind: "constellation";
      /** 3-letter IAU abbreviation ("Ori"). */
      abbr: string;
      genitive: string;
      /** d3-celestial prominence rank 1..3. */
      rank: number;
    }
  | {
      kind: "shower";
      /** The full baked row — the panel keeps its ZHR/activity/parent treatment. */
      row: ShowerRow;
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
// body provider — the sun and the moon as trackable targets (owner 2026-08-14, "anything
// should be searchable"). They keep their first-class scene impostors (scene/sky.ts) — a
// tracked sun/moon ADDS the instrument treatment (marker/trail/ghosts/panel) on top.
// ------------------------------------------------------------------------------------------

export type SunMoonId = "sun" | "moon";

const SUN_MOON: Record<
  SunMoonId,
  { body: Body; name: string; kind: TargetKind; radiusKm: number; aliases: string[]; blurb: string }
> = {
  sun: {
    body: Body.Sun,
    name: "Sun",
    kind: "sun",
    radiusKm: 695_700,
    aliases: ["sun", "sol", "the sun"],
    blurb: "OUR STAR · THE LIGHT EVERY SHOT HERE IS PLANNED AROUND · NEVER LOOK THROUGH OPTICS",
  },
  moon: {
    body: Body.Moon,
    name: "Moon",
    kind: "moon",
    radiusKm: 1737.4,
    aliases: ["moon", "luna", "the moon"],
    blurb: "EARTH'S MOON · 29.5 D PHASE CYCLE · THE TELEPHOTO LANDSCAPE TARGET",
  },
} as const;

/** The sun or the moon as a SkyTarget — astronomy-engine geocentric vectors, the planetTarget
 *  recipe. Illumination() is undefined for the sun (it IS the light source): magnitude is the
 *  standard −26.74 constant, phase null, elongation 0 by definition. */
export function bodyTarget(id: SunMoonId): SkyTarget {
  const spec = SUN_MOON[id];
  return {
    id: `body:${id}`,
    name: spec.name,
    kind: spec.kind,
    aliases: spec.aliases,
    facts: { kind: "planet", radiusKm: spec.radiusKm, blurb: spec.blurb },
    source: "ASTRONOMY-ENGINE 2.1.19 (VSOP87/TOP2013 CLASS)",
    stateAt(utcMs: number): TargetState {
      const time = MakeTime(new Date(utcMs));
      const g = GeoVector(spec.body, time, true);
      const frame = ecefFrameAt(time);
      const [ex, ey, ez] = frame.toEcef(g);
      const d = Math.hypot(ex, ey, ez);
      const isSun = id === "sun";
      const il = isSun ? null : Illumination(spec.body, time);
      const sun = isSun ? g : GeoVector(Body.Sun, time, true);
      return {
        dir: [ex / d, ey / d, ez / d] as const,
        raDeg: ((Math.atan2(g.y, g.x) * RAD) % 360 + 360) % 360,
        decDeg: Math.asin(g.z / d) * RAD,
        distanceAu: d,
        sunDistanceAu: il ? il.helio_dist : null,
        magnitude: il ? il.mag : -26.74,
        magnitudeModel: il ? "engine" : "catalog",
        magnitudeUncertainty: null,
        elongationDeg: isSun ? 0 : elongationDeg(g.x, g.y, g.z, sun.x, sun.y, sun.z),
        phaseFraction: il ? il.phase_fraction : null,
        angularDiamArcsec: 2 * angularRadiusRad(spec.radiusKm, d * KM_PER_AU) * RAD * 3600,
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

/** Saturn's north pole, J2000 (IAU WGCCRE 2015: RA 40.589°, Dec 83.537° — ring-plane normal;
 *  precession of Saturn's pole is ~0.02°/century, ignorable here). */
const SATURN_POLE_J2000 = { raDeg: 40.589, decDeg: 83.537 } as const;

/**
 * Saturn's ring-plane normal in ECEF at an instant (phase D — the ring treatment's orientation).
 * Same J2000 → of-date → ECEF path the fixed provider takes, so the projected ring ellipse and
 * every fixed target share one frame. Returns a unit vector.
 */
export function saturnRingPoleDir(utcMs: number): Vec3 {
  const ra = SATURN_POLE_J2000.raDeg * DEG;
  const dec = SATURN_POLE_J2000.decDeg * DEG;
  const j = {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.cos(dec) * Math.sin(ra),
    z: Math.sin(dec),
  };
  const [ex, ey, ez] = ecefFrameAt(MakeTime(new Date(utcMs))).toEcef(j);
  const d = Math.hypot(ex, ey, ez);
  return [ex / d, ey / d, ez / d] as const;
}

/** Sgr A* (SIMBAD ICRS J2000: 17h45m40.04s, −29°00′28.1″) — the Galactic-Centre TARGET.
 *  Deliberately ≈4.3′ from the frame-defining IAU l=0,b=0 point (`GALACTIC_CENTER` in
 *  lib/ephemeris/stars.ts, 266.405°/−28.93617°): the compact radio source is what a photographer
 *  aims at; the galactic-coordinate origin defines the Milky-Way band basis. Never merge the two
 *  constants — three stars.test.ts round-trips key off the frame one. */
const SGR_A_STAR_J2000 = { raDeg: 266.41684, decDeg: -29.00781 } as const;

/** `targetShortName` slices "dso:" off dso-fact ids — "dso:gc" reads GC on the edge chip. */
export const GALACTIC_CENTRE_ID = "dso:gc";

/**
 * The Milky Way core as a first-class fixed-provider target (Phase 8a P2). Reticle, trail, edge
 * chips, dark-sky windows and the skyline verdict all ride the generic SkyTarget machinery; no
 * `apparent` extents → the POINT reticle treatment. vmag null — a diffuse region has no honest
 * catalog magnitude (magnitude renders as "—").
 */
export function galacticCentreTarget(): SkyTarget {
  return fixedTarget({
    id: GALACTIC_CENTRE_ID,
    name: "Galactic Centre",
    kind: "galaxy",
    aliases: ["Sgr A*", "Sagittarius A*", "Milky Way core", "GC"],
    raDeg: SGR_A_STAR_J2000.raDeg,
    decDeg: SGR_A_STAR_J2000.decDeg,
    vmag: null,
    facts: {
      kind: "dso",
      dsoType: "GC",
      typeLabel: "GALACTIC CENTRE",
      constellation: "Sgr",
      names: ["Sgr A*", "Sagittarius A*", "Milky Way core"],
    },
    source: "SIMBAD (Sgr A*, ICRS J2000)",
  });
}

/**
 * A meteor-shower RADIANT as a first-class tracked target (Phase 8c P7). The radiant is the
 * perspective vanishing point the shower streams from — a direction, not an object: distance is
 * infinity like every fixed target, magnitude is null by contract (`TargetState.magnitude` doc
 * names this exact case), and the RA/Dec DRIFTS day-to-day (the IMO drift columns) — so stateAt
 * recomputes the J2000 vector per call instead of closing over it like `fixedTarget`.
 */
export function showerTarget(row: ShowerRow): SkyTarget {
  return {
    id: `shower:${row.code}`,
    name: row.name,
    kind: "shower",
    aliases: [row.code.toLowerCase(), ...row.aliases, "meteor shower", "meteors"],
    facts: { kind: "shower", row },
    source: "IAU MDC + IMO CALENDAR (BAKE 2026-08-17)",
    stateAt(utcMs: number): TargetState {
      const time = MakeTime(new Date(utcMs));
      const sun = GeoVector(Body.Sun, time, true);
      const { raDeg, decDeg } = radiantAt(row, utcMs);
      const ra = raDeg * DEG;
      const dec = decDeg * DEG;
      const jx = Math.cos(dec) * Math.cos(ra);
      const jy = Math.cos(dec) * Math.sin(ra);
      const jz = Math.sin(dec);
      const [ex, ey, ez] = ecefFrameAt(time).toEcef({ x: jx, y: jy, z: jz });
      const d = Math.hypot(ex, ey, ez);
      return {
        dir: [ex / d, ey / d, ez / d] as const,
        raDeg,
        decDeg,
        distanceAu: null,
        sunDistanceAu: null,
        magnitude: null,
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
  const short = cometShortDesignation(profile.designation); // "10P" · "C/1995 O1"
  const paren = profile.designation.match(/\(([^)]+)\)/)?.[1] ?? null; // "Hale-Bopp"
  return {
    id: `comet:${short}`,
    name: profile.designation,
    kind: "comet",
    aliases: [
      short.toLowerCase(),
      profile.designation.toLowerCase(),
      ...(paren ? [paren.toLowerCase()] : []),
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
        // MPC rows without an H carry m1 = NaN — no model, so no number (never print NaN).
        magnitude: Number.isFinite(s.magnitude) ? s.magnitude : null,
        magnitudeModel: s.magnitudeModel,
        magnitudeUncertainty: Number.isFinite(s.magnitude) ? s.magnitudeUncertainty : null,
        elongationDeg: s.elongationDeg,
        phaseFraction: null,
        angularDiamArcsec: null,
        tailDir: s.tailDir,
      };
    },
  };
}

/**
 * Asteroid profile — the kepler provider's second face (phase B). Same universal-variable
 * propagator and geometry as the comets; only the brightness law differs: the IAU (H,G) phase
 * law instead of the coma m1/k1 model (an asteroid is a point reflector — the phase angle at
 * the body matters, and near opposition the surge is real).
 */
export interface AsteroidProfile {
  /** MPC number — null for unnumbered. */
  number: number | null;
  /** Name or provisional designation ("Ceres", "2024 YR4"). */
  name: string;
  /** Absolute magnitude H (V band). */
  h: number;
  /** Slope parameter G (0.15 = the MPC default where unmeasured). */
  g: number;
  elements: KeplerElements;
  source: string;
}

export function asteroidTarget(profile: AsteroidProfile): SkyTarget {
  const numName = profile.number != null ? `${profile.number} ${profile.name}` : profile.name;
  return {
    id: `asteroid:${profile.number ?? profile.name}`,
    name: numName,
    kind: "asteroid",
    aliases: [profile.name.toLowerCase(), numName.toLowerCase(), "asteroid"],
    facts: {
      kind: "asteroid",
      number: profile.number,
      h: profile.h,
      g: profile.g,
      elements: profile.elements,
    },
    source: profile.source.toUpperCase(),
    stateAt(utcMs: number): TargetState {
      const geo = smallBodyGeometryAt(utcMs, profile.elements);
      return {
        dir: geo.dir,
        raDeg: geo.raDeg,
        decDeg: geo.decDeg,
        distanceAu: geo.distanceAu,
        sunDistanceAu: geo.sunDistanceAu,
        magnitude: hgMagnitude(
          geo.distanceAu,
          geo.sunDistanceAu,
          geo.earthSunAu,
          profile.h,
          profile.g,
        ),
        magnitudeModel: "hg",
        // H itself is typically good to ~0.2–0.3 mag; the two-parameter law adds a bit more.
        magnitudeUncertainty: 0.3,
        elongationDeg: geo.elongationDeg,
        phaseFraction: null,
        angularDiamArcsec: null,
        tailDir: null,
      };
    },
  };
}

export { ELEMENTS_TRUST_DAYS };

/** "10P/Tempel 2" → "10P" · "C/1995 O1 (Hale-Bopp)" → "C/1995 O1" — numbered periodic comets
 *  shorten to the number, long-period ones keep the year designation (dropping "C/" would
 *  collide with the provisional-asteroid grammar). */
function cometShortDesignation(designation: string): string {
  return designation.match(/^(\d+[A-Z])\b/)?.[1] ?? designation.split(" (")[0].trim();
}

/** The shortest honest designation for pills / edge chips — "10P" · "Mars" · "M31" · "Ceres". */
export function targetShortName(target: SkyTarget): string {
  const f = target.facts;
  if (f.kind === "comet") return cometShortDesignation(f.profile.designation);
  if (f.kind === "dso") return target.id.slice(4); // "dso:M31" → the catalog id
  if (f.kind === "asteroid") {
    const bare = target.name.replace(/^\d+\s+/, ""); // "1 Ceres" → "Ceres"
    return bare.length <= 12 ? bare : target.name.split(" ")[0];
  }
  if (f.kind === "constellation") return f.abbr;
  if (f.kind === "shower") return f.row.code;
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
  // ONE ENU projection for every provider — lib/ephemeris/topo.ts (audit A6).
  const t = topoAzAlt(s.dir, s.distanceAu ?? null, latDeg, lonDeg, altM);
  return { azDeg: t.azDeg, altDeg: t.altDeg, state: s };
}
