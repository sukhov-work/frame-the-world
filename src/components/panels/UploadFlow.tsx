/**
 * UploadFlow — design board 05 (drop → metadata review → place) with the board-04 slider idiom
 * for the adjustable projection params. Full-screen overlay over the globe; opened by any element
 * carrying `data-open-upload` (the nav link), closed by Escape or the ← GLOBE pill.
 *
 * Decode is the real Phase-2 pipeline (`lib/decode/extract.ts`): exifr metadata + embedded-JPEG
 * instant preview, then libraw-wasm / libheif-js in a disposable Web Worker for RAW/HEIC. The store
 * (`store/upload.ts`) holds the Phase-3 contract: EXIF baseline + adjustable params + D4 flags.
 */

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  useUploadStore,
  missingParamKeys,
  paramSource,
  isDirty,
  type AdjustableKey,
} from "../../store/upload";
import { computeHorizontalFov } from "../../lib/decode/sensors";
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
  EM_DASH,
} from "../../lib/format/readout";
import Slider, { type BadgeTone } from "../ui/Slider";
import "../../styles/upload-flow.css";

const FORMAT_CHIPS = ["DNG", "ARW", "CR3", "NEF", "RAF", "JPG · PNG · HEIC"];
const ACCEPT = ".arw,.dng,.cr3,.nef,.raf,.jpg,.jpeg,.png,.webp,.heic,.heif";

const PARAM_LABEL: Record<AdjustableKey, string> = {
  focalLengthMm: "FOCAL LENGTH",
  headingDeg: "HEADING",
  pitchDeg: "PITCH",
  altitudeM: "ALTITUDE",
};

export default function UploadFlow() {
  const open = useUploadStore((s) => s.open);
  const phase = useUploadStore((s) => s.phase);

  // The nav "Upload" link lives in Astro-rendered markup — delegate instead of coupling.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const trigger = (e.target as Element | null)?.closest?.("[data-open-upload]");
      if (trigger) {
        e.preventDefault();
        useUploadStore.getState().openPanel();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useUploadStore.getState().closePanel();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!open) return null;

  const step = phase === "review" ? 1 : 0;

  return (
    <div className="uf" role="dialog" aria-modal="true" aria-label="Upload a photo">
      <header className="uf-top">
        <div className="uf-top__left">
          <button className="uf-pill" onClick={() => useUploadStore.getState().closePanel()}>
            <span aria-hidden="true">←</span> GLOBE
          </button>
          <div className="uf-brand">
            <div className="uf-brand__mark">
              <div className="uf-brand__dot" />
            </div>
            <span className="uf-brand__name">FRAME THE WORLD</span>
          </div>
        </div>
        <div className="uf-steps">
          {["1 UPLOAD", "2 REVIEW", "3 PLACE"].map((s, i) => (
            <span key={s} className="uf-steps__group">
              {i > 0 && <span className="uf-steps__dash">──</span>}
              <span className={`uf-steps__step${i === step ? " uf-steps__step--active" : ""}`}>{s}</span>
            </span>
          ))}
        </div>
      </header>
      {phase === "review" ? <ReviewStep /> : <DropStep />}
    </div>
  );
}

function DropStep() {
  const phase = useUploadStore((s) => s.phase);
  const fileName = useUploadStore((s) => s.fileName);
  const fileSizeBytes = useUploadStore((s) => s.fileSizeBytes);
  const decodeProgress = useUploadStore((s) => s.decodeProgress);
  const previewUrl = useUploadStore((s) => s.previewUrl);
  const loadError = useUploadStore((s) => s.loadError);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void useUploadStore.getState().loadFile(file);
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
          <span className="uf-dropzone__title">Drop a RAW or image file</span>
          <span className="uf-dropzone__sub">
            We read the EXIF and place your camera on the globe. <span className="uf-link">Browse files</span>
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
        accept={ACCEPT}
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
      <span className="uf-privacy">FILES STAY PRIVATE UNTIL YOU PLACE THEM</span>
    </section>
  );
}

