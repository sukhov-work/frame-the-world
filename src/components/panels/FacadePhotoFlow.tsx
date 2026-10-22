/**
 * FacadePhotoFlow — the photo flow (b), desktop only (mounted top-level by index.astro).
 * A street photo of a facade goes through the existing decode pipeline, is placed as a camera
 * pose, and the globe projects it onto the 3D buildings. One island, three surfaces:
 *   (a) NO nav link since T181 (owner 2026-10-22): the Upload overlay's LOWER dropzone half
 *       (UploadFlow — `.uf-dropzone--facade`) loads the file into this store and opens the
 *       overlay; the `?facade` flag retired. The `[data-open-facade]` click delegation still
 *       binds — any element carrying it opens the overlay (the verify harnesses dispatch it);
 *   (b) the overlay (`.uf.ff` root) — drop (+ MY FACADES for a member) → decoding → review,
 *       the upload overlay's chrome;
 *   (c) the docked tweak panel while placed (+ the click-the-globe hint while placing): the
 *       pose sliders, the GIZMO row + UNDO (F1), the projection, and the SAVE section (F2).
 * (b) and (c) portal to <body> (they used to mount inside the nav's z-index-10 stacking context).
 * Writes to `store/facadePhoto` + `store/facadeSave` only — the upload/pin flow is untouched.
 * Every `/api` write goes through the store → `lib/save/uploadMedia` wrappers (`jsonWriteInit`);
 * nothing here fetches.
 */

import { useEffect, useRef, useState, type DragEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useFacadePhotoStore, type FacadeGizmoOp } from "../../store/facadePhoto";
import { isFacadeSaveBusy, useFacadeSaveStore } from "../../store/facadeSave";
import { useFacadesStore } from "../../store/facades";
import { loginUrl, returnHereUrl, useMemberStore } from "../../store/member";
import { editJournal, undoTitle, useEditJournalStore } from "../../store/editJournal";
import { facadeTarget, peekUndo, undoableCount } from "../../lib/edit/editJournal";
import { paramSource, isDirty, derivedFov, effectiveHFovDeg, type AdjustableKey } from "../../lib/decode/params";
import { focalFromHorizontalFov } from "../../lib/decode/sensors";
import { titleFromFileName } from "../../lib/save/pinBody";
import type { PhotoExif } from "../../lib/decode/extract";
import type { FacadeListItem } from "../../lib/wix/facadeRecords";
import { wrapHeadingDeg } from "../../lib/geo/heading";
import {
  formatLatLon,
  formatFocal,
  formatAperture,
  formatShutter,
  formatIso,
  formatHeading,
  formatMegapixels,
  formatBytes,
  formatCaptureDateTime,
  formatSigned,
  EM_DASH,
} from "../../lib/format/readout";
import Slider, { type BadgeTone } from "../ui/Slider";
import Encoder from "../ui/Encoder";
import InfoDot from "../ui/InfoDot";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import { CONTROLS, FRUSTUM, PHOTO_PROJECT } from "../globe/tuning";
import "../../styles/upload-flow.css";
import "../../styles/photo-detail.css";
import "../../styles/tips.css";
import "../../styles/facade-photo.css";

/** Photos only — the upload overlay's photo accept list (no model formats here). */
const PHOTO_ACCEPT = ".arw,.dng,.cr3,.nef,.raf,.jpg,.jpeg,.png,.webp,.heic,.heif";
const FORMAT_CHIPS = ["DNG", "ARW", "CR3", "NEF", "RAF", "JPG · PNG · HEIC"];
const STEPS = ["1 UPLOAD", "2 REVIEW", "3 PLACE"] as const;
const NUDGE_STEPS_M = [0.5, 1, 5] as const;
/** The armed DELETE disarms itself after this (the MyPins two-press idiom, with a timeout). */
const DELETE_CONFIRM_MS = 4000;

const PARAM_LABEL: Record<AdjustableKey, string> = {
  focalLengthMm: "FOCAL LENGTH",
  headingDeg: "HEADING",
  pitchDeg: "PITCH",
  altitudeM: "ALTITUDE",
};

/** F1 — the GIZMO chips: the op the globe shows on the placed frustum + its one-line tip. */
const GIZMO_CHIPS: readonly { op: FacadeGizmoOp; label: string; tip: string }[] = [
  { op: "none", label: "OFF", tip: "NO GIZMO — THE SLIDERS AND THE NUDGE PAD ONLY." },
  { op: "move", label: "MOVE", tip: "DRAG THE ARROWS — EAST / NORTH / UP." },
  { op: "rotate", label: "ROTATE", tip: "DRAG THE RINGS — HEADING / PITCH / ROLL." },
  { op: "scale", label: "SCALE", tip: "DRAG A BOX — THE FIELD OF VIEW, NEVER A STRETCH." },
];

