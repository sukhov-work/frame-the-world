import { create } from "zustand";
import type { BldgEditMenu } from "./bldgEdit";
import {
  IDENTITY_MODEL_EDIT,
  IDENTITY_MODEL_TRANSFORM,
  MODEL_XF_EPS,
  type ModelEdit,
  type ModelTransform,
} from "../lib/models/modelPlacement";

/**
 * MESH SUITE MS5 (D3 placement, 2026-09-02) — the armed USER MODEL bridge between the
 * orchestrator (StylizedTiles owns the pick, the gizmo and the commit) and the ModelEditChip
 * island: the `store/bldgEdit` twin, kept SEPARATE so the building chip, its verify harness and
 * the U8 UX stay byte-identical (the §4a posture). The globe writes the `armed` mirror at deadband
 * cadence; the chip writes back only REQUESTS (the op to switch to, revert one-shots, DONE).
 *
 * A model has three ops — MOVE (the placement itself: the drag's ENU offset folds into a new
 * lat/lon on release), ROTATE (yaw) and SCALE (uniform) — and no EXTRUDE: its height is its own.
 * "Original" for a model is the upload (yaw 0, scale 1); MOVE has no original to revert to (the
 * placement is wherever the member last dropped it), so its row shows the coordinates only.
 */

export type ModelEditOp = "move" | "rotate" | "scale";
export const MODEL_EDIT_OPS: readonly ModelEditOp[] = ["move", "rotate", "scale"];

/** The armed model as the chip needs it — plain display data, no engine references. */
export interface ModelEditArmed {
  id: string;
  title: string;
  /** The member owns it (MS5: only own models arm; MS6 opens editing to every member). */
  mine: boolean;
  /** The COMMITTED placement (the record's). */
  lat: number;
  lon: number;
  /** Footprint size (m, the record's bbox X/Z max) — kept for the harness; null when unknown. */
  sizeM: number | null;
  /** MS5b: the upload's size `[w, d, h]` (m: X, Z, Y of the bounds at scale 1) — the SCALE row,
   *  the menu head and the label print it × the scale; null when unknown. */
  sizeM3: [number, number, number] | null;
  /** A gizmo drag is in progress. */
  dragging: boolean;
  /** The committed seats differ from the upload — RESET ALL is meaningful. */
  overridden: boolean;
  /** The op the orchestrator has APPLIED (the chip highlights it; `state.op` is the ask). */
  op: ModelEditOp;
  /** The committed seats (what the record holds / eases to). */
  committed: ModelTransform;
  /** The LIVE edit — the gizmo's clamped read-back during a drag (offset + seats), else the
   *  committed seats with a zero offset. */
  live: ModelEdit;
  /** A PATCH is in flight / the last one failed (the chip says so). */
  saving: boolean;
  saveError: string | null;
}

export interface ModelEditState {
  /** Orchestrator-written mirror; null = disarmed (chip hidden). */
  armed: ModelEditArmed | null;
  _syncArmed(armed: ModelEditArmed | null): void;

  /** The REQUESTED op (chip tabs / menu / G-R-S keys). Resets to MOVE on disarm. */
  op: ModelEditOp;
  setOp(op: ModelEditOp): void;

  /** Revert one-shot: one op's seat back to the upload, or both (RESET ALL). Consumed next frame. */
  revertRequest: ModelEditOp | "all" | null;
  requestRevert(which: ModelEditOp | "all"): void;
  _consumeRevertRequest(): void;
  requestReset(): void;

  /** The model context menu (right-click desktop / long-press glass); null = closed. */
  menu: BldgEditMenu | null;
  _setMenu(menu: BldgEditMenu | null): void;
  closeMenu(): void;

  /** DONE one-shot (menu → orchestrator disarm). Consumed next frame. */
  disarmRequest: boolean;
  requestDisarm(): void;
  _consumeDisarmRequest(): void;
}

export const useModelEditStore = create<ModelEditState>((set) => ({
  armed: null,
  _syncArmed: (armed) => set(armed ? { armed } : { armed: null, op: "move", menu: null }),

  op: "move",
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

/** Which seat an op owns — the chip's per-row "is this op edited" test and the orchestrator's
 *  per-op revert share it. MOVE owns the placement, which has no original. */
export function modelOpIsEdited(op: ModelEditOp, t: ModelTransform): boolean {
  switch (op) {
    case "move":
      return false;
    case "rotate":
      return Math.abs(t.rotDeg) >= MODEL_XF_EPS.rotDeg;
    case "scale":
      return Math.abs(t.scale - 1) >= MODEL_XF_EPS.scale;
  }
}

/** The seats with ONE op's component (or both) restored to the upload. */
export function revertModelOp(t: ModelTransform, which: ModelEditOp | "all"): ModelTransform {
  switch (which) {
    case "all":
      return { ...IDENTITY_MODEL_TRANSFORM };
    case "move":
      return { ...t };
    case "rotate":
      return { ...t, rotDeg: 0 };
    case "scale":
      return { ...t, scale: 1 };
  }
}

/** The resting live edit for committed seats (no drag in flight). */
export function restingEdit(t: ModelTransform): ModelEdit {
  return { ...IDENTITY_MODEL_EDIT, rotDeg: t.rotDeg, scale: t.scale };
}

// Dev-only introspection (the window.__* DEV-seam registry) — browser verification reads the
// armed mirror and fires the one-shots without reaching through the UI.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__modelEditStore = useModelEditStore;
}
