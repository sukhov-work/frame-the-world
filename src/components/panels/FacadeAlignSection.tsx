/**
 * FacadeAlignSection — F5's PAIRS UI (T172, 2026-10-24): align the placed facade photo to the
 * buildings from point pairs. Mounted inside FacadeDetailPanel (between NUDGE POSITION and
 * PROJECTION). Three surfaces:
 *   (a) the section `.ff-align` — the photo thumbnail with the picked pairs as numbered dots, the
 *       pairs list (photo px · the building key · the LIVE residual of the current pose), SOLVE ·
 *       ALSO SOLVE THE LENS · CLEAR, and the status lines (NOW / SOLVED / the failure / the
 *       one-flat-wall note);
 *   (b) the PHOTO pick overlay `.ff-pick` (pairPick "photo", a portal to <body>): the photo large,
 *       a click on it is the pair's photo half → `setPendingUv`;
 *   (c) the GLOBE hint (pairPick "globe", the `.pd-hint` pill, a portal to <body>): the user clicks
 *       the same point on a building; the GLOBE orchestrator completes the pair (`completePair`).
 * The pick machine is the store's (`store/facadePhoto` — startPairPick → setPendingUv → the
 * orchestrator's completePair). Escape is the ORCHESTRATOR's (it cancels the pick itself) — there
 * is deliberately no key listener here: a second one would race it and unwind FPV.
 * The solve is `solveFacadeDraftNow` (the `revertFacadeOp` idiom): ONE journaled restorePose.
 */

import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useFacadePhotoStore, type FacadePairPick, type FacadePhotoStore } from "../../store/facadePhoto";
import { editJournal, refreshEditJournalMirror } from "../../store/editJournal";
import { facadeTarget, recordEntry } from "../../lib/edit/editJournal";
import {
  FACADE_PAIRS_FOV_MIN,
  FACADE_PAIRS_MAX,
  FACADE_PAIRS_MIN,
  draftReprojection,
  solveFacadeDraft,
  uvOfClick,
  type FacadeAlignOrigin,
  type FacadeAlignPair,
  type FacadeDraftPose,
  type FacadeDraftSolve,
  type FacadeSolved,
  type FacadeSolveRails,
} from "../../lib/geo/facadeAlign";
import { facadePairsPlanar } from "../../lib/geo/pnp";
import { facadeResolvedPoses } from "./FacadeEditChip";
import InfoDot from "../ui/InfoDot";
import { PHOTO_PROJECT } from "../globe/tuning";
import "../../styles/facade-photo.css";

export const FACADE_ALIGN_TIP =
  "CLICK A POINT ON THE PHOTO, THEN THE SAME POINT ON A BUILDING. 4 PAIRS SOLVE THE POSE, 6 ALSO THE LENS. A CORNER OR A NEARER POINT PINS YAW AND DISTANCE.";
export const FACADE_PLANAR_NOTE = "ONE FLAT WALL — YAW ↔ SIDEWAYS AND ZOOM ↔ DISTANCE TRADE OFF. ADD A CORNER OR A NEARER POINT.";

/** The sliders' rails — a solved pose never leaves what the panel can show. */
export const FACADE_SOLVE_RAILS: FacadeSolveRails = {
  altM: [PHOTO_PROJECT.altMinM, PHOTO_PROJECT.altMaxM],
  pitchMaxDeg: PHOTO_PROJECT.pitchMaxDeg,
  rollMaxDeg: PHOTO_PROJECT.rollMaxDeg,
  hFovDeg: [PHOTO_PROJECT.hFovMinDeg, PHOTO_PROJECT.hFovMaxDeg],
};

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────

/** A building key as the row prints it: `osm:w132547176` → `W…47176`; short keys as-is; none → GROUND. */
export function shortFacadeKey(target?: string | null): string {
  if (!target) return "GROUND";
  const id = (target.includes(":") ? target.slice(target.lastIndexOf(":") + 1) : target).toUpperCase();
  return id.length > 7 ? `${id[0]}…${id.slice(-5)}` : id;
}

/** A px figure: `3.2 PX`; a non-finite one (the point behind the camera) → `— PX`. */
export function formatPx(px: number | null | undefined): string {
  return typeof px === "number" && Number.isFinite(px) ? `${px.toFixed(1)} PX` : "— PX";
}

