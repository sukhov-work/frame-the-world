/**
 * Off-frame direction markers (Phase 5.5 S6 FPV HUD): given a direction in CAMERA space,
 * decide whether it sits inside the current frame and, when it doesn't, which way the
 * edge chip should point. Pure — the orchestrator feeds camera-space vectors, the HUD
 * clamps the resulting screen-plane direction to the viewport edge.
 *
 * Camera-space convention (three.js): x = right, y = up, −z = forward.
 */

export interface FrameMarker {
  /** True when the direction projects inside the frame (chip hidden — the body is visible). */
  inFrame: boolean;
  /** Normalized screen-plane direction from the frame centre toward the target
   *  (x = right, y = up). For a behind-camera target this is the shortest-turn hint. */
  dirX: number;
  dirY: number;
}

/**
 * Classify a camera-space unit direction against a symmetric perspective frustum.
 * `tanHalfV` = tan(vertical FOV / 2); `aspect` = width / height.
 */
export function frameMarker(
  vx: number,
  vy: number,
  vz: number,
  tanHalfV: number,
  aspect: number,
): FrameMarker {
  const inFrame =
    vz < 0 &&
    Math.abs(vx / -vz) <= tanHalfV * aspect &&
    Math.abs(vy / -vz) <= tanHalfV;
  const len = Math.hypot(vx, vy);
  // Degenerate straight-ahead/straight-behind: point "up" so the chip still renders sanely.
  const dirX = len > 1e-9 ? vx / len : 0;
  const dirY = len > 1e-9 ? vy / len : 1;
  return { inFrame, dirX, dirY };
}

const DEG = Math.PI / 180;

/**
 * Classify a topocentric sky bearing against a roll-free FPV pose (QoL-1 §3.1.D rail trace;
 * the QoL-2 frameFinder seed). Builds the camera basis from heading/pitch on the local ENU
 * frame — FPV never rolls — converts the az/alt direction to camera space and delegates to
 * `frameMarker`. Pose fields are the `camera.fpvHud` mirror's (headingDeg/pitchDeg/fovDeg
 * vertical + aspect).
 */
export function azAltFrameMarker(
  azDeg: number,
  altDeg: number,
  pose: { headingDeg: number; pitchDeg: number; fovDeg: number; aspect: number },
): FrameMarker {
  // ENU unit direction of a bearing (x=east, y=north, z=up) — the azAltToEnu convention.
  const enu = (az: number, alt: number): [number, number, number] => {
    const c = Math.cos(alt * DEG);
    return [c * Math.sin(az * DEG), c * Math.cos(az * DEG), Math.sin(alt * DEG)];
  };
  const d = enu(azDeg, altDeg);
  const f = enu(pose.headingDeg, pose.pitchDeg); // camera forward (−z)
  // right = forward × worldUp, normalized (degenerate only at |pitch| = 90°, which FPV clamps
  // away); camUp = right × forward completes the roll-free basis.
  const rx = f[1], ry = -f[0]; // (f × [0,0,1]) — z component is 0
  const rLen = Math.hypot(rx, ry) || 1;
  const r: [number, number, number] = [rx / rLen, ry / rLen, 0];
  const u: [number, number, number] = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return frameMarker(dot(d, r), dot(d, u), -dot(d, f), Math.tan((pose.fovDeg / 2) * DEG), pose.aspect);
}
