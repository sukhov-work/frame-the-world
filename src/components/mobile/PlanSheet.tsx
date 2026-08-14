/**
 * PlanSheet (M1; v2 M3b — the /m twin of the desktop PLAN deck + FIND panel): skyline verdict
 * rows (store/plan readers) + compact self-computing twins of THIS FRAME · TODAY · FIND IN
 * FRAME (v2 frame-as-query semantics — the ghost projections already render on /m's globe;
 * this sheet is their panel surface and the store/find ghost-mirror WRITER on /m) · MOON ·
 * SPOT STARS. Chip/row labels are deliberate compact copies of the desktop cards' (the
 * accepted two-shell duplication — MOBILE_PLAN §1); everything computes off the same pure
 * libs + stores, desktop panels are never imported.
 *
 * IMPORTANT seams:
 *  • planFeed computes focus-anchored chips only while plan.open — this sheet's mount IS the
 *    /m "open" state. Same idiom for FIND: mount sets find.open (the globe draws the ghost
 *    projections while the sheet lives), unmount clears the mirror.
 *  • FPV-only twins (THIS FRAME / FIND / SPOT STARS) gate on the quantized fpvHud pose key —
 *    the FindPanel `active` gate lesson (an ungated ephemeris pass froze the boot flight).
 */

import { useEffect, useMemo, useState } from "react";
import { usePlanStore, type PlanBodyState } from "../../store/plan";
import { useTimeStore, sameLocalTimeInstants, localTimeStr } from "../../store/time";
import { useCameraStore } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
import { useFindStore, FIND_GHOST_CAP, type FindGhost } from "../../store/find";
import { cardinal, formatSigned } from "../../lib/format/readout";
import {
  dayEvents,
  moonPhaseEvents,
  type PlanEvent,
  type PlanEventKind,
} from "../../lib/ephemeris/planner";
import { lightPhaseAt, sunAltDeg } from "../../lib/ephemeris/twilight";
import {
  bodyDayPositions,
  frameCrossings,
  frameStandingsFromPositions,
  nearestFrameCentre,
  type DayPosition,
  type FindBody,
  type FrameCrossing,
  type FramePose,
  type FrameSampler,
  type FrameStanding,
} from "../../lib/ephemeris/frameFinder";
import { horizontal } from "../../lib/ephemeris/bodies";
import {
  bodyTarget,
  galacticCentreTarget,
  targetAzAlt,
  targetShortName,
} from "../../lib/ephemeris/targets";
import { moonCalendar, nextSupermoons, type MoonCalKind } from "../../lib/ephemeris/moonCalendar";
import { sampleBins } from "../../lib/geo/horizonProfile";
import { kindGlyph } from "../../lib/sky/searchIndex";
import { findHitColor, findStandingColorIdx } from "../../lib/theme/findPalette";
import { maxCosDecInFrame, npfFullSec, npfSimpleSec, rule500Sec } from "../../lib/photo/npf";
import { focalFromVerticalFov } from "../../lib/decode/sensors";
import { GOLDEN } from "../globe/tuning";
import "../../styles/mobile/chrome.css";

const DAY_MS = 24 * 3600_000;

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

const MOON_KIND_LABEL: Record<MoonCalKind, string> = {
  newMoon: "NEW",
  firstQuarter: "1ST QTR",
  fullMoon: "FULL",
  thirdQuarter: "3RD QTR",
  perigee: "PERIGEE",
  apogee: "APOGEE",
};

const hhmm = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?([AP])M$/i, (_, p) => p.toLowerCase());
const dateTag = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

/** Quantized FPV pose key (the FrameCard idiom) — null while FPV is inactive. */
const usePoseKey = () =>
  useCameraStore((s) =>
    s.fpvHud
      ? `${Math.round(s.fpvHud.headingDeg)}|${Math.round(s.fpvHud.pitchDeg)}|${Math.round(
          s.fpvHud.fovDeg * 2,
        )}|${s.fpvHud.aspect.toFixed(2)}`
      : null,
  );

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

/** THIS FRAME — the FrameCard twin (FPV-only, next 36 h; rows jump, no .ics on phone rows —
 *  the FIND rows carry export duty; keep the sheet lean). */