/** The photo point in the texture's pixels: `[round(u·W), round(v·H)]`. */
export function pairPx(uv: readonly [number, number], w: number, h: number): [number, number] {
  return [Math.round(uv[0] * w), Math.round(uv[1] * h)];
}

export type AlignTone = "" | "ok" | "warn";
export interface AlignStatusLine {
  text: string;
  tone: AlignTone;
}

/** The status lines under the controls, in order: NOW · the solve (ok) or the failure (warn) · the planar note. */
export function facadeAlignStatus(a: {
  n: number;
  rmsNowPx: number | null;
  solved?: FacadeSolved;
  clamped?: boolean;
  failure?: string | null;
  planar: boolean | null;
}): AlignStatusLine[] {
  const out: AlignStatusLine[] = [];
  if (a.n >= 1) out.push({ text: `NOW · RMS ${formatPx(a.rmsNowPx)}`, tone: "" });
  if (a.failure) out.push({ text: a.failure.toUpperCase(), tone: "warn" });
  else if (a.solved) {
    const s = a.solved;
    out.push({
      text: `SOLVED · RMS ${formatPx(s.rmsPx)} · ${s.n} PAIRS · LENS ${s.fovSolved ? "SOLVED" : "HELD"}${a.clamped ? " · CLAMPED TO THE RAILS" : ""}`,
      tone: "ok",
    });
  }
  if (a.planar === true && a.n >= FACADE_PAIRS_MIN) out.push({ text: FACADE_PLANAR_NOTE, tone: "" });
  return out;
}

/** Why a new pair cannot be armed now (null = it can). */
export function pairAddBlock(a: { seated: boolean; n: number; pairPick: FacadePairPick }): string | null {
  if (!a.seated) return "WAIT — THE GLOBE IS SEATING THE PHOTO.";
  if (a.n >= FACADE_PAIRS_MAX) return `${FACADE_PAIRS_MAX} PAIRS IS THE CAP — REMOVE ONE FIRST.`;
  if (a.pairPick !== "none") return "FINISH OR CANCEL THE PAIR IN FLIGHT.";
  return null;
}

type DraftSource = Pick<
  FacadePhotoStore,
  "poseSnapshot" | "exif" | "exifPose" | "params" | "apexAltM" | "apexAboveGroundM" | "textureWidth" | "textureHeight"
>;

/** The store's placed draft as the solver reads it (null until placed AND the apex is seated). */
export function facadeDraftPoseOf(s: DraftSource): FacadeDraftPose | null {
  const poses = facadeResolvedPoses(s);
  if (!poses || typeof s.apexAltM !== "number" || typeof s.apexAboveGroundM !== "number") return null;
  const { cur } = poses;
  return {
    lat: cur.lat,
    lon: cur.lon,
    apexAltM: s.apexAltM,
    apexAboveGroundM: s.apexAboveGroundM,
    headingDeg: cur.headingDeg,
    pitchDeg: cur.pitchDeg,
    rollDeg: cur.rollDeg,
    hFovDeg: cur.hFovDeg,
    textureWidth: s.textureWidth ?? 0,
    textureHeight: s.textureHeight ?? 0,
  };
}

/** "The pose IS the last solve's": the six camera numbers the server compares (`derivePoseSource`),
 *  RESOLVED through the EXIF seeds — never the raw snapshot, whose unset overrides read null on a
 *  re-opened row (its heading / roll / H-FOV live in the synthesized EXIF, so a SOLVED row opened
 *  from MY CONTENT would show EXIF badges while the server says SOLVED). */
export function facadePoseIsSolved(s: DraftSource & { solved?: FacadeSolved }): boolean {
  const sp = s.solved?.pose;
  if (!sp) return false;
  const poses = facadeResolvedPoses(s);
  if (!poses) return false;
  const { cur } = poses;
  const near = (a: number, b: number | null) => b !== null && Math.abs(a - b) <= 1e-9;
  return near(cur.lat, sp.lat) && near(cur.lon, sp.lon) && near(cur.headingDeg, sp.headingDeg) && near(cur.pitchDeg, sp.pitchDeg) && near(cur.rollDeg, sp.rollDeg) && near(cur.hFovDeg, sp.hFovDeg);
}

