import InfoDot from "../ui/InfoDot";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import { usePlanStore, type PlanBodyState } from "../../store/plan";
import { useTimeStore } from "../../store/time";
import { cardinal } from "../../lib/format/readout";
import type { PlanEvent, PlanEventKind } from "../../lib/ephemeris/planner";
import "../../styles/plan-panel.css";
import "../../styles/tips.css";

/**
 * Light planner (Pass 3 WS4-C + Dnipro Slice 5) — jump-to-time chips for the anchor's solar
 * day (rise/set, golden windows matching the rendered grade, twilight, culminations, next
 * full/new moon) plus the skyline verdict: is the sun/moon behind the REAL local skyline
 * (terrain + streamed buildings + trees around the photo/FPV eye), and when does it clear.
 * Every chip pins scene time via store/time.setTime — the whole scene relights (S5 seam).
 *
 * The globe computes everything (scene/planFeed.ts); this panel only renders the store mirror.
 * Mounted as a top-level island (index.astro) — the S2 containing-block rule.
 */

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

function BodyRow({ glyph, state }: { glyph: string; state: PlanBodyState }) {
  const setTime = useTimeStore((s) => s.setTime);
  const crossMs = state.blockedNow ? state.nextClearMs : state.nextBlockMs;
  const crossLabel = state.blockedNow ? "CLEARS" : "HIDES";
  return (
    <div className={`pp-body ${state.blockedNow ? "pp-body--blocked" : "pp-body--clear"}`}>
      <span className="pp-body__glyph">{glyph}</span>
      <span className="pp-body__verdict">{state.blockedNow ? "BEHIND SKYLINE" : "CLEAR"}</span>
      <span className="pp-body__pos">
        {Math.round(state.azDeg)}° {cardinal(state.azDeg)} · skyline{" "}
        {state.skylineAltDeg.toFixed(1)}°
      </span>
      {crossMs != null && (
        <button
          type="button"
          className="pp-chip pp-chip--cross"
          onClick={() => setTime(crossMs)}
          title="Jump scene time"
        >
          {crossLabel}{" "}
          {new Date(crossMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </button>
      )}
    </div>
  );
}

export default function PlanPanel() {
  const drag = usePanelDrag("plan");
  const open = usePlanStore((s) => s.open);
  const setOpen = usePlanStore((s) => s.setOpen);
  const anchor = usePlanStore((s) => s.anchor);
  const events = usePlanStore((s) => s.events);
  const profileReady = usePlanStore((s) => s.profileReady);
  const coverage = usePlanStore((s) => s.profileCoverage);
  const trustRadiusM = usePlanStore((s) => s.trustRadiusM);
  const sun = usePlanStore((s) => s.sun);
  const moon = usePlanStore((s) => s.moon);
  const setTime = useTimeStore((s) => s.setTime);

  const hasEye = anchor != null && anchor.kind !== "focus";

  return (
    <div className="pp-root" style={drag.style}>
      <DragGrip drag={drag} label="Move the light planner" tipPos="up" />
      <button
        type="button"
        className={`pp-pill ${open ? "pp-pill--open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Toggle the light planner"
      >
        ☀ PLAN
      </button>
      {open && (
        <aside className="pp" aria-label="Light planner">
          <div className="pp-head">
            <span className="pp-title">LIGHT PLANNER</span>
            <span className="pp-anchor">{anchor ? anchor.kind.toUpperCase() : "—"}</span>
            <InfoDot
              tip="When is the light right, here. Chips pin scene time — sunrise, golden hour (matched to this scene's grade), moon events. With a placed photo or in FPV, the skyline rows read the REAL local horizon: terrain plus the streamed buildings and trees around your eye."
              pos="right"
            />
          </div>

          {/* Scrolling lives on this INNER wrapper so the head's InfoDot tip (a ::after pill
              wider than the card) never creates a horizontal scrollbar nor gets clipped —
              the card root stays overflow-free (owner 2026-07-14 no-h-scroll pass). */}
          <div className="pp-scroll">
          {hasEye ? (
            profileReady ? (
              <>
                {sun && <BodyRow glyph="☀" state={sun} />}
                {moon && <BodyRow glyph="☾" state={moon} />}
                <div className="pp-status">
                  SKYLINE {Math.round(coverage * 100)}% MAPPED · {(trustRadiusM / 1000).toFixed(0)}{" "}
                  KM TRUST
                </div>
              </>
            ) : (
              <div className="pp-status">MAPPING SKYLINE…</div>
            )
          ) : (
            <div className="pp-status">PLACE A PHOTO OR ENTER FPV FOR THE SKYLINE VERDICT</div>
          )}

          <div className="pp-chips">
            {events.map((e) => (
              <button
                key={`${e.kind}:${e.utcMs}`}
                type="button"
                className={`pp-chip pp-chip--${e.body}`}
                onClick={() => setTime(e.utcMs)}
                title="Jump scene time"
              >
                <span className="pp-chip__kind">{CHIP_LABEL[e.kind]}</span>
                <span className="pp-chip__time">{timeLabel(e)}</span>
              </button>
            ))}
            {events.length === 0 && <div className="pp-status">NO EVENTS FOR THIS DAY</div>}
          </div>
          </div>
        </aside>
      )}
    </div>
  );
}
