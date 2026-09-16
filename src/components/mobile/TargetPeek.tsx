/**
 * TargetPeek (M1) — the tracked-target peek row above the time dock (MOBILE_PLAN §3):
 * glyph · name · CLEAR/BEHIND/BELOW badge · next RISE / SET (stacked) · az/alt; tapping opens
 * the TARGET sheet. Same per-minute az/alt discipline as the TargetPanel; the verdict badge is
 * id-matched against the plan mirror so a just-swapped target never wears the old verdict.
 *
 * Owner 2026-09-16: two small stacked times — the object's next rise (↑) and next set (↓) at
 * this observer, almanac semantics (`lib/ephemeris/riseSet`: the planner's own SearchRiseSet for
 * sun/moon, the refracted horizon of `targetAzAlt` for everything else) — sit left of the
 * bearings; and a LONG PRESS on the object's NAME aims the view at it (`store/skyAim.aimAtSkyBody`:
 * the FPV look glides onto the body, on the map the planned cone turns to it) without opening
 * the sheet. The gesture is the ORCH shape (touch only, 500 ms, 6 px cancel, trailing click
 * swallowed — the TabBar's twin); it arms only when the press STARTS on the name, so the rest of
 * the row stays a plain tap-to-open.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { useCameraStore } from "../../store/camera";
import { localTimeStr, sceneTimeMs, useTimeStore } from "../../store/time";
import { aimAtSkyBody } from "../../store/skyAim";
import { targetAzAlt, targetShortName, type SkyTarget } from "../../lib/ephemeris/targets";
import { nextRiseSet, type RiseSet } from "../../lib/ephemeris/riseSet";
import { kindGlyph } from "../../lib/sky/searchIndex";
import { cardinal, EM_DASH } from "../../lib/format/readout";
import { ORCH } from "../globe/tuning";
import "../../styles/mobile/chrome.css";

/** Rise/set recompute cadence (ms) — the times move by seconds per hour of observer drift;
 *  the cache also re-solves the moment a shown event passes (so "next" stays next). */
const RISESET_BUCKET_MS = 10 * 60_000;

/** The next rise/set for the row, memoised on (target · 0.01° observer · 10-min bucket) and
 *  re-solved when a displayed instant is no longer ahead of scene time. Pure compute — the
 *  sun/moon path is astronomy-engine's own finder (~1 ms), the scan path ≤ 300 `targetAzAlt`. */
function useNextRiseSet(target: SkyTarget, nowMs: number, latDeg: number, lonDeg: number): RiseSet {
  const cache = useRef<{ key: string; rs: RiseSet } | null>(null);
  const latR = latDeg.toFixed(2);
  const lonR = lonDeg.toFixed(2);
  const key = `${target.id}|${latR}|${lonR}|${Math.floor(nowMs / RISESET_BUCKET_MS)}`;
  const c = cache.current;
  const passed =
    c !== null &&
    ((c.rs.riseMs !== null && c.rs.riseMs <= nowMs) || (c.rs.setMs !== null && c.rs.setMs <= nowMs));
  if (c === null || c.key !== key || passed) {
    cache.current = { key, rs: nextRiseSet(target, nowMs, Number(latR), Number(lonR)) };
  }
  return cache.current!.rs;
}

/** `↑ 05:42` — the browser's local clock, the dock's own grammar; an em dash when none. */
const clock = (ms: number | null): string => (ms === null ? EM_DASH : localTimeStr(ms));

