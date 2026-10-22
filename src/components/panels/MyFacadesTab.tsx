import { useState } from "react";
import { useFacadesStore, type FacadeMinePhase } from "../../store/facades";
import { useFacadePhotoStore } from "../../store/facadePhoto";
import { isFacadeSaveBusy, useFacadeSaveStore } from "../../store/facadeSave";
import { facadePoseLine, type FacadeListItem } from "../../lib/wix/facadeRecords";

/**
 * MY CONTENT · TEXTURES (T179, owner 2026-10-22) — the member's saved facade photos (the "texture
 * pins" projected onto the buildings): the fifth tab of the MY CONTENT panel, on the panel's own
 * row rhythm (`.mp-row` / `.mp-item` / `.mp-acts` / `.mp-del`) and the MODELS tab's split — a pure
 * view taking its state as props (zustand 5 serves a hook its INITIAL state under
 * renderToStaticMarkup) + the connected default export owning the per-row UI state.
 *
 * Rows come from `store/facades` (`mine` — the one owner of the rows the globe also projects);
 * the host re-asks `loadMine()` on every open of the tab (the panel's fresh-fetch idiom).
 * A row: thumb (`thumbUrl ?? displayUrl`) · title · `YYYY-MM-DD · N 48.46470 E 35.04620 · 90.0°`
 * · OPEN (= `openSaved`, the panel closes) · ✕ → SURE? (two-press delete → `deleteFacadeById`,
 * which drops the row from `mine` and clears the placed photo when it is that row).
 */

export interface MyFacadesActions {
  /** Row click / OPEN: re-open the saved row as the placed photo. */
  open(item: FacadeListItem): void;
  /** ✕ — first press arms (SURE?), the second deletes. */
  remove(item: FacadeListItem): void;
  /** The load-error RETRY. */
  retry(): void;
}

export interface MyFacadesViewState {
  facades: readonly FacadeListItem[];
  phase: FacadeMinePhase;
  /** The list load's error (the store's `mineError`). */
  loadError: string | null;
  /** An action's failure — a note ABOVE the list, never instead of it (the models' 2026-09-19 lesson). */
  error: string | null;
  armedDeleteId: string | null;
  /** A DELETE in flight for this row. */
  busyId: string | null;
}

/** The row's fact line: the saved date + the pose (+ `· N BLDG` once the record knows which
 *  buildings it paints — T172 / F5). */
export function facadeRowSub(item: FacadeListItem): string {
  const date = item.createdAt ? item.createdAt.slice(0, 10) : "";
  const pose = facadePoseLine(item);
  const line = date ? `${date} · ${pose}` : pose;
  const n = Array.isArray(item.targetFeatureIds) ? item.targetFeatureIds.length : 0;
  return n > 0 ? `${line} · ${n} BLDG` : line;
}

export function MyFacadesTabView({ state, actions }: { state: MyFacadesViewState; actions: MyFacadesActions }) {
  const { facades, phase, loadError, error, armedDeleteId, busyId } = state;
  const actionNote = error ? (
    <div className="mp-note mp-note--warn" role="status" data-note="action-error">
      {error.toUpperCase()} — TRY AGAIN
    </div>
  ) : null;
  if (phase === "error" && facades.length === 0) {
    return (
      <div className="mp-note mp-note--warn" data-note="load-error">
        COULD NOT LOAD — {(loadError ?? "unknown error").toUpperCase()}{" "}
        <button type="button" className="mp-act" data-act="retry" onClick={actions.retry}>
          RETRY
        </button>
      </div>
    );
  }
  if (phase === "anonymous") return <div className="mp-note">SIGN IN TO SEE YOUR TEXTURES.</div>;
  if ((phase === "loading" || phase === "idle") && facades.length === 0) return <div className="mp-note">LOADING…</div>;
  if (facades.length === 0) {
    return (
      <>
        {actionNote}
        <div className="mp-note" data-note="empty">
          No textures yet — drop a facade photo in Upload.
        </div>
      </>
    );
  }
  return (
    <>
      {actionNote}
      <ul className="mp-list" data-tab="textures">
        {facades.map((item) => {
          const busy = busyId === item.id;
          const thumbSrc = item.thumbUrl ?? item.displayUrl;
          return (
            <li key={item.id} className="mp-row" data-facade-row={item.id}>
              <button
                type="button"
                className="mp-item"
                title="Open on the globe"
                disabled={busy}
                onClick={() => actions.open(item)}
              >
                {thumbSrc ? (
                  <img className="mp-thumb" src={thumbSrc} alt="" loading="lazy" />
                ) : (
                  <span className="mp-thumb mp-thumb--empty" aria-hidden="true" />
                )}
                <span className="mp-meta">
                  <span className="mp-name" title={item.title}>
                    {item.title}
                  </span>
                  <span className="mp-sub">{facadeRowSub(item)}</span>
                </span>
              </button>
              <span className="mp-acts">
                <button
                  type="button"
                  className="mp-act"
                  data-act="open"
                  title="Open on the globe"
                  aria-label={`Open ${item.title}`}
                  disabled={busy}
                  onClick={() => actions.open(item)}
                >
                  OPEN
                </button>
                <button
                  type="button"
                  className={`mp-del${armedDeleteId === item.id ? " is-armed" : ""}`}
                  data-act="delete"
                  title={armedDeleteId === item.id ? "Press again to delete" : "Delete this texture"}
                  aria-label={`Delete texture ${item.title}`}
                  disabled={busyId !== null}
                  onClick={() => actions.remove(item)}
                >
                  {busy ? "…" : armedDeleteId === item.id ? "SURE?" : "✕"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The connected tab: the store's own rows + the per-row UI state; `onClose` closes the panel
 *  after OPEN (the PLACES-row precedent). */
export default function MyFacadesTab({ onClose }: { onClose: () => void }) {
  const facades = useFacadesStore((s) => s.mine);
  const phase = useFacadesStore((s) => s.minePhase);
  const loadError = useFacadesStore((s) => s.mineError ?? null);
  const [error, setError] = useState<string | null>(null);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const actions: MyFacadesActions = {
    open: (item) => {
      setArmedDeleteId(null);
      useFacadePhotoStore.getState().openSaved(item);
      onClose();
    },
    remove: async (item) => {
      if (armedDeleteId !== item.id) {
        setArmedDeleteId(item.id);
        return;
      }
      setArmedDeleteId(null);
      const save = useFacadeSaveStore.getState();
      if (isFacadeSaveBusy(save.phase)) {
        // deleteFacadeById refuses while another write runs (the B15 guard) — say so, not nothing.
        setError("another save is in progress");
        return;
      }
      setBusyId(item.id);
      setError(null);
      await save.deleteFacadeById(item.id);
      setBusyId(null);
      const after = useFacadeSaveStore.getState();
      if (after.phase === "error") setError(after.error ?? "delete failed");
    },
    retry: () => {
      setError(null);
      void useFacadesStore.getState().loadMine();
    },
  };

  return (
    <MyFacadesTabView state={{ facades, phase, loadError, error, armedDeleteId, busyId }} actions={actions} />
  );
}
