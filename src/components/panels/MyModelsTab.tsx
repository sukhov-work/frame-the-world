import { useState } from "react";
import { useCameraStore } from "../../store/camera";
import { useUserModelsStore, type MinePhase } from "../../store/userModels";
import type { ModelListItem } from "../../lib/wix/modelRecords";
import { MODEL_TITLE_MAX } from "../../lib/wix/modelRecords";
import { formatDims } from "../../lib/format/readout";
import { formatTris } from "../../lib/models/modelCaps";
import { modelStandpoint } from "../../lib/models/modelPlacement";
import { startModelPlacement } from "./ModelUploadStep";

/**
 * MY PINS · MODELS (MESH SUITE MS6, 2026-09-02m) — the member's uploaded 3D models: the fourth tab
 * of the MY PINS panel, on the panel's own row rhythm (`.mp-row` / `.mp-item` / `.mp-del`). Reads
 * `store/userModels` (`mine`) instead of a per-open fetch so a rename, a hide or a delete swaps
 * the world at once (the store's optimistic path). Desktop-only by mount: models have no /m entry.
 *
 * A row: OUR thumbnail (the platform's is a permanent 403) or the dashed placeholder · the title ·
 * `w × d × h m · N tris` at the committed scale · badges (HIDDEN · PROCESSING · FAILED · NOT PLACED
 * · EDITED — another member re-edited it) · trailing ✎ (rename inline: Enter saves, Escape cancels)
 * · HIDE / SHOW · ✕ → SURE? (the two-press delete). A click on a PLACED row stands beside the model
 * in first-person view (the PLACES-row jump — FPV is where editing works); an UNPLACED row starts
 * click-to-place on the globe. Hidden models leave the world, not the link (the MS0 consequence —
 * the foot says so whenever a row is hidden).
 *
 * The view takes its state as props (zustand 5 serves a hook its INITIAL state under
 * renderToStaticMarkup); the connected component owns the per-row UI state.
 */

export interface MyModelsActions {
  /** Row click: stand beside a placed model / start placing an unplaced one. */
  open(m: ModelListItem): void;
  beginRename(m: ModelListItem): void;
  cancelRename(): void;
  setDraft(title: string): void;
  commitRename(m: ModelListItem): void;
  toggleHidden(m: ModelListItem): void;
  remove(m: ModelListItem): void;
}

export interface MyModelsViewState {
  models: readonly ModelListItem[];
  phase: MinePhase;
  error: string | null;
  /** Two-press delete: the row whose ✕ was pressed once. */
  armedDeleteId: string | null;
  /** A PATCH / DELETE in flight for this row (its controls are disabled). */
  busyId: string | null;
  /** The row being renamed + the draft title. */
  renamingId: string | null;
  draft: string;
}

const BADGE_TITLE = {
  hidden: "Hidden from the world — the file stays public by URL",
  processing: "The platform is still processing the file",
  failed: "The platform could not process the file",
  unplaced: "Not on the globe yet — click the row to place it",
  edited: "Another member moved, turned or resized this model",
} as const;

/** The row's fact line: the CURRENT size (the upload's bounds × the committed scale, w × d × h)
 *  and the triangle count. */
export function modelRowSub(m: ModelListItem): string {
  const parts: string[] = [];
  if (m.bbox) parts.push(formatDims([m.bbox[0] * m.scale, m.bbox[2] * m.scale, m.bbox[1] * m.scale]));
  if (m.tris !== null) parts.push(`${formatTris(m.tris)} TRIS`);
  return parts.join(" · ");
}

/** The badges a row wears, in display order. */
export function modelRowBadges(m: ModelListItem): Array<{ key: keyof typeof BADGE_TITLE; label: string }> {
  const out: Array<{ key: keyof typeof BADGE_TITLE; label: string }> = [];
  if (m.hidden) out.push({ key: "hidden", label: "HIDDEN" });
  if (m.readiness === "PENDING") out.push({ key: "processing", label: "PROCESSING" });
  if (m.readiness === "FAILED") out.push({ key: "failed", label: "FAILED" });
  if (m.lat === null || m.lon === null) out.push({ key: "unplaced", label: "NOT PLACED" });
  if (m.editedByOther) out.push({ key: "edited", label: "EDITED" });
  return out;
}

