/**
 * TimeScrubber — the scene-time instrument (Phase 4; v2 QoL-1, owner 2026-08-14 —
 * PLANNING_QOL_PLAN §3.1). A docked bottom-centre rail showing a 12 h window with scene time
 * riding the FIXED CENTRE CURSOR: dragging slides the timeline under it — an INFINITE conveyor
 * into past and future (drag left = forward, the PhotoPills Time-Bar direction) — and the
 * ephemeris relights the whole globe per move (terminator, sun/moon, shadows, golden hour,
 * stars). NOW resumes the wall clock.
 *
 * On the rail (v2): the full photographic light bands (day/golden/blue/nautical/astro/night —
 * lib/ephemeris/twilight lightSegments), sun+moon altitude curves against the horizon midline
 * (elevationSeries), and REAL local hour ticks with printed labels (store/time hourTicksBetween;
 * browser-local, the same convention as the date/time inputs). A CLICK in the outer tap zones
 * steps to the next/previous almanac event chip (store/plan events — the planFeed mirror);
 * double-click in the middle returns to NOW.
 *
 * When a photo lands on the globe with an EXIF capture time, the scene pins to that instant —
 * `capturedAtToUtcMs` reads the TZ-naive stamp as solar time at the placement longitude (the
 * documented v1 choice), so the pin shows the light the photographer actually stood in.
 *
 * The rail is keyboard-operable (role="slider": arrows ± SCRUB.keyStepMin, Home/End = ∓ half a
 * window, Backspace = go live). TimeReadout (bottom-right) stays the precise readout; this
 * panel's header shows the offset against the real clock.
 *
 * Owner 2026-07-14 (kept intact): precise time-of-day picker, ±day/±hour/±minute steppers, and
 * the PLAY transport (real speed or SCRUB.playRates fast-forward). The scene itself never
 * steps: consumers read sceneTimeMs() per frame; the interval here only refreshes the labels.
 *
 * Perf discipline: bands/curves memoise on a SPAN (2× window) centred on the scene HOUR + the
 * 0.05°-quantized eye — never per pointermove; the window then slides over the cached span with
 * plain arithmetic (the Phase-8a twilight-band rule, now spanning the conveyor).
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  hourTicksBetween,
  localDateStr,
  localTimeStr,
  sceneTimeMs,
  useTimeStore,
  withLocalDate,
  withLocalTime,
} from "../../store/time";
import { useUploadStore } from "../../store/upload";
import { usePlanStore } from "../../store/plan";
import { useCameraStore } from "../../store/camera";
import { capturedAtToUtcMs } from "../../lib/ephemeris/captureTime";
import { lightSegments } from "../../lib/ephemeris/twilight";
import { elevationSeries, type AltSample } from "../../lib/ephemeris/dayArc";
import { dayEvents, moonPhaseEvents } from "../../lib/ephemeris/planner";
import { GOLDEN, SCRUB } from "../globe/tuning";
import InfoDot from "../ui/InfoDot";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import "../../styles/time-scrubber.css";
import "../../styles/tips.css";

const WINDOW_MS = SCRUB.windowHours * 3_600_000;
/** Band/curve cache span — 2× the visible window so an hour of drift never leaves it. */
const SPAN_MS = WINDOW_MS * 2;
const HOUR_MS = 3_600_000;

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

/** SVG path for an altitude curve over the visible window (viewBox 0..100 × 0..40; horizon at
 *  y=20, ±90° maps to ±19 units). Pure string math over cached span samples — cheap per render. */
