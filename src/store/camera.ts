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
  setTargetTilt: (deg: number) => void;
  clearTargetTilt: () => void;
  setTargetHeading: (deg: number) => void;
  clearTargetHeading: () => void;
  setTargetZoom: (altM: number) => void;
  clearTargetZoom: () => void;
  /** Direct manipulation (pointer/wheel/touch on the globe) cancels every slider glide. */
  clearAllTargets: () => void;
  /** Orchestrator-only: mirror the live pose into the store (low cadence). */
  _syncTilt: (deg: number) => void;
  _syncHeading: (deg: number) => void;
  _syncZoom: (altM: number) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  tiltDeg: 45,
  targetTiltDeg: null,
  headingDeg: 0,
  targetHeadingDeg: null,
  zoomAltM: 1_100_000, // mirrors POSE.cam.altM until the first live sync lands
  targetZoomAltM: null,
  setTargetTilt: (deg) => set({ targetTiltDeg: deg }),
  clearTargetTilt: () => set({ targetTiltDeg: null }),
  setTargetHeading: (deg) => set({ targetHeadingDeg: deg }),
  clearTargetHeading: () => set({ targetHeadingDeg: null }),
  setTargetZoom: (altM) => set({ targetZoomAltM: altM }),
  clearTargetZoom: () => set({ targetZoomAltM: null }),
  clearAllTargets: () =>
    set({ targetTiltDeg: null, targetHeadingDeg: null, targetZoomAltM: null }),
  _syncTilt: (deg) => set({ tiltDeg: deg }),
  _syncHeading: (deg) => set({ headingDeg: deg }),
  _syncZoom: (altM) => set({ zoomAltM: altM }),
}));

/** Normalize a heading to [0, 360). */
export function wrapHeadingDeg(deg: number): number {
  const w = deg % 360;
  return w < 0 ? w + 360 : w;
}

/** Shortest signed arc from `fromDeg` to `toDeg` (−180..180] — the glide direction. */
export function headingDeltaDeg(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

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
