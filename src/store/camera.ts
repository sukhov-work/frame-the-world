import { create } from "zustand";

/**
 * Camera control seams — tilt (declination), heading (rotate-in-place) and zoom (altitude) — the
 * bridge between the camera panel sliders (panels/CameraTiltPanel) and the globe orchestrator
 * (StylizedTiles), mirroring the store/time.ts pattern.
 *
 * Conventions:
 *  • tilt: 0° = straight down (nadir), 90° = level with the horizon — GlobeControls' pitch angle.
 *  • heading: 0° = looking north, 90° = east (compass convention) — measured from the camera's
 *    forward direction projected on the local horizon at the view focus. Rotating preserves the
 *    current tilt exactly (rigid rotation about the local up axis).
 *  • zoom: camera altitude above the ellipsoid (m) — the manual alternative to wheel/pinch.
 *
 * Each control is a pair: a LIVE mirror the orchestrator writes at low cadence (never 60 fps;
 * display-only for the UI) and a `target*` request the slider sets — the orchestrator glides the
 * camera toward it each frame and clears it on arrival. Grabbing the globe clears every target:
 * direct manipulation always wins over the sliders.
 */
/** A one-shot "fly the camera here" request (location finder → orchestrator). The orchestrator
 *  consumes it on the next frame: geodetic target → ECEF arrival pose along the current approach
 *  azimuth → the same cinematic flight a placed photo uses. */
export interface FlyRequest {
  latDeg: number;
  lonDeg: number;
  /** Arrival camera altitude above the ellipsoid (m). */
  altM: number;
}

/** Screen-space info for one sky body while FPV is active (Phase 5.5 S6 HUD markers). */
export interface FpvBodyMarker {
  /** True when the body sits inside the current FPV frame (no edge chip needed). */
  inFrame: boolean;
  /** Normalized screen-plane direction from the frame centre toward the body (x = right,
   *  y = up) — aims the off-frame edge chip; meaningful while !inFrame. */
  dirX: number;
  dirY: number;
  /** Topocentric bearings at the FPV anchor (deg; az compass, alt above horizon). */
  azDeg: number;
  altDeg: number;
  /** Above the marker gate (FPV.bodyMarkerMinAltDeg) — below it the chip hides. */
  up: boolean;
}

/** FPV HUD mirror — camera-view bearings + focal state + sky-body markers. */
export interface FpvHud {
  /** Compass azimuth of the view centre (deg; 0 = north, 90 = east). */
  headingDeg: number;
  /** Elevation of the view centre (deg; + = up). */
  pitchDeg: number;
  /** Live camera vertical FOV (deg) — the HUD derives the 35mm-equivalent focal length. */
  fovDeg: number;
  /** Eye height above the local ground (m) — the ALTITUDE encoder readout. */
  eyeAboveGroundM: number;
  sun: FpvBodyMarker;
  moon: FpvBodyMarker;
}

/** The viewer's ground point (owner 2026-07-14): the geodetic lat/lon directly under the camera
 *  plus the rendered terrain height there — the precise, copyable "where am I standing" readout
 *  the left HUD shows in EVERY mode (orbit and FPV alike). */
export interface CamGeo {
  latDeg: number;
  lonDeg: number;
  /** Rendered terrain height (m above the ellipsoid) under the viewer; null while no ground
   *  tile is loaded beneath the camera (oblique views often have none). */
  groundAltM: number | null;
}

