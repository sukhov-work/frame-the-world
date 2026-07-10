/**
 * PhotoDetailPanel — the compact docked tweak panel shown while a photo is PLACED on the globe
 * (Phase 3). Reuses the board-04 slider idiom (ui/Slider) + the upload-flow visual language so the
 * frustum re-projects live while the globe stays visible and interactive around it.
 *
 * This is the LIGHT version of the design canvas's "04 Photo Detail" board — the full board import
 * via Claude Design is deferred until the detail chrome grows (notes in DECISIONS 2026-07-10).
 * Also exports PlacementHint — the "click the globe" pill for the missing-GPS placing mode.
 */

import {
  useUploadStore,
  paramSource,
  isDirty,
  derivedFov,
  type AdjustableKey,
} from "../../store/upload";
import {
  formatLatLon,
  formatFocal,
  formatHeading,
  formatPitch,
  formatAltitude,
} from "../../lib/format/readout";
import Slider, { type BadgeTone } from "../ui/Slider";
import { FRUSTUM } from "../globe/tuning";
import "../../styles/photo-detail.css";

const PARAM_LABEL: Record<AdjustableKey, string> = {
  focalLengthMm: "FOCAL LENGTH",
  headingDeg: "HEADING",
  pitchDeg: "PITCH",
  altitudeM: "ALTITUDE",
};

export default function PhotoDetailPanel() {
  const store = useUploadStore();
  const exif = store.exif;
  if (!exif || store.phase !== "placed") return null;

  const dirty = isDirty(exif, store.params);
  const fov = derivedFov(exif, store.params);

  const provenanceBadge = (key: AdjustableKey): { text: string; tone: BadgeTone } => {
    const src = paramSource(exif, store.params, key);
    if (src === "missing") return { text: "MISSING — ADD", tone: "warn" };
    if (src === "manual") return { text: "MANUAL", tone: "dim" };
    return { text: "EXIF", tone: "accent" };
  };

  return (
    <aside className="pd" aria-label="Placed photo — adjust projection">
      <header className="pd-head">
        <div className="pd-head__title">
          <span className="pd-dot" aria-hidden="true" />
          <span className="uf-mono pd-name">{store.fileName}</span>
        </div>
        <span className="uf-mono pd-coords">
          {store.placement ? formatLatLon(store.placement.latDeg, store.placement.lonDeg) : ""}
        </span>
      </header>

      <div className="pd-adjust">
        <div className="pd-adjust__head">
          <span className="pd-adjust__title">
            LIVE PROJECTION
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
        <Slider
          label="PLANE ALPHA"
          formatted={`${Math.round((store.planeOpacity ?? FRUSTUM.planeOpacity) * 100)}%`}
          value={Math.round((store.planeOpacity ?? FRUSTUM.planeOpacity) * 100)}
          min={10}
          max={100}
          step={5}
          onChange={(v) => useUploadStore.getState().setPlaneOpacity(v / 100)}
          onReset={() => useUploadStore.getState().setPlaneOpacity(undefined)}
        />
        <div className="pd-fov">
          <span className="uf-mono">
            H-FOV · {fov.hFovDeg.toFixed(1)}°{fov.estimated ? " · EST" : ""}
          </span>
          <span className="pd-fov__hint">Double-click a slider to reset it.</span>
        </div>
      </div>

      <div className="pd-actions">
        <button className="uf-btn uf-btn--ghost" onClick={() => useUploadStore.getState().backToReview()}>
          ← REVIEW
        </button>
        <button className="uf-btn uf-btn--ghost" onClick={() => useUploadStore.getState().clear()}>
          START OVER
        </button>
      </div>
    </aside>
  );
}

/** The placing-mode pill: the globe is waiting for a click to set the capture location. */
export function PlacementHint() {
  return (
    <div className="pd-hint" role="status">
      <span className="pd-hint__pulse" aria-hidden="true" />
      <span className="uf-mono">CLICK THE GLOBE TO SET THE CAPTURE LOCATION</span>
      <button className="pd-hint__cancel" onClick={() => useUploadStore.getState().backToReview()}>
        ESC · CANCEL
      </button>
    </div>
  );
}