export function MyModelsTabView({ state, actions }: { state: MyModelsViewState; actions: MyModelsActions }) {
  const { models, phase, error, armedDeleteId, busyId, renamingId, draft } = state;
  if (error) return <div className="mp-note mp-note--warn">COULD NOT LOAD — {error.toUpperCase()}</div>;
  if (phase === "loading" && models.length === 0) return <div className="mp-note">LOADING…</div>;
  if (models.length === 0) {
    return (
      <div className="mp-note">
        No models yet — drop a GLB, OBJ or FBX in UPLOAD; once stored it is listed here.
      </div>
    );
  }
  const anyHidden = models.some((m) => m.hidden);
  return (
    <>
      <ul className="mp-list" data-tab="models">
        {models.map((m) => {
          const placed = m.lat !== null && m.lon !== null;
          const busy = busyId === m.id;
          const renaming = renamingId === m.id;
          const thumb = m.thumbnailUrl ? (
            <img className="mp-thumb" src={m.thumbnailUrl} alt="" loading="lazy" />
          ) : (
            <span className="mp-thumb mp-thumb--model" aria-hidden="true">
              ◆
            </span>
          );
          return (
            <li key={m.id} className="mp-row" data-model-id={m.id} data-hidden={m.hidden ? "true" : undefined}>
              {renaming ? (
                <div className="mp-item mp-item--static mp-item--rename">
                  {thumb}
                  <span className="mp-rename">
                    <input
                      className="mp-rename__input"
                      autoFocus
                      value={draft}
                      maxLength={MODEL_TITLE_MAX}
                      placeholder="NAME THIS MODEL"
                      disabled={busy}
                      aria-label={`Rename ${m.title}`}
                      onChange={(e) => actions.setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation(); // typing must never reach the globe's key table
                        if (e.key === "Enter") actions.commitRename(m);
                        if (e.key === "Escape") actions.cancelRename();
                      }}
                    />
                    <button type="button" className="mp-act" data-act="rename-ok" disabled={busy} onClick={() => actions.commitRename(m)}>
                      {busy ? "…" : "SAVE"}
                    </button>
                    <button type="button" className="mp-act" data-act="rename-cancel" disabled={busy} onClick={actions.cancelRename}>
                      ✕
                    </button>
                  </span>
                </div>
              ) : (
                <button
                  className="mp-item"
                  title={placed ? "Stand beside it in first-person view" : "Place it on the globe"}
                  disabled={busy}
                  onClick={() => actions.open(m)}
                >
                  {thumb}
                  <span className="mp-meta">
                    <span className="mp-name" title={m.title}>
                      {m.title}
                    </span>
                    <span className="mp-sub">{modelRowSub(m)}</span>
                  </span>
                  <span className="mp-badges">
                    {modelRowBadges(m).map((b) => (
                      <span key={b.key} className={`mp-badge is-${b.key}`} title={BADGE_TITLE[b.key]}>
                        {b.label}
                      </span>
                    ))}
                  </span>
                </button>
              )}
              {!renaming && (
                <span className="mp-acts">
                  <button
                    type="button"
                    className="mp-act"
                    data-act="rename"
                    title="Rename"
                    aria-label={`Rename ${m.title}`}
                    disabled={busy}
                    onClick={() => actions.beginRename(m)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="mp-act"
                    data-act="hide"
                    title={m.hidden ? "Show it in the world again" : "Hide it from the world (the file stays public by URL)"}
                    aria-pressed={m.hidden}
                    disabled={busy}
                    onClick={() => actions.toggleHidden(m)}
                  >
                    {busy ? "…" : m.hidden ? "SHOW" : "HIDE"}
                  </button>
                  <button
                    type="button"
                    className={`mp-del${armedDeleteId === m.id ? " is-armed" : ""}`}
                    data-act="delete"
                    title={armedDeleteId === m.id ? "Press again to delete" : "Delete this model"}
                    aria-label={`Delete model ${m.title}`}
                    disabled={busyId !== null}
                    onClick={() => actions.remove(m)}
                  >
                    {busy ? "…" : armedDeleteId === m.id ? "SURE?" : "✕"}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {anyHidden && (
        <div className="mp-note" data-note="hidden">
          HIDDEN MODELS LEAVE THE WORLD, NOT THE LINK — THE FILE STAYS PUBLIC BY URL.
        </div>
      )}
    </>
  );
}

/** The connected tab: the store's own rows + the per-row UI state; `onClose` closes the panel
 *  after a row click (the PLACES-row precedent). */
export default function MyModelsTab({ onClose }: { onClose: () => void }) {
  const models = useUserModelsStore((s) => s.mine);
  const phase = useUserModelsStore((s) => s.minePhase);
  const [error, setError] = useState<string | null>(null);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const actions: MyModelsActions = {
    open: (m) => {
      if (m.lat === null || m.lon === null) {
        startModelPlacement(m.id, m.title);
        onClose();
        return;
      }
      // Stand south of it, looking north, a few model-heights back (the size at the committed scale).
      const size = m.bbox ? ([m.bbox[0], m.bbox[2], m.bbox[1]] as [number, number, number]) : null;
      const pose = modelStandpoint(m.lat, m.lon, size, m.scale, 0);
      useCameraStore.getState().requestFpvJump({
        latDeg: pose.latDeg,
        lonDeg: pose.lonDeg,
        eyeM: pose.eyeM,
        headingDeg: pose.headingDeg,
        pitchDeg: pose.pitchDeg,
        fovDeg: pose.fovDeg,
      });
      onClose();
    },
    beginRename: (m) => {
      setArmedDeleteId(null);
      setRenamingId(m.id);
      setDraft(m.title);
    },
    cancelRename: () => {
      setRenamingId(null);
      setDraft("");
    },
    setDraft,
    commitRename: async (m) => {
      const title = draft.trim();
      if (title.length === 0 || title === m.title) {
        setRenamingId(null);
        return;
      }
      setBusyId(m.id);
      setError(null);
      const row = await useUserModelsStore.getState().rename(m.id, title);
      setBusyId(null);
      if (!row) setError("rename failed");
      else setRenamingId(null);
    },
    toggleHidden: async (m) => {
      setArmedDeleteId(null);
      setBusyId(m.id);
      setError(null);
      const row = await useUserModelsStore.getState().setHidden(m.id, !m.hidden);
      setBusyId(null);
      if (!row) setError(m.hidden ? "show failed" : "hide failed");
    },
    remove: async (m) => {
      if (armedDeleteId !== m.id) {
        setArmedDeleteId(m.id);
        return;
      }
      setArmedDeleteId(null);
      setBusyId(m.id);
      setError(null);
      const ok = await useUserModelsStore.getState().remove(m.id);
      setBusyId(null);
      if (!ok) setError("delete failed");
    },
  };

  return (
    <MyModelsTabView
      state={{ models, phase, error, armedDeleteId, busyId, renamingId, draft }}
      actions={actions}
    />
  );
}
