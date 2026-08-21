import { useState } from "react";
import Slider from "../ui/Slider";
import Encoder from "../ui/Encoder";
import InfoDot from "../ui/InfoDot";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import { useCameraStore } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
import { usePlacesMapStore } from "../../store/places";
import { useMemberStore } from "../../store/member";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { wrapHeadingDeg } from "../../lib/geo/heading";
import { useUploadStore } from "../../store/upload";
import { CONTROLS, FPV } from "../globe/tuning";
import { focalFromVerticalFov } from "../../lib/decode/sensors";
import { formatFocal, formatAltM, formatEyeM } from "../../lib/format/readout";
import { saveViewPref } from "../../lib/prefs";
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

  // BLD = 3D buildings on/off, LIVE (owner rule 2026-08-18, superseding the 2026-07-14 variant
  // A/B chip): WHICH bake streams is decided under the hood (lib/globe/regions.ts — best
  // variant by default per baked region), so the chip's whole job is show/hide. Flows through
  // the same setActive path the /m 2D map uses — no reload.

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
    <aside className={`ct${fpvMode ? " ct--fpv" : ""}`} aria-label="Camera controls">
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
          (ZOOM = vertical elevation while in this mode; look = drag / WASD). */}
      {s.tempFpv && (
        <button type="button" className="ct-exitlook" onClick={() => s.setTempFpv(false)}>
          EXIT LOOK · ESC
        </button>
      )}
      {/* CAM TILT + ROTATE hide in FPV (owner 2026-08-14): tilt is a dead control there (the
          orchestrator skips the glide while fpvActive) and look/turn belong to drag + WASD —
          dropping both shortens the deck the TARGET panel used to occlude. */}
      {!fpvMode && (
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
      )}
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
        {/* Ground mode (S7a; SAT is the default since 2026-07-21): satellite imagery at every
            altitude, or opt into the stylized dark drape below ~7 km. Persisted. */}
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
        {/* Pin markers (owner 2026-07-15): shows/hides everyone's public pins on the globe —
            declutters the view. FPV entry turns them off by default; the chip re-enables.
            Persisted HERE, not in the setter — the FPV auto-hide shares that setter and must
            never overwrite the user's choice. */}
        <button
          type="button"
          className={`ct-mode ct-pins tip${s.pinsVisible ? " is-on" : ""}`}
          onClick={() => {
            const on = !s.pinsVisible;
            saveViewPref("pinsVisible", on);
            s.setPinsVisible(on);
          }}
          aria-pressed={s.pinsVisible}
          aria-label={s.pinsVisible ? "Hide photo pins on the globe" : "Show photo pins on the globe"}
          data-tip="PHOTO PINS — SHOW OR HIDE EVERYONE'S PINS ON THE GLOBE."
          data-tip-pos="left"
        >
          PIN
        </button>
        {/* 3D buildings on/off (live — the best available bake for the region streams when ON). */}
        <button
          type="button"
          className={`ct-mode ct-bld tip${s.buildings3d ? " is-on" : ""}`}
          onClick={() => s.setBuildings3d(!s.buildings3d)}
          aria-pressed={s.buildings3d}
          aria-label={s.buildings3d ? "Hide 3D buildings" : "Show 3D buildings"}
          data-tip="3D BUILDINGS — SHOW OR HIDE. THE BEST AVAILABLE DETAIL LOADS AUTOMATICALLY."
          data-tip-pos="left"
        >
          BLD
        </button>
        <AimVisibleChip />
        <PlacesOnMapChip />
        {/* Vector map-ink on/off (owner batch #4 item 7): the road/river/green ribbons washed
            out satellite detail — this kills the wash; street names stay (content, not wash). */}
        <button
          type="button"
          className={`ct-mode ct-vec tip${s.vectorsVisible ? " is-on" : ""}`}
          onClick={() => s.setVectorsVisible(!s.vectorsVisible)}
          aria-pressed={s.vectorsVisible}
          aria-label={s.vectorsVisible ? "Hide the vector map overlay" : "Show the vector map overlay"}
          data-tip="VECTOR OVERLAY — ROAD / RIVER / PARK INK OVER THE GROUND."
          data-tip-pos="left"
        >
          VEC
        </button>
      </div>
      {!fpvMode && (
        <Encoder
          label="ROTATE"
          formatted={`${Math.round(liveHeading)}°`}
          maxRate={CONTROLS.headingRateMaxDegPerS}
          expoGamma={CONTROLS.rateExpoGamma}
          onRate={s.setHeadingRate}
          tip="DRAG SIDEWAYS TO SPIN THE VIEW — FURTHER IS FASTER; RELEASE STOPS."
          tipPos="left"
        />
      )}
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
      {/* BUILDINGS shading (owner; default fully solid since 2026-07-21): 0 = see-through
          wireframe, 100 = fully shaded solid. Double-click resets to the solid default. */}
      {fpvMode && (
        <Slider
          label="BUILDINGS"
          formatted={`${Math.round(s.fpvBuildingSolidity * 100)}`}
          value={Math.round(s.fpvBuildingSolidity * 100)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => s.setFpvBuildingSolidity(v / 100)}
          onReset={() => s.setFpvBuildingSolidity(1)}
          tip="BUILDING SHADING — 0 SEE-THROUGH WIREFRAME, 100 FULLY SHADED SOLID."
          tipPos="left"
        />
      )}
      {/* SAVE PLACE (owner 2026-07-15): members bookmark the CURRENT first-person viewpoint
          (the exact #f= pose + pinned scene time) — it lands in MY PINS · PLACES. */}
      {fpvMode && <SavePlaceControl />}
    </aside>
    </div>
    <TempPinPopup />
    </>
  );
}

