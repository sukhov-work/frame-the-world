/**
 * MobileTimeDock (MOBILE_PLAN §3/§6; v2 M3a — the compact phone twin of the desktop
 * TimeScrubber v2): scene time rides a FIXED CENTRE CURSOR and dragging slides the timeline
 * under it — an INFINITE conveyor into past and future (drag left = forward, the PhotoPills
 * Time-Bar direction). On the rail: the full photographic light bands (lib lightSegments),
 * compact sun+moon altitude curves against the horizon midline, the tracked-target visibility
 * trace (blocked/clear/IN-FRAME emphasis — §3.1.D), and REAL local hour ticks with printed
 * labels. Taps in the outer zones step to the next/previous almanac event.
 *
 * Store-mediated only (store/time + pure libs) — desktop panels are never imported; the SVG
 * path builders are the ACCEPTED two-shell duplication of TimeScrubber's (byte-compact twins,
 * same viewBox contract 0..100 × 0..40, horizon at y=20).
 *
 * Disciplines carried over verbatim from TimeScrubber v2:
 *  • bands/curves/trace memoise on a SPAN (2× window) centred on the scene HOUR + the
 *    0.05°-quantized eye (planAnchor ?? camera focus) — NEVER per pointermove.
 *  • the store is never written per frame — playback/live display rides a coarse interval;
 *    the conveyor needs no recentring (the window IS always centred by construction).
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  hourTicksBetween,
  localDateStr,
  localTimeStr,
  sceneTimeMs,
  useTimeStore,
  withLocalDate,
} from "../../store/time";
import { usePlanStore } from "../../store/plan";
import { useCameraStore } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
import { lightSegments } from "../../lib/ephemeris/twilight";
import {
  elevationSeries,
  targetElevationSeries,
  traceStates,
  type AltSample,
  type TargetAltSample,
  type TraceState,
} from "../../lib/ephemeris/dayArc";
import { dayEvents, moonPhaseEvents } from "../../lib/ephemeris/planner";
import { sampleBins } from "../../lib/geo/horizonProfile";
import { azAltFrameMarker } from "../../lib/geo/offscreen";
import { GOLDEN, SCRUB } from "../globe/tuning";
import "../../styles/mobile/dock.css";

const WINDOW_MS = SCRUB.windowHours * 3_600_000;
/** Band/curve cache span — 2× the visible window so an hour of drift never leaves it. */
const SPAN_MS = WINDOW_MS * 2;
const HOUR_MS = 3_600_000;

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

/** SVG path for an altitude curve over the visible window (viewBox 0..100 × 0..40; horizon at
 *  y=20, ±90° maps to ±19 units) — the TimeScrubber twin. */
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

/** The tracked-target trace split into per-class SVG paths (§3.1.D) — the TimeScrubber twin:
 *  below-horizon samples break the pen; class transitions bridge FROM the previous point;
 *  `frameTest` (FPV only) promotes clear samples inside the current frame. */
function tracePaths(
  samples: readonly TargetAltSample[],
  states: readonly TraceState[],
  windowStartMs: number,
  frameTest: ((s: TargetAltSample) => boolean) | null,
): { blocked: string; clear: string; frame: string } {
  const d = { blocked: "", clear: "", frame: "" };
  let prev: { x: number; y: number } | null = null;
  let open: keyof typeof d | null = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const x = ((s.utcMs - windowStartMs) / WINDOW_MS) * 100;
    if (x < -2 || x > 102 || states[i] === "down") {
      prev = null;
      open = null;
      continue;
    }
    const y = 20 - (s.altDeg / 90) * 19;
    const cls: keyof typeof d =
      states[i] === "blocked" ? "blocked" : frameTest?.(s) ? "frame" : "clear";
    const pt = `${x.toFixed(2)} ${y.toFixed(2)}`;
    if (open === cls) d[cls] += `L${pt}`;
    else d[cls] += prev ? `M${prev.x.toFixed(2)} ${prev.y.toFixed(2)}L${pt}` : `M${pt}`;
    open = cls;
    prev = { x, y };
  }
  return d;
}

