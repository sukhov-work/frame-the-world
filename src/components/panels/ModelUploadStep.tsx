/**
 * ModelUploadStep — the MODEL branch of the upload modal (MESH SUITE MS4, D3 — 2026-09-02).
 * Three cards on one store (`store/modelUpload`): the PROGRESS card while the pipeline reads,
 * inspects, decimates and packs; the CHECK card (thumbnail, the facts, the source-units row, the
 * warnings, the UPLOAD HERE seed) with UPLOAD MODEL — sign-in gated in the UI, structurally gated
 * by the endpoint's 401; and the STORED card. The photo pipeline's ReviewStep is untouched: a
 * model is not a photo (no EXIF, no frustum), so it gets its own step rather than a third mode
 * inside a component that is EXIF-shaped end to end.
 */

import { useEffect } from "react";
import { EM_DASH, formatBytes, formatLatLon } from "../../lib/format/readout";
import { MODEL_UNITS, formatTris, type ModelUnit } from "../../lib/models/modelCaps";
import { loginUrl, returnHereUrl, useMemberStore } from "../../store/member";
import { useModelUploadStore, type ModelPhase } from "../../store/modelUpload";
import { useUploadStore } from "../../store/upload";
import InfoDot from "../ui/InfoDot";

const STAGE_LABEL: Partial<Record<ModelPhase, string>> = {
  loading: "READING",
  inspecting: "INSPECTING",
  decimating: "DECIMATING",
  packing: "PACKING GLB",
};

/** The three-step header labels for the model path (the photo path keeps UPLOAD · REVIEW · PLACE). */
export const MODEL_STEPS = ["1 UPLOAD", "2 CHECK", "3 STORE"] as const;

/** Which header step a model phase lights. */
export function modelStepIndex(phase: ModelPhase): number {
  if (phase === "stored") return 2;
  if (phase === "review" || phase === "uploading") return 1;
  return 0;
}

const fmtM = (v: number): string => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

export default function ModelUploadStep() {
  const phase = useModelUploadStore((s) => s.phase);
  if (phase === "stored") return <StoredCard />;
  if (phase === "review" || phase === "uploading") return <CheckCard />;
  return <ProgressCard />;
}

function ProgressCard() {
  const phase = useModelUploadStore((s) => s.phase);
  const fileName = useModelUploadStore((s) => s.fileName);
  const rawBytes = useModelUploadStore((s) => s.rawBytes);
  const progress = useModelUploadStore((s) => s.progress);
  const stats = useModelUploadStore((s) => s.stats);
  return (
    <section className="uf-dropstep">
      <div className="uf-progress uf-progress--model">
        <div className="uf-progress__row">
          <span className="uf-mono">{fileName}</span>
          <span className="uf-mono uf-accent">
            {STAGE_LABEL[phase] ?? "WORKING"} · {Math.round(progress * 100)}%
          </span>
        </div>
        <div className="uf-bar">
          <div className="uf-bar__fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="uf-progress__hint">
          {phase === "decimating" && stats
            ? `${formatTris(stats.tris)} TRIANGLES — SIMPLIFYING TO THE 100K BUDGET`
            : `EVERYTHING RUNS IN YOUR BROWSER · ${formatBytes(rawBytes)} · NOTHING UPLOADS UNTIL YOU SAY SO`}
        </span>
      </div>
    </section>
  );
}

