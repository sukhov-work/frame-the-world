/**
 * Idle-drift rotation, frame-rate normalized (RENDERING_QUALITY_PASS F5).
 *
 * The LEO idle drift applied a fixed per-FRAME angle (`DRIFT.degPerFrame`), so the globe's rotation
 * pace scaled with the display refresh rate — ~2× as fast at 120 Hz, half at 30 Hz. This converts a
 * per-SECOND rate plus the frame's dt into the radians to rotate THIS frame, so the pace is identical
 * on any monitor. Pure + three-free → unit-tested; the orchestrator (StylizedTiles) applies the angle
 * about the drift axis. At the 60 Hz baseline (`dtMs = 1000/60`) `driftRadiansForDt(0.066, dt)` equals
 * the old `0.0011°/frame` exactly, so the verified feel is byte-identical there.
 */
export function driftRadiansForDt(degPerSec: number, dtMs: number): number {
  return ((degPerSec * Math.PI) / 180) * (dtMs / 1000);
}
