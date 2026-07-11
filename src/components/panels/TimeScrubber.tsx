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
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  fractionToTime,
  localDateStr,
  sceneTimeMs,
  timeToFraction,
  useTimeStore,
  withLocalDate,
} from "../../store/time";
import { useUploadStore } from "../../store/upload";
import { capturedAtToUtcMs } from "../../lib/ephemeris/captureTime";
import { SCRUB } from "../globe/tuning";
import "../../styles/time-scrubber.css";

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

export default function TimeScrubber() {
  const live = useTimeStore((s) => s.live);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const setTime = useTimeStore((s) => s.setTime);
  const goLive = useTimeStore((s) => s.goLive);
  const uploadPhase = useUploadStore((s) => s.phase);

  const railRef = useRef<HTMLDivElement>(null);
  const [anchorMs, setAnchorMs] = useState(() => sceneTimeMs());
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

  const nowMs = live ? Date.now() : pinnedMs;
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

  // Quick day traversal (Phase 5.5 S1): ±24 h keeping the time-of-day — pins even from LIVE,
  // exactly like picking the neighbouring date. Holds up across DST because the ephemeris is
  // exact at any epoch and the scrubber's day boundary is the browser TZ by design (v1 choice).
  const stepDay = (dir: 1 | -1) => {
    const ms = sceneTimeMs() + dir * 86_400_000;
    setTime(ms);
    setAnchorMs(ms);
  };

  return (
    <aside className="ts" aria-label="Scene time scrubber — relights the globe">
      <div className="ts-head">
        <span className="ts-label">TIME SCRUB</span>
        <button
          type="button"
          className="ts-day"
          aria-label="Previous day (same time)"
          onClick={() => stepDay(-1)}
        >
          ◀
        </button>
        <input
          type="date"
          className="ts-date"
          aria-label="Scene date — jump the window to another day"
          value={localDateStr(nowMs)}
          onChange={(e) => onDateChange(e.target.value)}
        />
        <button
          type="button"
          className="ts-day"
          aria-label="Next day (same time)"
          onClick={() => stepDay(1)}
        >
          ▶
        </button>
        <span className="ts-offset">{live ? "LIVE" : offsetLabel(nowMs - Date.now())}</span>
        {!live && (
          <button type="button" className="ts-now" onClick={() => { goLive(); setAnchorMs(Date.now()); }}>
            NOW
          </button>
        )}
      </div>
      <div
        ref={railRef}
        className="ts-rail"
        role="slider"
        tabIndex={0}
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
      <div className="ts-span" aria-hidden="true">
        <span>−{SCRUB.windowHours / 2}h</span>
        <span>+{SCRUB.windowHours / 2}h</span>
      </div>
    </aside>
  );
}
