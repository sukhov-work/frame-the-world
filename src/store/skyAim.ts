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

/**
 * SKY-search selection policy (owner 2026-08-18) — SOFTER than aimAtSky: picking a target from
 * the search box is a DATA choice, not a "steer my camera" order. In any map view (2D or 3D
 * orbit) the camera must not re-aim — the old auto-aim raised tilt toward the horizon and the
 * 2D locks visibly fought it back (tilt-out → rotate → snap-nadir). Behaviour:
 *   · FPV — keep the look glide (the viewfinder is exactly an aiming instrument there).
 *   · temp pin set — re-centre the PIN with a pose-preserving pan (`centerOnly` fly request:
 *     rigid translation, same tilt/heading/zoom) so the aim circle lands in view.
 *   · otherwise — nothing moves; the aim circle re-derives at the focus by itself.
 */
export function aimAtSkyFromSearch(azDeg: number, altDeg: number): void {
  const st = useCameraStore.getState();
  if (fpvActiveNow()) {
    if (altDeg > 0) st.requestSkyLook({ azDeg, altDeg });
    return;
  }
  const pin = st.tempPin;
  if (pin) st.requestFly({ latDeg: pin.latDeg, lonDeg: pin.lonDeg, altM: 0, centerOnly: true });
}
