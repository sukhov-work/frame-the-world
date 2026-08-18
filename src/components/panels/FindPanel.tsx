import { useEffect, useMemo, useState } from "react";
import InfoDot from "../ui/InfoDot";
import DragGrip, { ResizeGrip, usePanelDrag, usePanelResize } from "../ui/DragGrip";
import { useCameraStore } from "../../store/camera";
import { usePlanStore } from "../../store/plan";
import { useSkyStore } from "../../store/sky";
import { sameLocalTimeInstants, localTimeStr, useTimeStore } from "../../store/time";
import { useFindStore, FIND_GHOST_CAP, type FindGhost } from "../../store/find";
import {
  bodyDayPositions,
  frameStandingsFromPositions,
  type DayPosition,
  type FindBody,
  type FramePose,
  type FrameStanding,
} from "../../lib/ephemeris/frameFinder";
import { horizontal } from "../../lib/ephemeris/bodies";
import { bodyTarget, galacticCentreTarget, targetAzAlt } from "../../lib/ephemeris/targets";
import {
  sunEventDays,
  sunEventFrameHits,
  type SunEventDay,
  type SunEventHit,
  type SunEventKind,
} from "../../lib/ephemeris/sunEventFrame";
import { GOLDEN } from "../globe/tuning";
import { sampleBins } from "../../lib/geo/horizonProfile";
import { findHitColor, findStandingColorIdx } from "../../lib/theme/findPalette";
import { cardinal } from "../../lib/format/readout";
import { downloadIcs } from "../../lib/export/ics";
import "../../styles/plan-panel.css"; // the shared .pp-* board grammar (chips, dots, rows)
import "../../styles/find-panel.css";
import "../../styles/tips.css";

/**
 * FIND panel (v2, owner rework 2026-08-14) — the dedicated home of "find it in my frame",
 * replacing the buried az/el FindCard row. NO az/el inputs: the FRAME is the query (the §3.2
 * beat) — the live FPV pose (heading/pitch/FOV/aspect, so zoom AND orientation shape the
 * results) is scanned at the SCRUBBER's exact time-of-day on every following day. Each standing
 * is projected into the frame as a colour-matched ghost marker (scene/findGhosts via
 * store/find); hovering a row pulses its ghost, hovering a ghost highlights its row, clicking
 * either jumps scene time onto that day and tracks the body — the camera stays put, so the real
 * body arrives exactly where its ghost stood.
 *
 * Self-compute (the MwCard precedent) in TWO memo stages: day positions are pose-FREE (the
 * ~1 k-sample ephemeris pass survives look-drags), the frame filter + annotations are cheap and
 * re-run per ~1° pose move. Skyline verdicts ride the plan bins mirror (warm for any FPV/photo
 * anchor — planFeed keeps eyed builds alive with the panel closed).
 */

const RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
] as const;

/** Rendered row cap — the engine returns everything; long tails collapse to a "+N" note. */
const MAX_ROWS = 42;

/** Mean apparent disc diameters (deg) — ghost rings are markers, the ±2% seasonal swing is
 *  invisible at ring scale (the true-size discipline lives in skyGhosts, not here). */
const DISC_DEG: Record<FindBody, number> = { sun: 0.533, moon: 0.518, gc: 0 };

const GC = galacticCentreTarget(); // stateless closure — the PlanPanel module-scope precedent
const BODY_GLYPH: Record<FindBody, string> = { sun: "☀", moon: "☾", gc: "✦" };
const BODY_NAME: Record<FindBody, string> = { sun: "SUN", moon: "MOON", gc: "MW CORE" };
const DAY_MS = 24 * 3600_000;

const hhmm = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?([AP])M$/i, (_, p) => p.toLowerCase());

const dateTag = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

/** Where in the frame the standing sits — a two-arrow cluster ("▶▲", centre = "·"). */
function posHint(h: FrameStanding): string {
  const x = h.fx < -0.33 ? "◀" : h.fx > 0.33 ? "▶" : "";
  const y = h.fy < -0.33 ? "▼" : h.fy > 0.33 ? "▲" : "";
  return x + y || "·";
}

