import { useMemo } from "react";
import InfoDot from "../ui/InfoDot";
import DragGrip, { ResizeGrip, usePanelDrag, usePanelResize } from "../ui/DragGrip";
import { usePlanStore, type PlanBodyState } from "../../store/plan";
import { useTimeStore } from "../../store/time";
import { useCameraStore } from "../../store/camera";
import { cardinal } from "../../lib/format/readout";
import { galacticCentreTarget } from "../../lib/ephemeris/targets";
import { mwArcTiltDeg, mwSeason, type MwNight } from "../../lib/ephemeris/mwSeason";
import FrameCard from "./FrameCard";
import TodayCard from "./TodayCard";
import MoonCalCard from "./MoonCalCard";
import MeteorsCard from "./MeteorsCard";
import SpotStarsCard from "./SpotStarsCard";
import "../../styles/plan-panel.css";
import "../../styles/tips.css";

/**
 * Light planner (Pass 3 WS4-C + Dnipro Slice 5; QoL-2 2026-08-14) — the skyline verdict rows
 * (is the sun/moon/target behind the REAL local skyline around the photo/FPV eye, and when
 * does it clear) + THIS FRAME (FPV-only frame-crossing finder, FrameCard) + the TODAY daily
 * chronology (TodayCard — supersedes the old flat chip row) + the Milky-Way season card.
 * Every row pins scene time via store/time.setTime — the whole scene relights (S5 seam).
 *
 * The globe computes the skyline mirror (scene/planFeed.ts); the cards self-compute off the
 * pure ephemeris libs (the MwCard precedent — dodges the planFeed panel-open mirror trap).
 * Mounted as a top-level island (index.astro) — the S2 containing-block rule.
 */

function BodyRow({ glyph, label, state }: { glyph: string; label?: string; state: PlanBodyState }) {
  const setTime = useTimeStore((s) => s.setTime);
  const crossMs = state.blockedNow ? state.nextClearMs : state.nextBlockMs;
  const crossLabel = state.blockedNow ? "CLEARS" : "HIDES";
  return (
    <div className={`pp-body ${state.blockedNow ? "pp-body--blocked" : "pp-body--clear"}`}>
      <span className="pp-body__glyph">{glyph}</span>
      <span className="pp-body__verdict">
        {label && <span className="pp-body__label">{label} · </span>}
        {state.blockedNow ? "BEHIND SKYLINE" : "CLEAR"}
      </span>
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

// Stateless closure — safe to build once at module scope (the catalog resolver memoizes the
// same way). targets.ts is boot-safe; the lazy-sky fence only guards lib/sky/catalog.
const GC = galacticCentreTarget();
const MW_NIGHTS = 8;
const DAY_MS = 24 * 3600_000;

/** Compact clock for the tight MW rows: "9:15p" — the full form overflows the 12.5rem card. */
const hhmm = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?([AP])M$/i, (_, p) => p.toLowerCase());

/**
 * Milky-Way season card (Phase 8a P3): the next nights' Galactic-Centre dark windows
 * (sun < −18° ∩ GC up, mwSeason.ts conventions) + the arc-tilt-now readout. Computed here in
 * the panel (the TargetPanel windows precedent — store/plan stays globe-written only), memoised
 * per day/anchor so scrubbing minutes never re-scans. Mounts only while the panel is open.
 */
function MwCard({ latDeg, lonDeg }: { latDeg: number; lonDeg: number }) {
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);
  const sceneMs = live ? Date.now() : pinnedMs;
  const dayKey = Math.floor(sceneMs / DAY_MS);
  const hourKey = Math.floor(sceneMs / 3_600_000);
  const latKey = Math.round(latDeg * 20);
  const lonKey = Math.round(lonDeg * 20);
  const season = useMemo(
    () =>
      mwSeason(
        dayKey * DAY_MS,
        { latDeg: latKey / 20, lonDeg: lonKey / 20, groundAltM: 0, eyeAboveGroundM: 1.6 },
        GC,
        { days: MW_NIGHTS },
      ),
    [dayKey, latKey, lonKey],
  );
  const tiltDeg = useMemo(
    () => mwArcTiltDeg(hourKey * 3_600_000, latKey / 20, lonKey / 20),
    [hourKey, latKey, lonKey],
  );
  const maxScore = Math.max(1, ...season.map((n) => n.score));
  const inSeason = season.some((n) => n.window != null);
  return (
    <>
      <div className="pp-section">MILKY WAY · GC DARK WINDOWS · SUN &lt; −18°</div>
      <div className="pp-mw">
        {season.map((n: MwNight) => (
          <button
            key={n.dayStartMs}
            type="button"
            className="pp-mw__night"
            disabled={n.window == null}
            onClick={() => n.window && setTime(n.window.peakMs)}
            title={n.window ? "Jump scene time to the window peak" : undefined}
          >
            <span className="pp-mw__date">
              {new Date(n.dayStartMs + DAY_MS / 2).toLocaleDateString([], {
                month: "short",
                day: "numeric",
              })}
            </span>
            {n.window ? (
              <>
                <span className="pp-mw__bar">
                  <i style={{ width: `${Math.round((n.score / maxScore) * 100)}%` }} />
                </span>
                <span className="pp-mw__meta">
                  {hhmm(n.window.startMs)}–{hhmm(n.window.endMs)} · {Math.round(n.usableMinutes)}m
                  {n.moonInterference > 0 && ` · ☾${Math.round(n.moonInterference * 100)}%`}
                </span>
              </>
            ) : (
              <span className="pp-mw__meta pp-mw__meta--none">NO DARK PASS</span>
            )}
          </button>
        ))}
        <div className="pp-status">
          {inSeason ? `ARC TILT NOW ${Math.round(tiltDeg)}° TO HORIZON` : "OUT OF SEASON HERE"}
        </div>
      </div>
    </>
  );
}

