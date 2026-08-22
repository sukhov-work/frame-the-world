/**
 * TargetSheet (M1; ghosts M3c) — the /m face of the tracked sky target: live ALT/AZ/MAG, the
 * skyline verdict, the next dark-sky windows, the SHOW/MARK/TRAIL/GHOSTS chips and the
 * ghost-chain steppers. Same stores + lib calls as the desktop TargetPanel (never the panel
 * itself); the compact card drops the per-kind fact blocks — those are desktop depth, the
 * phone loop needs "where is it, when do I go". The ONE exception is PREDICTED ECLIPSES (owner
 * 2026-08-22k): an eclipse is a trip you plan weeks out, which is exactly the phone loop.
 *
 * Cost disciplines carried over: az/alt per MINUTE key (the fastest target crawls ~0.3°/day);
 * the ~10–20 ms targetWindows scan keyed to the hour + 0.05°-quantized eye + target — being
 * mounted IS the open gate (the sheet unmounts when closed).
 */

import { useEffect, useMemo, useState } from "react";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { useFindStore } from "../../store/find";
import type { FindBody } from "../../lib/ephemeris/frameFinder";
import { useCameraStore } from "../../store/camera";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { targetAzAlt } from "../../lib/ephemeris/targets";
import { targetWindows, type TargetWindow } from "../../lib/ephemeris/planner";
import {
  lunarEclipseAt,
  nextLunarEclipses,
  nextSolarEclipses,
  solarEclipseAt,
  type EclipseRow,
} from "../../lib/ephemeris/eclipse";
import { cardinal } from "../../lib/format/readout";
import "../../styles/mobile/chrome.css";

const clockLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

/** Session quality → a 4-step bar (score = altitude × moon interference × duration). */
function stars(score: number): string {
  const n = Math.max(1, Math.min(4, Math.round(score * 4)));
  return "★".repeat(n) + "☆".repeat(4 - n);
}

function WindowRow({ w, onJump }: { w: TargetWindow; onJump: (ms: number) => void }) {
  const moonNote =
    w.moonAltDeg <= 0
      ? "no moon"
      : `moon ${Math.round(w.moonAltDeg)}° ${Math.round(w.moonIllum * 100)}%`;
  return (
    <button type="button" className="m-win" onClick={() => onJump(w.peakMs)}>
      <span className="m-win__date">{dateLabel(w.startMs)}</span>
      <span>
        {clockLabel(w.startMs)}–{clockLabel(w.endMs)}
      </span>
      <span className="m-win__score">{stars(w.score)}</span>
      <span className="m-win__peak">
        PEAK {clockLabel(w.peakMs)} · {w.peakAltDeg.toFixed(1)}° {cardinal(w.peakAzDeg)} ·{" "}
        {moonNote}
      </span>
    </button>
  );
}

/** Rows per body — the /m cap (the PlanSheet slice(0, 8) precedent, tightened for a phone). */
const ECLIPSE_ROWS = 4;

/** Eclipse dates carry the YEAR (desktop twin): the next eclipses at one site span decades, so a
 *  bare "Aug 2" reads as "this year" and is a factual error. */
function eclipseDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

/** One eclipse row — the `.m-win` grammar, tap to pin scene time to greatest eclipse. */
function EclipseRowView({ row, onJump }: { row: EclipseRow; onJump: (ms: number) => void }) {
  return (
    <button type="button" className="m-win" onClick={() => onJump(row.peakMs)}>
      {/* WITH THE YEAR — this list spans decades, unlike the 8-night window list (desktop twin). */}
      <span className="m-win__date">{eclipseDateLabel(row.peakMs)}</span>
      <span>{row.phase.toUpperCase()}</span>
      {/* A PENUMBRAL eclipse has zero UMBRAL coverage by definition, so "0%" here reads as
          "nothing happens" for an event that is real and visible. The phase word already
          carries the meaning; the honest cell is a dash, not a false zero. */}
      <span className="m-win__score">
        {row.phase === "penumbral" ? "—" : `${Math.round(row.coverage * 100)}%`}
      </span>
      <span className="m-win__peak">
        {clockLabel(row.peakMs)}
        {row.peakAltDeg > 0
          ? ` · ${Math.round(row.peakAltDeg)}°`
          : row.visible
            ? " · SETS MID-ECLIPSE"
            : " · BELOW HORIZON"}
      </span>
    </button>
  );
}