/** The live per-pair residuals (px) + the RMS of the CURRENT pose; nulls when there is no draft yet. */
export function liveResiduals(
  pairs: readonly FacadeAlignPair[],
  origin: FacadeAlignOrigin | undefined,
  draft: FacadeDraftPose | null,
): { px: (number | null)[]; rmsPx: number | null } {
  if (!origin || !draft || pairs.length === 0) return { px: pairs.map(() => null), rmsPx: null };
  const r = draftReprojection(pairs, origin, draft);
  const px = r.residuals.map((x) => (Number.isFinite(x.px) ? x.px : null));
  return { px, rmsPx: px.every((v) => v !== null) ? r.rmsPx : null };
}

/** SOLVE (the `revertFacadeOp` idiom): ONE solve of the draft → `restorePose` + `_setSolved` + one
 *  journal entry "solve" (↶ UNDO takes it back). Returns the result for the status line. */
export function solveFacadeDraftNow(solveFov: boolean): FacadeDraftSolve {
  const fs = useFacadePhotoStore.getState();
  const before = fs.poseSnapshot();
  const draft = facadeDraftPoseOf(fs);
  if (!before || !draft) return { ok: false, reason: "the globe has not seated the photo yet" };
  if (!fs.pairOrigin) return { ok: false, reason: `need at least ${FACADE_PAIRS_MIN} pairs (got 0)` };
  const r = solveFacadeDraft(fs.pairs, fs.pairOrigin, draft, { solveFov, rails: FACADE_SOLVE_RAILS });
  if (!r.ok) return r;
  fs.restorePose(r.snapshot);
  fs._setSolved(r.solved);
  if (recordEntry(editJournal, "solve", [{ target: facadeTarget(fs.savedFacadeId ?? "draft"), before, after: r.snapshot }], Date.now()))
    refreshEditJournalMirror();
  return r;
}

// ── the views (props in, callbacks out — renderToStaticMarkup-testable) ─────────────────────────

export interface FacadeAlignViewModel {
  previewUrl?: string;
  textureWidth: number;
  textureHeight: number;
  pairs: readonly FacadeAlignPair[];
  /** The live residual per pair (px), null = unknown / behind the camera. */
  residualsPx: readonly (number | null)[];
  rmsNowPx: number | null;
  /** The apex is seated (a pair can be armed). */
  seated: boolean;
  pairPick: FacadePairPick;
  solveFov: boolean;
  solved?: FacadeSolved;
  clamped?: boolean;
  failure?: string | null;
  planar: boolean | null;
}

export interface FacadeAlignActions {
  startPairPick(): void;
  removePair(i: number): void;
  clearPairs(): void;
  solve(): void;
  setSolveFov(on: boolean): void;
}

/** The numbered dots over a photo box (the thumbnail's and the pick overlay's — one markup). */
export function PairDots({ pairs }: { pairs: readonly FacadeAlignPair[] }) {
  return (
    <>
      {pairs.map((p, i) => (
        <span
          key={i}
          className="ff-align__dot"
          aria-hidden="true"
          style={{ left: `${p.uv[0] * 100}%`, top: `${p.uv[1] * 100}%` }}
        >
          {i + 1}
        </span>
      ))}
    </>
  );
}