export default function PlanPanel() {
  // ONE session key with FIND (owner 2026-08-15): the shared window keeps its dragged spot and
  // its user size across a mode switch — to the user PLAN/FIND is one window.
  const drag = usePanelDrag("planfind");
  const resize = usePanelResize("planfind");
  const open = usePlanStore((s) => s.open);
  const setOpen = usePlanStore((s) => s.setOpen);
  const anchor = usePlanStore((s) => s.anchor);
  const profileReady = usePlanStore((s) => s.profileReady);
  const coverage = usePlanStore((s) => s.profileCoverage);
  const trustRadiusM = usePlanStore((s) => s.trustRadiusM);
  const sun = usePlanStore((s) => s.sun);
  const moon = usePlanStore((s) => s.moon);
  const target = usePlanStore((s) => s.target);
  // The MW card's eye: the planner anchor when there is one, else the live view focus
  // (the TargetPanel pattern — quantization happens inside MwCard's memo keys).
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);

  const hasEye = anchor != null && anchor.kind !== "focus";

  // The pill moved into the topnav PlanFindToggle (owner 2026-08-15). Closed renders nothing —
  // all hooks above still run, so the store-driven feeds keep their gating.
  if (!open) return null;

  return (
    <div className="pp-root" style={drag.style}>
      <DragGrip drag={drag} label="Move the planning window" tipPos="up" />
      {open && (
        <aside className="pp" aria-label="Light planner" style={resize.style}>
          <div className="pp-head">
            <span className="pp-title">LIGHT PLANNER</span>
            <span className="pp-anchor">{anchor ? anchor.kind.toUpperCase() : "—"}</span>
            <InfoDot
              tip="When is the light right, here. Chips pin scene time — sunrise, golden hour (matched to this scene's grade), moon events. With a placed photo or in FPV, the skyline rows read the REAL local horizon: terrain plus the streamed buildings and trees around your eye."
              pos="right"
            />
            <button
              type="button"
              className="pp-x"
              aria-label="Close the planning window"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
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
                {target && <BodyRow glyph={target.glyph} label={target.label} state={target} />}
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

          <FrameCard />

          <TodayCard latDeg={anchor?.latDeg ?? focusLat} lonDeg={anchor?.lonDeg ?? focusLon} />

          {/* FIND moved OUT of the deck (v2 rework 2026-08-14): it lives as the dedicated
              FindPanel island — frame-as-query + in-frame ghost projections. */}

          <MoonCalCard latDeg={anchor?.latDeg ?? focusLat} lonDeg={anchor?.lonDeg ?? focusLon} />

          <MeteorsCard latDeg={anchor?.latDeg ?? focusLat} lonDeg={anchor?.lonDeg ?? focusLon} />

          <SpotStarsCard latDeg={anchor?.latDeg ?? focusLat} />

          <MwCard latDeg={anchor?.latDeg ?? focusLat} lonDeg={anchor?.lonDeg ?? focusLon} />
          </div>
          <ResizeGrip resize={resize} label="Resize the planning window" />
        </aside>
      )}
    </div>
  );
}
