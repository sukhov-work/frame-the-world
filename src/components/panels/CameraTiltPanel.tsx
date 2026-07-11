import Slider from "../ui/Slider";
import Encoder from "../ui/Encoder";
import { useCameraStore, wrapHeadingDeg } from "../../store/camera";
import { useUploadStore } from "../../store/upload";
import { CONTROLS, FPV } from "../globe/tuning";
import { focalFromVerticalFov } from "../../lib/decode/sensors";
import { formatFocal } from "../../lib/format/readout";
import "../../styles/camera-tilt.css";

/**
 * Camera panel — manual global camera controls (2026-07-10 owner asks; encoder rework + compass
 * + 2D/3D toggle in Phase 5.5 S2). Docked above the scene clock:
 *  • CAM TILT — absolute declination slider: 0° looks straight down, 88° at the horizon.
 *  • Compass — needle shows where north is; CLICK glides the view fluidly back to north
 *    (shortest arc, tilt preserved — the existing heading glide, never a snap).
 *  • 2D/3D — glides tilt to nadir (2D) or back to CONTROLS.toggle3dTiltDeg (3D).
 *  • ROTATE / ZOOM — spring-centred ENCODERS (velocity, not position): deflection = rate with
 *    an expo curve, release springs back and the motion eases out. Readouts stay live mirrors.
 * In ANY FPV (S6): the ZOOM encoder becomes ALTITUDE (it elevates the viewpoint vertically —
 * that is what it does there) and a FOCAL ZOOM encoder appears — the panel twin of the wheel
 * FOV zoom. The bearings themselves read on the LEFT-side FpvHud.
 * Grabbing the globe releases every pending glide (direct manipulation wins).
 */

function formatAltM(altM: number): string {
  if (altM < 1_000) return `${Math.round(altM)} m`;
  if (altM < 100_000) return `${(altM / 1000).toFixed(1)} km`;
  return `${Math.round(altM / 1000)} km`;
}

