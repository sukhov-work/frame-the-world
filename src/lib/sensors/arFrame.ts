/**
 * THE AR FRAME CHANNEL (owner order 2026-09-19) — what the camera overlay needs at 60 fps and the
 * store mirror (HUD cadence, every third frame) is too slow for: the phone's smoothed ROLL (the
 * `<video>` is counter-rotated by it — the FPV camera has no roll seam) and the 3D view's live
 * vertical FOV (the `<video>` is scaled to the same pixel focal — a pinch must not lag).
 *
 * A plain mutable record, written once per frame by the orchestrator (`stepArLook`) and read by
 * `components/mobile/ArCameraOverlay.tsx` in its own rAF — the `skyTrackAim` posture: a per-frame
 * value is a closure value, never a 60 fps store write. Not a store (scene modules and the
 * orchestrator may touch it freely; `fences.test.ts` "mirror-never-seats" is about stores), and it
 * carries no state anything DECIDES on — only what the overlay draws.
 */
export interface ArFrame {
  /** True while the phone's aim is driving the view this frame. */
  live: boolean;
  /** The phone's roll about the look axis, degrees, + = clockwise as the viewer sees it, smoothed. */
  rollDeg: number;
  /** `camera.fov` — the 3D view's vertical field of view, degrees. */
  vFovDeg: number;
  /** The view's elevation above the horizon, degrees (the calibration drag's cos-pitch term). */
  viewPitchDeg: number;
  /** `performance.now()` of the write — a reader can tell a stale frame from a live one. */
  atMs: number;
}

export const arFrame: ArFrame = { live: false, rollDeg: 0, vFovDeg: 60, viewPitchDeg: 0, atMs: 0 };

export function writeArFrame(f: Omit<ArFrame, "atMs">, atMs: number): void {
  arFrame.live = f.live;
  arFrame.rollDeg = f.rollDeg;
  arFrame.vFovDeg = f.vFovDeg;
  arFrame.viewPitchDeg = f.viewPitchDeg;
  arFrame.atMs = atMs;
}
