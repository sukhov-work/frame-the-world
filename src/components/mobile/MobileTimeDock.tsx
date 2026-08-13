/**
 * MobileTimeDock (MOBILE_PLAN §3/§6 M1) — the compact phone twin of the desktop TimeScrubber:
 * the same ±12 h rail (SCRUB.windowHours) with the Phase-8a twilight bands, a date jump, PLAY
 * and NOW. Store-mediated only (store/time + the twilight lib) — desktop panels are never
 * imported (the two-shell drift guard).
 *
 * Disciplines carried over verbatim from TimeScrubber.tsx:
 *  • twilight memo keys = [anchorMs, lat*20, lon*20] — NEVER scene time (this component
 *    re-renders on every scrub pointermove via `pinnedMs`); eye = planAnchor ?? camera focus.
 *  • the store is never written per frame — playback display rides a SCRUB.playTickMs interval.
 *  • release / playback at a rail end recentres the window (walks across days).
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  fractionToTime,
  localDateStr,
  sceneTimeMs,
  timeToFraction,
  useTimeStore,
  withLocalDate,
} from "../../store/time";
import { usePlanStore } from "../../store/plan";
import { useCameraStore } from "../../store/camera";
import { twilightSegments } from "../../lib/ephemeris/twilight";
import { SCRUB } from "../globe/tuning";
import "../../styles/mobile/dock.css";

const WINDOW_MS = SCRUB.windowHours * 3_600_000;

/** "+3h12m" / "−47m" / "+164d" — the phone-width offset chip (minutes carried up first). */
function offsetShort(deltaMs: number): string {
  const sign = deltaMs < 0 ? "−" : "+";
  const totalMin = Math.round(Math.abs(deltaMs) / 60_000);
  if (totalMin === 0) return "±0m";
  const d = Math.floor(totalMin / 1_440);
  const h = Math.floor((totalMin % 1_440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${sign}${d}d${h > 0 ? ` ${h}h` : ""}`;
  return h > 0 ? `${sign}${h}h${String(m).padStart(2, "0")}m` : `${sign}${m}m`;
}

/** "10 MIN/S" style playback label (compact). */
function rateShort(rate: number): string {
  if (rate < 60) return `×${rate}`;
  if (rate < 3600) return `${Math.round(rate / 60)}M/S`;
  return `${Math.round(rate / 3600)}H/S`;
}

export default function MobileTimeDock() {
  const live = useTimeStore((s) => s.live);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const playRate = useTimeStore((s) => s.playRate);
  const setTime = useTimeStore((s) => s.setTime);
  const goLive = useTimeStore((s) => s.goLive);
  const play = useTimeStore((s) => s.play);
  const stopPlay = useTimeStore((s) => s.stopPlay);
  const playing = playRate !== null;

  const railRef = useRef<HTMLDivElement>(null);
  const [anchorMs, setAnchorMs] = useState(() => sceneTimeMs());
  const [armedRate, setArmedRate] = useState<number>(600); // 10 min/s — the planning default
  const draggingRef = useRef(false);
  const [, forceTick] = useState(0);

  // Twilight bands — same eye + quantization + memo keys as the desktop rail.
  const planAnchor = usePlanStore((s) => s.anchor);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  const twiLatKey = Math.round((planAnchor?.latDeg ?? focusLat) * 20);
  const twiLonKey = Math.round((planAnchor?.lonDeg ?? focusLon) * 20);
  const twilight = useMemo(
    () =>
      twilightSegments(
        anchorMs - WINDOW_MS / 2,
        anchorMs + WINDOW_MS / 2,
        twiLatKey / 20,
        twiLonKey / 20,
      ).filter((s) => s.phase !== "day"),
    [anchorMs, twiLatKey, twiLonKey],
  );

  // Live mode: coarse tick keeps the creeping knob honest (never a per-frame store write).
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (Math.abs(timeToFraction(Date.now(), anchorMs, WINDOW_MS) - 0.5) > 0.45) {
        setAnchorMs(Date.now());
      }
      forceTick((n) => n + 1);
    }, 10_000);
    return () => clearInterval(id);
  }, [live, anchorMs]);

  // Playback: display-only fast tick; recentre when the reel reaches a rail end.
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

  // The pinned value IS the scene instant while frozen — using it (not just sceneTimeMs())
  // keeps the pinnedMs subscription honest: it exists so every scrub move re-renders the dock.
  const nowMs = live ? Date.now() : playing ? sceneTimeMs() : pinnedMs;
  const pct = timeToFraction(nowMs, anchorMs, WINDOW_MS) * 100;

  const scrubToClientX = (clientX: number) => {
    const rect = railRef.current!.getBoundingClientRect();
    const f = (clientX - rect.left) / rect.width;
    setTime(fractionToTime(f, anchorMs, WINDOW_MS));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers (tests) have no capture — bubbling still scrubs
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
    const f = timeToFraction(useTimeStore.getState().timeMs, anchorMs, WINDOW_MS);
    if (f <= SCRUB.edgeRecenterFrac || f >= 1 - SCRUB.edgeRecenterFrac) {
      setAnchorMs(useTimeStore.getState().timeMs);
    }
  };

  const onDateChange = (dateStr: string) => {
    const ms = withLocalDate(sceneTimeMs(), dateStr);
    if (ms === null) return; // cleared/partial input — never scrub on garbage
    setTime(ms);
    setAnchorMs(ms);
  };

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
    if (playing) play(rate);
  };

  const goNow = () => {
    goLive();
    setAnchorMs(Date.now());
  };

  const ff = playing && (playRate ?? 1) > 1;
  const offsetMinNow = Math.round((nowMs - Date.now()) / 60_000);
  // Major ticks only (every 6 h) — the desktop's 25-tick comb is noise at phone width.
  const majors = SCRUB.windowHours / 6 + 1;

  return (
    <div className="md" aria-label="Scene time dock">
      <div
        ref={railRef}
        className="md-rail"
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
        onDoubleClick={goNow}
      >
        <div className="md-twilight" aria-hidden="true">
          {twilight.map((seg) => {
            const left = timeToFraction(seg.startMs, anchorMs, WINDOW_MS) * 100;
            const right = timeToFraction(seg.endMs, anchorMs, WINDOW_MS) * 100;
            return (
              <span
                key={`${seg.phase}${seg.startMs}`}
                className={`md-twilight__seg md-twilight__seg--${seg.phase}`}
                style={{ left: `${left}%`, width: `${right - left}%` }}
              />
            );
          })}
        </div>
        <div className="md-track" />
        <div className="md-ticks" aria-hidden="true">
          {Array.from({ length: majors }, (_, i) => (
            <span key={i} className="md-tick" />
          ))}
        </div>
        <div className={`md-knob${live ? "" : " md-knob--pinned"}`} style={{ left: `${pct}%` }} />
      </div>
      <div className="md-row">
        <input
          type="date"
          className="md-date"
          aria-label="Scene date — jump the window to another day"
          value={localDateStr(nowMs)}
          onChange={(e) => onDateChange(e.target.value)}
        />
        <button
          type="button"
          className={`md-play${playing ? " is-on" : ""}${ff ? " is-ff" : ""}`}
          aria-label={playing ? "Stop playback" : "Play scene time"}
          aria-pressed={playing}
          onClick={togglePlay}
        >
          {playing ? "◼" : "▶"}
        </button>
        <select
          className="md-rate"
          aria-label="Playback speed"
          value={armedRate}
          onChange={(e) => onRateChange(Number(e.target.value))}
        >
          <option value={1}>×1</option>
          {SCRUB.playRates.map((r) => (
            <option key={r} value={r}>
              {rateShort(r)}
            </option>
          ))}
        </select>
        <span className={`md-offset${ff ? " md-offset--ff" : ""}`}>
          {live ? "LIVE" : `${playing ? "▶ " : ""}${offsetShort(nowMs - Date.now())}`}
        </span>
        {!live && (
          <button type="button" className="md-now" onClick={goNow}>
            NOW
          </button>
        )}
      </div>
    </div>
  );
}
