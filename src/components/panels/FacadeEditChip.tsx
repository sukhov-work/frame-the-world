import { FACADE_GIZMO_OPS, useFacadePhotoStore, type FacadeGizmoOp, type FacadePhotoStore } from "../../store/facadePhoto";
import { useBldgEditStore } from "../../store/bldgEdit";
import { useModelEditStore } from "../../store/modelEdit";
import {
  DROP_TITLE_ONE,
  editJournal,
  journalCurrent,
  refreshEditJournalMirror,
  undoTitle,
  useEditJournalStore,
  type EditScope,
} from "../../store/editJournal";
import { facadeTarget, hasSessionEdits, peekUndo, recordEntry, undoableCount } from "../../lib/edit/editJournal";
import { effectiveHFovDeg, exifBaselineParams } from "../../lib/decode/params";
import type { FacadePoseSnapshot } from "../../lib/wix/facadeRecords";
import "../../styles/building-edit.css";

/**
 * Facade edit chip (T175, owner 2026-10-22: "quick MOVE / ROTATE / SCALE buttons beside UNDO and
 * DROP SESSION, for easier switching and UX"; T188, owner 2026-10-22g: "quick buttons to switch
 * move / rotate / scale modes for the camera projection — SAME AS WITH MESHES") — the
 * BuildingEditChip's twin on the same CSS (`.bldg-edit-chip` / `.bec-*`, root `data-kind="facade"`)
 * for the PLACED facade photo:
 *   • the op strip (OFF · MOVE G · ROTATE R · SCALE S — the store's `gizmoOp`; the key letters are
 *     the orchestrator's hotkeys, the same key again → OFF, exactly the meshes' G / R / S);
 *   • ONE ROW PER OP with its CURRENT value and what it WAS — the EXIF pose the photo arrived with
 *     (`exifPose`: the panel's RESET TO EXIF baseline, the meshes' "the baked building") — and a ↺
 *     per edited op that puts THAT op back (a journaled entry, so ↶ UNDO undoes the revert);
 *   • the foot's ↶ UNDO / DROP SESSION for THIS facade (the draft, or the row under edit).
 * Desktop-only mount (index.astro, beside ModelEditChip): the facade flow has no /m entry.
 *
 * The counts are computed off the journal for this facade's target (the FacadePhotoFlow idiom —
 * the mirror's `undoable` / `sessionEdits` span buildings and models too, so they are the
 * RE-RENDER trigger only). Writes back only the store's `setGizmoOp` / `restorePose` (+ one journal
 * entry per revert) and the journal one-shots (`requestUndo("facade")` / `requestDrop("facade")` —
 * the orchestrator's `journalScopeTarget` resolves the scope to the placed facade). It YIELDS while
 * a building or a model is armed: the three chips share one fixed slot and the armed mesh's chip
 * owns it then.
 */

export type FacadeEditOp = Exclude<FacadeGizmoOp, "none">;
export const FACADE_EDIT_OPS: readonly FacadeEditOp[] = ["move", "rotate", "scale"];
export const FACADE_OP_LABEL: Record<FacadeGizmoOp, string> = { none: "OFF", move: "MOVE", rotate: "ROTATE", scale: "SCALE" };
/** T188 — the hotkey letters (Blender's, the meshes' precedent); OFF has none. */
export const FACADE_OP_KEY: Record<FacadeEditOp, string> = { move: "G", rotate: "R", scale: "S" };
export const FACADE_OP_TITLE: Record<FacadeGizmoOp, string> = {
  none: "No gizmo — the sliders and the nudge pad only",
  move: "Drag the arrows — east / north / up (G)",
  rotate: "Drag the rings — heading / pitch / roll (R)",
  scale: "Drag a box — the field of view, never a stretch (S)",
};

/** The pose with every "unset = the EXIF default" resolved to a number (the chip's readouts). */
export interface FacadeResolvedPose {
  lat: number;
  lon: number;
  /** The editor's altitude value (m); null = unset on both the current and the baseline. */
  altitudeM: number | null;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  hFovDeg: number;
}

