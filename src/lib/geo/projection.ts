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

/** Geodetic point (degrees / metres above the ellipsoid). */
export interface Geodetic {
  latDeg: number;
  lonDeg: number;
  altM: number;
}

/**
 * ECEF metres → geodetic. Bowring's method seeds the latitude (exact on the surface), then two
 * fixed-point refinements (tanφ = (z + e²·N·sinφ)/ρ) tighten it for high-altitude points — the
 * camera flight converts poses at up to LEO altitude, where one-step Bowring is ~6e-8° off.
 * Pole-guarded.
 */
export function ecefToGeodetic(p: Vec3): Geodetic {
  const [x, y, z] = p;
  const rho = Math.hypot(x, y); // distance from the polar axis
  if (rho < 1e-6) {
    // On the polar axis the longitude is undefined — return 0 by convention.
    return { latDeg: z >= 0 ? 90 : -90, lonDeg: 0, altM: Math.abs(z) - WGS84_B };
  }
  const ePrime2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B);
  const theta = Math.atan2(z * WGS84_A, rho * WGS84_B);
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  let lat = Math.atan2(
    z + ePrime2 * WGS84_B * sinT * sinT * sinT,
    rho - WGS84_E2 * WGS84_A * cosT * cosT * cosT,
  );
  let n = WGS84_A;
  for (let i = 0; i < 2; i++) {
    const sinLat = Math.sin(lat);
    n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    lat = Math.atan2(z + WGS84_E2 * n * sinLat, rho);
  }
  const altM = rho / Math.cos(lat) - n;
  return { latDeg: lat / DEG, lonDeg: Math.atan2(y, x) / DEG, altM };
}

/**
 * First intersection of a ray with the WGS84 ellipsoid surface, or null when the ray misses.
 * Used by click-to-place: camera origin + pointer ray → geodetic location (via `ecefToGeodetic`).
 * Solved in scaled space (z·a/b) where the ellipsoid becomes a sphere of radius a.
 */
export function rayEllipsoidIntersect(origin: Vec3, dir: Vec3): Vec3 | null {
  const s = WGS84_A / WGS84_B;
  const ox = origin[0], oy = origin[1], oz = origin[2] * s;
  const dx = dir[0], dy = dir[1], dz = dir[2] * s;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - WGS84_A * WGS84_A;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  // smallest positive root = the near surface (the far root is the back of the planet)
  const t0 = (-b - sq) / (2 * a);
  const t1 = (-b + sq) / (2 * a);
  const t = t0 > 0 ? t0 : t1 > 0 ? t1 : NaN;
  if (!Number.isFinite(t)) return null; // ellipsoid entirely behind the origin
  return [origin[0] + t * dir[0], origin[1] + t * dir[1], origin[2] + t * dir[2]];
}

// --- tiny vec3 helpers (kept local so this module stays three-free) ---------------------------------------
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
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
