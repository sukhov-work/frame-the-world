import { useCameraStore } from "./camera";
import { useUploadStore } from "./upload";

/**
 * "Bring this sky bearing into view" — the ☀/☾ edge-chip idiom (owner 2026-07-14), extracted
 * in ASTRO ENGINE phase C so the edge chips, the sky-marker click and the SKY-search auto-aim
 * all steer the camera the same way:
 *
 *   · FPV — post a one-shot skyLook; the orchestrator glides the look offsets toward the
 *     bearing (any direct look interaction cancels it).
 *   · Orbit — resolve into the existing heading/tilt glide targets: heading turns to the
 *     azimuth; tilt only ever RAISES toward the horizon, capped at the platform's 88° — a
 *     high body stays best-effort at the frame top.
 */

/** Extra tilt headroom (deg) when steering the orbit camera toward a body: keeps the body
 *  comfortably inside the ~55° vertical frame rather than pinned at its top edge. */
const AIM_TILT_MARGIN_DEG = 18;

/** GlobeControls' own tilt ceiling (deg from nadir). */
const AIM_TILT_MAX_DEG = 88;

/** Orbit tilt (deg from nadir) that frames a sky altitude — raise-only callers compare first. */
function orbitTiltForAltDeg(altDeg: number): number {
  return Math.min(AIM_TILT_MAX_DEG, 90 + altDeg - AIM_TILT_MARGIN_DEG);
}

/** True while ANY first-person view owns the camera (photo FPV or temp-pin FPV). The HUD
 *  mirror lags entry by a few frames, so the entry intents back it up. */
function fpvActiveNow(): boolean {
  const cam = useCameraStore.getState();
  return (
    cam.fpvHud !== null || cam.tempFpv || useUploadStore.getState().viewMode === "fpv"
  );
}

export function aimAtSky(azDeg: number, altDeg: number): void {
  const st = useCameraStore.getState();
  if (fpvActiveNow()) {
    st.requestSkyLook({ azDeg, altDeg });
    return;
  }
  st.setTargetHeading(azDeg);
  const tiltForBody = orbitTiltForAltDeg(altDeg);
  if (tiltForBody > st.tiltDeg) st.setTargetTilt(tiltForBody);
}
