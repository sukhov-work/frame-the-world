import { useCameraStore, type FpvBodyMarker } from "../../store/camera";
import { focalFromVerticalFov } from "../../lib/decode/sensors";
import { formatFocal, formatEyeM, cardinal, formatSigned } from "../../lib/format/readout";
import "../../styles/fpv-hud.css";

/**
 * FPV HUD (Phase 5.5 S6, owner ask): while ANY FPV is active, a LEFT-side instrument card
 * reads the view — focal length equivalent (live camera FOV inverted against the full-frame
 * height), compass heading + pitch of the view centre, eye height — plus sun/moon bearings.
 * Sun/moon EDGE CHIPS float at the frame edge pointing toward a body that is OUTSIDE the
 * frame (hidden while the body is visible, or below the planning gate). S6 follow-up: the
 * chips render in EVERY mode from the `skyMarkers` mirror (gated by the right-panel SKY
 * toggle); the instrument card stays FPV-only (`fpvHud`).
 *
 * Mounted as a top-level island (index.astro): position:fixed children must never live inside
 * a backdrop-filtered card (the S2 containing-block trap). Everything is pointer-events:none —
 * the HUD annotates the view, it never intercepts the look-drag.
 */

function bodyReadout(marker: FpvBodyMarker): string {
  if (!marker.up && marker.altDeg < -6) return "BELOW HORIZON";
  return `${Math.round(marker.azDeg)}° ${cardinal(marker.azDeg)} · ${formatSigned(marker.altDeg)}`;
}

export default function FpvHud() {
  const hud = useCameraStore((s) => s.fpvHud);
  const markers = useCameraStore((s) => s.skyMarkers);
  if (!hud && !markers) return null;
  return (
    <>
      {markers && (
        <>
          <BodyChip marker={markers.sun} glyph="☀" kind="sun" />
          <BodyChip marker={markers.moon} glyph="☾" kind="moon" />
        </>
      )}
      {hud && (
      <aside className="fh" aria-label="Camera view instruments">
        <div className="fh-row">
          <span className="fh-label">FOCAL</span>
          <span className="fh-value">
            {formatFocal(focalFromVerticalFov(hud.fovDeg))}
            <span className="fh-sub"> · {hud.fovDeg.toFixed(1)}°</span>
          </span>
        </div>
        <div className="fh-row">
          <span className="fh-label">HEADING</span>
          <span className="fh-value">
            {Math.round(hud.headingDeg)}° {cardinal(hud.headingDeg)}
          </span>
        </div>
        <div className="fh-row">
          <span className="fh-label">PITCH</span>
          <span className="fh-value">{formatSigned(hud.pitchDeg)}</span>
        </div>
        <div className="fh-row">
          <span className="fh-label">EYE</span>
          <span className="fh-value">{formatEyeM(hud.eyeAboveGroundM)}</span>
        </div>
        <div className="fh-row fh-row--sun">
          <span className="fh-label">☀ SUN</span>
          <span className="fh-value">{bodyReadout(hud.sun)}</span>
        </div>
        <div className="fh-row fh-row--moon">
          <span className="fh-label">☾ MOON</span>
          <span className="fh-value">{bodyReadout(hud.moon)}</span>
        </div>
      </aside>
      )}
    </>
  );
}

/** Edge chip pointing toward an off-frame body — clamped to a margin box inside the viewport. */
function BodyChip({
  marker,
  glyph,
  kind,
}: {
  marker: FpvBodyMarker;
  glyph: string;
  kind: "sun" | "moon";
}) {
  if (marker.inFrame || !marker.up) return null;
  // Screen-plane direction: store y is up, screen y is down.
  const sx = marker.dirX;
  const sy = -marker.dirY;
  const margin = 64;
  const halfW = window.innerWidth / 2 - margin;
  const halfH = window.innerHeight / 2 - margin;
  const k = Math.min(
    Math.abs(sx) > 1e-6 ? halfW / Math.abs(sx) : Infinity,
    Math.abs(sy) > 1e-6 ? halfH / Math.abs(sy) : Infinity,
  );
  const x = window.innerWidth / 2 + sx * k;
  const y = window.innerHeight / 2 + sy * k;
  const angleDeg = (Math.atan2(sy, sx) * 180) / Math.PI;
  return (
    <div
      className={`fh-chip fh-chip--${kind}`}
      style={{ left: x, top: y }}
      role="img"
      aria-label={`${kind} is off-frame at ${Math.round(marker.azDeg)}°`}
    >
      <span className="fh-chip__glyph">{glyph}</span>
      <span className="fh-chip__arrow" style={{ transform: `rotate(${angleDeg}deg)` }}>
        ➤
      </span>
    </div>
  );
}
