/**
 * Geodetic → ECEF projection + camera-frustum orientation (ADR D5).
 *
 * The globe renders in ECEF (Earth-Centred, Earth-Fixed) metres — the same frame the OSM building tiles use
 * (`WGS84_ELLIPSOID.getCartographicToPosition` in the globe). A photo's frustum is placed by converting its
 * GPS lat/lon/alt to ECEF, then oriented from its heading/pitch in the local ENU (East-North-Up) frame.
 *
 * WGS84 constants here match three's `WGS84_ELLIPSOID` so a frustum lands exactly on the rendered surface.
 * Pure math, no three.js import → fast to unit-test.
 */

/** WGS84 semi-major axis (equatorial radius), metres. */
export const WGS84_A = 6378137.0;
/** WGS84 semi-minor axis (polar radius), metres. */
export const WGS84_B = 6356752.314245;
/** First eccentricity squared, e² = 1 − b²/a². */
export const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);

export type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;

/**
 * Geodetic (lat, lon in degrees; altitude in metres above the ellipsoid) → ECEF metres.
 *   N = a / sqrt(1 − e²·sin²φ)
 *   x = (N + h)·cosφ·cosλ,  y = (N + h)·cosφ·sinλ,  z = (N·(1 − e²) + h)·sinφ
 */
export function geodeticToEcef(latDeg: number, lonDeg: number, altM = 0): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const x = (n + altM) * cosLat * Math.cos(lon);
  const y = (n + altM) * cosLat * Math.sin(lon);
  const z = (n * (1 - WGS84_E2) + altM) * sinLat;
  return [x, y, z];
}

/**
 * Local East-North-Up basis (unit vectors in ECEF) at a geodetic point. `up` is the ellipsoid-normal
 * (geodetic) up, which is what heading/pitch are referenced to.
 */
export function enuBasis(latDeg: number, lonDeg: number): { east: Vec3; north: Vec3; up: Vec3 } {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const east: Vec3 = [-sinLon, cosLon, 0];
  const north: Vec3 = [-sinLat * cosLon, -sinLat * sinLon, cosLat];
  const up: Vec3 = [cosLat * cosLon, cosLat * sinLon, sinLat];
  return { east, north, up };
}

/**
 * Camera forward direction (unit vector, ECEF) from a compass heading and pitch at a geodetic point.
 *   heading: degrees clockwise from geographic north (0 = north, 90 = east) — EXIF `GPSImgDirection`.
 *   pitch:   degrees above the local horizon (0 = level, +up, −down).
 *   forward = cos(pitch)·(sin(heading)·east + cos(heading)·north) + sin(pitch)·up
 */
export function cameraForward(latDeg: number, lonDeg: number, headingDeg: number, pitchDeg = 0): Vec3 {
  const { east, north, up } = enuBasis(latDeg, lonDeg);
  const h = headingDeg * DEG;
  const p = pitchDeg * DEG;
  const cp = Math.cos(p);
  const horiz = add(scale(east, Math.sin(h)), scale(north, Math.cos(h)));
  return normalise(add(scale(horiz, cp), scale(up, Math.sin(p))));
}

/**
 * A frustum pose ready to drive a three.js camera/mesh in the ECEF globe: its ECEF position, a forward
 * (look) direction, and an up vector (local geodetic up, good enough for a levelled camera; roll is applied
 * separately when EXIF provides it).
 */
export interface FrustumPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
}

export function frustumPose(
  latDeg: number,
  lonDeg: number,
  altM: number,
  headingDeg: number,
  pitchDeg = 0,
): FrustumPose {
  return {
    position: geodeticToEcef(latDeg, lonDeg, altM),
    forward: cameraForward(latDeg, lonDeg, headingDeg, pitchDeg),
    up: enuBasis(latDeg, lonDeg).up,
  };
}

// --- tiny vec3 helpers (kept local so this module stays three-free) ---------------------------------------
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
export function normalise(a: Vec3): Vec3 {
  const l = length(a);
  if (l === 0) return [0, 0, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}
