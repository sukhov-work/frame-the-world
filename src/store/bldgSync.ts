import { create } from "zustand";

/**
 * MESH SUITE MS3 (2026-09-02) — the world-sync seam between the orchestrator (StylizedTiles owns
 * the fetch, the merge, the local map and the POST) and the SYNC affordances in the
 * BuildingEditChip island (the chip foot while a building is armed, the context menu, and the
 * standalone pill while nothing is armed but edits are pending). The globe writes the counters;
 * the chip writes back ONE request: sync now. The member gate (sign in to sync) is read from
 * store/member by the island itself.
 */

export type BldgWorldPhase = "idle" | "fetching" | "ready" | "error";

export type BldgSyncResultKind =
  /** The push landed (counts below). */
  | "synced"
  /** Nothing was pending. */
  | "nothing"
  /** The server refused: no member session (401) — sign in, then SYNC again. */
  | "signed-out"
  /** The server refused the payload (400) — a client/server contract drift; `message` says which. */
  | "rejected"
  /** Network / 5xx — the rows stay pending; try again. */
  | "failed";

export interface BldgSyncResult {
  kind: BldgSyncResultKind;
  upserted: number;
  removed: number;
  atMs: number;
  message?: string;
}

export interface BldgSyncState {
  /** The world fetch for the resolved bake variant. */
  world: BldgWorldPhase;
  /** World rows held after the last reconcile. */
  shared: number;
  /** The last fetch reached the end of the world's rows (a partial one never deletes locally). */
  complete: boolean;
  /** My pending rows — edits + pending resets (tombstones). The SYNC button's number. */
  dirty: number;
  /** A push is in flight. */
  syncing: boolean;
  /** The last push's outcome (null until one ran). */
  result: BldgSyncResult | null;

  /** One-shot: the chip / pill / menu asks the orchestrator to push now. Consumed next frame. */
  syncRequest: boolean;
  requestSync(): void;
  _consumeSyncRequest(): void;

  /** Orchestrator-written mirror. */
  _set(patch: Partial<Pick<BldgSyncState, "world" | "shared" | "complete" | "dirty" | "syncing" | "result">>): void;
}

export const useBldgSyncStore = create<BldgSyncState>((set) => ({
  world: "idle",
  shared: 0,
  complete: false,
  dirty: 0,
  syncing: false,
  result: null,

  syncRequest: false,
  requestSync: () => set({ syncRequest: true }),
  _consumeSyncRequest: () => set({ syncRequest: false }),

  _set: (patch) => set(patch),
}));

// Dev-only introspection (the window.__* DEV-seam registry, src/global.d.ts) — browser
// verification reads the counters and fires SYNC without reaching through the UI.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__bldgSyncStore = useBldgSyncStore;
}