function ReviewStep() {
  const store = useUploadStore();
  const exif = store.exif;
  if (!exif) return null;

  const missing = missingParamKeys(exif);
  const dirty = isDirty(exif, store.params);

  const provenanceBadge = (key: AdjustableKey): { text: string; tone: BadgeTone } => {
    const src = paramSource(exif, store.params, key);
    if (src === "missing") return { text: "MISSING — ADD", tone: "warn" };
    if (src === "manual") return { text: "MANUAL", tone: "dim" };
    return { text: "EXIF", tone: "accent" };
  };

  // Derived FOV — the load-bearing D4 math wired live into the instrument. The focal35 shortcut only
  // holds while focal is untouched from EXIF; a manual focal recomputes via Make/Model sensor lookup.
  const focalUntouched = store.params.focalLengthMm === exif.focalLengthMm;
  const fov = computeHorizontalFov({
    focalLengthMm: store.params.focalLengthMm,
    focalLengthIn35mmMm: focalUntouched ? exif.focalLengthIn35mmMm : undefined,
    make: exif.make,
    model: exif.model,
  });

  const missingCopy =
    missing.length > 0
      ? ` ${missing.length === 1 ? "One field is" : `${["", "", "Two", "Three"][missing.length]} fields are`} missing — add ${
          missing.length === 1 ? "it" : "them"
        } so the projection is exact.`
      : "";

  return (
    <section className="uf-review">
      <div className="uf-review__left">
        <h2 className="uf-h2">Review the metadata</h2>
        <p className="uf-body">Everything below was read from the file.{missingCopy}</p>
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
              {dirty && <span className="uf-dot" aria-label="changed from EXIF" />}
            </span>
            <button className="uf-reset" onClick={() => useUploadStore.getState().resetAll()}>
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
            onChange={(v) => useUploadStore.getState().setParam("focalLengthMm", v)}
            onReset={() => useUploadStore.getState().resetParam("focalLengthMm")}
            badge={provenanceBadge("focalLengthMm")}
          />
          <Slider
            label={PARAM_LABEL.headingDeg}
            formatted={formatHeading(store.params.headingDeg)}
            value={store.params.headingDeg}
            min={0}
            max={360}
            step={1}
            onChange={(v) => useUploadStore.getState().setParam("headingDeg", v)}
            onReset={() => useUploadStore.getState().resetParam("headingDeg")}
            badge={provenanceBadge("headingDeg")}
          />
          <Slider
            label={PARAM_LABEL.pitchDeg}
            formatted={formatPitch(store.params.pitchDeg)}
            value={store.params.pitchDeg}
            min={-90}
            max={90}
            step={0.5}
            onChange={(v) => useUploadStore.getState().setParam("pitchDeg", v)}
            onReset={() => useUploadStore.getState().resetParam("pitchDeg")}
            badge={provenanceBadge("pitchDeg")}
          />
          <Slider
            label={PARAM_LABEL.altitudeM}
            formatted={formatAltitude(store.params.altitudeM)}
            value={store.params.altitudeM}
            min={0}
            max={500}
            step={0.5}
            onChange={(v) => useUploadStore.getState().setParam("altitudeM", v)}
            onReset={() => useUploadStore.getState().resetParam("altitudeM")}
            badge={provenanceBadge("altitudeM")}
          />
          <div className="uf-fov">
            <span className="uf-mono">
              DERIVED H-FOV · {fov.hFovDeg.toFixed(1)}°{fov.estimated ? " · EST" : ""}
            </span>
            <span className="uf-fov__hint">Double-click any slider to reset it to the EXIF value.</span>
          </div>
        </div>

        {missing.length > 0 && (
          <div className="uf-notice">
            <div className="uf-notice__dot" aria-hidden="true" />
            <span>
              {missing.includes("headingDeg")
                ? "No compass data in this file. You can also set heading later by dragging the frustum in the scene."
                : `Add ${missing.map((k) => PARAM_LABEL[k].toLowerCase()).join(" and ")} so the projection is exact.`}
            </span>
          </div>
        )}

        <div className="uf-actions">
          <button className="uf-btn uf-btn--primary" disabled title="Arrives with Phase 3 — projection">
            PLACE ON GLOBE&nbsp;&nbsp;→
          </button>
          <button className="uf-btn uf-btn--ghost" onClick={() => useUploadStore.getState().clear()}>
            START OVER
          </button>
        </div>
        <span className="uf-actions__hint">PLACE ON GLOBE ARRIVES WITH PHASE 3 · PROJECTION</span>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  missingBadge = "MISSING",
}: {
  label: string;
  value?: string;
  missingBadge?: string;
}) {
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
