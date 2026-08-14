/**
 * TargetSheet (M1; ghosts M3c) — the /m face of the tracked sky target: live ALT/AZ/MAG, the
 * skyline verdict, the next dark-sky windows, the SHOW/MARK/TRAIL/GHOSTS chips and the
 * ghost-chain steppers. Same stores + lib calls as the desktop TargetPanel (never the panel
 * itself); the compact card drops the per-kind fact blocks — those are desktop depth, the
 * phone loop needs "where is it, when do I go".
 *
 * Cost disciplines carried over: az/alt per MINUTE key (the fastest target crawls ~0.3°/day);
 * the ~10–20 ms targetWindows scan keyed to the hour + 0.05°-quantized eye + target — being
 * mounted IS the open gate (the sheet unmounts when closed).
 */

import { useEffect, useMemo, useState } from "react";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { useCameraStore } from "../../store/camera";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { targetAzAlt } from "../../lib/ephemeris/targets";
import { targetWindows, type TargetWindow } from "../../lib/ephemeris/planner";
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

export default function TargetSheet() {
  const target = useSkyStore((s) => s.target);
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

      <div className="m-section">NEXT SESSIONS · SUN &lt; −15° · TARGET &gt; 5°</div>
      {windows.length > 0 ? (
        windows.map((w) => <WindowRow key={w.startMs} w={w} onJump={setTime} />)
      ) : (
        <div className="m-status-line">NO DARK-SKY PASS IN THE NEXT 8 NIGHTS HERE</div>
      )}

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
            disabled={ghostCount >= 8}
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
      <div className="m-status-line">{target.source}</div>
    </div>
  );
}