function CheckCard() {
  const s = useModelUploadStore();
  const memberPhase = useMemberStore((m) => m.phase);
  // The badge/login state may not have been asked for yet on this page — ask once.
  useEffect(() => {
    if (memberPhase === "unknown") void useMemberStore.getState().refresh();
  }, [memberPhase]);
  const stats = s.stats;
  if (!stats) return null;
  const uploading = s.phase === "uploading";
  const [bx, by, bz] = stats.bbox;

  return (
    <section className="uf-review">
      <div className="uf-review__left">
        <h2 className="uf-h2">Check the model</h2>
        <p className="uf-body">
          Read in your browser, packed as one GLB. Fix the units if the footprint looks wrong — then upload;
          placing it on the globe is the next step of this track.
        </p>
        <div className="uf-preview uf-preview--model">
          {s.thumbnailUrl ? (
            <img className="uf-preview__img" src={s.thumbnailUrl} alt={s.fileName ?? "model preview"} />
          ) : (
            <div className="uf-preview__placeholder">
              <span className="uf-mono">NO PREVIEW</span>
              <span className="uf-preview__note">this browser could not paint a thumbnail — the model is fine</span>
            </div>
          )}
        </div>
        <div className="uf-filerow">
          <div className="uf-progress__row">
            <span className="uf-mono">
              {s.fileName} · {s.format?.toUpperCase()} · {formatBytes(s.rawBytes)}
            </span>
            <span className="uf-mono uf-accent">
              PACKED {formatBytes(s.glbBytes)}
              {stats.textures > 0 && s.textureEdge && stats.maxTextureEdge > s.textureEdge
                ? ` · TEXTURES → ${s.textureEdge}²`
                : ""}
            </span>
          </div>
          <div className="uf-bar">
            <div className="uf-bar__fill" style={{ width: "100%" }} />
          </div>
          {s.decimatedFromTris !== null && (
            <span className="uf-badge uf-badge--warn">
              DECIMATED {formatTris(s.decimatedFromTris)} → {formatTris(stats.tris)} TRIANGLES
            </span>
          )}
        </div>
      </div>

      <div className="uf-review__right">
        <div className="uf-grid">
          <Fact label="TRIANGLES" value={formatTris(stats.tris)} badge={s.decimatedFromTris !== null ? "DECIMATED" : "OK"} />
          <Fact label="MESHES" value={String(stats.meshes)} badge="OK" />
          <Fact
            label="TEXTURES"
            value={stats.textures === 0 ? "NONE" : `${stats.textures} · UP TO ${Math.min(stats.maxTextureEdge, s.textureEdge ?? stats.maxTextureEdge)}²`}
            badge={stats.textures === 0 ? "FLAT" : "OK"}
          />
          <Fact label="FOOTPRINT" value={`${fmtM(bx)} × ${fmtM(bz)} m · ${fmtM(by)} m tall`} badge={s.unit.toUpperCase()} />
          <Fact label="SOURCE" value={s.format?.toUpperCase()} badge="GLB OUT" />
          <Fact
            label="LOCATION"
            value={s.placement ? formatLatLon(s.placement.latDeg, s.placement.lonDeg) : "NOT PLACED YET"}
            badge={s.placement ? "FROM PIN" : "PLACE LATER"}
            tone={s.placement ? "accent" : "dim"}
          />
        </div>

        <div className="uf-units">
          <span className="uf-units__label">SOURCE UNITS</span>
          {MODEL_UNITS.map((u: ModelUnit) => (
            <button
              key={u}
              type="button"
              className={`uf-chip${s.unit === u ? " uf-chip--on" : ""}`}
              disabled={uploading}
              onClick={() => void useModelUploadStore.getState().setUnit(u)}
            >
              {u.toUpperCase()}
            </button>
          ))}
          {s.unitSuggested && <span className="uf-badge uf-badge--warn">GUESSED FROM SIZE</span>}
          <InfoDot
            pos="down"
            label="About source units"
            tip="glTF is metres by spec; OBJ and FBX carry whatever the authoring tool used. Pick the unit the model was made in — the footprint updates and the GLB is re-packed."
          />
        </div>

        <label className="uf-title">
          <span className="uf-units__label">TITLE</span>
          <input
            className="uf-title__input"
            value={s.title}
            maxLength={120}
            disabled={uploading}
            onChange={(e) => useModelUploadStore.getState().setTitle(e.target.value)}
          />
        </label>

        {s.warnings.map((w) => (
          <div key={w} className="uf-notice">
            <div className="uf-notice__dot" aria-hidden="true" />
            <span>{w}</span>
          </div>
        ))}
        {s.error && (
          <div className="uf-notice">
            <div className="uf-notice__dot" aria-hidden="true" />
            <span>Upload failed — {s.error}</span>
          </div>
        )}

        <div className="uf-actions">
          {memberPhase === "member" ? (
            <button
              className="uf-btn uf-btn--primary"
              disabled={uploading}
              onClick={() => void useModelUploadStore.getState().upload()}
            >
              {uploading ? "UPLOADING…" : "UPLOAD MODEL"}&nbsp;&nbsp;→
            </button>
          ) : memberPhase === "anonymous" ? (
            <a className="uf-btn uf-btn--primary" href={loginUrl(returnHereUrl())}>
              SIGN IN TO UPLOAD&nbsp;&nbsp;→
            </a>
          ) : (
            <button className="uf-btn uf-btn--primary" disabled>
              CHECKING SIGN-IN…
            </button>
          )}
          <button className="uf-btn uf-btn--ghost" disabled={uploading} onClick={() => useModelUploadStore.getState().clear()}>
            START OVER
          </button>
        </div>
        <span className="uf-actions__hint">
          {memberPhase === "anonymous"
            ? "SIGNING IN RELOADS THE PAGE — DROP THE FILE AGAIN AFTERWARDS"
            : "STORED MODELS ARE PUBLIC — ANYONE EXPLORING THE GLOBE WILL SEE THEM ONCE PLACED"}
        </span>
      </div>
    </section>
  );
}