function FrameSection() {
  const poseKey = usePoseKey();
  const anchor = usePlanStore((s) => s.anchor);
  const bins = usePlanStore((s) => s.profileBins);
  const target = useSkyStore((s) => s.target);
  const targetVisible = useSkyStore((s) => s.visible);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);

  const sceneMs = live ? Date.now() : pinnedMs;
  const fromKey = Math.floor(sceneMs / (5 * 60_000));
  const hasEye = anchor != null && anchor.kind !== "focus";

  const scan = useMemo(() => {
    if (!poseKey || !hasEye || !anchor) return null;
    const hud = useCameraStore.getState().fpvHud;
    if (!hud) return null;
    const pose: FramePose = {
      latDeg: anchor.latDeg,
      lonDeg: anchor.lonDeg,
      headingDeg: hud.headingDeg,
      pitchDeg: hud.pitchDeg,
      fovDeg: hud.fovDeg,
      aspect: hud.aspect,
    };
    const profileFn = bins ? (az: number) => sampleBins(bins, az) : null;
    const from = fromKey * 5 * 60_000;
    const opts = { profileFn, stepMin: 5, maxWindows: 1 } as const;
    const sunS: FrameSampler = (t) => horizontal("sun", t, pose.latDeg, pose.lonDeg);
    const moonS: FrameSampler = (t) => horizontal("moon", t, pose.latDeg, pose.lonDeg);
    const tgtS: FrameSampler = (t) => targetAzAlt(target, t, pose.latDeg, pose.lonDeg);
    const rows: { key: string; glyph: string; isMoon: boolean; win: FrameCrossing | null }[] = [
      { key: "sun", glyph: "☀", isMoon: false, win: frameCrossings(sunS, pose, from, 1.5, opts)[0] ?? null },
      { key: "moon", glyph: "☾", isMoon: true, win: frameCrossings(moonS, pose, from, 1.5, opts)[0] ?? null },
    ];
    const targetIsBodyRow = target.id === "body:sun" || target.id === "body:moon";
    let centre: { utcMs: number; sepDeg: number } | null = null;
    if (targetVisible) {
      if (!targetIsBodyRow)
        rows.push({
          key: "target",
          glyph: kindGlyph(target.kind),
          isMoon: false,
          win: frameCrossings(tgtS, pose, from, 1.5, opts)[0] ?? null,
        });
      centre = nearestFrameCentre(tgtS, pose, from, 1.5, { stepMin: 5 });
    }
    return { rows, centre, from, tgtName: targetShortName(target).toUpperCase() };
    // eslint-disable-next-line react-hooks/exhaustive-deps — pose read via getState on poseKey change
  }, [poseKey, hasEye, anchor, bins, target, targetVisible, fromKey]);

  if (!scan) return null;
  return (
    <>
      <div className="m-section">THIS FRAME · NEXT 36 H</div>
      <div className="m-rows">
        {scan.rows.map((r) => (
          <div className="m-row" key={r.key}>
            {r.win ? (
              <button
                type="button"
                className="m-row__jump"
                onClick={() => setTime(r.win!.startMs <= scan.from ? r.win!.peakMs : r.win!.startMs)}
              >
                <span className="m-row__glyph">{r.glyph}</span>
                <span className="m-row__time">
                  {r.win.startMs <= scan.from
                    ? `NOW → ${hhmm(r.win.endMs)}`
                    : `${hhmm(r.win.startMs)}–${hhmm(r.win.endMs)}`}
                </span>
                <span className="m-row__meta">
                  {[
                    r.win.light.toUpperCase(),
                    r.win.skyline !== "unknown" ? r.win.skyline.toUpperCase() : null,
                    r.isMoon ? `${Math.round(r.win.moonIllum * 100)}%` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ) : (
              <div className="m-row__none">
                <span className="m-row__glyph">{r.glyph}</span>
                <span className="m-row__meta">NOT IN FRAME · 36 H</span>
              </div>
            )}
          </div>
        ))}
        {scan.centre && (
          <button type="button" className="m-jump" onClick={() => setTime(scan.centre!.utcMs)}>
            <span className="m-jump__kind">◎ CENTRE</span>
            {hhmm(scan.centre.utcMs)}
            {scan.centre.sepDeg > 1.5 ? ` · ${Math.round(scan.centre.sepDeg)}° OFF` : ""}
          </button>
        )}
      </div>
    </>
  );
}

/** TODAY — the TodayCard twin (self-computing chronology with light dots + the R5 sun-at-moon
 *  quality signal; supersedes the M1 raw "JUMP SCENE TIME" chips). */
function TodaySection({ latDeg, lonDeg }: { latDeg: number; lonDeg: number }) {
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);
  const sceneMs = live ? Date.now() : pinnedMs;
  const dayKey = Math.floor(sceneMs / DAY_MS);
  const latKey = Math.round(latDeg * 20);
  const lonKey = Math.round(lonDeg * 20);

  const rows = useMemo(() => {
    const lat = latKey / 20;
    const lon = lonKey / 20;
    const obs = { latDeg: lat, lonDeg: lon, groundAltM: 0, eyeAboveGroundM: 1.6 };
    const anchorMs = dayKey * DAY_MS + DAY_MS / 2;
    return [...dayEvents(anchorMs, obs, GOLDEN), ...moonPhaseEvents(anchorMs, obs)].map((e) => ({
      e,
      light: lightPhaseAt(e.utcMs, lat, lon),
      sunAtMoon:
        e.kind === "moonrise" || e.kind === "moonset" ? sunAltDeg(e.utcMs, lat, lon) : null,
    }));
  }, [dayKey, latKey, lonKey]);

  return (
    <>
      <div className="m-section">TODAY · MIDNIGHT → MIDNIGHT</div>
      <div className="m-rows">
        {rows.map(({ e, light, sunAtMoon }: { e: PlanEvent; light: string; sunAtMoon: number | null }) => (
          <div className="m-row" key={`${e.kind}:${e.utcMs}`}>
            <button type="button" className="m-row__jump" onClick={() => setTime(e.utcMs)}>
              <i className={`m-dot m-dot--${light}`} />
              <span className="m-row__time">
                {DATED_KINDS.has(e.kind) ? `${dateTag(e.utcMs)} ${hhmm(e.utcMs)}` : hhmm(e.utcMs)}
              </span>
              <span className="m-row__kind">{CHIP_LABEL[e.kind]}</span>
              {sunAtMoon != null && (
                <span className="m-row__meta">☀{formatSigned(Math.round(sunAtMoon))}</span>
              )}
            </button>
          </div>
        ))}
        {rows.length === 0 && <div className="m-status-line">NO EVENTS FOR THIS DAY</div>}
      </div>
    </>
  );
}

