import { create } from "zustand";
import {
  createJournal,
  isBldgTarget,
  sessionEditedTargets,
  targetKey,
  type EditJournal,
  type EditTarget,
} from "../lib/edit/editJournal";
import { sameOverrideState, type OverrideRow } from "../lib/globe/bldgOverrides";
import { samePlacement, type PlacementSnapshot } from "../lib/models/modelPlacement";

/**
 * T126 (owner 2026-09-08b) — the SESSION EDIT JOURNAL seam (MESH_SUITE_PLAN §16): UNDO + "drop this
 * session's edits" for buildings and user models, both shells.
 *
 * ONE journal instance for both domains (a global UNDO / DROP ALL spans them), owned here as a
 * module singleton the two writers reach directly: the orchestrator records every
 * `commitBldgTransform` and restores building rows; the user-models store records every
 * `commitPlacement` and restores placements. The React chips see only the MIRROR below (counts,
 * written at commit / undo / drop / sync time — never per frame) and write back one-shot REQUESTS
 * the orchestrator's frame service consumes (the `store/bldgEdit` pattern): `undoRequest` /
 * `dropRequest` with a SCOPE — the armed building, the armed model, or everything.
 *
 * Snapshots: a building step holds its raw `OverrideRow | null`, a model step its
 * `PlacementSnapshot | null` (lib/models/modelPlacement.ts). The comparator dispatches on the
 * target prefix.
 */

export type EditSnapshot = OverrideRow | PlacementSnapshot;

/** UNDO / DROP scope: the armed building, the armed model, or every mesh (the pill / the menus). */
export type EditScope = "bldg" | "model" | "all";

export const editJournal: EditJournal<EditSnapshot> = createJournal<EditSnapshot>((target, a, b) =>
  isBldgTarget(target)
    ? sameOverrideState(a as OverrideRow | null, b as OverrideRow | null)
    : samePlacement(a as PlacementSnapshot | null, b as PlacementSnapshot | null),
);

export interface EditJournalState {
  /** Entries in the journal (the pill's UNDO shows when > 0). */
  undoable: number;
  /** What the next global UNDO undoes ("extrude" · "move" · "reset" · "drop" …); null when nothing. */
  undoLabel: string | null;
  /** Meshes (buildings + models) whose current state differs from their session baseline. */
  sessionEdits: number;
  _setMirror(patch: Partial<Pick<EditJournalState, "undoable" | "undoLabel" | "sessionEdits">>): void;

  /** One-shots (consumed by the orchestrator's frame service). */
  undoRequest: EditScope | null;
  requestUndo(scope: EditScope): void;
  _consumeUndoRequest(): void;
  dropRequest: EditScope | null;
  requestDrop(scope: EditScope): void;
  _consumeDropRequest(): void;
}

export const useEditJournalStore = create<EditJournalState>((set) => ({
  undoable: 0,
  undoLabel: null,
  sessionEdits: 0,
  _setMirror: (patch) => set(patch),

  undoRequest: null,
  requestUndo: (scope) => set({ undoRequest: scope }),
  _consumeUndoRequest: () => set({ undoRequest: null }),
  dropRequest: null,
  requestDrop: (scope) => set({ dropRequest: scope }),
  _consumeDropRequest: () => set({ dropRequest: null }),
}));

/**
 * `current(target)` — the persisted state a target has NOW, read from its owner: the building
 * half is the orchestrator's local override map (installed at its boot), the model half the
 * user-models store's `placementOf`. Both default to "nothing" until installed.
 */
const currents: {
  bldg: (overrideKey: string) => OverrideRow | null;
  model: (id: string) => PlacementSnapshot | null;
} = { bldg: () => null, model: () => null };
export function setJournalCurrent(domain: "bldg", fn: (overrideKey: string) => OverrideRow | null): void;
export function setJournalCurrent(domain: "model", fn: (id: string) => PlacementSnapshot | null): void;
export function setJournalCurrent(domain: "bldg" | "model", fn: (k: string) => EditSnapshot | null): void {
  (currents as Record<string, (k: string) => EditSnapshot | null>)[domain] = fn;
}
export const journalCurrent = (t: EditTarget): EditSnapshot | null =>
  isBldgTarget(t) ? currents.bldg(targetKey(t)) : currents.model(targetKey(t));

/** Re-mirror the counts after any commit / undo / drop / sync (never per frame). */
export function refreshEditJournalMirror(): void {
  const last = editJournal.entries[editJournal.entries.length - 1] ?? null;
  useEditJournalStore.getState()._setMirror({
    undoable: editJournal.entries.length,
    undoLabel: last?.label ?? null,
    sessionEdits: sessionEditedTargets(editJournal, journalCurrent).length,
  });
}

/** The UNDO button's title for an entry label. */
export function undoTitle(label: string | null, what: "this building" | "this model" | "the last edit"): string {
  const verb: Record<string, string> = {
    extrude: "the height change",
    move: "the move",
    rotate: "the rotation",
    scale: "the scale change",
    reset: "the reset",
    drop: "the dropped session edits",
    place: "the placement",
    edit: "the edit",
  };
  const v = label ? (verb[label] ?? `the ${label}`) : "the last edit";
  return what === "the last edit" ? `Undo ${v} (Ctrl+Z)` : `Undo ${v} on ${what} (Ctrl+Z)`;
}

export const DROP_TITLE_ONE =
  "Drop this session's edits to this mesh — back to how it was when you opened the page or last synced. Synced edits stay.";
export const DROP_TITLE_ALL =
  "Drop this session's edits to every building and model — back to how they were when you opened the page or last synced. Synced edits stay.";

// Dev-only introspection (the window.__* DEV-seam registry) — browser verification reads the
// counts and fires UNDO / DROP without reaching through the UI.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__editJournalStore = useEditJournalStore;
  window.__editJournal = editJournal;
}

export type { EditTarget };