export function FacadeAlignView({ view, actions }: { view: FacadeAlignViewModel; actions: FacadeAlignActions }) {
  const n = view.pairs.length;
  const W = view.textureWidth > 0 ? view.textureWidth : 3;
  const H = view.textureHeight > 0 ? view.textureHeight : 2;
  const block = pairAddBlock({ seated: view.seated, n, pairPick: view.pairPick });
  const status = facadeAlignStatus({
    n,
    rmsNowPx: view.rmsNowPx,
    solved: view.solved,
    clamped: view.clamped,
    failure: view.failure,
    planar: view.planar,
  });
  const canSolve = n >= FACADE_PAIRS_MIN;
  const canFov = n >= FACADE_PAIRS_FOV_MIN;
  return (
    <div className="ff-align" data-facade-align>
      <div className="pd-adjust__head">
        <span className="pd-adjust__title">
          ALIGN TO THE BUILDINGS
          <InfoDot pos="down" label="About the alignment pairs" tip={FACADE_ALIGN_TIP} />
        </span>
        <span className="uf-mono ff-align__count">{n} PAIRS</span>
      </div>

      {view.previewUrl && (
        <button
          type="button"
          className={`ff-align__frame${block ? " is-blocked" : ""}`}
          style={{ aspectRatio: `${W} / ${H}` }}
          data-facade-pair-thumb
          aria-disabled={block ? true : undefined}
          aria-label="Add a pair — click a point on the photo"
          title={block ?? "ADD A PAIR — PICK A POINT ON THE PHOTO"}
          onClick={() => actions.startPairPick()}
        >
          <img className="ff-align__thumb" src={view.previewUrl} alt="" draggable={false} />
          <PairDots pairs={view.pairs} />
        </button>
      )}

      {n > 0 && (
        <ol className="ff-align__list">
          {view.pairs.map((p, i) => {
            const [x, y] = pairPx(p.uv, W, H);
            return (
              <li key={i} className="ff-align__row uf-mono" data-facade-pair-row={i}>
                <span className="ff-align__n">#{i + 1}</span>
                <span className="ff-align__px">
                  {x}, {y}
                </span>
                <span className="ff-align__key" title={p.target ?? "THE GROUND"}>
                  {shortFacadeKey(p.target)}
                </span>
                <span className="ff-align__res">{formatPx(view.residualsPx[i])}</span>
                <button
                  type="button"
                  className="ff-align__remove"
                  data-facade-pair-remove={i}
                  aria-label={`Remove pair ${i + 1}`}
                  title="REMOVE THIS PAIR"
                  onClick={() => actions.removePair(i)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="ff-align__ctl">
        <button
          type="button"
          className="pd-tier"
          data-facade-pair-add
          aria-disabled={block ? true : undefined}
          title={block ?? "ADD A PAIR — PICK A POINT ON THE PHOTO"}
          onClick={() => actions.startPairPick()}
        >
          + PAIR
        </button>
        <button
          type="button"
          className="pd-tier ff-align__solve"
          data-facade-solve
          disabled={!canSolve}
          title={canSolve ? "SOLVE THE POSE FROM THE PAIRS" : `${FACADE_PAIRS_MIN} PAIRS AT LEAST`}
          onClick={() => actions.solve()}
        >
          SOLVE
        </button>
        <label className={`ff-align__fov uf-mono${canFov ? "" : " is-off"}`}>
          <input
            type="checkbox"
            data-facade-solve-fov
            checked={canFov && view.solveFov}
            disabled={!canFov}
            onChange={(e) => actions.setSolveFov(e.target.checked)}
          />
          ALSO SOLVE THE LENS
        </label>
        {n > 0 && (
          <button type="button" className="pd-tier" data-facade-pairs-clear onClick={() => actions.clearPairs()}>
            CLEAR
          </button>
        )}
      </div>

      {status.map((l, i) => (
        <span key={i} className={`uf-mono ff-align__status${l.tone ? ` is-${l.tone}` : ""}`}>
          {l.text}
        </span>
      ))}
    </div>
  );
}

/** (b) The PHOTO pick overlay: the image's OWN rect is the photo (sized to its aspect, no letterbox),
 *  so `uvOfClick` over `getBoundingClientRect()` is the photo uv. A scrim click does nothing. */
export function FacadePickOverlayView({
  previewUrl,
  textureWidth,
  textureHeight,
  pairs,
  onPick,
  onCancel,
}: {
  previewUrl?: string;
  textureWidth: number;
  textureHeight: number;
  pairs: readonly FacadeAlignPair[];
  onPick(uv: [number, number]): void;
  onCancel(): void;
}) {
  const W = textureWidth > 0 ? textureWidth : 3;
  const H = textureHeight > 0 ? textureHeight : 2;
  const onImgClick = (e: MouseEvent<HTMLImageElement>) => {
    const uv = uvOfClick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    if (uv) onPick(uv);
  };
  return (
    <div className="ff-pick" role="dialog" aria-label="Pick the pair's point on the photo" data-facade-pick>
      <div className="ff-pick__head">
        <span className="uf-mono">PAIR {pairs.length + 1} — CLICK THE POINT ON THE PHOTO</span>
        <button type="button" className="pd-tier ff-pick__cancel" data-facade-pick-cancel onClick={onCancel}>
          ✕ CANCEL
        </button>
      </div>
      <figure className="ff-pick__frame">
        {/* The preview and the projector share one orientation: `previewUrl` is the decoded preview /
            the display JPEG, the projector draws it with imageOrientation "from-image", and an <img>'s
            default (image-orientation: from-image) is the same — the uv here IS the texture's uv. */}
        <img
          className="ff-pick__img"
          data-facade-pick-img
          src={previewUrl}
          alt="The facade photo — click the pair's point"
          draggable={false}
          style={{ aspectRatio: `${W} / ${H}`, width: `min(92vw, calc(82vh * ${W / H}))` }}
          onClick={onImgClick}
        />
        <PairDots pairs={pairs} />
      </figure>
    </div>
  );
}

/** (c) The GLOBE hint — the FacadePlacementHint pill. */
export function FacadeGlobeHintView({ n, onCancel }: { n: number; onCancel(): void }) {
  return (
    <div className="pd-hint" role="status" data-facade-pick-globe>
      <span className="pd-hint__pulse" aria-hidden="true" />
      <span className="uf-mono">PAIR {n} — CLICK THE SAME POINT ON A BUILDING</span>
      <button type="button" className="pd-hint__cancel" data-facade-pick-cancel onClick={onCancel}>
        ESC · CANCEL
      </button>
    </div>
  );
}

// ── the island part (store-wired) ────────────────────────────────────────────────────────────────

const facade = () => useFacadePhotoStore.getState();

export default function FacadeAlignSection() {
  const pairs = useFacadePhotoStore((s) => s.pairs);
  const pairOrigin = useFacadePhotoStore((s) => s.pairOrigin);
  const pairPick = useFacadePhotoStore((s) => s.pairPick);
  const solved = useFacadePhotoStore((s) => s.solved);
  const previewUrl = useFacadePhotoStore((s) => s.previewUrl);
  const textureWidth = useFacadePhotoStore((s) => s.textureWidth);
  const textureHeight = useFacadePhotoStore((s) => s.textureHeight);
  const apexAltM = useFacadePhotoStore((s) => s.apexAltM);
  // The pose fields — the live residuals re-render with every write (cheap at ≤ 24 pairs).
  useFacadePhotoStore((s) => s.placement);
  useFacadePhotoStore((s) => s.params);
  useFacadePhotoStore((s) => s.rollDeg);
  useFacadePhotoStore((s) => s.hFovDeg);
  useFacadePhotoStore((s) => s.apexAboveGroundM);
  useFacadePhotoStore((s) => s.exifPose);
  const [solveFov, setSolveFov] = useState(false);
  const [last, setLast] = useState<FacadeDraftSolve | null>(null);
  // A pair added / removed makes the last result stale: an ok one falls back to the store's
  // `solved` record (still printed), a failure is dropped.
  useEffect(() => setLast(null), [pairs]);

  const draft = facadeDraftPoseOf(facade());
  const live = liveResiduals(pairs, pairOrigin, draft);
  const W = textureWidth ?? 0;
  const H = textureHeight ?? 0;
  const view: FacadeAlignViewModel = {
    previewUrl,
    textureWidth: W,
    textureHeight: H,
    pairs,
    residualsPx: live.px,
    rmsNowPx: live.rmsPx,
    seated: typeof apexAltM === "number" && Number.isFinite(apexAltM),
    pairPick,
    solveFov,
    solved: last?.ok ? last.solved : solved,
    clamped: last?.ok ? last.clamped : false,
    failure: last && !last.ok ? last.reason : null,
    planar: pairs.length >= FACADE_PAIRS_MIN ? facadePairsPlanar(pairs) : null,
  };
  const actions: FacadeAlignActions = {
    startPairPick: () => facade().startPairPick(),
    removePair: (i) => facade().removePair(i),
    clearPairs: () => facade().clearPairs(),
    solve: () => setLast(solveFacadeDraftNow(solveFov)),
    setSolveFov,
  };

  const portal =
    typeof document === "undefined"
      ? null
      : pairPick === "photo"
        ? createPortal(
            <FacadePickOverlayView
              previewUrl={previewUrl}
              textureWidth={W}
              textureHeight={H}
              pairs={pairs}
              onPick={(uv) => facade().setPendingUv(uv)}
              onCancel={() => facade().cancelPairPick()}
            />,
            document.body,
          )
        : pairPick === "globe"
          ? createPortal(<FacadeGlobeHintView n={pairs.length + 1} onCancel={() => facade().cancelPairPick()} />, document.body)
          : null;

  return (
    <>
      <FacadeAlignView view={view} actions={actions} />
      {portal}
    </>
  );
}