export default function TargetPeek({ onOpen }: { onOpen: () => void }) {
  const target = useSkyStore((s) => s.target);
  const visible = useSkyStore((s) => s.visible);
  const planTarget = usePlanStore((s) => s.target);
  const anchor = usePlanStore((s) => s.anchor);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  const live = useTimeStore((s) => s.live);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const playRate = useTimeStore((s) => s.playRate);
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
  const upNow = now.altDeg > 0;
  const riseSet = useNextRiseSet(target, minuteKey * 60_000, latDeg, lonDeg);

  // The long press on the NAME (the ORCH shape — TabBar's twin, one timer for the row) — with
  // one hardening the twin lacks: the press is judged by the pointer events' OWN timestamps on
  // release, not only by the timer. In FPV the main thread can stall for hundreds of ms while
  // cells land (T77), and a stalled timer never gets its 500 ms between a touchStart and a
  // touchEnd that arrive together — the browser-verify twin caught exactly that (the sheet
  // opened, nothing aimed). `e.timeStamp` is stamped when the event is created, stall or not.
  const pressTimer = useRef<number | null>(null);
  const pressFired = useRef(false);
  const downPos = useRef({ x: 0, y: 0 });
  /** The armed press's `timeStamp`; null = no press armed (moved, lifted, or never on the name). */
  const downAt = useRef<number | null>(null);
  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  useEffect(() => cancelPress, []);
  const firePress = () => {
    if (pressFired.current) return; // the timer and the release both saw it — once is enough
    pressFired.current = true;
    downAt.current = null;
    aimAtSkyBody("target");
    // A tiny haptic tick where the platform has one (Android); iOS ignores it.
    try {
      navigator.vibrate?.(12);
    } catch {
      /* never load-bearing */
    }
    // Android fires the trailing click on lift, iOS may not — the swallow must not outlive
    // the gesture (the TabBar's 900 ms twin) or the NEXT tap would vanish.
    window.setTimeout(() => {
      pressFired.current = false;
    }, 900);
  };
  const armPress = (e: React.PointerEvent<HTMLButtonElement>) => {
    pressFired.current = false; // any new press (mouse too) forgets a swallowed click
    downAt.current = null;
    if (e.pointerType !== "touch") return;
    // Only a press that STARTS on the name arms — the badge, the times and the bearings stay a
    // plain tap-to-open row.
    if (!(e.target instanceof Element) || !e.target.closest(".m-peek__name")) return;
    downPos.current = { x: e.clientX, y: e.clientY };
    downAt.current = e.timeStamp;
    cancelPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      firePress();
    }, ORCH.longPressMs);
  };
  const movePress = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (downAt.current === null) return;
    const dx = e.clientX - downPos.current.x;
    const dy = e.clientY - downPos.current.y;
    if (Math.hypot(dx, dy) > ORCH.clickDragPx) {
      cancelPress();
      downAt.current = null;
    }
  };
  const liftPress = (e: React.PointerEvent<HTMLButtonElement>) => {
    cancelPress();
    // The release verdict: held long enough by the events' own clocks → it was a long press,
    // whether or not the timer ever got to run.
    if (downAt.current !== null && e.timeStamp - downAt.current >= ORCH.longPressMs) firePress();
    downAt.current = null;
  };


  // UNFOLLOW / SHOW-off (owner 2026-08-19): a dismissed object leaves the bottom bar too —
  // the whole app already treats `visible=false` as "not there" (planFeed, scrubber, cards).
  if (!visible) return null;

  return (
    <button
      type="button"
      className="m-peek"
      onClick={() => {
        // The long press already aimed — the trailing click must not also open the sheet.
        if (pressFired.current) {
          pressFired.current = false;
          return;
        }
        onOpen();
      }}
      onPointerDown={armPress}
      onPointerMove={movePress}
      onPointerUp={liftPress}
      onPointerCancel={() => {
        cancelPress();
        downAt.current = null;
      }}

      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Tracked target: ${target.name} — open details; hold the name to aim the view at it`}
    >
      <span className="m-peek__glyph" aria-hidden="true">
        {kindGlyph(target.kind)}
      </span>
      <span className="m-peek__name" title="Hold to aim at it">
        {targetShortName(target).toUpperCase()}
      </span>
      {upNow && planTarget?.id === target.id ? (
        <span className={`m-badge ${planTarget.blockedNow ? "m-badge--blocked" : "m-badge--clear"}`}>
          {planTarget.blockedNow ? "BEHIND" : "CLEAR"}
        </span>
      ) : (
        !upNow && <span className="m-badge">BELOW</span>
      )}
      {/* Next rise ↑ / next set ↓ (owner 2026-09-16) — stacked, left of the bearings. */}
      <span
        className="m-peek__rs"
        aria-label={`Next rise ${clock(riseSet.riseMs)}, next set ${clock(riseSet.setMs)}`}
      >
        <span className="m-peek__rs-row">
          <span className="m-peek__rs-k" aria-hidden="true">
            ↑
          </span>
          {clock(riseSet.riseMs)}
        </span>
        <span className="m-peek__rs-row">
          <span className="m-peek__rs-k" aria-hidden="true">
            ↓
          </span>
          {clock(riseSet.setMs)}
        </span>
      </span>
      <span className="m-peek__pos">
        {now.altDeg.toFixed(0)}° · {Math.round(now.azDeg)}° {cardinal(now.azDeg)}
      </span>
      {/* Pull-up hint (owner 2026-08-19, batch item 7: "not obvious this opens") — an own
          element, accent-coloured, gently nudging; reduced-motion opts out in chrome.css. */}
      <span className="m-peek__more" aria-hidden="true">
        ▲
      </span>
    </button>
  );
}
