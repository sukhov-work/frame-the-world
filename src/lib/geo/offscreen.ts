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
