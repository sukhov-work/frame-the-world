import { create } from "zustand";
import { IDENTITY_TRANSFORM, type FeatureTransform } from "../lib/globe/featureTransform";

/**
 * U8 per-building height edit seam (owner 2026-08-18) — the armed-building bridge between the
 * orchestrator (StylizedTiles owns the gesture + geometry) and the BuildingEditChip island
 * (both shells). The globe writes the `armed` mirror at deadband cadence (never 60 fps — the
 * per-frame numbers live on the mesh-pinned DOM label, which is orchestrator-owned); the chip
 * writes back only REQUESTS: the op to switch to, revert one-shots, DONE.
 *
 * MESH SUITE MS2 (2026-09-02, MESH_SUITE_PLAN §7): the edit grew into four OPS — MOVE / ROTATE /
 * SCALE ride the TransformControls gizmo, EXTRUDE is the U8 drag verbatim (and the default op on
 * arm, so the U8 UX stays byte-identical when only height is edited). The mirror now carries the
 * COMMITTED target and the LIVE transform (they differ only during a drag), the chip shows every
 * op's current vs original with a per-op revert, and a right-click / long-press context menu
 * (`menu`, a static screen point — the SkyContextMenu precedent) offers the same ops.
 */

export type BldgEditOp = "move" | "rotate" | "scale" | "extrude";
export const BLDG_EDIT_OPS: readonly BldgEditOp[] = ["move", "rotate", "scale", "extrude"];

/** MESH SUITE MS3: where the armed building's committed edit lives — "none" (original) ·
 *  "shared" (the world's row applies, nothing pending here) · "dirty" (mine, not yet pushed —
 *  including a pending RESET of a shared edit) · "synced" (mine, pushed). The chip's badge. */
export type BldgEditOrigin = "none" | "shared" | "dirty" | "synced";

/** The armed building as the chip needs it — plain display data, no engine references. */
export interface BldgEditArmed {
  featureId: number;
  /** MESH SUITE MS1: the armed building's cell identity (with `featureId`, the override key
   *  minus the variant) — plain display data; lets a verify harness address the building. */
  cellUri: string;
  /** Baked ("original") height, m. */
  originalHeightM: number;
  /** MS5b: the mapped footprint `[dx, dz]` (m) — the SCALE row prints the current size
   *  `dx·sx × dz·sz` against it (the HEIGHT row's metres precedent). */
  footprintM: [number, number];
  /** Current LIVE height, m (tracks the drag; equals the committed height between drags). */
  liveHeightM: number;
  /** liveHeightM − originalHeightM (the chip's Δ readout). */
  deltaM: number;
  /** A drag is in progress (U8 height drag or a gizmo drag — ghost preview showing). */
  dragging: boolean;
  /** The committed edit differs from the original on ANY component — RESET ALL is meaningful. */
  overridden: boolean;
  /** MS2: the op the orchestrator has APPLIED (the chip highlights it; `state.op` is the ask). */
  op: BldgEditOp;
  /** MS2: the committed edit target (what the mesh eases to / the persisted row). */
  committed: FeatureTransform;
  /** MS2: the LIVE transform — the gizmo's clamped read-back during a drag, else `committed`. */
  live: FeatureTransform;
  /** MS3: where the committed edit lives (world-shared · mine pending · mine pushed · none). */
  origin: BldgEditOrigin;
}

/** The context menu anchor (client px of the right-click / long-press; a static point). */
export interface BldgEditMenu {
  screenX: number;
  screenY: number;
}

export interface BldgEditState {
  /** Orchestrator-written mirror; null = disarmed (chip hidden). */
  armed: BldgEditArmed | null;
  _syncArmed(armed: BldgEditArmed | null): void;

  /** MS2: the REQUESTED op (chip tabs / menu / G-R-S-E keys). The orchestrator applies it in its
   *  per-frame service and mirrors the applied value on `armed.op`. Resets to `extrude` on
   *  disarm — the U8 default for the next arm. */
  op: BldgEditOp;
  setOp(op: BldgEditOp): void;

  /** MS2: revert one-shot (chip ↺ / menu / RESET ALL → orchestrator): one op's components back
   *  to original, or everything (the U8 RESET). Consumed next frame. */
  revertRequest: BldgEditOp | "all" | null;
  requestRevert(which: BldgEditOp | "all"): void;
  _consumeRevertRequest(): void;
  /** U8 compat (the chip's RESET ALL + `verify-bldg-override.mjs` call this): revert all. */
  requestReset(): void;

  /** MS2: the building context menu (right-click desktop / long-press glass); null = closed. */
  menu: BldgEditMenu | null;
  _setMenu(menu: BldgEditMenu | null): void;
  closeMenu(): void;

  /** MS2: DONE one-shot (menu → orchestrator disarm). Consumed next frame. */
  disarmRequest: boolean;
  requestDisarm(): void;
  _consumeDisarmRequest(): void;
}

export const useBldgEditStore = create<BldgEditState>((set) => ({
  armed: null,
  // Disarm resets the per-session asks in ONE place: the next arm starts at EXTRUDE with the
  // menu closed, whatever the last session left behind.
  _syncArmed: (armed) => set(armed ? { armed } : { armed: null, op: "extrude", menu: null }),

  op: "extrude",
  setOp: (op) => set({ op }),

  revertRequest: null,
  requestRevert: (which) => set({ revertRequest: which }),
  _consumeRevertRequest: () => set({ revertRequest: null }),
  requestReset: () => set({ revertRequest: "all" }),

  menu: null,
  _setMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),

  disarmRequest: false,
  requestDisarm: () => set({ disarmRequest: true }),
  _consumeDisarmRequest: () => set({ disarmRequest: false }),
}));

/** Which components of a transform an op owns — the chip's per-row "is this op edited" test
 *  and the orchestrator's per-op revert share it. */
export function opIsEdited(op: BldgEditOp, t: FeatureTransform): boolean {
  switch (op) {
    case "move":
      return Math.abs(t.tE) >= 0.01 || Math.abs(t.tN) >= 0.01 || Math.abs(t.tU) >= 0.01;
    case "rotate":
      return Math.abs(t.rotDeg) >= 0.05;
    case "scale":
      return Math.abs(t.sx - 1) >= 0.005 || Math.abs(t.sz - 1) >= 0.005;
    case "extrude":
      return Math.abs(t.sy - 1) >= 0.005;
  }
}

/** The transform with ONE op's components (or all of them) restored to the original. */
export function revertOp(t: FeatureTransform, which: BldgEditOp | "all"): FeatureTransform {
  switch (which) {
    case "all":
      return { ...IDENTITY_TRANSFORM };
    case "move":
      return { ...t, tE: 0, tN: 0, tU: 0 };
    case "rotate":
      return { ...t, rotDeg: 0 };
    case "scale":
      return { ...t, sx: 1, sz: 1 };
    case "extrude":
      return { ...t, sy: 1 };
  }
}

// Dev-only introspection (the window.__* DEV-seam registry) — browser verification reads the
// armed mirror and fires RESET without reaching through the UI.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__bldgEditStore = useBldgEditStore;
}
