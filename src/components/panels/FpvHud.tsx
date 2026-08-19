import { useEffect, useRef, useState } from "react";
import { useCameraStore, type FpvBodyMarker } from "../../store/camera";
import SkyGotoChips from "./SkyGotoChips";
import { focalFromVerticalFov } from "../../lib/decode/sensors";
import {
  formatFocal,
  formatEyeM,
  formatLatLonPaste,
  cardinal,
  formatSigned,
} from "../../lib/format/readout";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import "../../styles/fpv-hud.css";
import "../../styles/tips.css";

/**
 * FPV HUD (Phase 5.5 S6, owner ask): while ANY FPV is active, a LEFT-side instrument card
 * reads the view — focal length equivalent (live camera FOV inverted against the full-frame
 * height), compass heading + pitch of the view centre, eye height — plus sun/moon bearings.
 * Sun/moon EDGE CHIPS float at the frame edge pointing toward a body that is OUTSIDE the
 * frame (hidden while the body is visible, or below the planning gate). S6 follow-up: the
 * chips render in EVERY mode from the `skyMarkers` mirror (gated by the right-panel SKY
 * toggle); the instrument rows stay FPV-only (`fpvHud`).
 *
 * 2026-07-14 (owner): the card itself is now ALWAYS-ON — in every mode it shows the viewer's
 * precise ground-point coordinates (`camGeo` mirror: camera-nadir geodetic + rendered terrain
 * height), copyable in the exact "lat, lon" shape Google Earth accepts. Click the row to copy.
 *
 * Mounted as a top-level island (index.astro): position:fixed children must never live inside
 * a backdrop-filtered card (the S2 containing-block trap). The card is pointer-events:none —
 * it annotates the view, never intercepts the look-drag — except the copy row and the drag
 * grip, which re-enable themselves.
 */

function bodyReadout(marker: FpvBodyMarker): string {
  if (!marker.up && marker.altDeg < -6) return "BELOW HORIZON";
  return `${Math.round(marker.azDeg)}° ${cardinal(marker.azDeg)} · ${formatSigned(marker.altDeg)}`;
}

export default function FpvHud() {
  const hud = useCameraStore((s) => s.fpvHud);
  const markers = useCameraStore((s) => s.skyMarkers);
  const camGeo = useCameraStore((s) => s.camGeo);
  const drag = usePanelDrag("fpv-hud");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );
  if (!hud && !markers && !camGeo) return null;

  const copyCoords = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        /* clipboard denied — the text stays selectable by hand */
      });
  };

  return (
    <>
      {/* Off-frame GOTO chips — extracted to SkyGotoChips (2026-08-19b) so /m mounts the
          same island; desktop keeps the every-mode S6 behavior through this render. */}
      <SkyGotoChips />
      {(hud || camGeo) && (
      <aside className="fh" style={drag.style} aria-label="Camera view instruments">
        <DragGrip drag={drag} label="Move the view instruments" tipPos="right" />
        {camGeo && (
          <>
            <button
              type="button"
              className="fh-pos"
              onClick={() => copyCoords(formatLatLonPaste(camGeo.latDeg, camGeo.lonDeg))}
              title="Copy coordinates (paste into Google Earth)"
            >
              <span className="fh-label">POSITION</span>
              <span className="fh-pos__coords">
                {formatLatLonPaste(camGeo.latDeg, camGeo.lonDeg)}
              </span>
              <span className={`fh-pos__copy${copied ? " is-copied" : ""}`}>
                {copied ? "COPIED ✓" : "COPY"}
              </span>
            </button>
            {camGeo.groundAltM != null && (
              <div className="fh-row">
                <span className="fh-label">GROUND</span>
                <span className="fh-value">{formatEyeM(camGeo.groundAltM)}</span>
              </div>
            )}
          </>
        )}
        {hud && (
        <>
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
        <div className="fh-hint">
          WASD·◀▲▼▶ WALK · DRAG LOOK
          <br />␣ RISE · ⇧␣ SINK · WHEEL ZOOM
        </div>
        </>
        )}
      </aside>
      )}
    </>
  );
}

