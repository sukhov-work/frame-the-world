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
 *
 * Owner 2026-10-25: the SUN's and the MOON's next rise / set ride the row PERMANENTLY beside the object's
 * own pair ("so you can always have essential info at hand and don't have to go to plan each time") — one
 * 2-row cell per body with its glyph (☀ amber · ☾ moonlight · the object in the accent), the rise ↑ over
 * the set ↓, the arrows once as a legend; the object's own cell is dropped when it IS the sun or the moon.
 * The bearings stack in the same small grammar (altitude over azimuth) so three pairs fit a 402 px row
 * without the bar growing a pixel: the cluster's height is the two 0.56rem lines it always was.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { useCameraStore } from "../../store/camera";
import { localTimeStr, sceneTimeMs, useTimeStore } from "../../store/time";
import { aimAtSkyBody } from "../../store/skyAim";
import { bodyTarget, targetAzAlt, targetShortName, type SkyTarget } from "../../lib/ephemeris/targets";
import { dayRiseSet, type DayEvent, type DayRiseSet } from "../../lib/ephemeris/riseSet";
import { kindGlyph } from "../../lib/sky/searchIndex";
import { cardinal, EM_DASH } from "../../lib/format/readout";
import { ORCH } from "../globe/tuning";
import "../../styles/mobile/chrome.css";

/** THE DAY'S rise / set for the row (owner 2026-10-25c — the clock day's own events, a "+1" where one falls
 *  tomorrow; before it the row printed the NEXT events after scene time, the 2026-09-16 almanac semantics, so
 *  at 15:00 the sun's rise read as tomorrow's — see `lib/ephemeris/riseSet.dayRiseSet`), memoised on
 *  (target · 0.01° observer · the clock day): a day's pairs never move within the day, and the memo rolls
 *  at midnight with `dayStartMs`. Pure compute — the sun/moon path is astronomy-engine's own finder
 *  (~1 ms), the scan path ≤ 300 `targetAzAlt`. */
function useDayRiseSet(target: SkyTarget, nowMs: number, latDeg: number, lonDeg: number): DayRiseSet {
  const cache = useRef<{ key: string; rs: DayRiseSet } | null>(null);
  const latR = latDeg.toFixed(2);
  const lonR = lonDeg.toFixed(2);
  const c = cache.current;
  const sameDay = c !== null && nowMs >= c.rs.dayStartMs && nowMs < c.rs.dayEndMs;
  const key = `${target.id}|${latR}|${lonR}`;
  if (c === null || c.key !== key || !sameDay) {
    cache.current = { key, rs: dayRiseSet(target, nowMs, Number(latR), Number(lonR)) };
  }
  return cache.current!.rs;
}

/** `↑ 05:42` — the browser's local clock, the dock's own grammar; an em dash when none. */
const clock = (e: DayEvent | null): string => (e === null ? EM_DASH : localTimeStr(e.ms));
/** The micro day marker: "+1" for tomorrow's event (the flights' arrival notation), nothing for today's. */
const dayMark = (e: DayEvent | null): string | null => (e !== null && e.dayOffset > 0 ? `+${e.dayOffset}` : null);

/** The permanent almanac bodies (owner 2026-10-25). Module constants: a SkyTarget carries a method and the
 *  rise/set memo keys read `target.id`, so one instance each is all the row ever needs. */
const SUN_TARGET = bodyTarget("sun");
const MOON_TARGET = bodyTarget("moon");
/** U+FE0E, the TEXT presentation selector: ☀ (U+2600) and ☄ (U+2604) are Emoji=Yes characters that iOS WebKit
 *  may fall back to Apple Color Emoji for when the mono stack lacks them; the selector keeps them as text so the
 *  cell inks (amber / moonlight / accent) hold. ☾ has no emoji form; the selector is inert on it. */
const TEXT_GLYPH = "\uFE0E";
/** The label's clock — "none" where the row prints an em dash (a reader says "em dash" or skips it);
 *  "next day" / "in 2 days" where the row prints "+1" / "+2". */
