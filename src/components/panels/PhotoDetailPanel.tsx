/**
 * PhotoDetailPanel — the compact docked tweak panel shown while a photo is PLACED on the globe
 * (Phase 3). Reuses the board-04 slider idiom (ui/Slider) + the upload-flow visual language so the
 * frustum re-projects live while the globe stays visible and interactive around it.
 *
 * This is the LIGHT version of the design canvas's "04 Photo Detail" board — the full board import
 * via Claude Design is deferred until the detail chrome grows (notes in DECISIONS 2026-07-10).
 * Also exports PlacementHint — the "click the globe" pill for the missing-GPS placing mode.
 */

import { useEffect, useRef, useState } from "react";
import {
  useUploadStore,
  paramSource,
  isDirty,
  derivedFov,
  type AdjustableKey,
} from "../../store/upload";
import { useCameraStore, wrapHeadingDeg } from "../../store/camera";
import { useSaveStore, type SavePhase } from "../../store/save";
import { loginUrl, memberLabel, useMemberStore } from "../../store/member";
import { pinHueIndex } from "../../lib/pins/appearance";
import { tokens } from "../../lib/theme/tokens";
import { isPrecisionTier, type PrecisionTier } from "../../lib/geo/precision";
import { titleFromFileName } from "../../lib/save/pinBody";
import {
  formatLatLon,
  formatFocal,
  formatHeading,
  formatPitch,
  formatAltitude,
} from "../../lib/format/readout";
import Slider, { type BadgeTone } from "../ui/Slider";
import Encoder from "../ui/Encoder";
import { CONTROLS, FRUSTUM, PINS } from "../globe/tuning";
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

/** Post-save beat: how long "PINNED ✓" stays before the panel closes and the fly-out starts. */
const SAVED_CLOSE_MS = 1600;

