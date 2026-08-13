/**
 * PlanSheet (M1) — the /m reader of store/plan (MOBILE_PLAN §3 PLAN tab): the almanac
 * jump-chips for the anchor's solar day + the sun/moon/target skyline verdicts. The globe
 * computes everything (scene/planFeed.ts); this sheet only renders + jumps scene time.
 *
 * IMPORTANT seam: focus-anchored chips are computed ONLY while plan.open is true
 * (planFeed gates on it) — this sheet owns setOpen for the /m shell (mount = open).
 * Chip labels are a deliberate compact copy of the desktop PlanPanel's (some UI duplication
 * was the accepted cost of the two-shell design — MOBILE_PLAN §1).
 */

import { useEffect } from "react";
import { usePlanStore, type PlanBodyState } from "../../store/plan";
import { useTimeStore } from "../../store/time";
import { cardinal } from "../../lib/format/readout";
import type { PlanEvent, PlanEventKind } from "../../lib/ephemeris/planner";
import "../../styles/mobile/chrome.css";

const CHIP_LABEL: Record<PlanEventKind, string> = {
  sunrise: "☀ RISE",
  sunset: "☀ SET",
  civilDawn: "DAWN",
  civilDusk: "DUSK",
  goldenAmStart: "GOLDEN AM",
  goldenAmEnd: "GOLD AM END",
  goldenPmStart: "GOLDEN PM",
  goldenPmEnd: "GOLD PM END",
  sunNoon: "NOON",
  moonrise: "☾ RISE",
  moonset: "☾ SET",
  moonCulmination: "☾ HIGH",
  fullMoon: "FULL MOON",
  newMoon: "NEW MOON",
};

/** Multi-day chips (full/new moon) show the date too. */
const DATED_KINDS: ReadonlySet<PlanEventKind> = new Set(["fullMoon", "newMoon"]);

function timeLabel(e: PlanEvent): string {
  const d = new Date(e.utcMs);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return DATED_KINDS.has(e.kind)
    ? `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${t}`
    : t;
}

function BodyLine({ glyph, label, state }: { glyph: string; label?: string; state: PlanBodyState }) {
  const setTime = useTimeStore((s) => s.setTime);
  const crossMs = state.blockedNow ? state.nextClearMs : state.nextBlockMs;
  const crossLabel = state.blockedNow ? "CLEARS" : "HIDES";
  return (
    <div className="m-body">
      <span>{glyph}</span>
      <span className={state.blockedNow ? "m-badge m-badge--blocked" : "m-badge m-badge--clear"}>
        {label ? `${label} · ` : ""}
        {state.blockedNow ? "BEHIND SKYLINE" : "CLEAR"}
      </span>
      <span className="m-body__pos">
        {Math.round(state.azDeg)}° {cardinal(state.azDeg)} · skyline {state.skylineAltDeg.toFixed(1)}°
      </span>
      {crossMs != null && (
        <button type="button" className="m-jump" onClick={() => setTime(crossMs)}>
          <span className="m-jump__kind">{crossLabel}</span>
          {new Date(crossMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </button>
      )}
    </div>
  );
}

export default function PlanSheet() {
  // planFeed computes focus-anchored chips only while the plan store says open — the sheet's
  // mount IS the /m "open" state (no pill on mobile). Closing the sheet stands the feed down.
  useEffect(() => {
    const { setOpen } = usePlanStore.getState();
    setOpen(true);
    return () => setOpen(false);
  }, []);

  const anchor = usePlanStore((s) => s.anchor);
  const events = usePlanStore((s) => s.events);
  const profileReady = usePlanStore((s) => s.profileReady);
  const coverage = usePlanStore((s) => s.profileCoverage);
  const trustRadiusM = usePlanStore((s) => s.trustRadiusM);
  const sun = usePlanStore((s) => s.sun);
  const moon = usePlanStore((s) => s.moon);
  const target = usePlanStore((s) => s.target);
  const setTime = useTimeStore((s) => s.setTime);

  const hasEye = anchor != null && anchor.kind !== "focus";

  return (
    <div>
      <div className="m-status-line">ANCHOR · {(anchor?.kind ?? "—").toUpperCase()}</div>
      {hasEye ? (
        profileReady ? (
          <>
            {sun && <BodyLine glyph="☀" state={sun} />}
            {moon && <BodyLine glyph="☾" state={moon} />}
            {target && <BodyLine glyph={target.glyph} label={target.label} state={target} />}
            <div className="m-status-line">
              SKYLINE {Math.round(coverage * 100)}% MAPPED · {(trustRadiusM / 1000).toFixed(0)} KM
              TRUST
            </div>
          </>
        ) : (
          <div className="m-status-line">MAPPING SKYLINE…</div>
        )
      ) : (
        <div className="m-status-line">
          DROP A PIN (LONG-PRESS THE GROUND) AND LOOK FROM HERE FOR THE SKYLINE VERDICT
        </div>
      )}

      <div className="m-section">JUMP SCENE TIME</div>
      <div className="m-chips">
        {events.map((e) => (
          <button
            key={`${e.kind}:${e.utcMs}`}
            type="button"
            className={`m-jump m-jump--${e.body}`}
            onClick={() => setTime(e.utcMs)}
          >
            <span className="m-jump__kind">{CHIP_LABEL[e.kind]}</span>
            {timeLabel(e)}
          </button>
        ))}
        {events.length === 0 && <div className="m-status-line">NO EVENTS FOR THIS DAY</div>}
      </div>
    </div>
  );
}