function formatEyeM(m: number): string {
  return m < 1_000 ? `${m < 10 ? m.toFixed(1) : Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function CameraTiltPanel() {
  const s = useCameraStore();
  const uploadPhase = useUploadStore((st) => st.phase);
  const viewMode = useUploadStore((st) => st.viewMode);
  // ANY FPV re-identifies the encoders (photo FPV via upload.viewMode, temp via camera.tempFpv).
  const fpvMode = viewMode === "fpv" || s.tempFpv;

  // The tilt knob shows the REQUEST while a glide is pending (stable under the finger);
  // otherwise it mirrors the live camera pose. The encoders always show the live mirrors.
  const shownTilt = s.targetTiltDeg ?? s.tiltDeg;
  const liveHeading =
    fpvMode && s.fpvHud ? wrapHeadingDeg(s.fpvHud.headingDeg) : wrapHeadingDeg(s.headingDeg);
  const is2D = shownTilt < CONTROLS.twoDMaxTiltDeg;
  // The dblclick memo retires the moment the user demonstrates the gesture (a temp pin
  // exists) and stays out of the way while the upload flow owns the globe.
  const showMemo = !s.tempPin && !s.tempFpv && uploadPhase === "idle";

  return (
    <>
    <div className="ct-stack">
    {showMemo && (
      <div className="ct-memo" role="note">
        <span className="ct-memo__glyph" aria-hidden="true">◎</span>
        <span>
          DOUBLE-CLICK ANYWHERE TO
          <br />
          DROP A PIN &amp; LOOK FROM THERE
        </span>
      </div>
    )}
    <aside className="ct" aria-label="Camera controls">
      {/* Temp-pin look-around active: the exit affordance sits ABOVE the controls it retargets
          (ROTATE = look, ZOOM = vertical elevation while in this mode). */}
      {s.tempFpv && (
        <button type="button" className="ct-exitlook" onClick={() => s.setTempFpv(false)}>
          EXIT LOOK · ESC
        </button>
      )}
      <Slider
        label="CAM TILT"
        formatted={`${Math.round(shownTilt)}°`}
        value={Math.round(shownTilt)}
        min={CONTROLS.tiltMinDeg}
        max={CONTROLS.tiltMaxDeg}
        step={1}
        onChange={s.setTargetTilt}
        onReset={s.clearTargetTilt}
      />
      <div className="ct-row">
        <button
          type="button"
          className="ct-compass"
          onClick={() => s.setTargetHeading(0)}
          aria-label={`Compass — heading ${Math.round(liveHeading)}°, click to face north`}
          title="Face north"
        >
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle className="ct-compass__ring" cx="18" cy="18" r="15.5" />
            <g className="ct-compass__rose" style={{ transform: `rotate(${-liveHeading}deg)` }}>
              <polygon className="ct-compass__north" points="18,5 21,18 15,18" />
              <polygon className="ct-compass__south" points="18,31 21,18 15,18" />
              <text className="ct-compass__n" x="18" y="12.5">
                N
              </text>
            </g>
            <circle className="ct-compass__pin" cx="18" cy="18" r="1.4" />
          </svg>
        </button>
        <button
          type="button"
          className={`ct-mode${is2D ? "" : " is-3d"}`}
          onClick={() => s.setTargetTilt(is2D ? CONTROLS.toggle3dTiltDeg : 0)}
          aria-label={is2D ? "Switch to 3D perspective view" : "Switch to 2D top-down view"}
        >
          {is2D ? "3D" : "2D"}
        </button>
        {/* Sky guides (S6 follow-up): ON = sun/moon day-arcs + asterisms in FPV, ☀/☾
            direction chips elsewhere; OFF = none of them. */}
        <button
          type="button"
          className={`ct-mode ct-sky${s.skyGuides ? " is-on" : ""}`}
          onClick={() => s.setSkyGuides(!s.skyGuides)}
          aria-pressed={s.skyGuides}
          aria-label={s.skyGuides ? "Hide sun/moon sky guides" : "Show sun/moon sky guides"}
          title="Sun & moon guides — arcs and asterisms in camera view, direction markers elsewhere"
        >
          ☀☾
        </button>
      </div>
      <Encoder
        label="ROTATE"
        formatted={`${Math.round(liveHeading)}°`}
        maxRate={CONTROLS.headingRateMaxDegPerS}
        expoGamma={CONTROLS.rateExpoGamma}
        onRate={s.setHeadingRate}
      />
      {/* In FPV the same stick elevates the viewpoint vertically — the label says what it
          does; the readout swaps to the eye height above the local ground (FpvHud mirror). */}
      <Encoder
        label={fpvMode ? "ALTITUDE" : "ZOOM"}
        formatted={
          fpvMode && s.fpvHud ? formatEyeM(s.fpvHud.eyeAboveGroundM) : formatAltM(s.zoomAltM)
        }
        maxRate={CONTROLS.zoomRateMaxPerS}
        expoGamma={CONTROLS.rateExpoGamma}
        onRate={s.setZoomRate}
      />
      {/* FOCAL ZOOM (S6): the panel twin of the FPV wheel zoom — right = zoom in (focal
          grows, FOV narrows). Only meaningful while standing in a viewpoint. */}
      {fpvMode && (
        <Encoder
          label="FOCAL ZOOM"
          formatted={s.fpvHud ? formatFocal(focalFromVerticalFov(s.fpvHud.fovDeg)) : "—"}
          maxRate={FPV.fovRateMaxPerS}
          expoGamma={CONTROLS.rateExpoGamma}
          onRate={s.setFovRate}
        />
      )}
    </aside>
    </div>
    <TempPinPopup />
    </>
  );
}

/** Temporary pin (double-click the ground): contextual popup floating NEXT TO the pin.
 *  Rendered as its own island slot OUTSIDE the controls card — a backdrop-filter turns
 *  position:fixed descendants panel-relative (the original overlap bug). "LOOK FROM HERE"
 *  enters the spectator FPV; "UPLOAD HERE" (Phase 5.5 S3) opens the upload flow with the
 *  pin as the location seed for GPS-less files. */
function TempPinPopup() {
  const s = useCameraStore();
  if (!s.tempPin || s.tempFpv || !s.tempPinScreen) return null;
  const pin = s.tempPin;
  return (
    <div
      className="ct-pinpop"
      role="status"
      style={{ left: s.tempPinScreen.x, top: s.tempPinScreen.y }}
    >
      <button type="button" className="ct-pinpop__btn" onClick={() => s.setTempFpv(true)}>
        ◎ LOOK FROM HERE
      </button>
      <span className="ct-pinpop__sep" aria-hidden="true" />
      <button
        type="button"
        className="ct-pinpop__btn"
        onClick={() => useUploadStore.getState().uploadAt(pin.latDeg, pin.lonDeg)}
      >
        ↑ UPLOAD HERE
      </button>
      <button
        type="button"
        className="ct-pinpop__x"
        aria-label="Clear the temporary pin"
        onClick={() => s.setTempPin(null)}
      >
        ✕
      </button>
    </div>
  );
}