export interface CameraState {
  /** Live camera pitch (deg; 0 = nadir, 90 = horizon). Display-only for the UI. */
  tiltDeg: number;
  /** Requested pitch (deg) the orchestrator is gliding toward; null = no glide in progress. */
  targetTiltDeg: number | null;
  /** Live compass heading of the camera's view (deg; 0 = north, 90 = east). Display-only. */
  headingDeg: number;
  /** Requested heading (deg) — glides around the view focus, preserving tilt. */
  targetHeadingDeg: number | null;
  /** Live camera altitude above the ellipsoid (m). Display-only. */
  zoomAltM: number;
  /** Requested altitude (m) — log-space glide toward it (manual zoom slider). */
  targetZoomAltM: number | null;
  /** Live view-focus geodetic position (deg) — the point the camera looks at on the globe.
   *  Low-cadence mirror; the location finder uses it as the geocoding bias. */
  focusLatDeg: number;
  focusLonDeg: number;
  /** Live viewer ground point (camera nadir; low-cadence mirror, faster while FPV walks). */
  camGeo: CamGeo | null;
  /** Pending one-shot fly-to (location finder); the orchestrator consumes + clears it. */
  flyRequest: FlyRequest | null;
  /** Temporary virtual pin (Phase 5.5 S2 follow-up): double-click the ground drops it; while
   *  set it is the rotate/zoom pivot and FPV can be entered on it ("look around"). A single
   *  click elsewhere / Escape clears it (clearing also exits its FPV). */
  tempPin: { latDeg: number; lonDeg: number } | null;
  /** FPV look-around anchored at the temp pin (parallel to upload.viewMode==='fpv', which is
   *  anchored at a placed photo's frustum apex and takes precedence). */
  tempFpv: boolean;
  /** Screen position (px) of the temp pin marker — low-cadence mirror so the "look from here"
   *  popup can float NEXT TO the pin; null while the pin is off-screen / behind the camera. */
  tempPinScreen: { x: number; y: number } | null;
  setTempPin: (pin: { latDeg: number; lonDeg: number } | null) => void;
  setTempFpv: (on: boolean) => void;
  /** Orchestrator-only: mirror the marker's projected screen position. */
  _syncTempPinScreen: (pos: { x: number; y: number } | null) => void;
  /** Encoder-style rate controls (Phase 5.5 S2): the spring-centred ROTATE/ZOOM panel knobs
   *  write a VELOCITY while deflected and null on release; the orchestrator applies it
   *  per-frame through the same rotation/dolly paths as the glides (heading wraps freely,
   *  zoom clamps at CONTROLS.zoomMinAltM/zoomMaxAltM). Positive heading rate = clockwise
   *  (compass heading increases); positive zoom rate = zoom IN (altitude shrinks). */
  headingRateDegPerS: number | null;
  zoomRatePerS: number | null;
  /** FOCAL ZOOM encoder (Phase 5.5 S6, FPV only): log-space rate on the camera FOV — the panel
   *  twin of the FPV wheel zoom. Positive = zoom IN (FOV narrows / focal length grows). */
  fovRatePerS: number | null;
  /** FPV HUD mirror (Phase 5.5 S6) — the orchestrator writes it at low cadence while ANY FPV
   *  is active, null otherwise (the HUD unmounts on null). Bearings are the CAMERA VIEW's
   *  topocentric az/alt at the FPV anchor; sun/moon carry screen-space info for the off-frame
   *  edge markers. */
  fpvHud: FpvHud | null;
  /** Sky guides master toggle (S6 follow-up, right-hand SKY chip): ON (default) = day-arcs +
   *  asterisms while in FPV, sun/moon direction chips otherwise; OFF = none of them anywhere
   *  (the FPV HUD card itself stays — it is an instrument readout, not a sky decoration). */
  skyGuides: boolean;
  setSkyGuides: (on: boolean) => void;
  /** Ground surface mode (Phase 5.5 S7a): 'dark' (default) = the CARTO dark drape owns the
   *  ground below DRAPE.fadeTopAltM; 'satellite' = the Esri imagery look at every altitude
   *  (textures are opt-in — the SAT chip on the camera panel). */
  groundMode: "dark" | "satellite";
  setGroundMode: (mode: "dark" | "satellite") => void;
  /** Sun/moon direction markers (every mode, gated by skyGuides) — feeds the ☀/☾ edge chips;
   *  outside FPV the bearings reference is the camera's own geodetic position. */
  skyMarkers: { sun: FpvBodyMarker; moon: FpvBodyMarker } | null;
  /** Explore ambient pin journey (Phase 5.5 S4): the nav toggle arms it; the orchestrator's
   *  cruise (globe/explore.ts) owns the camera while set. ANY direct interaction (canvas
   *  pointer/wheel, Escape, encoder deflection, slider glide) clears it — never fight the user. */
  exploreActive: boolean;
  setExplore: (on: boolean) => void;
  requestFly: (req: FlyRequest) => void;
  /** Orchestrator-only: mark the pending fly request consumed. */
  _consumeFlyRequest: () => void;
  setTargetTilt: (deg: number) => void;
  clearTargetTilt: () => void;
  setTargetHeading: (deg: number) => void;
  clearTargetHeading: () => void;
  setTargetZoom: (altM: number) => void;
  clearTargetZoom: () => void;
  /** Rate-control writers — null = stick released (motion eases out in the orchestrator). */
  setHeadingRate: (degPerS: number | null) => void;
  setZoomRate: (perS: number | null) => void;
  setFovRate: (perS: number | null) => void;
  /** FPV building shading (0..1, owner ask): 0 = the see-through wireframe look, 1 = fully shaded
   *  solid. Raises the auto eye-height ghost curve UPWARD (max), so 0 keeps current behavior. */
  fpvBuildingSolidity: number;
  setFpvBuildingSolidity: (v: number) => void;
  /** Orchestrator-only: mirror the FPV HUD state (low cadence; null = FPV inactive). */
  _syncFpvHud: (hud: FpvHud | null) => void;
  /** Orchestrator-only: mirror the sky-body markers (low cadence; null = guides off). */
  _syncSkyMarkers: (m: { sun: FpvBodyMarker; moon: FpvBodyMarker } | null) => void;
  /** Direct manipulation (pointer/wheel/touch on the globe) cancels every slider glide. */
  clearAllTargets: () => void;
  /** Orchestrator-only: mirror the live pose into the store (low cadence). */
  _syncTilt: (deg: number) => void;
  _syncHeading: (deg: number) => void;
  _syncZoom: (altM: number) => void;
  _syncFocus: (latDeg: number, lonDeg: number) => void;
  _syncCamGeo: (g: CamGeo | null) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  tiltDeg: 45,
  targetTiltDeg: null,
  headingDeg: 0,
  targetHeadingDeg: null,
  zoomAltM: 1_100_000, // mirrors POSE.cam.altM until the first live sync lands
  targetZoomAltM: null,
  focusLatDeg: 48.46, // Dnipro-ish until the first live sync lands (POSE default view)
  focusLonDeg: 35.05,
  camGeo: null,
  flyRequest: null,
  headingRateDegPerS: null,
  zoomRatePerS: null,
  fovRatePerS: null,
  fpvHud: null,
  skyGuides: true,
  setSkyGuides: (on) => set({ skyGuides: on }),
  groundMode: "dark",
  setGroundMode: (mode) => set({ groundMode: mode }),
  skyMarkers: null,
  exploreActive: false,
  setExplore: (on) => set({ exploreActive: on }),
  tempPin: null,
  tempFpv: false,
  tempPinScreen: null,
  setTempPin: (pin) =>
    set(
      pin === null
        ? { tempPin: null, tempFpv: false, tempPinScreen: null }
        : { tempPin: pin },
    ),
  setTempFpv: (on) => set((s) => (on && s.tempPin === null ? {} : { tempFpv: on })),
  _syncTempPinScreen: (pos) => set({ tempPinScreen: pos }),
  requestFly: (req) => set({ flyRequest: req }),
  _consumeFlyRequest: () => set({ flyRequest: null }),
  setTargetTilt: (deg) => set({ targetTiltDeg: deg }),
  clearTargetTilt: () => set({ targetTiltDeg: null }),
  setTargetHeading: (deg) => set({ targetHeadingDeg: deg }),
  clearTargetHeading: () => set({ targetHeadingDeg: null }),
  setTargetZoom: (altM) => set({ targetZoomAltM: altM }),
  clearTargetZoom: () => set({ targetZoomAltM: null }),
  setHeadingRate: (degPerS) => set({ headingRateDegPerS: degPerS }),
  setZoomRate: (perS) => set({ zoomRatePerS: perS }),
  setFovRate: (perS) => set({ fovRatePerS: perS }),
  fpvBuildingSolidity: 0,
  setFpvBuildingSolidity: (v) => set({ fpvBuildingSolidity: Math.max(0, Math.min(1, v)) }),
  _syncFpvHud: (hud) => set({ fpvHud: hud }),
  _syncSkyMarkers: (m) => set({ skyMarkers: m }),
  clearAllTargets: () =>
    set({
      targetTiltDeg: null,
      targetHeadingDeg: null,
      targetZoomAltM: null,
      headingRateDegPerS: null,
      zoomRatePerS: null,
      fovRatePerS: null,
    }),
  _syncTilt: (deg) => set({ tiltDeg: deg }),
  _syncHeading: (deg) => set({ headingDeg: deg }),
  _syncZoom: (altM) => set({ zoomAltM: altM }),
  _syncFocus: (latDeg, lonDeg) => set({ focusLatDeg: latDeg, focusLonDeg: lonDeg }),
  _syncCamGeo: (g) => set({ camGeo: g }),
}));

/** Zoom slider (0..1) → altitude (m), log-mapped so metres and megametres both get travel. */
export function sliderToAltM(t: number, minAltM: number, maxAltM: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return Math.exp(Math.log(minAltM) + clamped * (Math.log(maxAltM) - Math.log(minAltM)));
}

/** Altitude (m) → zoom slider position (0..1); inverse of sliderToAltM. */
export function altMToSlider(altM: number, minAltM: number, maxAltM: number): number {
  const a = Math.min(maxAltM, Math.max(minAltM, altM));
  return (Math.log(a) - Math.log(minAltM)) / (Math.log(maxAltM) - Math.log(minAltM));
}
