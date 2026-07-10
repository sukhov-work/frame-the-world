/**
 * Camera-frustum geometry from EXIF-style pose parameters (ADR D5 — projection v1: textured plane
 * at the frustum far face). Pure math on top of `projection.ts` (no three.js) → fast to unit-test;
 * `components/globe/PhotoFrustum.ts` feeds the returned ECEF points straight into buffer geometry.
 *
 * Conventions (match EXIF + `projection.ts`):
 *   heading — degrees clockwise from geographic north (GPSImgDirection).
 *   pitch   — degrees above the local horizon (0 = level, + up).
 *   roll    — degrees clockwise around the view axis, seen from behind the camera (0 = level).
 *   hFov/vFov — full angles (deg); vFov usually derived via `verticalFovDeg(hFov, aspect)`.
 */

import {
  add,
  cameraForward,
  cross,
  enuBasis,
  geodeticToEcef,
  normalise,
  scale,
  type Vec3,
} from "./projection";

const DEG = Math.PI / 180;

export interface FrustumParams {
  latDeg: number;
  lonDeg: number;
  /** Camera height in metres above the ellipsoid (terrain-snapped default lives in globe tuning). */
  altM: number;
  headingDeg: number;
  pitchDeg?: number;
  rollDeg?: number;
  /** Full horizontal field of view (deg) — from `computeHorizontalFov` (D4 fallback chain). */
  hFovDeg: number;
  /** Full vertical field of view (deg) — from `verticalFovDeg(hFovDeg, aspect)`. */
  vFovDeg: number;
  /** Apex → image-plane distance (m). Purely presentational in v1 (how big the frustum reads). */
  planeDistM: number;
}

export interface FrustumGeometry {
  /** Camera position (ECEF m). */
  apex: Vec3;
  /** View direction (unit). */
  forward: Vec3;
  /** Camera up after roll (unit, ⊥ forward). */
  up: Vec3;
  /** Camera right after roll (unit, ⊥ forward, ⊥ up). */
  right: Vec3;
  /** Image-plane (far-face) corners in ECEF m, photographer's view:
   *  [topLeft, topRight, bottomRight, bottomLeft]. */
  corners: [Vec3, Vec3, Vec3, Vec3];
}

/** Rotate v around unit axis k by angle (rad) — Rodrigues. v is assumed ⊥ k (our basis case). */
function rotateAround(v: Vec3, k: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return add(scale(v, c), scale(cross(k, v), s));
}

export function frustumGeometry(p: FrustumParams): FrustumGeometry {
  const apex = geodeticToEcef(p.latDeg, p.lonDeg, p.altM);
  const forward = cameraForward(p.latDeg, p.lonDeg, p.headingDeg, p.pitchDeg ?? 0);
  const { up: geodeticUp } = enuBasis(p.latDeg, p.lonDeg);

  // Levelled camera basis: right ⊥ forward in the horizontal sense, up completes it. (When the
  // camera points straight up/down the horizontal reference degenerates — nudge via north.)
  let right = cross(forward, geodeticUp);
  if (right[0] === 0 && right[1] === 0 && right[2] === 0) {
    right = cross(forward, enuBasis(p.latDeg, p.lonDeg).north);
  }
  right = normalise(right);
  let up = cross(right, forward);

  // EXIF roll: clockwise (from behind the camera) = the world appears to rotate counter-clockwise;
  // rotate the basis around forward by -roll.
  const roll = -(p.rollDeg ?? 0) * DEG;
  if (roll !== 0) {
    right = rotateAround(right, forward, roll);
    up = rotateAround(up, forward, roll);
  }

  const d = p.planeDistM;
  const halfW = d * Math.tan((p.hFovDeg * DEG) / 2);
  const halfH = d * Math.tan((p.vFovDeg * DEG) / 2);
  const centre = add(apex, scale(forward, d));
  const rw = scale(right, halfW);
  const uh = scale(up, halfH);
  const corners: [Vec3, Vec3, Vec3, Vec3] = [
    add(add(centre, scale(rw, -1)), uh), // top-left
    add(add(centre, rw), uh), // top-right
    add(add(centre, rw), scale(uh, -1)), // bottom-right
    add(add(centre, scale(rw, -1)), scale(uh, -1)), // bottom-left
  ];

  return { apex, forward, up, right, corners };
}
