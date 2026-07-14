/**
 * TimeScrubber — the Phase-4 scene-time instrument (IMPLEMENTATION_PLAN §4, ADR D6). A docked
 * bottom-centre rail spanning ±12 h (SCRUB.windowHours) around an anchor instant: dragging pins
 * scene time via `useTimeStore.setTime` and the ephemeris relights the whole globe (terminator,
 * sun/moon, shadows, golden hour, stars); NOW resumes the wall clock. Releasing the knob at a rail
 * end recentres the window there, so repeated edge drags walk across days.
 *
 * When a photo lands on the globe with an EXIF capture time, the scene pins to that instant —
 * `capturedAtToUtcMs` reads the TZ-naive stamp as solar time at the placement longitude (the
 * documented v1 choice), so the pin shows the light the photographer actually stood in.
 *
 * The knob is keyboard-operable (role="slider": arrows ± SCRUB.keyStepMin, Home/End = window
 * edges, Backspace/double-click = go live). TimeReadout (bottom-right) stays the precise readout;
 * this panel's header shows the offset against the real clock.
 *
 * Multiday (2026-07-10): the rail stays the ±12 h fine control; the header date picker jumps the
 * whole window to ANY calendar date (local time-of-day preserved, window recentred). The
 * ephemeris is exact at any epoch, so sun/moon/star positions are correct on the chosen date.
 *
 * Owner 2026-07-14: a precise time-of-day picker joins the date; ±hour/±minute steppers join the
 * ±day pair; and a PLAY transport advances scene time fluidly — real speed or the SCRUB.playRates
 * fast-forward presets. The scene itself never steps: consumers read sceneTimeMs() per frame
 * (store/time playback derivation); the interval here only refreshes the knob and labels.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  fractionToTime,
  localDateStr,
  localTimeStr,
  sceneTimeMs,
  timeToFraction,
  useTimeStore,
  withLocalDate,
  withLocalTime,
} from "../../store/time";
import { useUploadStore } from "../../store/upload";
import { capturedAtToUtcMs } from "../../lib/ephemeris/captureTime";
import { SCRUB } from "../globe/tuning";
import InfoDot from "../ui/InfoDot";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import "../../styles/time-scrubber.css";
import "../../styles/tips.css";

const WINDOW_MS = SCRUB.windowHours * 3_600_000;

/** "+3 h 12 m" / "−47 m" / "+164 d 2 h" offset of the pinned scene time against the real clock.
 *  Minutes are rounded FIRST and carried up (the old per-unit rounding printed "+3936 h 60 m"). */