export interface FacadeOpRow {
  op: FacadeEditOp;
  /** The CURRENT readout (the meshes' `.bec-v`). */
  value: string;
  /** What it WAS — the EXIF pose (the meshes' `.bec-was`); null when no baseline is known yet. */
  was: string | null;
  /** This op's fields differ from the baseline (the ↺ shows). */
  edited: boolean;
}

/** What the chip writes back — passed as props so the view is pure (zustand 5 renders a store
 *  hook's INITIAL state under renderToStaticMarkup). */
export interface FacadeEditActions {
  setGizmoOp(op: FacadeGizmoOp): void;
  /** T188 — put ONE op's fields back to the EXIF pose (journaled). */
  requestRevert(op: FacadeEditOp): void;
  requestUndo(scope: EditScope): void;
  requestDrop(scope: EditScope): void;
}

export interface FacadeEditView {
  gizmoOp: FacadeGizmoOp;
  /** T188 — one row per op (MOVE · ROTATE · SCALE), in that order. */
  rows: readonly FacadeOpRow[];
  /** Journal entries touching this facade (the foot's UNDO shows when > 0). */
  undoable: number;
  /** What the next UNDO on this facade undoes ("move" · "rotate" · "scale" · "revert" · "drop" …). */
  undoLabel: string | null;
  /** This facade differs from its session baseline (DROP SESSION shows). */
  sessionEdited: boolean;
}

const METRES_PER_DEG_LAT = 111_320;
const sg = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
const EPS_DEG = 1e-9;
const EPS_ANGLE = 1e-6;
const EPS_M = 1e-3;

/** East / north metres from the baseline to the current placement (the nudge pad's inverse). */
export function facadeOffsetM(cur: { lat: number; lon: number }, base: { lat: number; lon: number }): { eastM: number; northM: number } {
  const cosLat = Math.cos((base.lat * Math.PI) / 180);
  return {
    northM: (cur.lat - base.lat) * METRES_PER_DEG_LAT,
    eastM: (cur.lon - base.lon) * METRES_PER_DEG_LAT * cosLat,
  };
}

const altPart = (altitudeM: number | null) => (altitudeM === null ? "" : ` · ↑${altitudeM.toFixed(1)} m`);

/** One op's CURRENT readout — the meshes' `opReadout` twin. Without a baseline MOVE prints the
 *  placement itself (there is nothing to be offset from). */
export function facadeOpReadout(op: FacadeEditOp, cur: FacadeResolvedPose, base: FacadeResolvedPose | null): string {
  switch (op) {
    case "move": {
      if (!base) return `${cur.lat.toFixed(5)}, ${cur.lon.toFixed(5)}${altPart(cur.altitudeM)}`;
      const { eastM, northM } = facadeOffsetM(cur, base);
      return `${sg(eastM)} E · ${sg(northM)} N${altPart(cur.altitudeM)}`;
    }
    case "rotate":
      return `${cur.headingDeg.toFixed(1)}° · ${sg(cur.pitchDeg)}° · ${sg(cur.rollDeg)}°`;
    case "scale":
      return `${cur.hFovDeg.toFixed(1)}° H-FOV`;
  }
}

/** One op's ORIGINAL (the EXIF pose) as the chip prints it — the meshes' `opOriginal` twin. */
export function facadeOpOriginal(op: FacadeEditOp, base: FacadeResolvedPose): string {
  switch (op) {
    case "move":
      return `0.0 E · 0.0 N${altPart(base.altitudeM)}`;
    case "rotate":
      return `${base.headingDeg.toFixed(1)}° · ${sg(base.pitchDeg)}° · ${sg(base.rollDeg)}°`;
    case "scale":
      return `${base.hFovDeg.toFixed(1)}° H-FOV`;
  }
}