function icsForStanding(h: FrameStanding, latDeg: number, lonDeg: number): void {
  downloadIcs(`ftw-find-${new Date(h.utcMs).toISOString().slice(0, 10)}`, [
    {
      startMs: h.utcMs,
      endMs: h.utcMs + 10 * 60_000,
      summary: `${BODY_GLYPH[h.body]} ${BODY_NAME[h.body]} stands in your frame · ${h.light.toUpperCase()} (Sidera)`,
      description: `Az ${Math.round(h.azDeg)}° / el ${h.altDeg.toFixed(1)}°; skyline ${h.skyline}; visibility ${Math.round(h.visibility * 100)}%.`,
      geo: { latDeg, lonDeg },
    },
  ]);
}

// ── SUNSETS · IN FRAME (§3.5, owner order: lives HERE, never buried in a PLAN card) ──────────
/** Rendered sun-event row cap — the section shares the card's scroll budget with the standings. */
const SUNSET_MAX_ROWS = 21;
const EVENT_LABEL: Record<SunEventKind, string> = {
  sunset: "SET",
  sunrise: "RISE",
  goldenAm: "G·AM",
  goldenPm: "G·PM",
};
const EVENT_LONG: Record<SunEventKind, string> = {
  sunset: "Sunset",
  sunrise: "Sunrise",
  goldenAm: "Golden morning sun",
  goldenPm: "Golden evening sun",
};

function icsForSunEvent(h: SunEventHit, latDeg: number, lonDeg: number): void {
  downloadIcs(`ftw-sunevent-${new Date(h.utcMs).toISOString().slice(0, 10)}`, [
    {
      startMs: h.utcMs,
      endMs: h.utcMs + 10 * 60_000,
      summary: `☀ ${EVENT_LONG[h.kind]} in your frame (Sidera)`,
      description: `Az ${Math.round(h.azDeg)}°; skyline ${h.skyline}; walks ${h.azDriftDegPerDay.toFixed(1)}°/day along the horizon.`,
      geo: { latDeg, lonDeg },
    },
  ]);
}