function curvePath(samples: AltSample[], windowStartMs: number): string {
  let d = "";
  for (const s of samples) {
    const x = ((s.utcMs - windowStartMs) / WINDOW_MS) * 100;
    if (x < -2 || x > 102) continue;
    const y = 20 - (s.altDeg / 90) * 19;
    d += `${d ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

export default function TimeScrubber() {
  const drag = usePanelDrag("timeline");
  const live = useTimeStore((s) => s.live);
  // Subscribed for re-render on every scrub/jump (the value itself is read via sceneTimeMs()).
  useTimeStore((s) => s.timeMs);
  const playRate = useTimeStore((s) => s.playRate);
  const setTime = useTimeStore((s) => s.setTime);
  const goLive = useTimeStore((s) => s.goLive);
  const play = useTimeStore((s) => s.play);
  const stopPlay = useTimeStore((s) => s.stopPlay);
  const uploadPhase = useUploadStore((s) => s.phase);
  const playing = playRate !== null;

  const railRef = useRef<HTMLDivElement>(null);

  const nowMs = sceneTimeMs();
  const windowStartMs = nowMs - WINDOW_MS / 2;
  // Span anchor quantized to the scene HOUR: bands/curves recompute once per crossed hour (or
  // eye move), and the ±24 h span always contains the ±6 h window between recomputes.
  const spanAnchorMs = Math.round(nowMs / HOUR_MS) * HOUR_MS;
  const spanStartMs = spanAnchorMs - SPAN_MS / 2;
  const spanEndMs = spanAnchorMs + SPAN_MS / 2;

  // The eye = the planner's anchor when there is one, else the live view focus (the TargetPanel
  // pattern), quantized to 0.05° — focus drifts constantly in LEO idle.
  const planAnchor = usePlanStore((s) => s.anchor);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  const eyeLatKey = Math.round((planAnchor?.latDeg ?? focusLat) * 20);
  const eyeLonKey = Math.round((planAnchor?.lonDeg ?? focusLon) * 20);

  const bands = useMemo(
    () => lightSegments(spanStartMs, spanEndMs, eyeLatKey / 20, eyeLonKey / 20),
    [spanAnchorMs, eyeLatKey, eyeLonKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const curves = useMemo(
    () => ({
      sun: elevationSeries("sun", spanStartMs, spanEndMs, eyeLatKey / 20, eyeLonKey / 20, SCRUB.curveStepMin),
      moon: elevationSeries("moon", spanStartMs, spanEndMs, eyeLatKey / 20, eyeLonKey / 20, SCRUB.curveStepMin),
    }),
    [spanAnchorMs, eyeLatKey, eyeLonKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The PLAY speed the transport arms (scene-seconds per real second); 1 = real time.
  const [armedRate, setArmedRate] = useState<number>(1);
  // Live/playback: a coarse tick keeps the sliding rail honest (the store is never written
  // per-frame; the conveyor needs no recentring — the window IS always centred).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!live && !playing) return;
    const id = setInterval(() => forceTick((n) => n + 1), playing ? SCRUB.playTickMs : 10_000);
    return () => clearInterval(id);
  }, [live, playing]);

  // Placed photo with an EXIF capture time → pin the scene to the capture instant (solar time
  // at the placement longitude); the window centres there by construction. Re-placing re-seeds.
  useEffect(() => {
    if (uploadPhase !== "placed") return;
    const { exif, placement } = useUploadStore.getState();
    if (!exif?.capturedAt || !placement) return;
    const ms = capturedAtToUtcMs(exif.capturedAt, placement.lonDeg);
    if (ms === null) return;
    setTime(ms);
  }, [uploadPhase, setTime]);

  // Conveyor drag: grab the timeline — dx px slides time by −dx/width·window (drag left =
  // forward). A press that never leaves the tap slop is a TAP: outer zones event-step.
  const dragRef = useRef<{ startX: number; startMs: number; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events (tests) have no active pointer — dragging still works via bubbling
    }
    dragRef.current = { startX: e.clientX, startMs: sceneTimeMs(), moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) <= SCRUB.tapSlopPx) return;
    d.moved = true;
    const rect = railRef.current!.getBoundingClientRect();
    setTime(d.startMs - (dx / rect.width) * WINDOW_MS);
  };
  // Next/previous almanac event (tap zones). The planFeed mirror is preferred when warm (it
  // adds skyline crossings and terrain-true elevation), but it only computes while the PLAN
  // panel is open / a photo-FPV anchor exists — so a closed-panel tap computes the pure almanac
  // chips on demand (a few finder ms, only when actually tapped; sea-level observer is within
  // chip granularity).
  const jumpEvent = (dir: 1 | -1) => {
    const base = sceneTimeMs();
    let events = usePlanStore.getState().events;
    if (events.length === 0) {
      const obs = { latDeg: eyeLatKey / 20, lonDeg: eyeLonKey / 20, groundAltM: 0, eyeAboveGroundM: 2 };
      events = [...dayEvents(base, obs, GOLDEN), ...moonPhaseEvents(base, obs)].sort(
        (a, b) => a.utcMs - b.utcMs,
      );
    }
    const target =
      dir > 0
        ? events.find((ev) => ev.utcMs > base + 30_000)
        : [...events].reverse().find((ev) => ev.utcMs < base - 30_000);
    if (target) setTime(target.utcMs);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* no capture to release for synthetic pointers */
    }
    if (d && !d.moved) {
      const rect = railRef.current!.getBoundingClientRect();
      const f = (e.clientX - rect.left) / rect.width;
      if (f <= SCRUB.eventTapFrac) jumpEvent(-1);
      else if (f >= 1 - SCRUB.eventTapFrac) jumpEvent(1);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const stepMs = SCRUB.keyStepMin * 60_000;
    const base = sceneTimeMs();
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") setTime(base - stepMs);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") setTime(base + stepMs);
    else if (e.key === "Home") setTime(base - WINDOW_MS / 2);
    else if (e.key === "End") setTime(base + WINDOW_MS / 2);
    else if (e.key === "Backspace" || e.key === "Delete") goLive();
    else return;
    e.preventDefault();
  };

  const offsetMinNow = Math.round((nowMs - Date.now()) / 60_000);

  // Date jump: same local time-of-day on another calendar day (the window follows the time).
  const onDateChange = (dateStr: string) => {
    const ms = withLocalDate(sceneTimeMs(), dateStr);
    if (ms === null) return; // cleared/partial input — never scrub on garbage
    setTime(ms);
  };

  // Precise time-of-day (owner 2026-07-14): same calendar day, another wall time.
  const onTimeChange = (timeStr: string) => {
    const ms = withLocalTime(sceneTimeMs(), timeStr);
    if (ms === null) return; // cleared input — never scrub on garbage
    setTime(ms);
  };

  // Quick traversal (Phase 5.5 S1 days; owner 2026-07-14 hours/minutes): ± one unit keeping the
  // rest of the stamp — pins even from LIVE. The conveyor re-centres by construction.
  const stepBy = (deltaMs: number) => setTime(sceneTimeMs() + deltaMs);

  // PLAY/STOP: play() pins the current instant and advances it at the armed rate (no-op when
  // already LIVE at real speed — the wall clock IS ×1 playback); STOP freezes where it reached.
  const togglePlay = () => {
    if (playing) stopPlay();
    else play(armedRate);
  };
  const onRateChange = (rate: number) => {
    setArmedRate(rate);
    if (playing) play(rate); // re-arm the running reel at the new speed
  };

  const ff = playing && (playRate ?? 1) > 1;
  const ticks = hourTicksBetween(windowStartMs, windowStartMs + WINDOW_MS);

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
          data-tip="JUMP TO ANY DATE — SUN, MOON AND STARS FOLLOW."
        >
          <input
            type="date"
            className="ts-date"
            aria-label="Scene date — jump to another day"
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
          tip="Scene time drives the whole planet: sun, shadows, moon phase, stars. Drag the timeline to plan golden hour, blue hour and darkness at your pin's location."
        />
        {!live && (
          <button
            type="button"
            className="ts-now tip"
            data-tip="RESUME THE LIVE WALL CLOCK."
            onClick={goLive}
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
        data-tip="DRAG THE TIMELINE — ENDLESS, BOTH WAYS. TAP AN EDGE FOR NEXT/PREV EVENT. DOUBLE-CLICK FOR NOW."
        aria-label="Scene time offset from the real clock"
        aria-valuemin={offsetMinNow - SCRUB.windowHours * 30}
        aria-valuemax={offsetMinNow + SCRUB.windowHours * 30}
        aria-valuenow={offsetMinNow}
        aria-valuetext={new Date(nowMs).toUTCString()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragRef.current = null)}
        onDoubleClick={(e) => {
          const rect = railRef.current!.getBoundingClientRect();
          const f = (e.clientX - rect.left) / rect.width;
          // The outer zones are the event-step taps — only a middle double-click means NOW.
          if (f > SCRUB.eventTapFrac && f < 1 - SCRUB.eventTapFrac) goLive();
        }}
        onKeyDown={onKeyDown}
      >
        <div className="ts-light" aria-hidden="true">
          {bands.map((seg) => {
            const left = ((seg.startMs - windowStartMs) / WINDOW_MS) * 100;
            const right = ((seg.endMs - windowStartMs) / WINDOW_MS) * 100;
            if (right <= 0 || left >= 100) return null;
            const l = Math.max(0, left);
            const r = Math.min(100, right);
            return (
              <span
                key={`${seg.phase}${seg.startMs}`}
                className={`ts-light__seg ts-light__seg--${seg.phase}`}
                style={{ left: `${l}%`, width: `${r - l}%` }}
              />
            );
          })}
        </div>
        <svg
          className="ts-curves"
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line className="ts-curves__horizon" x1="0" y1="20" x2="100" y2="20" />
          <path className="ts-curves__moon" d={curvePath(curves.moon, windowStartMs)} />
          <path className="ts-curves__sun" d={curvePath(curves.sun, windowStartMs)} />
        </svg>
        <div className="ts-ticks" aria-hidden="true">
          {ticks.map((t) => {
            const left = ((t.ms - windowStartMs) / WINDOW_MS) * 100;
            const labeled = t.isMidnight || t.hour % SCRUB.hourLabelEvery === 0;
            return (
              <span
                key={t.ms}
                className={`ts-tick${labeled ? " ts-tick--major" : ""}${t.isMidnight ? " ts-tick--midnight" : ""}`}
                style={{ left: `${left}%` }}
              >
                {labeled && (
                  <span className="ts-tick__label">{String(t.hour).padStart(2, "0")}</span>
                )}
              </span>
            );
          })}
        </div>
        <div className={`ts-knob${live ? "" : " ts-knob--pinned"}`} style={{ left: "50%" }} />
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
