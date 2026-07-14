import { create } from "zustand";

/**
 * FPV mini-map mirror (owner 2026-07-14) — the panels↔globe seam for the small square 2D map.
 * The globe-side feed (scene/minimapFeed.ts) owns ALL computation: it reuses the shared MVT
 * cache (scene/vectorTiles.ts), projects roads/water/green/building footprints into LOCAL
 * METRES around a slow-moving origin (east = +x, north = +y), and mirrors two channels here:
 *  • `scene` — the feature payload; rebuilt only when tiles land or the viewer walks
 *    MINIMAP.rebuildDistM from the origin (never per frame).
 *  • `pose` — the viewer offset from that origin + heading, at the FPV HUD cadence (~20 Hz).
 * The panel (panels/MiniMap.tsx) just draws a canvas from this store. Both null outside FPV.
 */

/** One stroked polyline in origin-local metres: [x0,y0, x1,y1, ...]. */
export interface MiniMapLine {
  /** Ground stroke width (m) — the panel scales it to pixels (clamped to stay readable). */
  widthM: number;
  /** Ink family: road | waterway — the panel picks the token colour. */
  kind: "road" | "waterway";
  bridge: boolean;
  pts: Float32Array;
}

/** One filled ring (holes ignored at mini-map scale): [x0,y0, x1,y1, ...]. */
export interface MiniMapFill {
  kind: "water" | "green" | "building";
  pts: Float32Array;
}

export interface MiniMapScene {
  /** Geodetic origin the local metres are measured from. */
  originLatDeg: number;
  originLonDeg: number;
  lines: MiniMapLine[];
  fills: MiniMapFill[];
}

export interface MiniMapPose {
  /** Viewer offset from the scene origin (m; east/north). */
  dxM: number;
  dyM: number;
  /** Compass heading of the view centre (deg; 0 = north) — drives the view wedge. */
  headingDeg: number;
}

interface MiniMapState {
  scene: MiniMapScene | null;
  pose: MiniMapPose | null;
  /** Ground patch shown edge-to-edge (m) — mirrored from MINIMAP.patchM so the panel needs no
   *  globe import (the design fence). */
  patchM: number;
  /** Orchestrator-only mirrors (scene/minimapFeed.ts). */
  _syncScene: (scene: MiniMapScene | null) => void;
  _syncPose: (pose: MiniMapPose | null) => void;
  _syncPatchM: (m: number) => void;
}

export const useMiniMapStore = create<MiniMapState>((set) => ({
  scene: null,
  pose: null,
  patchM: 200,
  _syncScene: (scene) => set({ scene }),
  _syncPose: (pose) => set({ pose }),
  _syncPatchM: (m) => set({ patchM: m }),
}));

// Dev-only introspection (mirrors window.__planStore) so browser verification can read the
// mirrored features/pose without reaching through the UI. No secrets, no behaviour change.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__minimapStore = useMiniMapStore;
}
