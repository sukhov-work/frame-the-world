/**
 * Ephemeris — sun + moon state from time (ADR D6: astronomy-engine 2.1.19, ±1 arcmin class).
 *
 * Pure and three-free (unit-tests fast; the globe converts Vec3 tuples at the use site).
 * All directions are GEOCENTRIC unit vectors in ECEF (x → 0°N/0°E, y → 0°N/90°E, z → north pole —
 * the same frame as `lib/geo/projection.ts` and three's WGS84_ELLIPSOID), which is exactly what
 * scene lighting wants. Note: the RENDERED moon position is geocentric too — topocentric parallax
 * (<~1°) is invisible at scene scale; switch to `Equator(..., observer, true, true)` + `Horizon`
 * if the moon disc ever needs observer-exact placement.
 *
 * Recipe verified against JPL Horizons (2026-07-10 research pass, ≤0.0007° agreement):
 * EQJ vector → `Rotation_EQJ_EQD` → rotate about +Z by −GAST (`SiderealTime`·15°).
 * TRAP: `MakeTime` accepts a raw number as *J2000 days*, not epoch ms — always wrap in `new Date`.
 */

import {
  type AstroTime,
  Body,
  Equator,
  GeoMoon,
  GeoVector,
  Horizon,
  Illumination,
  KM_PER_AU,
  MakeTime,
  MoonPhase,
  Observer,
  Rotation_EQJ_EQD,
  RotateVector,
  SiderealTime,
  Vector,
} from "astronomy-engine";
import type { Vec3 } from "../geo/projection";

/** IAU nominal solar radius (km). */
export const SUN_RADIUS_KM = 695_700;
/** Mean lunar radius (km). */
export const MOON_RADIUS_KM = 1_737.4;
export { KM_PER_AU };

export interface BodyStates {
  /** Unit direction TO the sun, ECEF (geocentric). */
  sunDir: Vec3;
  sunDistanceAu: number;
  /** Unit direction TO the moon, ECEF (geocentric). */
  moonDir: Vec3;
  moonDistanceKm: number;
  /** Ecliptic longitude moon−sun, deg [0,360): 0 new · 90 first quarter · 180 full · 270 last. */
  moonPhaseDeg: number;
  /** Illuminated fraction of the lunar disc, 0..1 (geocentric). */
  moonIllumination: number;
  /** Sun–moon–earth phase angle, deg (0 = full, 90 = quarter, 180 = new) — feeds the K&S-1991
   *  brightness curve (`lib/ephemeris/moonlight.ts`); phase_fraction = (1 + cos α)/2. */
  moonPhaseAngleDeg: number;
  /** Greenwich apparent sidereal time (rad) — rotating the J2000-equatorial star sphere by −this
   *  about +Z puts every star over its correct earth longitude (Phase 4 BSC5 star field). */
  gastRad: number;
}

/** The EQJ → ECEF map for ONE instant (see the module header for the verified recipe). */
export interface EcefFrame {
  /** Greenwich apparent sidereal time (rad) — the −Z rotation this frame applies. */
  gastRad: number;
  /** EQJ vector → earth-fixed components, units preserved (AU in → AU out). */
  toEcef(eqj: { x: number; y: number; z: number }): Vec3;
}

/**
 * Build the EQJ → ECEF converter for an instant. Shared by every body that has to land in the
 * scene frame — the sun/moon here, the comet propagator in `comet.ts`, and every SkyTarget
 * provider in `targets.ts` (fixed/engine/kepler) — so there is exactly ONE place where
 * precession/nutation and the sidereal spin are applied (the dayArc.ts "never a second
 * ephemeris" rule, one level down).
 */
export function ecefFrameAt(time: AstroTime): EcefFrame {
  const rot = Rotation_EQJ_EQD(time); // precession + nutation, once per instant
  const gastRad = SiderealTime(time) * 15 * (Math.PI / 180); // sidereal hours → radians
  const c = Math.cos(gastRad);
  const s = Math.sin(gastRad);
  return {
    gastRad,
    toEcef(eqj) {
      const v = RotateVector(rot, new Vector(eqj.x, eqj.y, eqj.z, time)); // EQJ → equator-of-date
      // Equator-of-date → earth-fixed: rotate about +Z by −GAST (sign verified against the
      // library's own terra()/Horizon() and JPL Horizons).
      return [v.x * c + v.y * s, -v.x * s + v.y * c, v.z] as const;
    },
  };
}

/** Sun + moon state at a UTC instant — ONE call drives lighting, bodies and readouts. */
export function bodyStatesAt(utcMs: number): BodyStates {
  const time = MakeTime(new Date(utcMs));
  const frame = ecefFrameAt(time);
  const gastRad = frame.gastRad;
  const toEcef = (eqj: Vector): { dir: Vec3; distAu: number } => {
    const [x, y, z] = frame.toEcef(eqj);
    const d = Math.hypot(x, y, z);
    return { dir: [x / d, y / d, z / d] as const, distAu: d };
  };
  const sun = toEcef(GeoVector(Body.Sun, time, true));
  const moon = toEcef(GeoMoon(time)); // GeoVector(Moon) ignores aberration anyway — call GeoMoon directly
  const illum = Illumination(Body.Moon, time);
  return {
    sunDir: sun.dir,
    sunDistanceAu: sun.distAu,
    moonDir: moon.dir,
    moonDistanceKm: moon.distAu * KM_PER_AU,
    moonPhaseDeg: MoonPhase(time),
    moonIllumination: illum.phase_fraction,
    moonPhaseAngleDeg: illum.phase_angle,
    gastRad,
  };
}

/** Apparent angular radius (rad) of a sphere of `bodyRadiusKm` seen from `distanceKm`. */
export function angularRadiusRad(bodyRadiusKm: number, distanceKm: number): number {
  return Math.asin(Math.min(1, bodyRadiusKm / distanceKm));
}

export interface AzAlt {
  /** Azimuth deg [0,360), N=0 E=90. */
  azDeg: number;
  /** Altitude deg [−90,90], airless (no refraction — matches almanac "airless" rows). */
  altDeg: number;
}

/** Topocentric az/alt for an observer — the almanac-checkable face of the same ephemeris
 *  (parallax-corrected, of-date, airless). Used by tests and future rise/set UI. */
export function horizontal(
  body: "sun" | "moon",
  utcMs: number,
  latDeg: number,
  lonDeg: number,
): AzAlt {
  const time = MakeTime(new Date(utcMs));
  const observer = new Observer(latDeg, lonDeg, 0);
  const eq = Equator(body === "sun" ? Body.Sun : Body.Moon, time, observer, true, true);
  const hor = Horizon(time, observer, eq.ra, eq.dec); // no refraction argument = airless
  return { azDeg: hor.azimuth, altDeg: hor.altitude };
}