function StoredCard() {
  const s = useModelUploadStore();
  const stored = s.stored;
  const stats = s.stats;
  // The local blob is the same picture and can never 403: the platform's preview derivative
  // takes seconds to render after the PUT (browser-caught 2026-09-02h) — it is for the MS6 list.
  const thumb = s.thumbnailUrl ?? stored?.thumbnailUrl;
  return (
    <section className="uf-review">
      <div className="uf-review__left">
        <h2 className="uf-h2">Model stored</h2>
        <p className="uf-body">
          Packed as GLB and saved to your account. Placing it on the globe — and editing it there with the
          building tools — arrives with the next step of this track.
        </p>
        <div className="uf-preview uf-preview--model">
          {thumb ? (
            <img className="uf-preview__img" src={thumb} alt={s.title || "stored model"} />
          ) : (
            <div className="uf-preview__placeholder">
              <span className="uf-mono">STORED</span>
            </div>
          )}
        </div>
      </div>
      <div className="uf-review__right">
        <div className="uf-grid">
          <Fact label="TITLE" value={s.title || undefined} badge="SAVED" />
          <Fact label="STATUS" value={stored?.readiness ?? EM_DASH} badge={stored?.readiness === "READY" ? "READY" : "PROCESSING"} tone={stored?.readiness === "READY" ? "accent" : "warn"} />
          <Fact label="TRIANGLES" value={stats ? formatTris(stats.tris) : undefined} badge="OK" />
          <Fact label="PACKED" value={formatBytes(s.glbBytes)} badge="GLB" />
          <Fact
            label="LOCATION"
            value={s.placement ? formatLatLon(s.placement.latDeg, s.placement.lonDeg) : "NOT PLACED YET"}
            badge={s.placement ? "FROM PIN" : "PLACE LATER"}
            tone={s.placement ? "accent" : "dim"}
          />
        </div>
        <div className="uf-actions">
          <button className="uf-btn uf-btn--primary" onClick={() => useModelUploadStore.getState().clear()}>
            UPLOAD ANOTHER&nbsp;&nbsp;→
          </button>
          <button
            className="uf-btn uf-btn--ghost"
            onClick={() => {
              useModelUploadStore.getState().clear();
              useUploadStore.getState().closePanel();
            }}
          >
            ← GLOBE
          </button>
        </div>
        <span className="uf-actions__hint">THE MODEL IS PUBLIC BY URL — HIDING OR DELETING IT LATER REMOVES IT FROM THE WORLD, NOT FROM THE LINK</span>
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  badge,
  tone = "accent",
}: {
  label: string;
  value?: string;
  badge: string;
  tone?: "accent" | "warn" | "dim";
}) {
  const missing = value === undefined;
  return (
    <div className="uf-field">
      <div className="uf-field__head">
        <span className={`uf-field__label${missing ? " uf-field__label--hot" : ""}`}>{label}</span>
        <span className={`uf-badge uf-badge--${missing ? "warn" : tone}`}>{missing ? "MISSING" : badge}</span>
      </div>
      <div className={`uf-field__value${missing ? " uf-field__value--empty" : ""}`}>{value ?? EM_DASH}</div>
    </div>
  );
}