export default function FindPanel() {
  // ONE session key with PLAN (owner 2026-08-15) — the shared window, see PlanFindToggle.
  const drag = usePanelDrag("planfind");
  const resize = usePanelResize("planfind");
  const open = useFindStore((s) => s.open);
  const setOpen = useFindStore((s) => s.setOpen);
  const setHoverKey = useFindStore((s) => s.setHoverKey);
  const sceneHoverKey = useFindStore((s) => s.sceneHoverKey);
  const planOpen = usePlanStore((s) => s.open);
  const anchor = usePlanStore((s) => s.anchor);
  const bins = usePlanStore((s) => s.profileBins);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  // Quantized pose key (the FrameCard idiom, ≈1° / half-degree FOV / aspect hundredths) —
  // null while FPV is inactive; the memo reads the full pose via getState().
  const poseKey = useCameraStore((s) =>
    s.fpvHud
      ? `${Math.round(s.fpvHud.headingDeg)}|${Math.round(s.fpvHud.pitchDeg)}|${Math.round(
          s.fpvHud.fovDeg * 2,
        )}|${s.fpvHud.aspect.toFixed(2)}`
      : null,
  );
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);

  // Bodies + range live in store/find (owner 2026-08-15c) — shared with the /m sheet and the
  // sky context-menu quick-toggle. The §3.5 SUNSETS chips are independent of this set.
  const bodies = useFindStore((s) => s.bodies);
  const setBody = useFindStore((s) => s.setBody);
  const rangeDays = useFindStore((s) => s.rangeDays);
  const setRangeDays = useFindStore((s) => s.setRangeDays);
  // §3.5 event chips — SET on by default (the owner ask was literally "sunsets in my frame").
  const [sunEventsOn, setSunEventsOn] = useState({ set: true, rise: false, gold: false });

  // The two planning surfaces share ONE window — opening PLAN closes FIND. The topnav
  // PlanFindToggle enforces this at click time; this effect is the belt for any other opener.
  useEffect(() => {
    if (planOpen && open) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps — only PLAN opening matters here
  }, [planOpen]);

  // Scan anchor instant: the pinned/scrubbed moment (stable while playing — a fast playback
  // must not re-run the day scan per frame), the wall clock while LIVE.
  const baseMs = live ? Date.now() : pinnedMs;
  const minuteKey = Math.floor(baseMs / 60_000);
  const lat = anchor?.latDeg ?? focusLat;
  const lon = anchor?.lonDeg ?? focusLon;
  const latKey = Math.round(lat * 20);
  const lonKey = Math.round(lon * 20);

  // The scan runs ONLY while the panel is open AND FPV is active. Outside FPV the lat/lon key
  // rides the camera FOCUS, which churns every frame during a flight — an ungated ~550-sample
  // pass per frame froze the boot flight solid (observed 2026-08-14, this session).
  const active = open && poseKey !== null;

  // Stage 1 — pose-FREE ephemeris pass: where each body stands at this wall-clock time on each
  // of the next `rangeDays` days. All three bodies always (body-chip toggles stay instant).
  const positions = useMemo<Record<FindBody, DayPosition[]> | null>(() => {
    if (!active) return null;
    const la = latKey / 20;
    const lo = lonKey / 20;
    const instants = sameLocalTimeInstants(minuteKey * 60_000, rangeDays);
    return {
      sun: bodyDayPositions((t) => horizontal("sun", t, la, lo), instants),
      moon: bodyDayPositions((t) => horizontal("moon", t, la, lo), instants),
      gc: bodyDayPositions((t) => targetAzAlt(GC, t, la, lo), instants),
    };
  }, [active, minuteKey, latKey, lonKey, rangeDays]);

  // Stage 2 — pose filter + annotations (cheap, re-runs on ~1° pose moves / chip toggles).
  const hits = useMemo<FrameStanding[]>(() => {
    if (!positions || !poseKey) return [];
    const hud = useCameraStore.getState().fpvHud;
    if (!hud) return [];
    const pose: FramePose = {
      latDeg: latKey / 20,
      lonDeg: lonKey / 20,
      headingDeg: hud.headingDeg,
      pitchDeg: hud.pitchDeg,
      fovDeg: hud.fovDeg,
      aspect: hud.aspect,
    };
    const profileFn = bins ? (az: number) => sampleBins(bins, az) : null;
    const out: FrameStanding[] = [];
    for (const b of ["sun", "moon", "gc"] as const) {
      if (!bodies[b]) continue;
      out.push(...frameStandingsFromPositions(b, positions[b], pose, profileFn));
    }
    out.sort((a, b) => a.utcMs - b.utcMs);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps — pose read via getState on poseKey change
  }, [positions, poseKey, bins, bodies, latKey, lonKey]);

  // §3.5 stage 1 — pose-FREE event day loop (root-finds). Keyed on the local DAY, never the
  // scrub minute: sunset instants don't depend on the scrubber hour (unlike the standings scan).
  const dayKey = Math.floor(baseMs / DAY_MS);
  const eventDays = useMemo<SunEventDay[] | null>(() => {
    if (!active) return null;
    const kinds: SunEventKind[] = [
      ...(sunEventsOn.set ? (["sunset"] as const) : []),
      ...(sunEventsOn.rise ? (["sunrise"] as const) : []),
      ...(sunEventsOn.gold ? (["goldenAm", "goldenPm"] as const) : []),
    ];
    if (kinds.length === 0) return [];
    return sunEventDays(
      { latDeg: latKey / 20, lonDeg: lonKey / 20, groundAltM: 0, eyeAboveGroundM: 1.6 },
      dayKey * DAY_MS,
      rangeDays,
      kinds,
      GOLDEN,
    );
  }, [active, dayKey, latKey, lonKey, rangeDays, sunEventsOn]);

  // §3.5 stage 2 — pose-cheap frame filter (the sunEventFrameHits face).
  const sunHits = useMemo<SunEventHit[]>(() => {
    if (!eventDays || !poseKey) return [];
    const hud = useCameraStore.getState().fpvHud;
    if (!hud) return [];
    const pose: FramePose = {
      latDeg: latKey / 20,
      lonDeg: lonKey / 20,
      headingDeg: hud.headingDeg,
      pitchDeg: hud.pitchDeg,
      fovDeg: hud.fovDeg,
      aspect: hud.aspect,
    };
    return sunEventFrameHits(eventDays, pose, bins ? (az: number) => sampleBins(bins, az) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps — pose read via getState on poseKey change
  }, [eventDays, poseKey, bins, latKey, lonKey]);

  const jumpSunEvent = (h: SunEventHit) => {
    setTime(h.utcMs);
    const sky = useSkyStore.getState();
    sky.setTarget(bodyTarget("sun"));
    if (!sky.visible) sky.setVisible(true);
  };

  // Ghost mirror: the first FIND_GHOST_CAP standings by date, colour = row index on the wheel.
  useEffect(() => {
    const ghosts: FindGhost[] = hits.slice(0, FIND_GHOST_CAP).map((h) => ({
      key: `${h.body}:${h.utcMs}`,
      utcMs: h.utcMs,
      body: h.body,
      azDeg: h.azDeg,
      altDeg: h.altDeg,
      discDeg: DISC_DEG[h.body],
      tNorm: Math.min(1, Math.max(0, (h.utcMs - baseMs) / (rangeDays * DAY_MS))),
      visibility: h.visibility,
      illum: h.body === "moon" ? h.moonIllum : 0,
      colorIdx: findStandingColorIdx(h.body, h.utcMs),
    }));
    useFindStore.getState().publishGhosts({ latDeg: latKey / 20, lonDeg: lonKey / 20 }, ghosts);
    // eslint-disable-next-line react-hooks/exhaustive-deps — baseMs rides minuteKey via hits
  }, [hits, latKey, lonKey, rangeDays]);
  // Leaving the page/panel unmount clears the projections.
  useEffect(() => () => useFindStore.getState().publishGhosts(null, []), []);

  const jump = (h: FrameStanding) => {
    setTime(h.utcMs);
    const sky = useSkyStore.getState();
    sky.setTarget(h.body === "gc" ? GC : bodyTarget(h.body));
    if (!sky.visible) sky.setVisible(true);
  };

  const hud = useCameraStore.getState().fpvHud;
  const hfovDeg = hud
    ? 2 * (Math.atan(Math.tan((hud.fovDeg * Math.PI) / 360) * hud.aspect) * (180 / Math.PI))
    : 0;
  const shown = hits.slice(0, MAX_ROWS);
  const rangeLabel = RANGES.find((r) => r.days === rangeDays)?.label ?? `${rangeDays}D`;

  // The pill moved into the topnav PlanFindToggle (owner 2026-08-15). Closed renders nothing —
  // all hooks above still run, so `active` gating and the ghost-mirror clearing stay intact.
  if (!open) return null;

  return (
    <div className="fnd-root" style={drag.style}>
      <DragGrip drag={drag} label="Move the planning window" tipPos="up" />
      {open && (
        <aside className="fnd" aria-label="Frame finder" style={resize.style}>
          <div className="pp-head">
            <span className="pp-title">FIND IN FRAME</span>
            <span className="pp-anchor">{anchor ? anchor.kind.toUpperCase() : "—"}</span>
            <InfoDot
              tip="Your frame is the query: on which coming days will the sun, the moon or the Milky-Way core stand INSIDE this exact view — at this exact time of day (set it with the scrubber)? Every find is projected into the frame as a colour-matched ring; click a ring or a row to jump to that day. Zoom or turn the frame and the results follow."
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
          <div className="fnd-scroll">
            {hud ? (
              <>
                <div className="fnd-ctx">
                  AT {localTimeStr(baseMs)} EVERY DAY · NEXT {rangeLabel}
                  <br />
                  LOOKING {cardinal(hud.headingDeg)} {Math.round(hud.headingDeg)}° · FRAME{" "}
                  {Math.round(hfovDeg)}°×{Math.round(hud.fovDeg)}°
                </div>
                <div className="pp-find__chips" role="group" aria-label="Bodies and range">
                  {(["sun", "moon", "gc"] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`pp-chip ${bodies[b] ? "pp-chip--on" : ""}`}
                      onClick={() => setBody(b, !bodies[b])}
                      title={BODY_NAME[b]}
                    >
                      {BODY_GLYPH[b]}
                    </button>
                  ))}
                  <span className="pp-find__sep" />
                  {RANGES.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      className={`pp-chip ${rangeDays === r.days ? "pp-chip--on" : ""}`}
                      onClick={() => setRangeDays(r.days)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {shown.map((h, i) => {
                  const key = `${h.body}:${h.utcMs}`;
                  const projected = i < FIND_GHOST_CAP;
                  return (
                    <div
                      className={`pp-day__row fnd-row ${sceneHoverKey === key ? "fnd-row--hot" : ""}`}
                      key={key}
                      onMouseEnter={() => setHoverKey(key)}
                      onMouseLeave={() => setHoverKey(null)}
                    >
                      <button
                        type="button"
                        className="pp-day__jump"
                        onClick={() => jump(h)}
                        title={`Jump to ${dateTag(h.utcMs)} ${hhmm(h.utcMs)} and track the ${BODY_NAME[h.body]}`}
                      >
                        <span
                          className={`fnd-sw ${projected ? "" : "fnd-sw--off"}`}
                          style={{ background: findHitColor(findStandingColorIdx(h.body, h.utcMs)).css }}
                        />
                        <i className={`pp-day__dot pp-day__dot--${h.light}`} />
                        <span className="pp-day__time">{dateTag(h.utcMs)}</span>
                        <span className="fnd-glyph">{BODY_GLYPH[h.body]}</span>
                        <span className="fnd-pos" title="Where in the frame it stands">
                          {posHint(h)}
                        </span>
                        <span className="pp-day__kind">
                          {h.skyline === "blocked" ? "✕" : h.skyline === "clear" ? "CLEAR" : "—"}
                        </span>
                        <span className="pp-day__meta" title="How visible it will be">
                          {Math.round(h.visibility * 100)}%
                        </span>
                      </button>
                      <button
                        type="button"
                        className="pp-ics"
                        onClick={() => icsForStanding(h, latKey / 20, lonKey / 20)}
                        title="Add to calendar (.ics)"
                        aria-label="Export standing to calendar"
                      >
                        ⤓
                      </button>
                    </div>
                  );
                })}
                <div className="pp-find__foot">
                  <span className="pp-status pp-status--inline">
                    {hits.length === 0
                      ? `NOTHING STANDS HERE AT ${localTimeStr(baseMs)} · TRY 1Y, ANOTHER HOUR, OR A WIDER FRAME`
                      : hits.length > FIND_GHOST_CAP
                        ? `${hits.length} STANDINGS · FIRST ${FIND_GHOST_CAP} PROJECTED IN FRAME`
                        : `${hits.length} STANDING${hits.length === 1 ? "" : "S"} · ALL PROJECTED IN FRAME`}
                  </span>
                </div>
                {/* ── §3.5 SUNSETS · IN FRAME — the event-anchored twin of the scan above:
                       not "where does the sun stand at this hour" but "on which days does the
                       sunset/sunrise/golden sun itself land inside this frame". ─────────── */}
                <div className="pp-section">
                  SUNSETS · IN FRAME
                  <InfoDot
                    tip="On which coming days does the sunset (or sunrise / the golden sun) happen INSIDE this exact frame? Times are true almanac times (refracted); ✕ means a ridge or building swallows the sun before the horizon. The °/day figure is how fast the event walks along your skyline."
                    pos="right"
                  />
                </div>
                <div className="pp-find__chips" role="group" aria-label="Sun events">
                  {(
                    [
                      ["set", "SET"],
                      ["rise", "RISE"],
                      ["gold", "GOLD"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`pp-chip ${sunEventsOn[k] ? "pp-chip--on" : ""}`}
                      onClick={() => setSunEventsOn({ ...sunEventsOn, [k]: !sunEventsOn[k] })}
                      title={
                        k === "set" ? "Sunsets" : k === "rise" ? "Sunrises" : "Golden-hour sun"
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {sunHits.length > 0 && (
                  <div className="fnd-ctx">
                    NEXT · {dateTag(sunHits[0].utcMs).toUpperCase()} {hhmm(sunHits[0].utcMs)}{" "}
                    {EVENT_LABEL[sunHits[0].kind]}
                  </div>
                )}
                {sunHits.slice(0, SUNSET_MAX_ROWS).map((h) => (
                  <div className="pp-day__row fnd-row" key={`${h.kind}:${h.utcMs}`}>
                    <button
                      type="button"
                      className="pp-day__jump"
                      onClick={() => jumpSunEvent(h)}
                      title={`Jump to ${EVENT_LONG[h.kind].toLowerCase()} on ${dateTag(h.utcMs)} and track the sun`}
                    >
                      <i className={`pp-day__dot pp-day__dot--${h.light}`} />
                      <span className="pp-day__time">{dateTag(h.utcMs)}</span>
                      <span className="pp-day__time">{hhmm(h.utcMs)}</span>
                      <span className="pp-day__kind">{EVENT_LABEL[h.kind]}</span>
                      <span className="pp-day__kind">
                        {h.skyline === "blocked" ? "✕" : h.skyline === "clear" ? "CLEAR" : "—"}
                      </span>
                      <span
                        className="pp-day__meta"
                        title="How fast this event walks along the skyline"
                      >
                        {h.azDriftDegPerDay > 0 ? "+" : ""}
                        {h.azDriftDegPerDay.toFixed(1)}°/d
                      </span>
                    </button>
                    <button
                      type="button"
                      className="pp-ics"
                      onClick={() => icsForSunEvent(h, latKey / 20, lonKey / 20)}
                      title="Add to calendar (.ics)"
                      aria-label="Export sun event to calendar"
                    >
                      ⤓
                    </button>
                  </div>
                ))}
                <div className="pp-find__foot">
                  <span className="pp-status pp-status--inline">
                    {!sunEventsOn.set && !sunEventsOn.rise && !sunEventsOn.gold
                      ? "PICK AN EVENT — SET, RISE OR GOLD"
                      : sunHits.length === 0
                        ? "NO SUN EVENTS LAND IN THIS FRAME · TRY 1Y OR TURN TOWARD THE HORIZON"
                        : sunHits.length > SUNSET_MAX_ROWS
                          ? `${sunHits.length} EVENTS · FIRST ${SUNSET_MAX_ROWS} SHOWN`
                          : `${sunHits.length} EVENT${sunHits.length === 1 ? "" : "S"} IN FRAME`}
                  </span>
                </div>
              </>
            ) : (
              <div className="pp-status">
                ENTER LOOK (FPV) — YOUR FRAME IS THE QUERY. THE SCRUBBER SETS THE HOUR; EVERY
                COMING DAY IS CHECKED AT THAT EXACT TIME.
              </div>
            )}
          </div>
          <ResizeGrip resize={resize} label="Resize the planning window" />
        </aside>
      )}
    </div>
  );
}