export default function PhotoDetailPanel() {
  const store = useUploadStore();
  const save = useSaveStore();
  const memberPhase = useMemberStore((s) => s.phase);
  const memberRefresh = useMemberStore((s) => s.refresh);
  const member = useMemberStore((s) => s.member);
  // Legend swatch (Phase 5.5 S4): client twin of the server's authorLabel — the same label the
  // public row will carry as authorName, so this previews the EXACT hue hash(authorName) picks.
  const myPinHue =
    tokens[
      PINS.hueTokens[
        pinHueIndex(member ? memberLabel(member) : null, PINS.hueWeights, PINS.hueSalt)
      ] as keyof typeof tokens
    ];
  // Two-step DELETE guard (own pins): first press arms, second confirms.
  const [confirmDelete, setConfirmDelete] = useState(false);

  // HEADING + PITCH are encoders (owner follow-ups 2026-07-11): a rate loop nudges the param
  // per frame while the stick is deflected — fine absolute control a positional slider can't
  // give. Heading wraps 0–360°; pitch clamps ±90°. Refs so the rAF loops read live rates.
  const rateRef = useRef<{ heading: number | null; pitch: number | null }>({
    heading: null,
    pitch: null,
  });
  const rateRaf = useRef({ heading: 0, pitch: 0 });
  const onParamRate = (kind: "heading" | "pitch") => (rate: number | null) => {
    rateRef.current[kind] = rate;
    if (rate === null) return; // loop exits itself; params keep their last value
    if (rateRaf.current[kind]) return; // already running
    let last = performance.now();
    const step = (now: number) => {
      const r = rateRef.current[kind];
      if (r === null) {
        rateRaf.current[kind] = 0;
        return;
      }
      const dtS = Math.min(now - last, 100) / 1000;
      last = now;
      const s = useUploadStore.getState();
      if (kind === "heading") {
        const current = s.params.headingDeg ?? s.exif?.headingDeg ?? 0;
        s.setParam("headingDeg", wrapHeadingDeg(current + r * dtS));
      } else {
        const current = s.params.pitchDeg ?? s.exif?.pitchDeg ?? 0;
        s.setParam("pitchDeg", Math.min(90, Math.max(-90, current + r * dtS)));
      }
      rateRaf.current[kind] = requestAnimationFrame(step);
    };
    rateRaf.current[kind] = requestAnimationFrame(step);
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(rateRaf.current.heading);
      cancelAnimationFrame(rateRaf.current.pitch);
    },
    [],
  );

  // Session state for the SAVE PIN gate (the nav badge usually resolved it already).
  useEffect(() => {
    if (memberPhase === "unknown") void memberRefresh();
  }, [memberPhase, memberRefresh]);

  // A different file or a re-placed photo is a NEW pin — drop any previous save result.
  const placeKey = `${store.fileName}|${store.placement?.latDeg}|${store.placement?.lonDeg}`;
  useEffect(() => {
    useSaveStore.getState().reset();
  }, [placeKey]);

  // Seed the pin-name input + the edit section's choices when the viewed identity changes
  // (a fresh upload defaults from the file name; an own pin from its stored record).
  const identityKey = store.viewingPinId ?? store.fileName ?? "";
  useEffect(() => {
    const s = useSaveStore.getState();
    s.setTitle(null);
    setConfirmDelete(false);
    const meta = useUploadStore.getState().ownPinMeta;
    if (meta) {
      s.setIsPublic(meta.isPublic);
      if (isPrecisionTier(meta.precision)) s.setPrecision(meta.precision);
    }
  }, [identityKey]);

  // Post-save completion beat (Phase 5.5 S3): "PINNED ✓" → auto-close → fly out to a few km
  // above the new pin (the pulse-highlight was armed by the save store). New saves only —
  // an UPDATE keeps the panel open for further tweaks.
  const savedBeat = save.phase === "saved" && !store.viewingPinId;
  useEffect(() => {
    if (!savedBeat) return;
    const t = setTimeout(() => {
      const u = useUploadStore.getState();
      if (u.phase !== "placed" || useSaveStore.getState().phase !== "saved") return;
      const p = u.placement;
      if (p) {
        useCameraStore.getState().requestFly({
          latDeg: p.latDeg,
          lonDeg: p.lonDeg,
          altM: PINS.savedFlyOutAltM,
        });
      }
      u.clear();
    }, SAVED_CLOSE_MS);
    return () => clearTimeout(t);
  }, [savedBeat]);

  const exif = store.exif;
  if (!exif || store.phase !== "placed") return null;

  const busy =
    save.phase === "uploading-original" ||
    save.phase === "uploading-preview" ||
    save.phase === "saving" ||
    save.phase === "updating" ||
    save.phase === "deleting";

  const statusLine = (): { text: string; tone: "" | "warn" | "ok" } => {
    if (save.phase === "uploading-original")
      return { text: `UPLOADING RAW ${Math.round(save.progress * 100)}%`, tone: "" };
    if (save.phase === "uploading-preview") return { text: "PREVIEW…", tone: "" };
    if (save.phase === "saving") return { text: "SAVING…", tone: "" };
    if (save.phase === "updating") return { text: "UPDATING…", tone: "" };
    if (save.phase === "deleting") return { text: "DELETING…", tone: "" };
    if (save.phase === "updated") return { text: "UPDATED ✓", tone: "ok" };
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

      {/* FPV photographer mode (Phase 5.5 S2): stand exactly where the camera stood. */}
      <div className="pd-fpv">
        <button
          type="button"
          className={`uf-btn ${store.viewMode === "fpv" ? "uf-btn--primary" : "uf-btn--ghost"} pd-fpv__btn`}
          onClick={() =>
            useUploadStore.getState().setViewMode(store.viewMode === "fpv" ? "orbit" : "fpv")
          }
        >
          {store.viewMode === "fpv" ? "EXIT CAMERA VIEW · ESC" : "◎ VIEW FROM CAMERA"}
        </button>
        {store.viewMode === "fpv" && (
          <span className="uf-mono pd-fpv__hint">DRAG TO LOOK · WHEEL ZOOMS FOV</span>
        )}
      </div>

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
        <Encoder
          label={PARAM_LABEL.headingDeg}
          formatted={formatHeading(store.params.headingDeg)}
          maxRate={CONTROLS.headingRateMaxDegPerS}
          expoGamma={CONTROLS.rateExpoGamma}
          onRate={onParamRate("heading")}
          onReset={() => useUploadStore.getState().resetParam("headingDeg")}
          badge={provenanceBadge("headingDeg")}
        />
        <Encoder
          label={PARAM_LABEL.pitchDeg}
          formatted={formatPitch(store.params.pitchDeg)}
          maxRate={CONTROLS.pitchRateMaxDegPerS}
          expoGamma={CONTROLS.rateExpoGamma}
          onRate={onParamRate("pitch")}
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
          Phase 5.5 S3 — an OWN saved pin (My-pins path) gets UPDATE / RE-PLACE / DELETE here
          instead; a foreign viewed pin gets neither (re-saving would just duplicate it). */}
      {(!store.viewingPinId || store.ownPhotoId) && (
      <div className="pd-save">
        {!store.viewingPinId && (
          <div className="pd-steps" aria-label="Pin progress">
            <span className="pd-step is-done">PLACED ✓</span>
            <span className="pd-steps__dash" aria-hidden="true" />
            <span className={`pd-step${dirty ? " is-done" : ""}`}>TUNED</span>
            <span className="pd-steps__dash" aria-hidden="true" />
            <span className={`pd-step${save.phase === "saved" ? " is-done" : ""}`}>
              {save.phase === "saved" ? "SAVED ✓" : "SAVED"}
            </span>
          </div>
        )}
        <label className="pd-save__name">
          <span className="pd-save__namelabel">PIN NAME</span>
          <input
            type="text"
            className="pd-save__nameinput uf-mono"
            maxLength={120}
            value={save.title ?? (store.viewingPinId ? (store.fileName ?? "") : titleFromFileName(store.fileName))}
            disabled={busy}
            onChange={(e) => save.setTitle(e.target.value)}
          />
        </label>
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
        {save.isPublic && memberPhase === "member" && (
          <div className="pd-save__hue" role="note">
            <span
              className="pd-save__huedot"
              style={{ background: myPinHue, boxShadow: `0 0 6px ${myPinHue}` }}
              aria-hidden="true"
            />
            YOUR PINS GLOW THIS HUE ON THE SHARED GLOBE
          </div>
        )}
        <div className="pd-save__act">
          {memberPhase !== "member" ? (
            <a className="uf-btn uf-btn--primary pd-save__signin" href={loginUrl("/")}>
              SIGN IN TO SAVE
            </a>
          ) : store.ownPhotoId ? (
            <>
              <button
                className="uf-btn uf-btn--primary"
                disabled={busy}
                onClick={() => void save.updatePin()}
              >
                {save.phase === "updating" ? "UPDATING…" : "UPDATE PIN"}
              </button>
              <button
                className="uf-btn uf-btn--ghost"
                disabled={busy}
                onClick={() => useUploadStore.getState().rePlace()}
                title="Pick a new location on the globe"
              >
                ⌖ RE-PLACE
              </button>
              <button
                className={`uf-btn uf-btn--ghost pd-del${confirmDelete ? " is-armed" : ""}`}
                disabled={busy}
                onClick={() => {
                  if (!confirmDelete) return setConfirmDelete(true);
                  setConfirmDelete(false);
                  void save.deletePin();
                }}
              >
                {confirmDelete ? "SURE? DELETE" : "DELETE"}
              </button>
            </>
          ) : (
            <button
              className="uf-btn uf-btn--primary"
              disabled={busy || save.phase === "saved"}
              onClick={() => void save.savePin()}
            >
              {save.phase === "saved" ? "PINNED ✓" : (BUSY_LABEL[save.phase] ?? "SAVE PIN")}
            </button>
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

/** The placing-mode pill: the globe is waiting for a click to set the capture location.
 *  Serves both the missing-GPS path and the own-pin RE-PLACE path (Phase 5.5 S3) — cancel
 *  returns wherever the placing started (review overlay / the viewed pin). */
export function PlacementHint() {
  const rePlacing = useUploadStore((s) => !!s.viewingPinId);
  return (
    <div className="pd-hint" role="status">
      <span className="pd-hint__pulse" aria-hidden="true" />
      <span className="uf-mono">
        {rePlacing ? "CLICK THE GLOBE TO MOVE THIS PIN" : "CLICK THE GLOBE TO SET THE CAPTURE LOCATION"}
      </span>
      <button className="pd-hint__cancel" onClick={() => useUploadStore.getState().cancelPlacing()}>
        ESC · CANCEL
      </button>
    </div>
  );
}