/** SAVE PLACE (owner 2026-07-15) — members-only bookmark of the live FPV pose. One control,
 *  three states: quiet button → inline name input (Enter saves, Escape cancels — key events
 *  stop propagating so the FPV walk/exit handlers never fire while typing) → saved flash.
 *  Pose source = the SAME mirrors the `#f=` hash writer uses (fpvHud bearings/FOV/eye +
 *  camGeo ground point), so a saved place and a shared link can never disagree. */
function SavePlaceControl() {
  const memberPhase = useMemberStore((s) => s.phase);
  const fpvHud = useCameraStore((s) => s.fpvHud);
  const camGeo = useCameraStore((s) => s.camGeo);
  const [mode, setMode] = useState<"idle" | "naming" | "busy" | "saved" | "error">("idle");
  const [title, setTitle] = useState("");
  if (memberPhase !== "member") return null;
  const ready = fpvHud !== null && camGeo !== null;

  const save = async () => {
    // Re-read the live mirrors at the save instant — the render props may be a frame stale.
    const hud = useCameraStore.getState().fpvHud;
    const geo = useCameraStore.getState().camGeo;
    if (!hud || !geo) return;
    setMode("busy");
    const t = useTimeStore.getState();
    const pose = {
      latDeg: geo.latDeg,
      lonDeg: geo.lonDeg,
      eyeM: Math.min(10_000, Math.max(0.5, hud.eyeAboveGroundM)),
      headingDeg: hud.headingDeg,
      pitchDeg: Math.min(89, Math.max(-89, hud.pitchDeg)),
      fovDeg: hud.fovDeg,
      timeMs: t.live ? null : sceneTimeMs(), // LIVE is never persisted (the &t= rule)
    };
    try {
      const r = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined, // server defaults "Untitled place"
          ...pose,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Push the new place into the map-marker store so it shows WITHOUT a reload
      // (owner 2026-08-19b) — same shape the GET would return.
      const j = (await r.json().catch(() => null)) as { placeId?: string } | null;
      if (j?.placeId) {
        usePlacesMapStore.getState().addLocal({
          id: j.placeId,
          title: title.trim() || "Untitled place",
          createdAt: new Date().toISOString(),
          ...pose,
        });
      }
      setMode("saved");
      setTitle("");
      window.setTimeout(() => setMode((m) => (m === "saved" ? "idle" : m)), 1800);
    } catch {
      setMode("error");
      window.setTimeout(() => setMode((m) => (m === "error" ? "naming" : m)), 1800);
    }
  };

  if (mode === "idle" || mode === "saved") {
    return (
      <button
        type="button"
        className={`ct-saveplace tip${mode === "saved" ? " is-saved" : ""}`}
        disabled={!ready || mode === "saved"}
        onClick={() => setMode("naming")}
        data-tip="BOOKMARK THIS EXACT VIEWPOINT — FIND IT UNDER MY PINS · PLACES."
        data-tip-pos="left"
      >
        {mode === "saved" ? "✓ PLACE SAVED" : "◎ SAVE PLACE"}
      </button>
    );
  }
  return (
    <div className="ct-saveplace__row">
      <input
        className="ct-saveplace__input"
        autoFocus
        value={title}
        placeholder="NAME THIS PLACE"
        maxLength={120}
        disabled={mode === "busy"}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // typing must never walk (arrows) or exit (Escape) the FPV
          if (e.key === "Enter") void save();
          if (e.key === "Escape") {
            setMode("idle");
            setTitle("");
          }
        }}
      />
      <button
        type="button"
        className="ct-saveplace__ok"
        disabled={mode === "busy"}
        onClick={() => void save()}
      >
        {mode === "busy" ? "…" : mode === "error" ? "RETRY" : "SAVE"}
      </button>
    </div>
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

/** RADAR chip (LAYERS batch, owner 2026-08-19) — master switch over the U4 aim overlay
 *  (azimuth circle + direction lines, GL + 2D map). Per-body DIRECTION flags survive under it. */
function AimVisibleChip() {
  const aimVisible = useSkyStore((s) => s.aimVisible);
  const setAimVisible = useSkyStore((s) => s.setAimVisible);
  return (
    <button
      type="button"
      className={`ct-mode ct-aim tip${aimVisible ? " is-on" : ""}`}
      onClick={() => setAimVisible(!aimVisible)}
      aria-pressed={aimVisible}
      aria-label={aimVisible ? "Hide the aim radar overlay" : "Show the aim radar overlay"}
      data-tip="RADAR — THE AZIMUTH CIRCLE + DIRECTION LINES, ON THE GLOBE AND THE 2D MAP."
      data-tip-pos="left"
    >
      AIM
    </button>
  );
}

/** MY PLACES chip (LAYERS batch, owner 2026-08-19) — saved-place markers on the 2D map. */
function PlacesOnMapChip() {
  const onMap = usePlacesMapStore((s) => s.onMap);
  const setOnMap = usePlacesMapStore((s) => s.setOnMap);
  return (
    <button
      type="button"
      className={`ct-mode ct-places tip${onMap ? " is-on" : ""}`}
      onClick={() => setOnMap(!onMap)}
      aria-pressed={onMap}
      aria-label={onMap ? "Hide my saved places on the map" : "Show my saved places on the map"}
      data-tip="MY PLACES — YOUR SAVED VIEWS AS MARKERS ON THE 2D MAP (WHEN SIGNED IN)."
      data-tip-pos="left"
    >
      PLC
    </button>
  );
}