const FIND_RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
] as const;
const GC = galacticCentreTarget();
const BODY_GLYPH: Record<FindBody, string> = { sun: "☀", moon: "☾", gc: "✦" };
const FIND_MAX_ROWS = 24;

function findPosHint(h: FrameStanding): string {
  const x = h.fx < -0.33 ? "◀" : h.fx > 0.33 ? "▶" : "";
  const y = h.fy < -0.33 ? "▼" : h.fy > 0.33 ? "▲" : "";
  return x + y || "·";
}

/** FIND IN FRAME — the FindPanel v2 twin (frame-as-query at the scrubber's wall-clock on every
 *  following day; the ghost projections on /m's globe read the mirror THIS section writes).
 *  Same two-stage memo + the `active` gate (the frozen-boot-flight lesson). */
function FindSection() {
  const poseKey = usePoseKey();
  const anchor = usePlanStore((s) => s.anchor);
  const bins = usePlanStore((s) => s.profileBins);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);
  const sceneHoverKey = useFindStore((s) => s.sceneHoverKey);

  const [bodies, setBodies] = useState<Record<FindBody, boolean>>({ sun: true, moon: true, gc: true });
  const [rangeDays, setRangeDays] = useState<number>(182);

  // The sheet IS the FIND surface on /m: mount opens the store gate (ghosts draw), unmount
  // clears the mirror (this section is the single ghost writer on the /m shell).
  useEffect(() => {
    useFindStore.getState().setOpen(true);
    return () => {
      useFindStore.getState().setOpen(false);
      useFindStore.getState()._syncGhosts(null, []);
    };
  }, []);

  const baseMs = live ? Date.now() : pinnedMs;
  const minuteKey = Math.floor(baseMs / 60_000);
  const lat = anchor?.latDeg ?? focusLat;
  const lon = anchor?.lonDeg ?? focusLon;
  const latKey = Math.round(lat * 20);
  const lonKey = Math.round(lon * 20);
  const active = poseKey !== null; // mount = open; FPV gate stays (the boot-flight freeze lesson)

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

  // Ghost mirror — identical contract to the desktop FindPanel writer.
  useEffect(() => {
    const ghosts: FindGhost[] = hits.slice(0, FIND_GHOST_CAP).map((h) => ({
      key: `${h.body}:${h.utcMs}`,
      utcMs: h.utcMs,
      body: h.body,
      azDeg: h.azDeg,
      altDeg: h.altDeg,
      discDeg: h.body === "sun" ? 0.533 : h.body === "moon" ? 0.518 : 0,
      tNorm: Math.min(1, Math.max(0, (h.utcMs - baseMs) / (rangeDays * DAY_MS))),
      visibility: h.visibility,
      illum: h.body === "moon" ? h.moonIllum : 0,
      colorIdx: findStandingColorIdx(h.body, h.utcMs),
    }));
    useFindStore.getState()._syncGhosts({ latDeg: latKey / 20, lonDeg: lonKey / 20 }, ghosts);
    // eslint-disable-next-line react-hooks/exhaustive-deps — baseMs rides minuteKey via hits
  }, [hits, latKey, lonKey, rangeDays]);

  const jump = (h: FrameStanding) => {
    setTime(h.utcMs);
    const sky = useSkyStore.getState();
    sky.setTarget(h.body === "gc" ? GC : bodyTarget(h.body));
    if (!sky.visible) sky.setVisible(true);
  };

  const shown = hits.slice(0, FIND_MAX_ROWS);
  const rangeLabel = FIND_RANGES.find((r) => r.days === rangeDays)?.label ?? `${rangeDays}D`;

  return (
    <>
      <div className="m-section">FIND IN FRAME</div>
      {active ? (
        <>
          <div className="m-status-line">
            AT {localTimeStr(baseMs)} EVERY DAY · NEXT {rangeLabel} — RINGS IN THE SKY ARE THE
            FINDS
          </div>
          <div className="m-toggles">
            {(["sun", "moon", "gc"] as const).map((b) => (
              <button
                key={b}
                type="button"
                className={`m-toggle ${bodies[b] ? "m-toggle--on" : ""}`}
                onClick={() => setBodies({ ...bodies, [b]: !bodies[b] })}
              >
                {BODY_GLYPH[b]}
              </button>
            ))}
            {FIND_RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                className={`m-toggle ${rangeDays === r.days ? "m-toggle--on" : ""}`}
                onClick={() => setRangeDays(r.days)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="m-rows">
            {shown.map((h) => {
              const key = `${h.body}:${h.utcMs}`;
              return (
                <div className={`m-row ${sceneHoverKey === key ? "m-row--hot" : ""}`} key={key}>
                  <button type="button" className="m-row__jump" onClick={() => jump(h)}>
                    <span
                      className="m-sw"
                      style={{ background: findHitColor(findStandingColorIdx(h.body, h.utcMs)).css }}
                    />
                    <i className={`m-dot m-dot--${h.light}`} />
                    <span className="m-row__time">{dateTag(h.utcMs)}</span>
                    <span className="m-row__kind">{BODY_GLYPH[h.body]}</span>
                    <span className="m-row__meta">{findPosHint(h)}</span>
                    <span className="m-row__meta">
                      {h.skyline === "blocked" ? "✕" : h.skyline === "clear" ? "CLEAR" : "—"} ·{" "}
                      {Math.round(h.visibility * 100)}%
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="m-status-line">
            {hits.length === 0
              ? `NOTHING STANDS HERE AT ${localTimeStr(baseMs)} · TRY 1Y OR A WIDER FRAME`
              : hits.length > FIND_MAX_ROWS
                ? `${hits.length} STANDINGS · FIRST ${FIND_GHOST_CAP} PROJECTED IN THE SKY`
                : `${hits.length} STANDING${hits.length === 1 ? "" : "S"} · ALL PROJECTED`}
          </div>
        </>
      ) : (
        <div className="m-status-line">
          ENTER LOOK-FROM-HERE (FPV) — YOUR FRAME IS THE QUERY. THE TIME DOCK SETS THE HOUR;
          EVERY COMING DAY IS CHECKED AT THAT EXACT TIME.
        </div>
      )}
    </>
  );
}

/** MOON — the MoonCalCard twin (phases + perigee/apogee, supermoons starred, disc size). */
function MoonSection({ latDeg, lonDeg }: { latDeg: number; lonDeg: number }) {
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);
  const sceneMs = live ? Date.now() : pinnedMs;
  const dayKey = Math.floor(sceneMs / DAY_MS);
  const latKey = Math.round(latDeg * 20);
  const lonKey = Math.round(lonDeg * 20);

  const { rows, superChip } = useMemo(() => {
    const from = dayKey * DAY_MS;
    const events = moonCalendar(from, 45).slice(0, 8); // 8 rows — phone height
    const lat = latKey / 20;
    const lon = lonKey / 20;
    const rows = events.map((e) => ({ e, light: lightPhaseAt(e.utcMs, lat, lon) }));
    const superChip = events.some((e) => e.supermoon) ? null : (nextSupermoons(from, 1)[0] ?? null);
    return { rows, superChip };
  }, [dayKey, latKey, lonKey]);

  return (
    <>
      <div className="m-section">MOON · PHASES & DISTANCES</div>
      <div className="m-rows">
        {rows.map(({ e, light }) => (
          <div className="m-row" key={`${e.kind}:${e.utcMs}`}>
            <button type="button" className="m-row__jump" onClick={() => setTime(e.utcMs)}>
              <i className={`m-dot m-dot--${light}`} />
              <span className="m-row__time">{`${dateTag(e.utcMs)} ${hhmm(e.utcMs)}`}</span>
              <span className="m-row__kind">{e.supermoon ? "★ SUPER" : MOON_KIND_LABEL[e.kind]}</span>
              <span className="m-row__meta">{e.discArcmin.toFixed(1)}′</span>
            </button>
          </div>
        ))}
        {superChip && (
          <button type="button" className="m-jump" onClick={() => setTime(superChip.utcMs)}>
            <span className="m-jump__kind">★ SUPERMOON</span>
            {dateTag(superChip.utcMs)}
          </button>
        )}
      </div>
    </>
  );
}

/** SPOT STARS — the SpotStarsCard twin (NPF ceiling for the live frame; FPV-only). */
function SpotSection({ latDeg }: { latDeg: number }) {
  const poseKey = usePoseKey();
  const [apertureStr, setApertureStr] = useState("2.8");
  const [pitchStr, setPitchStr] = useState("4.4");
  const [k, setK] = useState<1 | 2 | 3>(1);
  const latKey = Math.round(latDeg * 20);

  const calc = useMemo(() => {
    if (!poseKey) return null;
    const hud = useCameraStore.getState().fpvHud;
    if (!hud) return null;
    const apertureN = Number(apertureStr);
    const pitchUm = Number(pitchStr);
    if (!(apertureN > 0) || !(pitchUm > 0)) return null;
    const focalMm = focalFromVerticalFov(hud.fovDeg);
    const cosDec = maxCosDecInFrame(
      { headingDeg: hud.headingDeg, pitchDeg: hud.pitchDeg, fovDeg: hud.fovDeg, aspect: hud.aspect },
      latKey / 20,
    );
    return {
      focalMm,
      cosDec,
      npf: npfFullSec(apertureN, focalMm, pitchUm, cosDec, k),
      simple: npfSimpleSec(apertureN, focalMm, pitchUm),
      r500: rule500Sec(focalMm, 1),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps — pose read via getState on poseKey change
  }, [poseKey, apertureStr, pitchStr, k, latKey]);

  if (!calc) return null;
  const fmtSec = (s: number) => (s >= 10 ? `${Math.round(s)} s` : `${s.toFixed(1)} s`);

  return (
    <>
      <div className="m-section">SPOT STARS · NPF</div>
      <div className="m-npf">
        <label className="m-npf__field">
          f/
          <input
            className="m-in"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={apertureStr}
            onChange={(e) => setApertureStr(e.target.value)}
            aria-label="Aperture (f-number)"
          />
        </label>
        <label className="m-npf__field">
          P µM
          <input
            className="m-in"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={pitchStr}
            onChange={(e) => setPitchStr(e.target.value)}
            aria-label="Pixel pitch (micrometres)"
          />
        </label>
        {([1, 2, 3] as const).map((kk) => (
          <button
            key={kk}
            type="button"
            className={`m-toggle ${k === kk ? "m-toggle--on" : ""}`}
            onClick={() => setK(kk)}
          >
            ×{kk}
          </button>
        ))}
      </div>
      <div className="m-npf__big">NPF {fmtSec(calc.npf)}</div>
      <div className="m-status-line">
        {Math.round(calc.focalMm)} MM · δ AUTO (cos {calc.cosDec.toFixed(2)}) · SIMPLE{" "}
        {fmtSec(calc.simple)} · 500: {fmtSec(calc.r500)}
      </div>
    </>
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
  const profileReady = usePlanStore((s) => s.profileReady);
  const coverage = usePlanStore((s) => s.profileCoverage);
  const trustRadiusM = usePlanStore((s) => s.trustRadiusM);
  const sun = usePlanStore((s) => s.sun);
  const moon = usePlanStore((s) => s.moon);
  const target = usePlanStore((s) => s.target);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);

  const hasEye = anchor != null && anchor.kind !== "focus";
  const eyeLat = anchor?.latDeg ?? focusLat;
  const eyeLon = anchor?.lonDeg ?? focusLon;

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

      <FrameSection />
      <TodaySection latDeg={eyeLat} lonDeg={eyeLon} />
      <FindSection />
      <MoonSection latDeg={eyeLat} lonDeg={eyeLon} />
      <SpotSection latDeg={eyeLat} />
    </div>
  );
}