function offsetLabel(deltaMs: number): string {
  const sign = deltaMs < 0 ? "−" : "+";
  const totalMin = Math.round(Math.abs(deltaMs) / 60_000);
  if (totalMin === 0) return "±0 m";
  const d = Math.floor(totalMin / 1_440);
  const h = Math.floor((totalMin % 1_440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${sign}${d} d ${h} h`; // date-picker range — minutes are noise here
  return h > 0 ? `${sign}${h} h ${String(m).padStart(2, "0")} m` : `${sign}${m} m`;
}

/** "1 MIN/S" style label for a playback preset (scene-seconds per real second). */
function rateLabel(rate: number): string {
  if (rate < 60) return `×${rate}`;
  if (rate < 3600) return `${Math.round(rate / 60)} MIN/S`;
  return `${Math.round(rate / 3600)} HR/S`;
}

export default function TimeScrubber() {
  const drag = usePanelDrag("timeline");
  const live = useTimeStore((s) => s.live);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const playRate = useTimeStore((s) => s.playRate);
  const setTime = useTimeStore((s) => s.setTime);
  const goLive = useTimeStore((s) => s.goLive);
  const play = useTimeStore((s) => s.play);
  const stopPlay = useTimeStore((s) => s.stopPlay);
  const uploadPhase = useUploadStore((s) => s.phase);
  const playing = playRate !== null;

  const railRef = useRef<HTMLDivElement>(null);
  const [anchorMs, setAnchorMs] = useState(() => sceneTimeMs());
  // The PLAY speed the transport arms (scene-seconds per real second); 1 = real time.
  const [armedRate, setArmedRate] = useState<number>(1);
  // Ref, not state: nothing renders from the drag flag, and it must flip synchronously so a
  // pointermove arriving in the same tick as pointerdown already scrubs.
  const draggingRef = useRef(false);
  // Live mode: a coarse tick keeps the creeping knob honest (the store is never written per-frame).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      // Recentre quietly if hours of live drift walked the knob toward a rail end.
      if (Math.abs(timeToFraction(Date.now(), anchorMs, WINDOW_MS) - 0.5) > 0.45) {
        setAnchorMs(Date.now());
      }
      forceTick((n) => n + 1);
    }, 10_000);
    return () => clearInterval(id);
  }, [live, anchorMs]);

  // Playback: a fast UI tick keeps the knob/labels riding the fluid scene time (the SCENE reads
  // sceneTimeMs() per frame — this interval is display-only). The window recentres when the
  // playing knob reaches a rail end, so fast-forward walks across days hands-free.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const f = timeToFraction(sceneTimeMs(), anchorMs, WINDOW_MS);
      if (f <= SCRUB.edgeRecenterFrac || f >= 1 - SCRUB.edgeRecenterFrac) {
        setAnchorMs(sceneTimeMs());
      }
      forceTick((n) => n + 1);
    }, SCRUB.playTickMs);
    return () => clearInterval(id);
  }, [playing, anchorMs]);

  // Placed photo with an EXIF capture time → pin the scene to the capture instant (solar time at
  // the placement longitude) and centre the rail there. Re-placing re-seeds.
  useEffect(() => {
    if (uploadPhase !== "placed") return;
    const { exif, placement } = useUploadStore.getState();
    if (!exif?.capturedAt || !placement) return;
    const ms = capturedAtToUtcMs(exif.capturedAt, placement.lonDeg);
    if (ms === null) return;
    setTime(ms);
    setAnchorMs(ms);
  }, [uploadPhase, setTime]);

  const nowMs = sceneTimeMs();
  const fraction = timeToFraction(nowMs, anchorMs, WINDOW_MS);

  const scrubToClientX = (clientX: number) => {
    const rect = railRef.current!.getBoundingClientRect();
    const f = (clientX - rect.left) / rect.width;
    setTime(fractionToTime(f, anchorMs, WINDOW_MS));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events (tests) have no active pointer — dragging still works via bubbling
    }
    draggingRef.current = true;
    scrubToClientX(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) scrubToClientX(e.clientX);
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // Released at a rail end → recentre the window on the pinned instant (walk further days).
    const f = timeToFraction(useTimeStore.getState().timeMs, anchorMs, WINDOW_MS);
    if (f <= SCRUB.edgeRecenterFrac || f >= 1 - SCRUB.edgeRecenterFrac) {
      setAnchorMs(useTimeStore.getState().timeMs);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const stepMs = SCRUB.keyStepMin * 60_000;
    const base = sceneTimeMs();
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") setTime(base - stepMs);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") setTime(base + stepMs);
    else if (e.key === "Home") setTime(fractionToTime(0, anchorMs, WINDOW_MS));
    else if (e.key === "End") setTime(fractionToTime(1, anchorMs, WINDOW_MS));
    else if (e.key === "Backspace" || e.key === "Delete") goLive();
    else return;
    e.preventDefault();
  };

  const pct = fraction * 100;
  const offsetMinNow = Math.round((nowMs - Date.now()) / 60_000);

  // Date jump: move the pinned window to another calendar day, same local time-of-day.
  const onDateChange = (dateStr: string) => {
    const ms = withLocalDate(sceneTimeMs(), dateStr);
    if (ms === null) return; // cleared/partial input — never scrub on garbage
    setTime(ms);
    setAnchorMs(ms);
  };

  // Precise time-of-day (owner 2026-07-14): same calendar day, another wall time.
  const onTimeChange = (timeStr: string) => {
    const ms = withLocalTime(sceneTimeMs(), timeStr);
    if (ms === null) return; // cleared input — never scrub on garbage
    setTime(ms);
    setAnchorMs(ms);
  };

  // Quick traversal (Phase 5.5 S1 days; owner 2026-07-14 hours/minutes): ± one unit keeping the
  // rest of the stamp — pins even from LIVE. The window recentres only when the step would land
  // the knob in the clamp band (day steps always do; hour/minute steps stay put on the rail).
  const stepBy = (deltaMs: number) => {
    const ms = sceneTimeMs() + deltaMs;
    setTime(ms);
    const f = timeToFraction(ms, anchorMs, WINDOW_MS);
    if (f <= SCRUB.edgeRecenterFrac || f >= 1 - SCRUB.edgeRecenterFrac) setAnchorMs(ms);
  };

  // PLAY/STOP: play() pins the current instant and advances it at the armed rate (no-op when
  // already LIVE at real speed — the wall clock IS ×1 playback); STOP freezes where it reached.
  const togglePlay = () => {
    if (playing) {
      stopPlay();
      return;
    }
    play(armedRate);
    if (!useTimeStore.getState().live) setAnchorMs(sceneTimeMs());
  };
  const onRateChange = (rate: number) => {
    setArmedRate(rate);
    if (playing) play(rate); // re-arm the running reel at the new speed
  };

  const ff = playing && (playRate ?? 1) > 1;

  return (
    <aside className="ts" style={drag.style} aria-label="Scene time scrubber — relights the globe">
      <DragGrip drag={drag} label="Move the time scrubber" tipPos="up" />
      <div className="ts-head">
        <span className="ts-label">TIME SCRUB</span>
        <button
          type="button"
          className="ts-day tip"
          aria-label="Previous day (same time)"
          data-tip="PREVIOUS DAY, SAME TIME"
          onClick={() => stepBy(-86_400_000)}
        >
          ◀
        </button>
        {/* Inputs render no ::after — the wrapper span anchors the tip (tips.css). */}
        <span
          className="tip tip-wrap"
          data-tip="JUMP THE 24H WINDOW TO ANY DATE — SUN, MOON AND STARS FOLLOW."
        >
          <input
            type="date"
            className="ts-date"
            aria-label="Scene date — jump the window to another day"
            value={localDateStr(nowMs)}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </span>
        <span className="tip tip-wrap" data-tip="SET THE PRECISE TIME OF DAY — LIGHT FOLLOWS.">
          <input
            type="time"
            className="ts-date ts-time"
            aria-label="Scene time of day"
            value={localTimeStr(nowMs)}
            onChange={(e) => onTimeChange(e.target.value)}
          />
        </span>
        <button
          type="button"
          className="ts-day tip"
          aria-label="Next day (same time)"
          data-tip="NEXT DAY, SAME TIME"
          onClick={() => stepBy(86_400_000)}
        >
          ▶
        </button>
        <span className={`ts-offset${ff ? " ts-offset--ff" : ""}`}>
          {live ? "LIVE" : `${playing ? (ff ? "▶▶ " : "▶ ") : ""}${offsetLabel(nowMs - Date.now())}`}
        </span>
        <InfoDot
          label="About scene time"
          tip="Scene time drives the whole planet: sun, shadows, moon phase, stars. Scrub to plan golden hour at your pin's location."
        />
        {!live && (
          <button
            type="button"
            className="ts-now tip"
            data-tip="RESUME THE LIVE WALL CLOCK."
            onClick={() => { goLive(); setAnchorMs(Date.now()); }}
          >
            NOW
          </button>
        )}
      </div>
      <div
        ref={railRef}
        className="ts-rail tip"
        role="slider"
        tabIndex={0}
        data-tip="SCRUB ±12H — LIGHT, SHADOWS AND SKY FOLLOW SCENE TIME. DOUBLE-CLICK FOR NOW."
        aria-label="Scene time offset from the real clock"
        aria-valuemin={-SCRUB.windowHours * 30}
        aria-valuemax={SCRUB.windowHours * 30}
        aria-valuenow={offsetMinNow}
        aria-valuetext={new Date(nowMs).toUTCString()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => {
          endDrag();
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* no capture to release for synthetic pointers */
          }
        }}
        onPointerCancel={endDrag}
        onDoubleClick={() => { goLive(); setAnchorMs(Date.now()); }}
        onKeyDown={onKeyDown}
      >
        <div className="ts-track" />
        <div className="ts-ticks" aria-hidden="true">
          {Array.from({ length: SCRUB.windowHours + 1 }, (_, i) => (
            <span key={i} className={`ts-tick${i % 6 === 0 ? " ts-tick--major" : ""}`} />
          ))}
        </div>
        <div className={`ts-knob${live ? "" : " ts-knob--pinned"}`} style={{ left: `${pct}%` }} />
      </div>
      <div className="ts-foot">
        <span className="ts-span" aria-hidden="true">−{SCRUB.windowHours / 2}h</span>
        <div className="ts-transport">
          <span className="ts-step">
            <button
              type="button"
              className="ts-day tip"
              aria-label="Previous hour (same minute)"
              data-tip="PREVIOUS HOUR"
              onClick={() => stepBy(-3_600_000)}
            >
              ◀
            </button>
            <span className="ts-step__unit" aria-hidden="true">H</span>
            <button
              type="button"
              className="ts-day tip"
              aria-label="Next hour (same minute)"
              data-tip="NEXT HOUR"
              onClick={() => stepBy(3_600_000)}
            >
              ▶
            </button>
          </span>
          <span className="ts-step">
            <button
              type="button"
              className="ts-day tip"
              aria-label="Previous minute"
              data-tip="PREVIOUS MINUTE"
              onClick={() => stepBy(-60_000)}
            >
              ◀
            </button>
            <span className="ts-step__unit" aria-hidden="true">M</span>
            <button
              type="button"
              className="ts-day tip"
              aria-label="Next minute"
              data-tip="NEXT MINUTE"
              onClick={() => stepBy(60_000)}
            >
              ▶
            </button>
          </span>
          <button
            type="button"
            className={`ts-play tip${playing ? " is-on" : ""}${ff ? " is-ff" : ""}`}
            aria-label={playing ? "Stop playback" : "Play scene time"}
            aria-pressed={playing}
            data-tip={
              playing
                ? "STOP — STAY AT THIS SCENE TIME."
                : "PLAY SCENE TIME FROM HERE AT THE PICKED SPEED. NOW RETURNS TO LIVE."
            }
            onClick={togglePlay}
          >
            {playing ? "◼" : "▶"}
          </button>
          <span className="tip tip-wrap" data-tip="PLAYBACK SPEED — REAL TIME OR COMPRESSED.">
            <select
              className="ts-rate"
              aria-label="Playback speed"
              value={armedRate}
              onChange={(e) => onRateChange(Number(e.target.value))}
            >
              <option value={1}>REAL ×1</option>
              {SCRUB.playRates.map((r) => (
                <option key={r} value={r}>
                  {rateLabel(r)}
                </option>
              ))}
            </select>
          </span>
          {ff && (
            <span className="ts-ff" role="status">
              FAST-FORWARD {rateLabel(playRate!)}
            </span>
          )}
        </div>
        <span className="ts-span" aria-hidden="true">+{SCRUB.windowHours / 2}h</span>
      </div>
    </aside>
  );
}