/** This op's fields differ from the baseline (exact to the chip's epsilons). */
export function facadeOpEdited(op: FacadeEditOp, cur: FacadeResolvedPose, base: FacadeResolvedPose): boolean {
  const diffNum = (a: number | null, b: number | null, eps: number) => (a === null || b === null ? a !== b : Math.abs(a - b) > eps);
  switch (op) {
    case "move":
      return Math.abs(cur.lat - base.lat) > EPS_DEG || Math.abs(cur.lon - base.lon) > EPS_DEG || diffNum(cur.altitudeM, base.altitudeM, EPS_M);
    case "rotate":
      return (
        Math.abs(cur.headingDeg - base.headingDeg) > EPS_ANGLE ||
        Math.abs(cur.pitchDeg - base.pitchDeg) > EPS_ANGLE ||
        Math.abs(cur.rollDeg - base.rollDeg) > EPS_ANGLE
      );
    case "scale":
      return Math.abs(cur.hFovDeg - base.hFovDeg) > EPS_ANGLE;
  }
}

/** The three rows for a current pose and its baseline (null baseline → "was" unknown, nothing edited). */
export function facadeOpRows(cur: FacadeResolvedPose, base: FacadeResolvedPose | null): FacadeOpRow[] {
  return FACADE_EDIT_OPS.map((op) => ({
    op,
    value: facadeOpReadout(op, cur, base),
    was: base ? facadeOpOriginal(op, base) : null,
    edited: base ? facadeOpEdited(op, cur, base) : false,
  }));
}

/** The journal snapshot a ↺ restores: ONE op's fields back to "unset" (= the EXIF default the store
 *  resolves — `restorePose` deletes a null param), the other ops untouched. MOVE goes back to the
 *  baseline's placement (a placement is never "unset"). */
export function facadeRevertedPose(before: FacadePoseSnapshot, op: FacadeEditOp, base: { lat: number; lon: number } | null): FacadePoseSnapshot {
  switch (op) {
    case "move":
      return { ...before, lat: base?.lat ?? before.lat, lon: base?.lon ?? before.lon, altitudeM: null };
    case "rotate":
      return { ...before, headingDeg: null, pitchDeg: null, rollDeg: null };
    case "scale":
      return { ...before, hFovDeg: null };
  }
}

/** The store's pose with the unset fields resolved through the EXIF pose (else the EXIF-seeded
 *  params), and the baseline when the photo's EXIF pose is known (captured lazily on a fresh
 *  draft — the first frames after a placement have none; a re-opened row carries the record's). */
export function facadeResolvedPoses(s: Pick<FacadePhotoStore, "poseSnapshot" | "exif" | "exifPose" | "params">): {
  cur: FacadeResolvedPose;
  base: FacadeResolvedPose | null;
} | null {
  const snap = s.poseSnapshot();
  const exif = s.exif;
  if (!snap || !exif) return null;
  const seed = exifBaselineParams(exif);
  const ep = s.exifPose;
  const base: FacadeResolvedPose | null = ep
    ? { lat: ep.lat, lon: ep.lon, altitudeM: ep.altitudeM, headingDeg: ep.headingDeg, pitchDeg: ep.pitchDeg, rollDeg: ep.rollDeg, hFovDeg: ep.hFovDeg }
    : null;
  const cur: FacadeResolvedPose = {
    lat: snap.lat,
    lon: snap.lon,
    altitudeM: snap.altitudeM ?? base?.altitudeM ?? seed.altitudeM ?? null,
    headingDeg: snap.headingDeg ?? base?.headingDeg ?? seed.headingDeg ?? 0,
    pitchDeg: snap.pitchDeg ?? base?.pitchDeg ?? seed.pitchDeg ?? 0,
    rollDeg: snap.rollDeg ?? base?.rollDeg ?? exif.rollDeg ?? 0,
    hFovDeg: snap.hFovDeg ?? effectiveHFovDeg(exif, s.params, undefined),
  };
  return { cur, base };
}

/** T188 — the ↺: ONE op back to the EXIF pose, as a journal entry (↶ UNDO takes it back). */
export function revertFacadeOp(op: FacadeEditOp): void {
  const fs = useFacadePhotoStore.getState();
  const before = fs.poseSnapshot();
  if (!before) return;
  const after = facadeRevertedPose(before, op, fs.exifPose ? { lat: fs.exifPose.lat, lon: fs.exifPose.lon } : null);
  fs.restorePose(after);
  if (recordEntry(editJournal, "revert", [{ target: facadeTarget(fs.savedFacadeId ?? "draft"), before, after }], Date.now()))
    refreshEditJournalMirror();
}

