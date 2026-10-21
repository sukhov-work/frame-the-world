/**
 * FacadePhotoFlow — the photo flow (b) PROTOTYPE, desktop only (mounted by index.astro's nav).
 * A street photo of a facade goes through the existing decode pipeline, is placed as a camera
 * pose, and the globe projects it onto the 3D buildings. One island, three surfaces:
 *   (a) the nav link — rendered only with `?facade` in the URL (never surfaces by default);
 *       the `[data-open-facade]` click delegation always binds so harnesses can dispatch it;
 *   (b) the overlay (`.uf.ff` root) — drop → decoding → review, the upload overlay's chrome;
 *   (c) the docked tweak panel while placed (+ the click-the-globe hint while placing).
 * (b) and (c) portal to <body>: the nav is a fixed z-index-10 stacking context.
 * Writes ONLY to `store/facadePhoto` — the upload/pin flow is untouched. Nothing is saved.
 */

import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useFacadePhotoStore } from "../../store/facadePhoto";
import { paramSource, isDirty, derivedFov, type AdjustableKey } from "../../lib/decode/params";
import type { PhotoExif } from "../../lib/decode/extract";
import { wrapHeadingDeg } from "../../lib/geo/heading";
import {
  formatLatLon,
  formatFocal,
  formatAperture,
  formatShutter,
  formatIso,
  formatHeading,
  formatPitch,
  formatAltitude,
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
import { CONTROLS, FRUSTUM } from "../globe/tuning";
import "../../styles/upload-flow.css";
import "../../styles/photo-detail.css";
import "../../styles/tips.css";
import "../../styles/facade-photo.css";

/** Photos only — the upload overlay's photo accept list (no model formats here). */
const PHOTO_ACCEPT = ".arw,.dng,.cr3,.nef,.raf,.jpg,.jpeg,.png,.webp,.heic,.heif";
const FORMAT_CHIPS = ["DNG", "ARW", "CR3", "NEF", "RAF", "JPG · PNG · HEIC"];
const STEPS = ["1 UPLOAD", "2 REVIEW", "3 PLACE"] as const;
const NUDGE_STEPS_M = [0.5, 1, 5] as const;

const PARAM_LABEL: Record<AdjustableKey, string> = {
  focalLengthMm: "FOCAL LENGTH",
  headingDeg: "HEADING",
  pitchDeg: "PITCH",
  altitudeM: "ALTITUDE",
};

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

export default function FacadePhotoFlow() {
  const open = useFacadePhotoStore((s) => s.open);
  const phase = useFacadePhotoStore((s) => s.phase);
  // The prototype flag is read once — without `?facade` the nav shows nothing.
  const [flagged] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("facade"),
  );

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

  // The island mounts inside the nav (a fixed z-index-10 stacking context) — the overlay and
  // the docked panel portal to <body> so their own z-index layers them like UploadFlow's.
  const surface = open ? (
    <FacadeOverlay />
  ) : phase === "placed" ? (
    <FacadeDetailPanel />
  ) : phase === "placing" ? (
    <FacadePlacementHint />
  ) : null;

  return (
    <>
      {flagged && (
        <a
          href="#facade"
          className="nav-upload ff-navlink tip"
          data-open-facade
          data-tip="PROJECT A STREET PHOTO ONTO THE BUILDINGS · PROTOTYPE"
          data-tip-pos="down"
        >
          Facade
        </a>
      )}
      {surface && typeof document !== "undefined" ? createPortal(surface, document.body) : null}
    </>
  );
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
            label="About the facade photo prototype"
            tip="Drop a street photo of a building → we read its EXIF → place it as a camera on the globe → the photo is projected onto the 3D buildings. It stays in your browser."
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
        <span className="uf-mono uf-accent">FACADE PHOTO · PROTOTYPE</span>
        <span className="uf-mono ff-title__sub">
          THIS PHOTO IS PROJECTED ONTO THE 3D BUILDINGS. IT IS NEVER SAVED OR PUBLISHED.
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
      <span className="uf-privacy">FACADE PHOTOS NEVER LEAVE YOUR BROWSER</span>
    </section>
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
            formatted={formatPitch(store.params.pitchDeg)}
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
            formatted={formatAltitude(store.params.altitudeM)}
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
  const [nudgeStepM, setNudgeStepM] = useState<number>(1);

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

  const drag = usePanelDrag("facade-photo");
  const exif = store.exif;
  if (!exif || store.phase !== "placed") return null;

  const badge = (key: AdjustableKey) => provenanceBadge(exif, store.params, key);
  const fov = derivedFov(exif, store.params);
  const roll = store.rollDeg ?? exif.rollDeg ?? 0;
  const rollBadge: { text: string; tone: BadgeTone } =
    store.rollDeg !== undefined
      ? { text: "MANUAL", tone: "dim" }
      : exif.rollDeg !== undefined
        ? { text: "EXIF", tone: "accent" }
        : { text: "MISSING", tone: "warn" };
  const dirty = isDirty(exif, store.params) || store.rollDeg !== undefined;
  const plane = Math.round((store.planeOpacity ?? FRUSTUM.planeOpacity) * 100);
  const { projection } = store;

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
            min={-45}
            max={45}
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
            min={-30}
            max={30}
            step={0.1}
            onChange={(v) => facade().setRollDeg(v)}
            onReset={() => facade().setRollDeg(undefined)}
            badge={rollBadge}
            tip="HORIZON TILT — CLOCKWISE IS POSITIVE."
          />
          <Slider
            label={PARAM_LABEL.focalLengthMm}
            formatted={`${formatFocal(store.params.focalLengthMm)} · ${fov.hFovDeg.toFixed(1)}°${fov.estimated ? " EST" : ""}`}
            value={store.params.focalLengthMm}
            min={8}
            max={400}
            step={0.5}
            onChange={(v) => facade().setParam("focalLengthMm", v)}
            onReset={() => facade().resetParam("focalLengthMm")}
            badge={badge("focalLengthMm")}
            tip="LENS FOCAL LENGTH — THE READOUT ADDS THE DERIVED H-FOV."
          />
          <Slider
            label={PARAM_LABEL.altitudeM}
            formatted={store.params.altitudeM === undefined ? EM_DASH : `${store.params.altitudeM.toFixed(1)} M`}
            value={store.params.altitudeM}
            min={0}
            max={60}
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
