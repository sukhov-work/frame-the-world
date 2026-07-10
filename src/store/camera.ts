import { create } from "zustand";

/**
 * Camera declination (tilt) — the seam between the tilt slider (panels/CameraTiltPanel) and the
 * globe orchestrator (StylizedTiles), mirroring the store/time.ts pattern.
 *
 * Convention: 0° = straight down (nadir), 90° = level with the horizon — the same pitch angle
 * GlobeControls clamps internally.
 *
 *  • `tiltDeg` mirrors the LIVE camera pitch; the orchestrator writes it at low cadence (never
 *    60 fps) and the panel only displays it.
 *  • `targetTiltDeg` is a request: the slider sets it, the orchestrator glides the camera toward
 *    it each frame (CONTROLS.tiltEaseTauMs) and clears it on arrival. Grabbing the globe also
 *    clears it — direct manipulation always wins over the slider.
 */
export interface CameraState {
  /** Live camera pitch (deg; 0 = nadir, 90 = horizon). Display-only for the UI. */
  tiltDeg: number;
  /** Requested pitch (deg) the orchestrator is gliding toward; null = no glide in progress. */
  targetTiltDeg: number | null;
  setTargetTilt: (deg: number) => void;
  clearTargetTilt: () => void;
  /** Orchestrator-only: mirror the live pitch into the store. */
  _syncTilt: (deg: number) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  tiltDeg: 45,
  targetTiltDeg: null,
  setTargetTilt: (deg) => set({ targetTiltDeg: deg }),
  clearTargetTilt: () => set({ targetTiltDeg: null }),
  _syncTilt: (deg) => set({ tiltDeg: deg }),
}));
