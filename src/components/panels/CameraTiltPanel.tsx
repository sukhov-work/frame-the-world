import Slider from "../ui/Slider";
import Encoder from "../ui/Encoder";
import InfoDot from "../ui/InfoDot";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import { useCameraStore } from "../../store/camera";
import { wrapHeadingDeg } from "../../lib/geo/heading";
import { useUploadStore } from "../../store/upload";
import { CONTROLS, FPV } from "../globe/tuning";
import { focalFromVerticalFov } from "../../lib/decode/sensors";
import { formatFocal, formatAltM, formatEyeM } from "../../lib/format/readout";
import { isVariantActive, toggleVariantUrl } from "../../lib/globe/enrichedVariant";
import "../../styles/camera-tilt.css";
import "../../styles/tips.css";

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

export default function CameraTiltPanel() {
  const s = useCameraStore();
  const drag = usePanelDrag("camera");
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

  // Buildings-source A/B (OSM2World variant work, 2026-07-14): the chip toggles `?enriched=`
  // and RELOADS — the camera pose rides the #p hash, so the reload lands at the identical view
  // with the other bake streaming. Chip only exists when an enriched tileset is configured
  // (no env URL → no enrichment → nothing to toggle). Computed once per render: a click
  // navigates away, so no reactive mirror is needed.
  const hasEnriched = Boolean(import.meta.env.PUBLIC_ENRICHED_TILES_URL);
  const o2wActive = typeof location !== "undefined" && isVariantActive(location.search);

  return (
    <>
    <div className="ct-stack" style={drag.style}>
    <DragGrip drag={drag} label="Move the camera deck" tipPos="left" />
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
      {/* Panel header (tips batch): quiet label + the one flow-level InfoDot (right-docked
          panel → tips slide out to the LEFT so they never leave the viewport). */}
      <div className="ct-head">
        <span className="ct-head__label">CAMERA</span>
        <InfoDot
          pos="left"
          label="About the camera deck"
          tip="Camera deck — aim, tilt and zoom the globe camera. Double-click the globe to drop a temporary pin and look from there."
        />
      </div>
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
        tip="CAMERA PITCH — 0° LOOKS STRAIGHT DOWN, 88° AT THE HORIZON."
        tipPos="left"
      />
      <div className="ct-row">
        <button
          type="button"
          className="ct-compass tip"
          onClick={() => s.setTargetHeading(0)}
          aria-label={`Compass — heading ${Math.round(liveHeading)}°, click to face north`}
          data-tip="COMPASS — CLICK TO FACE NORTH. NEEDLE TRACKS YOUR HEADING."
          data-tip-pos="left"
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
          className={`ct-mode tip${is2D ? "" : " is-3d"}`}
          onClick={() => s.setTargetTilt(is2D ? CONTROLS.toggle3dTiltDeg : 0)}
          aria-label={is2D ? "Switch to 3D perspective view" : "Switch to 2D top-down view"}
          data-tip="SWITCH TOP-DOWN MAP VIEW ↔ FREE 3D ORBIT."
          data-tip-pos="left"
        >
          {is2D ? "3D" : "2D"}
        </button>
        {/* Sky guides (S6 follow-up): ON = sun/moon day-arcs + asterisms in FPV, ☀/☾
            direction chips elsewhere; OFF = none of them. */}
        <button
          type="button"
          className={`ct-mode ct-sky tip${s.skyGuides ? " is-on" : ""}`}
          onClick={() => s.setSkyGuides(!s.skyGuides)}
          aria-pressed={s.skyGuides}
          aria-label={s.skyGuides ? "Hide sun/moon sky guides" : "Show sun/moon sky guides"}
          data-tip="SUN & MOON GUIDES — DIRECTION CHIPS; FULL SKY ARCS IN CAMERA VIEW."
          data-tip-pos="left"
        >
          ☀☾
        </button>
        {/* Ground mode (S7a): the dark drape is the default below ~7 km; SAT opts back into
            the satellite imagery look at every altitude. */}
        <button
          type="button"
          className={`ct-mode ct-sat tip${s.groundMode === "satellite" ? " is-on" : ""}`}
          onClick={() =>
            s.setGroundMode(s.groundMode === "satellite" ? "dark" : "satellite")
          }
          aria-pressed={s.groundMode === "satellite"}
          aria-label={
            s.groundMode === "satellite"
              ? "Switch the ground to the dark map"
              : "Switch the ground to satellite imagery"
          }
          data-tip="GROUND STYLE — STYLIZED DARK MAP ↔ SATELLITE IMAGERY."
          data-tip-pos="left"
        >
          SAT
        </button>
        {/* Buildings source (o2w A/B): CLASSIC extruded bake ↔ OSM2World detailed bake.
            Reload-based by design — a live tileset swap would have to tear down the enriched
            renderer's seating/occlusion state mid-frame; the #p pose makes the reload lossless. */}
        {hasEnriched && (
          <button
            type="button"
            className={`ct-mode ct-bld tip${o2wActive ? " is-on" : ""}`}
            onClick={() => location.assign(toggleVariantUrl(location.href))}
            aria-pressed={o2wActive}
            aria-label={
              o2wActive
                ? "Switch buildings to the classic bake"
                : "Switch buildings to the OSM2World detailed bake"
            }
            data-tip="BUILDINGS SOURCE — CLASSIC BAKE ↔ OSM2WORLD DETAIL. RELOADS, KEEPS THE VIEW."
            data-tip-pos="left"
          >
            BLD
          </button>
        )}
      </div>
      <Encoder
        label="ROTATE"
        formatted={`${Math.round(liveHeading)}°`}
        maxRate={CONTROLS.headingRateMaxDegPerS}
        expoGamma={CONTROLS.rateExpoGamma}
        onRate={s.setHeadingRate}
        tip="DRAG SIDEWAYS TO SPIN THE VIEW — FURTHER IS FASTER; RELEASE STOPS."
        tipPos="left"
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
        tip={
          fpvMode
            ? "DRAG RIGHT TO RISE, LEFT TO DESCEND — STRAIGHT OFF THE PIN."
            : "DRAG TO GLIDE ALTITUDE — IN CAMERA VIEW IT BECOMES EYE HEIGHT."
        }
        tipPos="left"
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
          tip="ZOOM THE CAMERA'S FOCAL LENGTH — THE WHEEL DOES THE SAME."
          tipPos="left"
        />
      )}
      {/* BUILDINGS shading (owner): 0 = see-through wireframe, 100 = fully shaded solid — tunes the
          FPV building ghost/opacity so you're not always staring at bare wireframes. */}
      {fpvMode && (
        <Slider
          label="BUILDINGS"
          formatted={`${Math.round(s.fpvBuildingSolidity * 100)}`}
          value={Math.round(s.fpvBuildingSolidity * 100)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => s.setFpvBuildingSolidity(v / 100)}
          onReset={() => s.setFpvBuildingSolidity(0)}
          tip="BUILDING SHADING — 0 SEE-THROUGH WIREFRAME, 100 FULLY SHADED SOLID."
          tipPos="left"
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
