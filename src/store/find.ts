import { create } from "zustand";
import type { FindBody } from "../lib/ephemeris/frameFinder";

/**
 * FIND v2 seam (owner rework 2026-08-14) — the dedicated FIND panel ↔ globe bridge. The PANEL
 * computes the standings (self-compute, the MwCard precedent: pure frameFinder libs over the
 * live FPV pose + the scrubber instant) and mirrors the capped ghost list here; the globe's
 * findGhosts scene module only renders + hit-tests what it reads. Hover flows BOTH ways:
 * `hoverKey` (panel row → ghost pulse) is React-written, `sceneHoverKey` (canvas hover → row
 * highlight) is globe-written — two fields so neither side fights the other.
 */

/** One projected standing — everything the ghost renderer + hit test need, plain data. */
export interface FindGhost {
  /** `${body}:${utcMs}` — the row ↔ ghost join key. */
  key: string;
  utcMs: number;
  body: FindBody;
  azDeg: number;
  altDeg: number;
  /** Ghost disc/marker angular DIAMETER (deg) — sun/moon true-ish size, GC the tuned marker. */
  discDeg: number;
  /** 0..1 — days-ahead fraction of the search horizon (near→far opacity ramp). */
  tNorm: number;
  /** 0..1 — the FIND_VIS visibility score (the second opacity factor). */
  visibility: number;
  /** Illuminated fraction 0..1 at the hit — the moon's in-sky label appends it as a phase %
   *  (0 for the sun/GC: their labels carry the date alone). */
  illum: number;
  /** FIND_PALETTE index (already cycled by the panel). */
  colorIdx: number;
}

/** Ghost projection cap — the first N standings by date get ghosts (rows beyond stay listed).
 *  Mirrors tuning FINDGHOSTS.maxGhosts (the scene clamps to the smaller of the two). */
export const FIND_GHOST_CAP = 24;

export interface FindState {
  /** Panel visibility (user toggle — the pill stays either way). */
  open: boolean;
  setOpen(open: boolean): void;

  // ── Scan configuration (owner 2026-08-15c) — lifted out of panel-local state so the desktop
  //    panel, the /m FIND sheet AND the SkyContextMenu quick-toggle all read/write ONE truth
  //    (chips no longer reset when the /m sheet remounts). Compute stays in the panels.
  bodies: Record<FindBody, boolean>;
  setBody(body: FindBody, on: boolean): void;
  /** Scan horizon in days — 30 (1M) by default (owner 2026-08-15c). */
  rangeDays: number;
  setRangeDays(days: number): void;

  // ── Panel-written mirror (FindPanel only — the globe reads) ──────────────────────────────
  /** The observer the az/alt directions were computed from; null hides every ghost. */
  anchor: { latDeg: number; lonDeg: number } | null;
  ghosts: readonly FindGhost[];
  _syncGhosts(anchor: FindState["anchor"], ghosts: readonly FindGhost[]): void;

  /** Panel row under the pointer → that ghost pulses (React-written). */
  hoverKey: string | null;
  setHoverKey(key: string | null): void;
  /** Ghost under the canvas pointer → that row highlights (globe-written). */
  sceneHoverKey: string | null;
  _setSceneHover(key: string | null): void;
}

export const useFindStore = create<FindState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),

  // Moon-only by default (owner 2026-08-15: all three at once read as clutter).
  bodies: { sun: false, moon: true, gc: false },
  setBody: (body, on) => set((s) => ({ bodies: { ...s.bodies, [body]: on } })),
  rangeDays: 30,
  setRangeDays: (rangeDays) => set({ rangeDays }),

  anchor: null,
  ghosts: [],
  _syncGhosts: (anchor, ghosts) => set({ anchor, ghosts }),

  hoverKey: null,
  setHoverKey: (hoverKey) => set({ hoverKey }),
  sceneHoverKey: null,
  _setSceneHover: (sceneHoverKey) => set({ sceneHoverKey }),
}));

// Dev-only introspection (the window.__* DEV-seam registry, global.d.ts) so browser verification
// can read the mirrored ghosts and drive the panel without reaching through the UI.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__findStore = useFindStore;
}