export default function FacadeEditChip() {
  const placed = useFacadePhotoStore((s) => s.phase === "placed");
  const gizmoOp = useFacadePhotoStore((s) => s.gizmoOp);
  const savedFacadeId = useFacadePhotoStore((s) => s.savedFacadeId);
  const setGizmoOp = useFacadePhotoStore((s) => s.setGizmoOp);
  // The pose fields — the rows re-render with every write (a gizmo drag writes per frame; the
  // chip is small — the building chip's `armed.live` precedent).
  useFacadePhotoStore((s) => s.placement);
  useFacadePhotoStore((s) => s.params);
  useFacadePhotoStore((s) => s.rollDeg);
  useFacadePhotoStore((s) => s.hFovDeg);
  useFacadePhotoStore((s) => s.exifPose);
  const requestUndo = useEditJournalStore((s) => s.requestUndo);
  const requestDrop = useEditJournalStore((s) => s.requestDrop);
  // Re-render triggers only (the mirror is re-written at every commit / undo / drop / sync).
  useEditJournalStore((s) => s.undoable);
  useEditJournalStore((s) => s.sessionEdits);
  const bldgArmed = useBldgEditStore((s) => s.armed !== null);
  const modelArmed = useModelEditStore((s) => s.armed !== null);
  if (!placed || bldgArmed || modelArmed) return null;
  const target = facadeTarget(savedFacadeId ?? "draft");
  const poses = facadeResolvedPoses(useFacadePhotoStore.getState());
  const view: FacadeEditView = {
    gizmoOp,
    rows: poses ? facadeOpRows(poses.cur, poses.base) : [],
    undoable: undoableCount(editJournal, target),
    undoLabel: peekUndo(editJournal, target)?.label ?? null,
    sessionEdited: hasSessionEdits(editJournal, journalCurrent, target),
  };
  return <FacadeEditChipView view={view} actions={{ setGizmoOp, requestRevert: revertFacadeOp, requestUndo, requestDrop }} />;
}

export function FacadeEditChipView({ view, actions }: { view: FacadeEditView; actions: FacadeEditActions }) {
  const { setGizmoOp, requestRevert, requestUndo, requestDrop } = actions;
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
            className={`bec-op${view.gizmoOp === op ? " is-on" : ""}${op !== "none" && view.rows.find((r) => r.op === op)?.edited ? " is-edited" : ""}`}
            data-op={op}
            title={FACADE_OP_TITLE[op]}
            onClick={() => setGizmoOp(op)}
          >
            {FACADE_OP_LABEL[op]}
            {op !== "none" && <kbd>{FACADE_OP_KEY[op]}</kbd>}
          </button>
        ))}
      </div>
      {view.rows.length > 0 && (
        <div className="bec-rows">
          {view.rows.map((r) => (
            <div key={r.op} className={`bec-row${view.gizmoOp === r.op ? " is-on" : ""}${r.edited ? " is-edited" : ""}`} data-op={r.op}>
              <span className="bec-k">{FACADE_OP_LABEL[r.op]}</span>
              <span className="bec-v">{r.value}</span>
              <span className="bec-was">{r.was === null ? "was —" : `was ${r.was}`}</span>
              {r.edited ? (
                <button
                  type="button"
                  className="bec-revert"
                  data-op={r.op}
                  title={`Revert ${FACADE_OP_LABEL[r.op].toLowerCase()} to the EXIF pose`}
                  onClick={() => requestRevert(r.op)}
                >
                  ↺
                </button>
              ) : (
                <span className="bec-revert bec-revert--void" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
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
          {view.gizmoOp === "none" ? "G / R / S or a tab — then drag on the globe" : "drag a handle · G / R / S switch · the key again → off"}
        </span>
      </div>
    </div>
  );
}