const facade = () => useFacadePhotoStore.getState();

function provenanceBadge(
  exif: PhotoExif,
  params: Parameters<typeof paramSource>[1],
  key: AdjustableKey,
): { text: string; tone: BadgeTone } {
  const src = paramSource(exif, params, key);
  if (src === "missing") return { text: "MISSING — ADD", tone: "warn" };
  if (src === "manual") return { text: "MANUAL", tone: "dim" };
  return { text: "EXIF", tone: "accent" };
}

/** The MY FACADES pose line: "N 48.46470 E 35.04620 · 214.0°". */
function poseLine(item: FacadeListItem): string {
  const ns = `${item.lat >= 0 ? "N" : "S"} ${Math.abs(item.lat).toFixed(5)}`;
  const ew = `${item.lon >= 0 ? "E" : "W"} ${Math.abs(item.lon).toFixed(5)}`;
  return `${ns} ${ew} · ${item.headingDeg.toFixed(1)}°`;
}

export default function FacadePhotoFlow() {
  const open = useFacadePhotoStore((s) => s.open);
  const phase = useFacadePhotoStore((s) => s.phase);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const trigger = (e.target as Element | null)?.closest?.("[data-open-facade]");
      if (trigger) {
        e.preventDefault();
        facade().openPanel();
      }
    };
    // Acts ONLY on this store's own states — the upload flow's Escape stays its own.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = facade();
      if (s.open) s.closePanel();
      else if (s.phase === "placing") s.cancelPlacing();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // The overlay and the docked panel portal to <body> so their own z-index layers them like
  // UploadFlow's, wherever the island is mounted.
  const surface = open ? (
    <FacadeOverlay />
  ) : phase === "placed" ? (
    <FacadeDetailPanel />
  ) : phase === "placing" ? (
    <FacadePlacementHint />
  ) : null;

  return surface && typeof document !== "undefined" ? createPortal(surface, document.body) : null;
}

function FacadeOverlay() {
  const phase = useFacadePhotoStore((s) => s.phase);
  const step = phase === "review" ? 1 : 0;
  return (
    <div className="uf ff" role="dialog" aria-modal="true" aria-label="Project a facade photo onto the buildings">
      <header className="uf-top">
        <div className="uf-top__left">
          <button
            className="uf-pill tip"
            data-tip="BACK TO THE GLOBE — YOUR PHOTO STAYS LOADED."
            data-tip-pos="down"
            onClick={() => facade().closePanel()}
          >
            <span aria-hidden="true">←</span> GLOBE
          </button>
          <div className="uf-brand">
            <img className="uf-brand__logo" src="/logo/plux-mark.png" alt="" width="96" height="96" />
            <span className="uf-brand__name">PLUX</span>
          </div>
          <InfoDot
            pos="down"
            label="About the facade photo flow"
            tip="Drop a street photo of a building → we read its EXIF → place it as a camera on the globe → the photo is projected onto the 3D buildings. Members can save it — every visitor then sees it on the buildings; only you can edit or remove it."
          />
        </div>
        <div className="uf-steps">
          {STEPS.map((s, i) => (
            <span key={s} className="uf-steps__group">
              {i > 0 && <span className="uf-steps__dash">──</span>}
              <span className={`uf-steps__step${i === step ? " uf-steps__step--active" : ""}`}>{s}</span>
            </span>
          ))}
        </div>
      </header>
      <div className="ff-title">
        <span className="uf-mono uf-accent">FACADE PHOTO</span>
        <span className="uf-mono ff-title__sub">
          THIS PHOTO IS PROJECTED ONTO THE 3D BUILDINGS. A SAVED FACADE PHOTO IS SHOWN TO EVERY VISITOR — ONLY YOU CAN EDIT OR REMOVE IT.
        </span>
      </div>
      {phase === "review" ? <FacadeReviewStep /> : <FacadeDropStep />}
    </div>
  );
}