export default function MobileTimeDock() {
  const live = useTimeStore((s) => s.live);
  // Subscribed for re-render on every scrub/jump (the value itself is read via sceneTimeMs()).
  useTimeStore((s) => s.timeMs);
  const playRate = useTimeStore((s) => s.playRate);
  const setTime = useTimeStore((s) => s.setTime);
  const goLive = useTimeStore((s) => s.goLive);
  // PLAY/speed retired on /m (batch #4 item 12) — playRate still read: a play started elsewhere
  // (e.g. a shared pose landing mid-play) keeps its cursor/offset styling honest.
  const playing = playRate !== null;

  const railRef = useRef<HTMLDivElement>(null);

  const nowMs = sceneTimeMs();
  const windowStartMs = nowMs - WINDOW_MS / 2;
  // Span anchor quantized to the scene HOUR — bands/curves recompute once per crossed hour.
  const spanAnchorMs = Math.round(nowMs / HOUR_MS) * HOUR_MS;
  const spanStartMs = spanAnchorMs - SPAN_MS / 2;
  const spanEndMs = spanAnchorMs + SPAN_MS / 2;

  // The eye = planner anchor when there is one, else the live view focus, quantized to 0.05°.
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

  // Tracked-target visibility trace — rides the TARGET SHOW gate; skyline classification reads
  // the planFeed profile mirror when a photo/FPV build is warm.
  const targetVisible = useSkyStore((s) => s.visible);
  const skyTarget = useSkyStore((s) => s.target);
  const profileBins = usePlanStore((s) => s.profileBins);
  const trace = useMemo(
    () =>
      targetVisible
        ? targetElevationSeries(skyTarget, spanStartMs, spanEndMs, eyeLatKey / 20, eyeLonKey / 20, SCRUB.traceStepMin)
        : [],
    [targetVisible, skyTarget, spanAnchorMs, eyeLatKey, eyeLonKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const traceCls = useMemo(
    () => traceStates(trace, profileBins ? (az) => sampleBins(profileBins, az) : null),
    [trace, profileBins],
  );
  // FPV in-frame emphasis — quantized pose key so HUD writes only re-render on real moves.
  const fpvPoseKey = useCameraStore((s) =>
    s.fpvHud
      ? `${Math.round(s.fpvHud.headingDeg)}|${Math.round(s.fpvHud.pitchDeg)}|${Math.round(s.fpvHud.fovDeg * 2)}|${s.fpvHud.aspect.toFixed(2)}`
      : null,
  );
  const fpvPose = fpvPoseKey ? useCameraStore.getState().fpvHud : null;
  const frameTest = fpvPose
    ? (s: TargetAltSample) => azAltFrameMarker(s.azDeg, s.altDeg, fpvPose).inFrame
    : null;

  // Live/playback: a coarse tick keeps the sliding rail honest (never a per-frame store write).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!live && !playing) return;
    const id = setInterval(() => forceTick((n) => n + 1), playing ? SCRUB.playTickMs : 10_000);
    return () => clearInterval(id);
  }, [live, playing]);

  // Conveyor drag: dx px slides time by −dx/width·window; a press inside the tap slop is a TAP.
  const dragRef = useRef<{ startX: number; startMs: number; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers (tests) have no capture — dragging still works via bubbling
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
  // Next/previous almanac event (outer tap zones); closed-panel taps compute pure almanac
  // chips on demand (the TimeScrubber discipline — a few finder ms, only when tapped).
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

  const onDateChange = (dateStr: string) => {
    const ms = withLocalDate(sceneTimeMs(), dateStr);
    if (ms === null) return; // cleared/partial input — never scrub on garbage
    setTime(ms);
  };

  // Owner 2026-08-19 (batch item 3): desktop .ts-day parity — a fixed 24 h step, same literal.
  const stepDay = (dir: 1 | -1) => setTime(sceneTimeMs() + dir * 86_400_000);

  const ff = playing && (playRate ?? 1) > 1;
  // Pinned-time side (owner 2026-08-15) — the desktop TimeScrubber twin: amber past, blue future.
  const ahead = !live && nowMs > Date.now();
  const offsetMinNow = Math.round((nowMs - Date.now()) / 60_000);
  const ticks = hourTicksBetween(windowStartMs, windowStartMs + WINDOW_MS);

  return (
    <div className="md" aria-label="Scene time dock">
      <div
        ref={railRef}
        className="md-rail"
        role="slider"
        tabIndex={0}
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
          if (f > SCRUB.eventTapFrac && f < 1 - SCRUB.eventTapFrac) goLive();
        }}
        onKeyDown={onKeyDown}
      >
        <div className="md-light" aria-hidden="true">
          {bands.map((seg) => {
            const left = ((seg.startMs - windowStartMs) / WINDOW_MS) * 100;
            const right = ((seg.endMs - windowStartMs) / WINDOW_MS) * 100;
            if (right <= 0 || left >= 100) return null;
            const l = Math.max(0, left);
            const r = Math.min(100, right);
            return (
              <span
                key={`${seg.phase}${seg.startMs}`}
                className={`md-light__seg md-light__seg--${seg.phase}`}
                style={{ left: `${l}%`, width: `${r - l}%` }}
              />
            );
          })}
        </div>
        <svg className="md-curves" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          <line className="md-curves__horizon" x1="0" y1="20" x2="100" y2="20" />
          <path className="md-curves__moon" d={curvePath(curves.moon, windowStartMs)} />
          <path className="md-curves__sun" d={curvePath(curves.sun, windowStartMs)} />
          {trace.length > 0 &&
            (() => {
              const t = tracePaths(trace, traceCls, windowStartMs, frameTest);
              return (
                <>
                  {t.blocked && <path className="md-curves__trace-blocked" d={t.blocked} />}
                  {t.clear && <path className="md-curves__trace-clear" d={t.clear} />}
                  {t.frame && <path className="md-curves__trace-frame" d={t.frame} />}
                </>
              );
            })()}
        </svg>
        <div className="md-ticks" aria-hidden="true">
          {ticks.map((t) => {
            const left = ((t.ms - windowStartMs) / WINDOW_MS) * 100;
            const labeled = t.isMidnight || t.hour % SCRUB.hourLabelEvery === 0;
            return (
              <span
                key={t.ms}
                className={`md-tick${labeled ? " md-tick--major" : ""}${t.isMidnight ? " md-tick--midnight" : ""}`}
                style={{ left: `${left}%` }}
              >
                {labeled && <span className="md-tick__label">{String(t.hour).padStart(2, "0")}</span>}
              </span>
            );
          })}
        </div>
        <div
          className={`md-cursor${live ? "" : ahead ? " md-cursor--future" : " md-cursor--pinned"}`}
          aria-hidden="true"
        />
      </div>
      <div className="md-row">
        <button
          type="button"
          className="md-day"
          aria-label="Previous day (same time)"
          onClick={() => stepDay(-1)}
        >
          ◀
        </button>
        <input
          type="date"
          className="md-date"
          aria-label="Scene date — jump the window to another day"
          value={localDateStr(nowMs)}
          onChange={(e) => onDateChange(e.target.value)}
        />
        <button
          type="button"
          className="md-day"
          aria-label="Next day (same time)"
          onClick={() => stepDay(1)}
        >
          ▶
        </button>
        {/* Owner batch #4 item 12 (2026-08-21): PLAY + speed retired on /m (not useful at touch
            scale) — the scene-time readout moved down here from the status strip instead.
            Time only (the calendar to the left already carries the date). */}
        <span
          className={`md-clock${live ? " md-clock--live" : ahead ? " md-clock--future" : " md-clock--pinned"}`}
        >
          {localTimeStr(nowMs)}
        </span>
        <span
          className={`md-offset${ff ? " md-offset--ff" : live ? "" : ahead ? " md-offset--future" : " md-offset--past"}`}
        >
          {live ? "LIVE" : `${playing ? "▶ " : ""}${offsetShort(nowMs - Date.now())}`}
        </span>
        {!live && (
          <button type="button" className="md-now" onClick={goLive}>
            NOW
          </button>
        )}
      </div>
    </div>
  );
}
