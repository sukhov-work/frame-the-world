import { FACADE_GIZMO_OPS, useFacadePhotoStore, type FacadeGizmoOp } from "../../store/facadePhoto";
import { useBldgEditStore } from "../../store/bldgEdit";
import { useModelEditStore } from "../../store/modelEdit";
import {
  DROP_TITLE_ONE,
  editJournal,
  journalCurrent,
  undoTitle,
  useEditJournalStore,
  type EditScope,
} from "../../store/editJournal";
import { facadeTarget, hasSessionEdits, peekUndo, undoableCount } from "../../lib/edit/editJournal";
import "../../styles/building-edit.css";

/**
 * Facade edit chip (T175, owner 2026-10-22: "quick MOVE / ROTATE / SCALE buttons beside UNDO and
 * DROP SESSION, for easier switching and UX") — the ModelEditChip's twin on the same CSS
 * (`.bldg-edit-chip` / `.bec-*`, root `data-kind="facade"`) for the PLACED facade photo: the gizmo
 * op strip (OFF · MOVE · ROTATE · SCALE — the store's `gizmoOp`, the docked panel's GIZMO row) and
 * the foot's ↶ UNDO / DROP SESSION for THIS facade (the draft, or the row under edit), so the op
 * switches without the docked panel. Desktop-only mount (index.astro, beside ModelEditChip): the
 * facade flow has no /m entry.
 *
 * The counts are computed off the journal for this facade's target (the FacadePhotoFlow idiom —
 * the mirror's `undoable` / `sessionEdits` span buildings and models too, so they are the
 * RE-RENDER trigger only). Writes back only the store's `setGizmoOp` and the journal one-shots
 * (`requestUndo("facade")` / `requestDrop("facade")` — the orchestrator's `journalScopeTarget`
 * resolves the scope to the placed facade). It YIELDS while a building or a model is armed: the
 * three chips share one fixed slot and the armed mesh's chip owns it then.
 */

export const FACADE_OP_LABEL: Record<FacadeGizmoOp, string> = { none: "OFF", move: "MOVE", rotate: "ROTATE", scale: "SCALE" };
export const FACADE_OP_TITLE: Record<FacadeGizmoOp, string> = {
  none: "No gizmo — the sliders and the nudge pad only",
  move: "Drag the arrows — east / north / up",
  rotate: "Drag the rings — heading / pitch / roll",
  scale: "Drag a box — the field of view, never a stretch",
};

/** What the chip writes back — passed as props so the view is pure (zustand 5 renders a store
 *  hook's INITIAL state under renderToStaticMarkup). */
export interface FacadeEditActions {
  setGizmoOp(op: FacadeGizmoOp): void;
  requestUndo(scope: EditScope): void;
  requestDrop(scope: EditScope): void;
}

export interface FacadeEditView {
  gizmoOp: FacadeGizmoOp;
  /** Journal entries touching this facade (the foot's UNDO shows when > 0). */
  undoable: number;
  /** What the next UNDO on this facade undoes ("move" · "rotate" · "scale" · "drop" …). */
  undoLabel: string | null;
  /** This facade differs from its session baseline (DROP SESSION shows). */
  sessionEdited: boolean;
}

export default function FacadeEditChip() {
  const placed = useFacadePhotoStore((s) => s.phase === "placed");
  const gizmoOp = useFacadePhotoStore((s) => s.gizmoOp);
  const savedFacadeId = useFacadePhotoStore((s) => s.savedFacadeId);
  const setGizmoOp = useFacadePhotoStore((s) => s.setGizmoOp);
  const requestUndo = useEditJournalStore((s) => s.requestUndo);
  const requestDrop = useEditJournalStore((s) => s.requestDrop);
  // Re-render triggers only (the mirror is re-written at every commit / undo / drop / sync).
  useEditJournalStore((s) => s.undoable);
  useEditJournalStore((s) => s.sessionEdits);
  const bldgArmed = useBldgEditStore((s) => s.armed !== null);
  const modelArmed = useModelEditStore((s) => s.armed !== null);
  if (!placed || bldgArmed || modelArmed) return null;
  const target = facadeTarget(savedFacadeId ?? "draft");
  const view: FacadeEditView = {
    gizmoOp,
    undoable: undoableCount(editJournal, target),
    undoLabel: peekUndo(editJournal, target)?.label ?? null,
    sessionEdited: hasSessionEdits(editJournal, journalCurrent, target),
  };
  return <FacadeEditChipView view={view} actions={{ setGizmoOp, requestUndo, requestDrop }} />;
}

export function FacadeEditChipView({ view, actions }: { view: FacadeEditView; actions: FacadeEditActions }) {
  const { setGizmoOp, requestUndo, requestDrop } = actions;
  return (
    <div className="bldg-edit-chip" role="status" data-kind="facade" data-facade-chip>
      <div className="bec-ops" role="tablist" aria-label="Facade gizmo op">
        <span className="bec-kind">FACADE</span>
        {FACADE_GIZMO_OPS.map((op) => (
          <button
            key={op}
            type="button"
            role="tab"
            aria-selected={view.gizmoOp === op}
            className={`bec-op${view.gizmoOp === op ? " is-on" : ""}`}
            data-op={op}
            title={FACADE_OP_TITLE[op]}
            onClick={() => setGizmoOp(op)}
          >
            {FACADE_OP_LABEL[op]}
          </button>
        ))}
      </div>
      <div className="bec-foot">
        {view.undoable > 0 && (
          <button
            type="button"
            className="bec-undo"
            data-act="undo"
            title={undoTitle(view.undoLabel, "the last edit")}
            onClick={() => requestUndo("facade")}
          >
            ↶ UNDO
          </button>
        )}
        {view.sessionEdited && (
          <button type="button" className="bec-drop" data-act="drop-session" title={DROP_TITLE_ONE} onClick={() => requestDrop("facade")}>
            DROP SESSION
          </button>
        )}
        <span className="bec-hint bec-hint--desktop">
          {view.gizmoOp === "none" ? "pick an op to edit on the globe" : "drag a handle on the frustum"}
        </span>
      </div>
    </div>
  );
}