export default function TargetSheet({ onClose }: { onClose: () => void }) {
  const target = useSkyStore((s) => s.target);
  const stopFollowing = useSkyStore((s) => s.stopFollowing);
  // FIND IN FRAME seat (batch #4 item 8) — the sky-menu mapping: sun/moon own chips, else TARGET.
  const findOpen = useFindStore((s) => s.open);
  const findBodies = useFindStore((s) => s.bodies);
  const findBody: FindBody =
    target.id === "body:sun" ? "sun" : target.id === "body:moon" ? "moon" : "target";
  const findOn = findOpen && findBodies[findBody];
  const visible = useSkyStore((s) => s.visible);
  const setVisible = useSkyStore((s) => s.setVisible);
  const highlight = useSkyStore((s) => s.highlight);
  const setHighlight = useSkyStore((s) => s.setHighlight);
  const trail = useSkyStore((s) => s.trail);
  const setTrail = useSkyStore((s) => s.setTrail);
  const ghosts = useSkyStore((s) => s.ghosts);
  const setGhosts = useSkyStore((s) => s.setGhosts);
  const ghostCount = useSkyStore((s) => s.ghostCount);
  const setGhostCount = useSkyStore((s) => s.setGhostCount);
  const ghostStepMin = useSkyStore((s) => s.ghostStepMin);
  const setGhostStepMin = useSkyStore((s) => s.setGhostStepMin);
  const track = useSkyStore((s) => s.track);
  const setTrack = useSkyStore((s) => s.setTrack);
  const setTime = useTimeStore((s) => s.setTime);
  const live = useTimeStore((s) => s.live);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const playRate = useTimeStore((s) => s.playRate);

  // The eye: planner anchor when there is one, else the live view focus (the shared pattern).
  const anchor = usePlanStore((s) => s.anchor);
  const planTarget = usePlanStore((s) => s.target);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  const latDeg = anchor?.latDeg ?? focusLat;
  const lonDeg = anchor?.lonDeg ?? focusLon;

  const [nowMs, setNowMs] = useState(() => sceneTimeMs());
  useEffect(() => {
    if (!live && playRate === null) {
      setNowMs(pinnedMs);
      return;
    }
    setNowMs(sceneTimeMs());
    const id = setInterval(() => setNowMs(sceneTimeMs()), playRate === null ? 1000 : 250);
    return () => clearInterval(id);
  }, [live, pinnedMs, playRate]);

  const minuteKey = Math.floor(nowMs / 60_000);
  const now = useMemo(
    () => targetAzAlt(target, minuteKey * 60_000, latDeg, lonDeg),
    [minuteKey, latDeg, lonDeg, target],
  );

  const hourKey = Math.floor(nowMs / 3_600_000);
  const latKey = Math.round(latDeg * 20);
  const lonKey = Math.round(lonDeg * 20);
  const windows = useMemo(
    () =>
      targetWindows(
        hourKey * 3_600_000,
        { latDeg: latKey / 20, lonDeg: lonKey / 20, groundAltM: 0, eyeAboveGroundM: 1.6 },
        target,
        { days: 8, stepMin: 15, limit: 5 },
      ),
    [hourKey, latKey, lonKey, target],
  );

  // PREDICTED ECLIPSES — sun/moon only. Gated on `target.kind`, NEVER on `target.facts.kind`:
  // both bodies reuse the planet fact shape, so a facts gate would print eclipse rows on Mars.
  // Keyed to the DAY (~6 ms per eclipse found) — never to nowMs or the raw focus.
  const isSun = target.kind === "sun";
  const isMoon = target.kind === "moon";
  const dayKey = Math.floor(nowMs / 86_400_000);
  const eclipses = useMemo(() => {
    if (!isSun && !isMoon) return [];
    const obs = { latDeg: latKey / 20, lonDeg: lonKey / 20, groundAltM: 0, eyeAboveGroundM: 1.6 };
    const from = dayKey * 86_400_000;
    return isSun
      ? nextSolarEclipses(from, obs, ECLIPSE_ROWS)
      : nextLunarEclipses(from, obs, ECLIPSE_ROWS);
  }, [isSun, isMoon, dayKey, latKey, lonKey]);

  // What is happening RIGHT NOW at scene time (no search — cheap enough to ride the minute).
  const eclipseNow = useMemo(() => {
    if (!isSun && !isMoon) return null;
    if (isSun) {
      const e = solarEclipseAt(minuteKey * 60_000, latKey / 20, lonKey / 20);
      return e.phase === "none"
        ? null
        : `${e.phase.toUpperCase()} · ${(e.coverage * 100).toFixed(1)}% COVERED`;
    }
    const l = lunarEclipseAt(minuteKey * 60_000);
    return l.phase === "none"
      ? null
      : l.phase === "penumbral"
        ? `PENUMBRAL · ${(l.penumbralMag * 100).toFixed(0)}% INTO THE OUTER SHADOW`
        : `${l.phase.toUpperCase()} · ${(l.umbralCoverage * 100).toFixed(1)}% IN THE UMBRA`;
  }, [isSun, isMoon, minuteKey, latKey, lonKey]);

  const upNow = now.altDeg > 0;
  const s = now.state;

  return (
    <div>
      <div className="m-chips">
        <span className={`m-badge${upNow ? " m-badge--clear" : ""}`}>
          {upNow ? "ABOVE HORIZON" : "BELOW HORIZON"}
        </span>
        {upNow && planTarget?.id === target.id && (
          <span className={`m-badge ${planTarget.blockedNow ? "m-badge--blocked" : "m-badge--clear"}`}>
            {planTarget.blockedNow ? "BEHIND SKYLINE" : "SKYLINE CLEAR"}
          </span>
        )}
      </div>

      <div className="m-live">
        <span className="m-k">ALT</span>
        <span className="m-v">{now.altDeg.toFixed(1)}°</span>
        <span className="m-k">AZ</span>
        <span className="m-v">
          {Math.round(now.azDeg)}° {cardinal(now.azDeg)}
        </span>
        <span className="m-k">MAG</span>
        <span className="m-v">{s.magnitude != null ? s.magnitude.toFixed(1) : "—"}</span>
        <span className="m-k">ELONG</span>
        <span className="m-v">{Math.round(s.elongationDeg)}°</span>
      </div>

      {/* Owner 2026-08-19 (batch item 8): the actions block sits right under the essentials,
          AHEAD of the next-sessions list — both shells share this order. */}
      <div className="m-toggles">
        <button
          type="button"
          className={`m-toggle${visible ? " m-toggle--on" : ""}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          SHOW
        </button>
        <button
          type="button"
          className={`m-toggle${highlight ? " m-toggle--on" : ""}`}
          aria-pressed={highlight}
          disabled={!visible}
          onClick={() => setHighlight(!highlight)}
        >
          MARK
        </button>
        <button
          type="button"
          className={`m-toggle${trail ? " m-toggle--on" : ""}`}
          aria-pressed={trail}
          disabled={!visible}
          onClick={() => setTrail(!trail)}
        >
          TRAIL
        </button>
        <button
          type="button"
          className={`m-toggle${ghosts ? " m-toggle--on" : ""}`}
          aria-pressed={ghosts}
          disabled={!visible}
          onClick={() => setGhosts(!ghosts)}
        >
          GHOSTS
        </button>
        {/* TRACKING camera lock (owner 2026-08-15c) — not gated on `visible` (follows the
            ephemeris, not the render); released by a look-drag or the target setting. */}
        <button
          type="button"
          className={`m-toggle${track ? " m-toggle--on" : ""}`}
          aria-pressed={track}
          onClick={() => setTrack(!track)}
        >
          TRACK
        </button>
      </div>
      {visible && ghosts && (
        <div className="m-ghostrow">
          <span>±</span>
          <button
            type="button"
            className="m-ghostbtn"
            aria-label="Fewer ghost copies"
            disabled={ghostCount <= 1}
            onClick={() => setGhostCount(ghostCount - 1)}
          >
            −
          </button>
          <span className="m-ghostrow__value">{ghostCount}</span>
          <button
            type="button"
            className="m-ghostbtn"
            aria-label="More ghost copies"
            disabled={ghostCount >= 15}
            onClick={() => setGhostCount(ghostCount + 1)}
          >
            +
          </button>
          <span>EVERY</span>
          <select
            className="m-ghostsel"
            aria-label="Minutes between ghost copies"
            value={ghostStepMin}
            onChange={(e) => setGhostStepMin(Number(e.target.value))}
          >
            {[1, 2, 5, 10, 15, 20, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} MIN
              </option>
            ))}
          </select>
        </div>
      )}
      {/* FIND IN FRAME (owner batch #4 item 8) — the sky-menu action seated above UNFOLLOW;
          same body mapping + composite enabled-read as the menu (on /m PLAN keeps its sheet). */}
      <button
        type="button"
        className={`m-findframe${findOn ? " m-findframe--on" : ""}`}
        aria-pressed={findOn}
        onClick={() => {
          const f = useFindStore.getState();
          f.setBody(findBody, !findOn);
          if (!findOn) f.setOpen(true);
        }}
      >
        {findOn ? "✓ FIND IN FRAME" : "⌖ FIND IN FRAME"}
      </button>
      {/* Owner 2026-08-19 (batch item 7): dismiss the followed object — hides it everywhere
          and releases the camera; search / long-press the sky to follow again. */}
      <button
        type="button"
        className="m-unfollow"
        onClick={() => {
          stopFollowing();
          onClose();
        }}
      >
        ✕ UNFOLLOW
      </button>

      {(isSun || isMoon) && (
        <>
          <div className="m-section">
            {isSun ? "ECLIPSES · FROM THIS ANCHOR" : "ECLIPSES · MOON IN EARTH'S SHADOW"}
          </div>
          {eclipseNow && <div className="m-ecl-live">NOW: {eclipseNow}</div>}
          {eclipses.length > 0 ? (
            eclipses.map((r) => <EclipseRowView key={r.peakMs} row={r} onJump={setTime} />)
          ) : (
            <div className="m-status-line">NO ECLIPSE FOUND IN THE SEARCH HORIZON</div>
          )}
        </>
      )}

      <div className="m-section">NEXT SESSIONS · SUN &lt; −15° · TARGET &gt; 5°</div>
      {windows.length > 0 ? (
        windows.map((w) => <WindowRow key={w.startMs} w={w} onJump={setTime} />)
      ) : (
        <div className="m-status-line">NO DARK-SKY PASS IN THE NEXT 8 NIGHTS HERE</div>
      )}

      <div className="m-status-line">{target.source}</div>
    </div>
  );
}