function FacadeDropStep() {
  const phase = useFacadePhotoStore((s) => s.phase);
  const fileName = useFacadePhotoStore((s) => s.fileName);
  const fileSizeBytes = useFacadePhotoStore((s) => s.fileSizeBytes);
  const decodeProgress = useFacadePhotoStore((s) => s.decodeProgress);
  const previewUrl = useFacadePhotoStore((s) => s.previewUrl);
  const loadError = useFacadePhotoStore((s) => s.loadError);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    void facade().loadFile(files[0]);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    onFiles(e.dataTransfer.files);
  };

  return (
    <section className="uf-dropstep">
      <div
        className={`uf-dropzone${dragOver ? " uf-dropzone--over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="uf-dropzone__icon" aria-hidden="true">
          ↑
        </div>
        <div className="uf-dropzone__copy">
          <span className="uf-dropzone__title">Drop a street photo of a facade</span>
          <span className="uf-dropzone__sub">
            We read the EXIF, place the camera on the globe and project the photo onto the buildings.{" "}
            <span className="uf-link">Browse files</span>
          </span>
        </div>
        <div className="uf-chips">
          {FORMAT_CHIPS.map((c) => (
            <span key={c} className="uf-chip">
              {c}
            </span>
          ))}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {phase === "decoding" && (
        <div className="uf-progress">
          {previewUrl && <img className="uf-progress__thumb" src={previewUrl} alt="" aria-hidden="true" />}
          <div className="uf-progress__row">
            <span className="uf-mono">{fileName}</span>
            <span className="uf-mono uf-accent">DECODING · {Math.round(decodeProgress * 100)}%</span>
          </div>
          <div className="uf-bar">
            <div className="uf-bar__fill" style={{ width: `${decodeProgress * 100}%` }} />
          </div>
          <span className="uf-progress__hint">
            EMBEDDED JPEG PREVIEW SHOWN INSTANTLY · FULL DECODE {formatBytes(fileSizeBytes)}
          </span>
        </div>
      )}
      {phase === "idle" && loadError && (
        <div className="uf-notice">
          <div className="uf-notice__dot" aria-hidden="true" />
          <span>Could not read that file — {loadError}</span>
        </div>
      )}
      {phase === "idle" && <FacadeMineList />}
      <span className="uf-privacy">A SAVED FACADE PHOTO IS PUBLIC — EVERY VISITOR SEES IT ON THE BUILDINGS; THE ORIGINAL FILE STAYS PRIVATE</span>
    </section>
  );
}

/**
 * MY FACADES (F2) — the member's own rows under the dropzone; a click re-opens one as the placed
 * photo (`openSaved`). The list is the residency store's `mine` (one owner for the rows the globe
 * also projects); it is re-asked on every open as a member (the MyPins fresh-fetch idiom).
 */
function FacadeMineList() {
  const memberPhase = useMemberStore((s) => s.phase);
  const memberRefresh = useMemberStore((s) => s.refresh);
  const mine = useFacadesStore((s) => s.mine);
  const minePhase = useFacadesStore((s) => s.minePhase);
  const mineError = useFacadesStore((s) => s.mineError);

  // Session state (the nav badge usually resolved it already).
  useEffect(() => {
    if (memberPhase === "unknown") void memberRefresh();
  }, [memberPhase, memberRefresh]);
  useEffect(() => {
    if (memberPhase === "member") void useFacadesStore.getState().loadMine();
  }, [memberPhase]);

  const note = (text: string, warn = false) => (
    <span className={`uf-mono ff-mine__note${warn ? " is-warn" : ""}`}>{text}</span>
  );

  let body: ReactElement;
  if (memberPhase === "anonymous") body = note("SIGN IN TO SEE YOUR FACADE PHOTOS");
  else if (memberPhase !== "member") body = note("LOADING…");
  else if (minePhase === "error") body = note(`COULD NOT LOAD — ${(mineError ?? "unknown error").toUpperCase()}`, true);
  else if (minePhase === "anonymous") body = note("SIGN IN TO SEE YOUR FACADE PHOTOS");
  else if (mine.length === 0 && minePhase !== "ready") body = note("LOADING…");
  else if (mine.length === 0) body = note("NO SAVED FACADE PHOTOS YET");
  else
    body = (
      <ul className="ff-mine__list">
        {mine.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="ff-mine__row"
              data-facade-row={item.id}
              title="Open on the globe"
              onClick={() => facade().openSaved(item)}
            >
              {item.thumbUrl || item.displayUrl ? (
                <img className="ff-mine__thumb" src={item.thumbUrl ?? item.displayUrl} alt="" loading="lazy" />
              ) : (
                <span className="ff-mine__thumb ff-mine__thumb--empty" aria-hidden="true" />
              )}
              <span className="ff-mine__meta">
                <span className="ff-mine__title" title={item.title}>
                  {item.title}
                </span>
                <span className="ff-mine__sub">
                  {item.createdAt.slice(0, 10)} · {poseLine(item)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="ff-mine" aria-label="My facade photos">
      <div className="ff-mine__head">
        <span className="uf-mono uf-accent">
          MY FACADE PHOTOS{memberPhase === "member" && mine.length > 0 ? ` · ${mine.length}` : ""}
        </span>
      </div>
      {body}
    </div>
  );
}

function FacadeReviewStep() {
  const store = useFacadePhotoStore();
  const exif = store.exif;
  if (!exif) return null;

  const fov = derivedFov(exif, store.params);
  const badge = (key: AdjustableKey) => provenanceBadge(exif, store.params, key);

  return (
    <section className="uf-review">
      <div className="uf-review__left">
        <h2 className="uf-h2">Review the metadata</h2>
        <p className="uf-body">Everything below was read from the file.</p>
        <div className="uf-preview">
          {store.previewUrl ? (
            <img className="uf-preview__img" src={store.previewUrl} alt={store.fileName ?? "preview"} />
          ) : (
            <div className="uf-preview__placeholder">
              <span className="uf-mono">NO PREVIEW</span>
              <span className="uf-preview__note">this file carries no image we can display</span>
            </div>
          )}
        </div>
        <div className="uf-filerow">
          <div className="uf-progress__row">
            <span className="uf-mono">
              {store.fileName} · {formatMegapixels(exif.width, exif.height)} · {formatBytes(store.fileSizeBytes)}
            </span>
            <span className="uf-mono uf-accent">
              {store.previewSource === "decoded" ? "DECODED" : store.previewSource === "embedded" ? "EMBEDDED PREVIEW" : "READ"}
              {store.decodeMs !== undefined ? ` · ${(store.decodeMs / 1000).toFixed(1)} S` : ""}
            </span>
          </div>
          <div className="uf-bar">
            <div className="uf-bar__fill" style={{ width: "100%" }} />
          </div>
          {store.decodeError && (
            <span className="uf-badge uf-badge--warn">FULL DECODE FAILED — SHOWING WHAT WE COULD READ</span>
          )}
        </div>
      </div>

      <div className="uf-review__right">
        <div className="uf-grid">
          <Field label="CAMERA" value={[exif.make, exif.model].filter(Boolean).join(" ") || undefined} />
          <Field label="LENS" value={exif.lensModel} />
          <Field
            label="FOCAL · APERTURE"
            value={
              exif.focalLengthMm !== undefined || exif.fNumber !== undefined
                ? `${formatFocal(exif.focalLengthMm)} · ${formatAperture(exif.fNumber)}`
                : undefined
            }
          />
          <Field
            label="SHUTTER · ISO"
            value={
              exif.exposureSec !== undefined || exif.iso !== undefined
                ? `${formatShutter(exif.exposureSec)} · ${formatIso(exif.iso)}`
                : undefined
            }
          />
          <Field label="DATE · TIME" value={exif.capturedAt ? formatCaptureDateTime(exif.capturedAt) : undefined} />
          <Field
            label="GPS"
            value={exif.gpsLat !== undefined ? formatLatLon(exif.gpsLat, exif.gpsLon) : undefined}
            missingBadge="MISSING — SET ON GLOBE"
          />
        </div>

        <div className="uf-adjust">
          <div className="uf-adjust__head">
            <span className="uf-adjust__title">
              ADJUST PROJECTION
              {isDirty(exif, store.params) && <span className="uf-dot" aria-label="changed from EXIF" />}
              <InfoDot
                pos="down"
                label="About the provenance badges"
                tip="EXIF = read from the file · MANUAL = you set it · MISSING = no data, using a default."
              />
            </span>
            <button className="uf-reset" onClick={() => facade().resetAll()}>
              RESET TO EXIF
            </button>
          </div>
          <Slider
            label={PARAM_LABEL.focalLengthMm}
            formatted={formatFocal(store.params.focalLengthMm)}
            value={store.params.focalLengthMm}
            min={8}
            max={400}
            step={1}
            onChange={(v) => facade().setParam("focalLengthMm", v)}
            onReset={() => facade().resetParam("focalLengthMm")}
            badge={badge("focalLengthMm")}
            tip="LENS FOCAL LENGTH — SETS THE FRUSTUM'S FIELD OF VIEW."
          />
          <Slider
            label={PARAM_LABEL.headingDeg}
            formatted={formatHeading(store.params.headingDeg)}
            value={store.params.headingDeg}
            min={0}
            max={360}
            step={1}
            onChange={(v) => facade().setParam("headingDeg", v)}
            onReset={() => facade().resetParam("headingDeg")}
            badge={badge("headingDeg")}
            tip="COMPASS DIRECTION THE LENS FACES."
          />
          <Slider
            label={PARAM_LABEL.pitchDeg}
            formatted={store.params.pitchDeg === undefined ? EM_DASH : formatSigned(store.params.pitchDeg)}
            value={store.params.pitchDeg}
            min={-90}
            max={90}
            step={0.5}
            onChange={(v) => facade().setParam("pitchDeg", v)}
            onReset={() => facade().resetParam("pitchDeg")}
            badge={badge("pitchDeg")}
            tip="LENS TILT — NEGATIVE LOOKS DOWN, POSITIVE UP."
          />
          <Slider
            label={PARAM_LABEL.altitudeM}
            formatted={store.params.altitudeM === undefined ? EM_DASH : `${store.params.altitudeM.toFixed(1)} M`}
            value={store.params.altitudeM}
            min={0}
            max={500}
            step={0.5}
            onChange={(v) => facade().setParam("altitudeM", v)}
            onReset={() => facade().resetParam("altitudeM")}
            badge={badge("altitudeM")}
            tip="CAMERA HEIGHT — EXIF IS ABSOLUTE; MANUAL IS METERS ABOVE GROUND."
          />
          <div className="uf-fov">
            <span className="uf-mono">
              DERIVED H-FOV · {fov.hFovDeg.toFixed(1)}°{fov.estimated ? " · EST" : ""}
            </span>
            <span className="uf-fov__hint">Double-click any slider to reset it to the EXIF value.</span>
          </div>
        </div>

        <div className="uf-actions">
          <button className="uf-btn uf-btn--primary" onClick={() => facade().place()}>
            {store.placement ? "PLACE ON GLOBE" : "SET ON GLOBE"}&nbsp;&nbsp;→
          </button>
          <button className="uf-btn uf-btn--ghost" onClick={() => facade().clear()}>
            START OVER
          </button>
        </div>
        <span className="uf-actions__hint">
          {store.placement
            ? "THE GLOBE FLIES TO THE CAMERA POSITION"
            : "NO GPS IN THIS FILE — CLICK THE CAMERA POSITION ON THE GLOBE NEXT"}
        </span>
      </div>
    </section>
  );
}

function FacadeDetailPanel() {
  const store = useFacadePhotoStore();
  const save = useFacadeSaveStore();
  const memberPhase = useMemberStore((s) => s.phase);
  const memberRefresh = useMemberStore((s) => s.refresh);
  // The journal mirror is the RE-RENDER TRIGGER only — the facade's own count is computed off
  // the journal below (the mirror's `undoable` spans buildings and models too).
  useEditJournalStore((s) => s.undoable);
  const [nudgeStepM, setNudgeStepM] = useState<number>(1);
  // Two-step DELETE guard: first press arms ("SURE? DELETE"), the second within 4 s confirms.
  const [confirmDelete, setConfirmDelete] = useState(false);

  // HEADING is an encoder — PhotoDetailPanel's rate-loop idiom: a rAF loop nudges the param per
  // frame while the stick is deflected (a ref so the loop reads the live rate).
  const rateRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const onHeadingRate = (rate: number | null) => {
    rateRef.current = rate;
    if (rate === null || rafRef.current) return;
    let last = performance.now();
    const step = (now: number) => {
      const r = rateRef.current;
      if (r === null) {
        rafRef.current = 0;
        return;
      }
      const dtS = Math.min(now - last, 100) / 1000;
      last = now;
      const s = facade();
      const current = s.params.headingDeg ?? s.exif?.headingDeg ?? 0;
      s.setParam("headingDeg", wrapHeadingDeg(current + r * dtS));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Session state for the SAVE gate (the nav badge usually resolved it already).
  useEffect(() => {
    if (memberPhase === "unknown") void memberRefresh();
  }, [memberPhase, memberRefresh]);

  // A different photo is a NEW draft — drop the previous save result + title. The key must NOT
  // move on a SAVE (`savedFacadeId` lands then) or the "SAVED" beat would vanish at once; the
  // file name + the preview URL are fixed for the life of one draft / one re-opened row.
  const identityKey = `${store.fileName ?? ""}|${store.previewUrl ?? ""}`;
  useEffect(() => {
    const s = useFacadeSaveStore.getState();
    s.reset();
    s.setTitle(null);
    setConfirmDelete(false);
  }, [identityKey]);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), DELETE_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const drag = usePanelDrag("facade-photo");
  const exif = store.exif;
  if (!exif || store.phase !== "placed") return null;

  const badge = (key: AdjustableKey) => provenanceBadge(exif, store.params, key);
  const fov = derivedFov(exif, store.params);
  // F1 — the ONE effective H-FOV: the override when set, else the derived baseline. The slider
  // writes the override (never the focal — `effectiveHFovDeg`'s doc says why) and the SCALE
  // gizmo writes the same number.
  const hFov = effectiveHFovDeg(exif, store.params, store.hFovDeg);
  const hFovManual = store.hFovDeg !== undefined;
  const hFovBadge: { text: string; tone: BadgeTone } = hFovManual ? { text: "MANUAL", tone: "dim" } : badge("focalLengthMm");
  const hFovFormatted =
    hFov > 0 && hFov < 180
      ? `${hFov.toFixed(1)}° · ${focalFromHorizontalFov(hFov).toFixed(0)} MM EQ${!hFovManual && fov.estimated ? " · EST" : ""}`
      : EM_DASH;
  const roll = store.rollDeg ?? exif.rollDeg ?? 0;
  const rollBadge: { text: string; tone: BadgeTone } =
    store.rollDeg !== undefined
      ? { text: "MANUAL", tone: "dim" }
      : exif.rollDeg !== undefined
        ? { text: "EXIF", tone: "accent" }
        : { text: "MISSING", tone: "warn" };
  const dirty = isDirty(exif, store.params) || store.rollDeg !== undefined || hFovManual;
  const plane = Math.round((store.planeOpacity ?? FRUSTUM.planeOpacity) * 100);
  const { projection } = store;

  // F1 — UNDO for THIS facade (the draft, or the row under edit): the count + the last label.
  const target = facadeTarget(store.savedFacadeId ?? "draft");
  const facadeUndoable = undoableCount(editJournal, target);
  const facadeUndoLabel = peekUndo(editJournal, target)?.label ?? null;

  const busy = isFacadeSaveBusy(save.phase);
  const statusLine = (): { text: string; tone: "" | "warn" | "ok" } => {
    switch (save.phase) {
      case "uploading-original":
        return { text: `UPLOADING ORIGINAL ${Math.round(save.progress * 100)} %`, tone: "" };
      case "deriving":
        return { text: "MAKING THE DISPLAY COPY", tone: "" };
      case "uploading-display":
        return { text: "UPLOADING THE DISPLAY COPY", tone: "" };
      case "uploading-thumb":
        return { text: "UPLOADING THE THUMB", tone: "" };
      case "saving":
        return { text: "SAVING…", tone: "" };
      case "updating":
        return { text: "UPDATING…", tone: "" };
      case "deleting":
        return { text: "DELETING…", tone: "" };
      case "saved":
        return { text: save.warning ? `SAVED · ${save.warning.toUpperCase()}` : "SAVED", tone: "ok" };
      case "updated":
        return { text: "UPDATED", tone: "ok" };
      case "error":
        return { text: (save.error ?? "SAVE FAILED").toUpperCase(), tone: "warn" };
      default:
        return { text: "", tone: "" };
    }
  };
  const status = statusLine();

  return (
    <aside className="pd ff-panel" style={drag.style} aria-label="Facade photo — adjust the projection">
      <DragGrip drag={drag} label="Move the facade photo panel" tipPos="right" />
      <div className="pd-scroll">
        <header className="pd-head">
          <div className="pd-head__title">
            <span className="pd-dot" aria-hidden="true" />
            <span className="uf-mono pd-name">FACADE PHOTO</span>
            <button
              type="button"
              className="pd-close tip"
              aria-label="Close and return to the map"
              data-tip="CLOSE — BACK TO THE MAP."
              data-tip-pos="down"
              onClick={() => facade().clear()}
            >
              ✕
            </button>
          </div>
          <span className="uf-mono pd-coords">{store.fileName}</span>
        </header>

        <div className="pd-adjust">
          <div className="pd-adjust__head">
            <span className="pd-adjust__title">
              CAMERA POSE
              {dirty && <span className="uf-dot" aria-label="changed from EXIF" />}
            </span>
            {dirty && (
              <button className="uf-reset" onClick={() => facade().resetAll()}>
                RESET TO EXIF
              </button>
            )}
          </div>
          {/* F1 — the GIZMO row: which handles the globe draws on the frustum, and UNDO for the
              last gizmo release / slider edit on this facade (the session edit journal). */}
          <div className="ff-gizmo">
            <div className="ff-gizmo__ops" role="group" aria-label="Gizmo">
              {GIZMO_CHIPS.map((c) => (
                <button
                  key={c.op}
                  type="button"
                  className={`pd-tier tip${store.gizmoOp === c.op ? " is-active" : ""}`}
                  aria-pressed={store.gizmoOp === c.op}
                  data-facade-op={c.op}
                  data-tip={c.tip}
                  data-tip-pos="down"
                  onClick={() => facade().setGizmoOp(c.op)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="pd-tier ff-gizmo__undo"
              data-facade-undo
              title={undoTitle(facadeUndoLabel, "the last edit")}
              disabled={facadeUndoable === 0}
              onClick={() => useEditJournalStore.getState().requestUndo("facade")}
            >
              ↶ UNDO{facadeUndoable > 0 ? ` · ${facadeUndoable}` : ""}
            </button>
          </div>
          <Encoder
            label={PARAM_LABEL.headingDeg}
            formatted={formatHeading(store.params.headingDeg)}
            maxRate={CONTROLS.headingRateMaxDegPerS}
            expoGamma={CONTROLS.rateExpoGamma}
            onRate={onHeadingRate}
            onReset={() => facade().resetParam("headingDeg")}
            badge={badge("headingDeg")}
            tip="COMPASS DIRECTION THE LENS FACES."
          />
          <Slider
            label={PARAM_LABEL.pitchDeg}
            formatted={store.params.pitchDeg === undefined ? EM_DASH : formatSigned(store.params.pitchDeg)}
            value={store.params.pitchDeg}
            min={-PHOTO_PROJECT.pitchMaxDeg}
            max={PHOTO_PROJECT.pitchMaxDeg}
            step={0.1}
            onChange={(v) => facade().setParam("pitchDeg", v)}
            onReset={() => facade().resetParam("pitchDeg")}
            badge={badge("pitchDeg")}
            tip="LENS TILT — NEGATIVE LOOKS DOWN, POSITIVE UP."
          />
          <Slider
            label="ROLL"
            formatted={formatSigned(roll)}
            value={roll}
            min={-PHOTO_PROJECT.rollMaxDeg}
            max={PHOTO_PROJECT.rollMaxDeg}
            step={0.1}
            onChange={(v) => facade().setRollDeg(v)}
            onReset={() => facade().setRollDeg(undefined)}
            badge={rollBadge}
            tip="HORIZON TILT — CLOCKWISE IS POSITIVE."
          />
          <Slider
            label="LENS · H-FOV"
            formatted={hFovFormatted}
            value={hFov}
            min={PHOTO_PROJECT.hFovMinDeg}
            max={PHOTO_PROJECT.hFovMaxDeg}
            step={0.1}
            onChange={(v) => facade().setHFovDeg(v)}
            onReset={() => facade().setHFovDeg(undefined)}
            badge={hFovBadge}
            tip="FIELD OF VIEW — THE SCALE GIZMO WRITES THE SAME NUMBER."
          />
          <Slider
            label={PARAM_LABEL.altitudeM}
            formatted={store.params.altitudeM === undefined ? EM_DASH : `${store.params.altitudeM.toFixed(1)} M`}
            value={store.params.altitudeM}
            min={PHOTO_PROJECT.altMinM}
            max={PHOTO_PROJECT.altMaxM}
            step={0.1}
            onChange={(v) => facade().setParam("altitudeM", v)}
            onReset={() => facade().resetParam("altitudeM")}
            badge={badge("altitudeM")}
            tip="CAMERA HEIGHT IN METRES — A STREET PHOTO SITS NEAR EYE LEVEL."
          />
        </div>

        <div className="ff-nudge">
          <div className="pd-adjust__head">
            <span className="pd-adjust__title">NUDGE POSITION</span>
            <div className="ff-steps" role="group" aria-label="Nudge step">
              {NUDGE_STEPS_M.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`pd-tier${nudgeStepM === m ? " is-active" : ""}`}
                  aria-pressed={nudgeStepM === m}
                  onClick={() => setNudgeStepM(m)}
                >
                  {m} M
                </button>
              ))}
            </div>
          </div>
          <div className="ff-nudge__body">
            <div className="ff-nudge__pad" role="group" aria-label="Nudge the camera position">
              <button type="button" className="ff-nudge__btn" onClick={() => facade().nudgePlacement(nudgeStepM, 0)}>
                N ▲
              </button>
              <button type="button" className="ff-nudge__btn" onClick={() => facade().nudgePlacement(-nudgeStepM, 0)}>
                S ▼
              </button>
              <button type="button" className="ff-nudge__btn" onClick={() => facade().nudgePlacement(0, -nudgeStepM)}>
                W ◀
              </button>
              <button type="button" className="ff-nudge__btn" onClick={() => facade().nudgePlacement(0, nudgeStepM)}>
                E ▶
              </button>
            </div>
            <span className="uf-mono ff-nudge__coords">
              {store.placement
                ? `${store.placement.latDeg.toFixed(6)}, ${store.placement.lonDeg.toFixed(6)}`
                : EM_DASH}
            </span>
          </div>
        </div>

        <div className="pd-adjust">
          <div className="pd-adjust__head">
            <span className="pd-adjust__title">PROJECTION</span>
            <button
              type="button"
              className={`pd-tier ff-toggle${projection.enabled ? " is-active" : ""}`}
              aria-pressed={projection.enabled}
              onClick={() => facade().setProjection({ enabled: !projection.enabled })}
            >
              PROJECT ON BUILDINGS
            </button>
          </div>
          <Slider
            label="STRENGTH"
            formatted={`${Math.round(projection.strength * 100)}%`}
            value={Math.round(projection.strength * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(v) => facade().setProjection({ strength: v / 100 })}
            onReset={() => facade().setProjection({ strength: 1 })}
            tip="HOW MUCH OF THE FACADE THE PHOTO REPLACES."
          />
          <Slider
            label="OWN LIGHT"
            formatted={`${Math.round(projection.ownLight * 100)}%`}
            value={Math.round(projection.ownLight * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(v) => facade().setProjection({ ownLight: v / 100 })}
            onReset={() => facade().setProjection({ ownLight: 0.6 })}
            tip="0 = LIT BY THE SCENE · 100 = THE PHOTO'S OWN COLOURS"
          />
          <Slider
            label="PLANE"
            formatted={`${plane}%`}
            value={plane}
            min={0}
            max={100}
            step={5}
            onChange={(v) => facade().setPlaneOpacity(v / 100)}
            onReset={() => facade().setPlaneOpacity(undefined)}
            tip="THE PREVIEW PLANE IN THE FRUSTUM — 0 HIDES IT."
          />
        </div>

        {/* F2 — SAVE / UPDATE / DELETE the pose as a FacadePhotos row (members only to write; PUBLIC to read since T190; the
            pin panel's `.pd-save` chrome). The writes live in store/facadeSave. */}
        <div className="pd-save ff-save">
          <div className="pd-adjust__head">
            <span className="pd-adjust__title">{store.savedFacadeId ? "SAVED FACADE PHOTO" : "SAVE FACADE PHOTO"}</span>
            <span className="uf-mono ff-save__note">PUBLIC · YOURS TO EDIT</span>
          </div>
          <label className="pd-save__name">
            <span className="pd-save__namelabel">TITLE</span>
            <input
              type="text"
              className="pd-save__nameinput pd-save__title uf-mono"
              maxLength={120}
              placeholder={titleFromFileName(store.fileName)}
              value={save.title ?? ""}
              disabled={busy || memberPhase !== "member"}
              onChange={(e) => save.setTitle(e.target.value)}
            />
          </label>
          <div className="pd-save__act">
            {memberPhase !== "member" ? (
              <a
                className="uf-btn uf-btn--primary pd-save__signin"
                href={loginUrl("/")}
                // returnTo resolves at CLICK time — the orchestrator mirrors the pose hash at a
                // low cadence, so a render-time href would still say "/" (the pin panel's lesson).
                onClick={(e) => {
                  e.preventDefault();
                  window.location.href = loginUrl(returnHereUrl());
                }}
              >
                SIGN IN TO SAVE
              </a>
            ) : store.savedFacadeId ? (
              <>
                <button
                  type="button"
                  className="uf-btn uf-btn--primary"
                  data-facade-update
                  disabled={busy}
                  onClick={() => void save.updateFacade()}
                >
                  {save.phase === "updating" ? "UPDATING…" : "UPDATE"}
                </button>
                <button
                  type="button"
                  className={`uf-btn uf-btn--ghost pd-del tip${confirmDelete ? " is-armed" : ""}`}
                  data-facade-delete
                  data-tip="REMOVES THE FACADE PHOTO AND ITS FILES — CLICK TWICE TO CONFIRM."
                  disabled={busy}
                  onClick={() => {
                    if (!confirmDelete) return setConfirmDelete(true);
                    setConfirmDelete(false);
                    void save.deleteFacade();
                  }}
                >
                  {confirmDelete ? "SURE? DELETE" : "DELETE"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="uf-btn uf-btn--primary"
                data-facade-save
                disabled={busy || save.phase === "saved"}
                onClick={() => void save.saveFacade()}
              >
                {save.phase === "saved" ? "SAVED ✓" : "SAVE"}
              </button>
            )}
            {status.text && (
              <span className={`uf-mono pd-save__status${status.tone ? ` is-${status.tone}` : ""}`}>
                {status.text}
              </span>
            )}
          </div>
          {memberPhase === "anonymous" && (
            <span className="uf-mono ff-save__hint">SIGN IN TO KEEP THIS FACADE PHOTO — EVERY VISITOR WILL SEE IT; ONLY YOU CAN EDIT OR REMOVE IT.</span>
          )}
        </div>

        <div className="pd-actions">
          <button className="uf-btn uf-btn--ghost" onClick={() => facade().backToReview()}>
            ← REVIEW
          </button>
          <button className="uf-btn uf-btn--ghost" onClick={() => facade().clear()}>
            START OVER
          </button>
          <button className="uf-btn uf-btn--ghost" onClick={() => facade().clear()}>
            ✕ CLOSE
          </button>
        </div>
      </div>
    </aside>
  );
}

/** The placing-mode pill (PlacementHint's markup): the globe awaits a click for the camera. */
function FacadePlacementHint() {
  return (
    <div className="pd-hint" role="status">
      <span className="pd-hint__pulse" aria-hidden="true" />
      <span className="uf-mono">CLICK THE GLOBE TO SET THE FACADE PHOTO'S CAMERA POSITION</span>
      <button className="pd-hint__cancel" onClick={() => facade().cancelPlacing()}>
        ESC · CANCEL
      </button>
    </div>
  );
}

function Field({ label, value, missingBadge = "MISSING" }: { label: string; value?: string; missingBadge?: string }) {
  const missing = value === undefined;
  return (
    <div className="uf-field">
      <div className="uf-field__head">
        <span className={`uf-field__label${missing ? " uf-field__label--hot" : ""}`}>{label}</span>
        <span className={`uf-badge ${missing ? "uf-badge--warn" : "uf-badge--accent"}`}>
          {missing ? missingBadge : "EXIF"}
        </span>
      </div>
      <div className={`uf-field__value${missing ? " uf-field__value--empty" : ""}`}>{value ?? EM_DASH}</div>
    </div>
  );
}
