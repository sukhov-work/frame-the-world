/**
 * PhotoDetailPanel — the compact docked tweak panel shown while a photo is PLACED on the globe
 * (Phase 3). Reuses the board-04 slider idiom (ui/Slider) + the upload-flow visual language so the
 * frustum re-projects live while the globe stays visible and interactive around it.
 *
 * This is the LIGHT version of the design canvas's "04 Photo Detail" board — the full board import
 * via Claude Design is deferred until the detail chrome grows (notes in DECISIONS 2026-07-10).
 * Also exports PlacementHint — the "click the globe" pill for the missing-GPS placing mode.
 */

import { useEffect } from "react";
import {
  useUploadStore,
  paramSource,
  isDirty,
  derivedFov,
  type AdjustableKey,
} from "../../store/upload";
import { useSaveStore, type SavePhase } from "../../store/save";
import { loginUrl, useMemberStore } from "../../store/member";
import type { PrecisionTier } from "../../lib/geo/precision";
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

/** C6: the tier chips — default is the reduced ~1 km cell; EXACT is a deliberate opt-in. */
const TIERS: ReadonlyArray<{ id: PrecisionTier; label: string }> = [
  { id: "exact", label: "EXACT" },
  { id: "1km", label: "~1 KM" },
  { id: "city", label: "CITY" },
];

const BUSY_LABEL: Partial<Record<SavePhase, string>> = {
  "uploading-original": "UPLOADING RAW…",
  "uploading-preview": "PREVIEW…",
  saving: "SAVING…",
};

export default function PhotoDetailPanel() {
  const store = useUploadStore();
  const save = useSaveStore();
  const memberPhase = useMemberStore((s) => s.phase);
  const memberRefresh = useMemberStore((s) => s.refresh);

  // Session state for the SAVE PIN gate (the nav badge usually resolved it already).
  useEffect(() => {
    if (memberPhase === "unknown") void memberRefresh();
  }, [memberPhase, memberRefresh]);

  // A different file or a re-placed photo is a NEW pin — drop any previous save result.
  const placeKey = `${store.fileName}|${store.placement?.latDeg}|${store.placement?.lonDeg}`;
  useEffect(() => {
    useSaveStore.getState().reset();
  }, [placeKey]);

  const exif = store.exif;
  if (!exif || store.phase !== "placed") return null;

  const busy =
    save.phase === "uploading-original" ||
    save.phase === "uploading-preview" ||
    save.phase === "saving";

  const statusLine = (): { text: string; tone: "" | "warn" | "ok" } => {
    if (save.phase === "uploading-original")
      return { text: `UPLOADING RAW ${Math.round(save.progress * 100)}%`, tone: "" };
    if (save.phase === "uploading-preview") return { text: "PREVIEW…", tone: "" };
    if (save.phase === "saving") return { text: "SAVING…", tone: "" };
    if (save.phase === "saved") {
      const quota =
        save.quotaUsed !== undefined ? `PIN ${save.quotaUsed}/${save.quotaLimit}` : "PINNED";
      return { text: save.warning ? `${quota} · ${save.warning.toUpperCase()}` : quota, tone: "ok" };
    }
    if (save.phase === "error") {
      if (save.errorCode === "QUOTA_EXCEEDED")
        return { text: "FREE PLAN FULL (10/10) — UPGRADE FOR UNLIMITED", tone: "warn" };
      return { text: (save.error ?? "SAVE FAILED").toUpperCase(), tone: "warn" };
    }
    return { text: "", tone: "" };
  };
  const status = statusLine();

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

      {/* Phase 5 — save the placed photo as a pin (C6: public defaults to REDUCED precision).
          Hidden while VIEWING an already-saved pin (re-saving would just duplicate it). */}
      {!store.viewingPinId && (
      <div className="pd-save">
        <div className="pd-save__head">
          <label className="pd-save__pub">
            <input
              type="checkbox"
              checked={save.isPublic}
              disabled={busy}
              onChange={(e) => save.setIsPublic(e.target.checked)}
            />
            PUBLIC PIN
          </label>
          {save.isPublic && (
            <div className="pd-save__tiers" role="radiogroup" aria-label="Public location precision">
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={save.precision === t.id}
                  className={`pd-tier${save.precision === t.id ? " is-active" : ""}`}
                  disabled={busy}
                  onClick={() => save.setPrecision(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {save.isPublic && save.precision === "exact" && (
          <div className="pd-save__c6" role="note">
            EXACT PUBLISHES YOUR PRECISE LOCATION — DEFAULT IS ~1 KM
          </div>
        )}
        <div className="pd-save__act">
          {memberPhase === "member" ? (
            <button
              className="uf-btn uf-btn--primary"
              disabled={busy || save.phase === "saved"}
              onClick={() => void save.savePin()}
            >
              {save.phase === "saved" ? "PINNED ✓" : (BUSY_LABEL[save.phase] ?? "SAVE PIN")}
            </button>
          ) : (
            <a className="uf-btn uf-btn--primary pd-save__signin" href={loginUrl("/")}>
              SIGN IN TO SAVE
            </a>
          )}
          {status.text && (
            <span className={`uf-mono pd-save__status${status.tone ? ` is-${status.tone}` : ""}`}>
              {status.text}
            </span>
          )}
        </div>
      </div>
      )}

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
