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
  /** Greenwich apparent sidereal time (rad) — rotating the J2000-equatorial star sphere by −this
   *  about +Z puts every star over its correct earth longitude (Phase 4 BSC5 star field). */
  gastRad: number;
}

/** Sun + moon state at a UTC instant — ONE call drives lighting, bodies and readouts. */
export function bodyStatesAt(utcMs: number): BodyStates {
  const time = MakeTime(new Date(utcMs));
  const rot = Rotation_EQJ_EQD(time); // precession + nutation, once per instant
  const gastRad = SiderealTime(time) * 15 * (Math.PI / 180); // sidereal hours → radians
  const c = Math.cos(gastRad);
  const s = Math.sin(gastRad);
  const toEcef = (eqj: Vector): { dir: Vec3; distAu: number } => {
    const v = RotateVector(rot, eqj); // EQJ → equator-of-date
    // Equator-of-date → earth-fixed: rotate about +Z by −GAST (sign verified against the
    // library's own terra()/Horizon() and JPL Horizons).
    const x = v.x * c + v.y * s;
    const y = -v.x * s + v.y * c;
    const z = v.z;
    const d = Math.hypot(x, y, z);
    return { dir: [x / d, y / d, z / d] as const, distAu: d };
  };
  const sun = toEcef(GeoVector(Body.Sun, time, true));
  const moon = toEcef(GeoMoon(time)); // GeoVector(Moon) ignores aberration anyway — call GeoMoon directly
  return {
    sunDir: sun.dir,
    sunDistanceAu: sun.distAu,
    moonDir: moon.dir,
    moonDistanceKm: moon.distAu * KM_PER_AU,
    moonPhaseDeg: MoonPhase(time),
    moonIllumination: Illumination(Body.Moon, time).phase_fraction,
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
