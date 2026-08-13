/**
 * Topocentric az/alt from a geocentric direction — ONE ENU projection for every provider
 * (audit A6, 2026-08-13: this block was copy-pasted in comet.ts and targets.ts).
 */
import { enuBasis, geodeticToEcef } from "../geo/projection";
import { KM_PER_AU } from "./bodies";

const RAD = 180 / Math.PI;

/**
 * Project a geocentric unit direction (+ optional true distance) into an observer's ENU frame.
 * `distanceAu != null` applies full diurnal parallax by subtracting the observer's ECEF position
 * at the true distance (the comet lesson: it is free and matches Horizons to 3 decimals);
 * null keeps the direction geocentric — targets at infinity.
 */
export function topoAzAlt(
  dir: ArrayLike<number>,
  distanceAu: number | null,
  latDeg: number,
  lonDeg: number,
  altM = 0,
): { azDeg: number; altDeg: number; topoDistanceAu: number | null } {
  let x = dir[0];
  let y = dir[1];
  let z = dir[2];
  if (distanceAu != null) {
    const dKm = distanceAu * KM_PER_AU;
    const [ox, oy, oz] = geodeticToEcef(latDeg, lonDeg, altM); // metres
    x = dir[0] * dKm - ox / 1000;
    y = dir[1] * dKm - oy / 1000;
    z = dir[2] * dKm - oz / 1000;
  }
  const d = Math.hypot(x, y, z);
  const { east, north, up } = enuBasis(latDeg, lonDeg);
  const u = (x * up[0] + y * up[1] + z * up[2]) / d;
  const e = (x * east[0] + y * east[1] + z * east[2]) / d;
  const n = (x * north[0] + y * north[1] + z * north[2]) / d;
  return {
    azDeg: (((Math.atan2(e, n) * RAD) % 360) + 360) % 360,
    altDeg: Math.asin(Math.max(-1, Math.min(1, u))) * RAD,
    topoDistanceAu: distanceAu != null ? d / KM_PER_AU : null,
  };
}