const say = (e: DayEvent | null): string =>
  e === null
    ? "none"
    : e.dayOffset === 0
      ? localTimeStr(e.ms)
      : `${localTimeStr(e.ms)} ${e.dayOffset === 1 ? "next day" : `in ${e.dayOffset} days`}`;

interface AlmanacCell {
  key: "sun" | "moon" | "target";
  glyph: string;
  name: string;
  rs: DayRiseSet;
}

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
  const riseSet = useDayRiseSet(target, minuteKey * 60_000, latDeg, lonDeg);
  // The almanac (owner 2026-10-25): the sun's and the moon's pairs always, the object's own pair only when
  // it is neither — a tracked sun or moon would print its times twice. Hooks run unconditionally; the
  // render picks. Both finders are astronomy-engine's own (~1 ms), memoised on the clock day.
  const sunRs = useDayRiseSet(SUN_TARGET, minuteKey * 60_000, latDeg, lonDeg);
  const moonRs = useDayRiseSet(MOON_TARGET, minuteKey * 60_000, latDeg, lonDeg);
  const ownPair = target.kind !== "sun" && target.kind !== "moon";
  const almanac: AlmanacCell[] = [
    { key: "sun", glyph: kindGlyph("sun"), name: "Sun", rs: sunRs },
    { key: "moon", glyph: kindGlyph("moon"), name: "Moon", rs: moonRs },
    ...(ownPair
      ? [{ key: "target" as const, glyph: kindGlyph(target.kind), name: targetShortName(target), rs: riseSet }]
      : []),
  ];
  const almanacLabel = almanac.map((a) => `${a.name} rise ${say(a.rs.rise)}, set ${say(a.rs.set)}`).join("; ");

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
      aria-label={`Tracked target: ${target.name}. ${almanacLabel}. Open details; hold the name to aim the view at it`}
    >
      <span className="m-peek__glyph" aria-hidden="true">
        {kindGlyph(target.kind) + TEXT_GLYPH}
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
      {/* The ALMANAC (owner 2026-10-25; the single stacked pair of 2026-09-16 grew into it): the DAY's rise ↑
          over the DAY's set ↓ (2026-10-25c — today's own events, a "+1" where one falls tomorrow), one 2-row cell
          per body with its glyph — ☀ and ☾ always, the object's own pair beside them unless it IS one of them.
          The same two 0.56rem lines, so the row is not a pixel taller (the marker's line-height is 0). */}
      <span className="m-peek__alm" aria-hidden="true">
        <span className="m-peek__alm-k">
          <span>↑</span>
          <span>↓</span>
        </span>
        {almanac.map((a) => (
          <span className="m-peek__alm-cell" data-body={a.key} key={a.key}>
            <span className={`m-peek__alm-glyph m-peek__alm-glyph--${a.key}`}>{a.glyph + TEXT_GLYPH}</span>
            <span className="m-peek__alm-times">
              {[a.rs.rise, a.rs.set].map((e, i) => (
                <span className="m-peek__alm-t" key={i}>
                  {clock(e)}
                  {dayMark(e) && <span className="m-peek__alm-d">{dayMark(e)}</span>}
                </span>
              ))}
            </span>
          </span>
        ))}
      </span>
      {/* The bearings — altitude over azimuth + cardinal, stacked in the almanac's grammar (the one-line
          "12° · 245° SW" took the width three pairs need); a hairline separates "when" from "where". */}
      <span className="m-peek__pos">
        <span>{now.altDeg.toFixed(0)}°</span>
        <span>
          {Math.round(now.azDeg)}° {cardinal(now.azDeg)}
        </span>
      </span>
      {/* Pull-up hint (owner 2026-08-19, batch item 7: "not obvious this opens") — an own
          element, accent-coloured, gently nudging; reduced-motion opts out in chrome.css. */}
      <span className="m-peek__more" aria-hidden="true">
        ▲
      </span>
    </button>
  );
}
