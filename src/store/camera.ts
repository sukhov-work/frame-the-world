import { create } from "zustand";
import type { UrlFpvPose } from "../lib/geo/urlPose";
import { loadViewPrefs, saveViewPref } from "../lib/prefs";

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
interface FlyRequest {
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

/** The tracked sky target's edge-chip marker (ASTRO ENGINE phase C) — a body marker plus what
 *  the chip face needs to say WHICH object it points at. */
interface SkyTargetMarker extends FpvBodyMarker {
  /** Kind glyph (☄ ◉ ❍ …) — the chip face. */
  glyph: string;
  /** Shortest honest designation ("10P" · "MARS" · "M31") — the chip label + aria text. */
  label: string;
}

/** Sky-body direction markers (every mode): sun/moon ride the right-panel SKY-guides chip;
 *  the tracked target rides the TARGET panel's SHOW toggle — each slot null when its gate is
 *  off, the whole mirror null when nothing wants markers. */
interface SkyMarkers {
  sun: FpvBodyMarker | null;
  moon: FpvBodyMarker | null;
  target: SkyTargetMarker | null;
}

/** FPV HUD mirror — camera-view bearings + focal state + sky-body markers. */
interface FpvHud {
  /** Compass azimuth of the view centre (deg; 0 = north, 90 = east). */
  headingDeg: number;
  /** Elevation of the view centre (deg; + = up). */
  pitchDeg: number;
  /** Live camera vertical FOV (deg) — the HUD derives the 35mm-equivalent focal length. */
  fovDeg: number;
  /** Live camera aspect (width/height) — with fovDeg it fixes the frame rectangle (the rail
   *  trace's in-frame test §3.1.D; the QoL-2 frameFinder pose). */
  aspect: number;
  /** Eye height above the local ground (m) — the ALTITUDE encoder readout. */
  eyeAboveGroundM: number;
  sun: FpvBodyMarker;
  moon: FpvBodyMarker;
}

/** The viewer's ground point (owner 2026-07-14): the geodetic lat/lon directly under the camera
 *  plus the rendered terrain height there — the precise, copyable "where am I standing" readout
 *  the left HUD shows in EVERY mode (orbit and FPV alike). */
interface CamGeo {
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
  /** FPV walk stick (MOBILE_PLAN §4.1, M2): the mobile joystick's analog deflection, −1..1 per
   *  axis (fwd + = walk where you look, right + = strafe right); null = stick released. The
   *  orchestrator integrates it into the world-space walk offset each frame alongside the
   *  arrow keys (the 2026-08-11 pivot invariant: only INPUT mutates the offset — a head-turn
   *  never does). Deliberately NOT cleared by clearAllTargets: the canvas pointerdown that
   *  fires it is the FPV look-drag itself, and walking while looking is the joystick's whole
   *  point — the stick component owns the null-on-release lifecycle instead. */
  fpvWalkInput: { fwd: number; right: number } | null;
  setFpvWalkInput: (v: { fwd: number; right: number } | null) => void;
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
  /** Ground surface mode (Phase 5.5 S7a; default flipped 2026-07-21): 'satellite' (default) =
   *  the Esri imagery look at every altitude; 'dark' = the CARTO dark drape owns the ground
   *  below DRAPE.fadeTopAltM (the SAT chip on the camera panel toggles, persisted). */
  groundMode: "dark" | "satellite";
  setGroundMode: (mode: "dark" | "satellite") => void;
  /** Public-pin markers master toggle (owner 2026-07-15, PIN chip): ON (default) = pins render
   *  and pick on the globe; OFF = markers hidden + unpickable (viewport queries keep running so
   *  re-show is instant). FPV entry hides them by default (declutter) and exit restores the
   *  pre-FPV state unless the chip was flipped back on inside FPV. */
  pinsVisible: boolean;
  setPinsVisible: (on: boolean) => void;
  /** One-shot "stand in this first-person viewpoint" request (saved places, owner 2026-07-15):
   *  the full `#f=` pose. The orchestrator consumes it next frame — drops a temp pin at the
   *  location and enters temp-pin FPV through the exact share-link path (same basis/eye/FOV
   *  reconstruction), flying there cinematically from wherever the camera currently is. */
  fpvJumpRequest: UrlFpvPose | null;
  requestFpvJump: (pose: UrlFpvPose) => void;
  /** Orchestrator-only: mark the pending FPV jump consumed. */
  _consumeFpvJump: () => void;
  /** Sky-body direction markers (every mode) — feeds the ☀/☾ + tracked-target edge chips;
   *  outside FPV the bearings reference is the camera's own geodetic position. */
  skyMarkers: SkyMarkers | null;
  /** One-shot "bring this sky direction into view" request (owner 2026-07-14: clicking an
   *  off-frame ☀/☾ edge chip). While FPV is active the orchestrator glides fpvYaw/fpvPitch
   *  toward it and clears it on arrival; outside FPV the chip resolves it directly into the
   *  existing heading/tilt glide targets. Any direct look interaction cancels it. */
  skyLook: { azDeg: number; altDeg: number } | null;
  requestSkyLook: (target: { azDeg: number; altDeg: number }) => void;
  /** Orchestrator-only: the glide arrived (or was cancelled). */
  _clearSkyLook: () => void;
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
  /** FPV building shading (0..1, owner ask; default 1 since 2026-07-21): 0 = the see-through
   *  wireframe look, 1 (default) = fully shaded solid. Raises the auto eye-height ghost curve
   *  UPWARD (max), so lowering it restores the ghost look. Persisted (BUILDINGS slider). */
  fpvBuildingSolidity: number;
  setFpvBuildingSolidity: (v: number) => void;
  /** Orchestrator-only: mirror the FPV HUD state (low cadence; null = FPV inactive). */
  _syncFpvHud: (hud: FpvHud | null) => void;
  /** Orchestrator-only: mirror the sky-body markers (low cadence; null = nothing wants them). */
  _syncSkyMarkers: (m: SkyMarkers | null) => void;
  /** Direct manipulation (pointer/wheel/touch on the globe) cancels every slider glide. */
  clearAllTargets: () => void;
  /** Orchestrator-only: mirror the live pose into the store (low cadence). */
  _syncTilt: (deg: number) => void;
  _syncHeading: (deg: number) => void;
  _syncZoom: (altM: number) => void;
  _syncFocus: (latDeg: number, lonDeg: number) => void;
  _syncCamGeo: (g: CamGeo | null) => void;
}

// Reload-surviving view choices (owner 2026-07-21) — read once at module load (client:only
// islands ⇒ browser-only; tests/SSR degrade to {} inside loadViewPrefs).
const stored = loadViewPrefs();

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
  skyGuides: stored.skyGuides ?? true,
  setSkyGuides: (on) => {
    saveViewPref("skyGuides", on);
    set({ skyGuides: on });
  },
  groundMode: stored.groundMode ?? "satellite",
  setGroundMode: (mode) => {
    saveViewPref("groundMode", mode);
    set({ groundMode: mode });
  },
  pinsVisible: stored.pinsVisible ?? true,
  // NOT persisted here: the orchestrator's FPV declutter (hide on entry / restore on exit) flows
  // through this same setter — only the PIN chip writes the preference (CameraTiltPanel).
  setPinsVisible: (on) => set({ pinsVisible: on }),
  fpvJumpRequest: null,
  requestFpvJump: (pose) => set({ fpvJumpRequest: pose }),
  _consumeFpvJump: () => set({ fpvJumpRequest: null }),
  skyMarkers: null,
  skyLook: null,
  requestSkyLook: (target) => set({ skyLook: target }),
  _clearSkyLook: () => set({ skyLook: null }),
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
  fpvWalkInput: null,
  setFpvWalkInput: (v) =>
    set({
      fpvWalkInput:
        v === null
          ? null
          : {
              fwd: Math.max(-1, Math.min(1, v.fwd)),
              right: Math.max(-1, Math.min(1, v.right)),
            },
    }),
  fpvBuildingSolidity: stored.fpvBuildingSolidity ?? 1,
  setFpvBuildingSolidity: (v) => {
    const clamped = Math.max(0, Math.min(1, v));
    saveViewPref("fpvBuildingSolidity", clamped);
    set({ fpvBuildingSolidity: clamped });
  },
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
      skyLook: null,
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

// Dev-only introspection (the window.__* DEV-seam registry, global.d.ts) — same dual-instance
// caveat as store/time.ts: always probe THIS handle, never a page-context /src import.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__cameraStore = useCameraStore;
}
