import { create } from "zustand";

/**
 * U8 per-building height edit seam (owner 2026-08-18) — the armed-building bridge between the
 * orchestrator (StylizedTiles owns the gesture + geometry) and the BuildingEditChip island
 * (both shells). The globe writes the `armed` mirror at deadband cadence (never 60 fps — the
 * per-frame numbers live on the mesh-pinned DOM label, which is orchestrator-owned); the chip
 * writes exactly one thing back: the RESET one-shot (the flyRequest/consume idiom).
 */

/** The armed building as the chip needs it — plain display data, no engine references. */
export interface BldgEditArmed {
  featureId: number;
  /** MESH SUITE MS1: the armed building's cell identity (with `featureId`, the override key
   *  minus the variant) — plain display data; lets a verify harness address the building. */
  cellUri: string;
  /** Baked ("original") height, m. */
  originalHeightM: number;
  /** Current LIVE height, m (tracks the drag; equals the committed height between drags). */
  liveHeightM: number;
  /** liveHeightM − originalHeightM (the chip's Δ readout). */
  deltaM: number;
  /** A height drag is in progress (ghost preview showing). */
  dragging: boolean;
  /** The committed scale differs from original — RESET is meaningful. */
  overridden: boolean;
}

export interface BldgEditState {
  /** Orchestrator-written mirror; null = disarmed (chip hidden). */
  armed: BldgEditArmed | null;
  _syncArmed(armed: BldgEditArmed | null): void;

  /** RESET one-shot (chip → orchestrator): restore the armed building to its baked height and
   *  drop the stored override. Consumed next frame. */
  resetRequest: boolean;
  requestReset(): void;
  _consumeResetRequest(): void;
}

export const useBldgEditStore = create<BldgEditState>((set) => ({
  armed: null,
  _syncArmed: (armed) => set({ armed }),

  resetRequest: false,
  requestReset: () => set({ resetRequest: true }),
  _consumeResetRequest: () => set({ resetRequest: false }),
}));

// Dev-only introspection (the window.__* DEV-seam registry) — browser verification reads the
// armed mirror and fires RESET without reaching through the UI.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__bldgEditStore = useBldgEditStore;
}
