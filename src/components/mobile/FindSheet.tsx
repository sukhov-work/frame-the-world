/**
 * FindSheet (owner 2026-08-15c) — FIND IN FRAME as a DEDICATED 4th tab on /m, no longer a
 * PlanSheet section. MobileShell mounts this component UNCONDITIONALLY: the hooks (the
 * two-stage scan + the store/find ghost mirror) run for the whole /m session and only the
 * <Sheet> chrome mounts/unmounts with the tab — so the in-frame standings SURVIVE the sheet
 * being collapsed (the Pixel bug: ghosts vanished the moment the config sheet closed,
 * because the old FindSection's unmount cleared the mirror). find.open is STICKY on /m:
 * the first tab visit (or the SkyContextMenu per-body quick-toggle) switches the scan on;
 * collapsing the sheet leaves the projections in the frame. This component is the SINGLE
 * store/find ghost writer on the /m shell (PlanSheet no longer writes).
 *
 * Bodies + range chips read/write store/find (lifted 2026-08-15c — shared with the desktop
 * FindPanel and the sky context menu; moon-only, 1M by default).
 */

import { useEffect, useMemo } from "react";
import Sheet from "./Sheet";
import { usePlanStore } from "../../store/plan";
import { useTimeStore, sameLocalTimeInstants, localTimeStr } from "../../store/time";
import { useCameraStore } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
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
import { sampleBins } from "../../lib/geo/horizonProfile";
import { findHitColor, findStandingColorIdx } from "../../lib/theme/findPalette";
import "../../styles/mobile/chrome.css";

const DAY_MS = 24 * 3600_000;
const FIND_RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
] as const;
const GC = galacticCentreTarget();
const BODY_GLYPH: Record<FindBody, string> = { sun: "☀", moon: "☾", gc: "✦" };
const FIND_MAX_ROWS = 24;

const dateTag = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

function findPosHint(h: FrameStanding): string {
  const x = h.fx < -0.33 ? "◀" : h.fx > 0.33 ? "▶" : "";
  const y = h.fy < -0.33 ? "▼" : h.fy > 0.33 ? "▲" : "";
  return x + y || "·";
}

/** Quantized FPV pose key (the FrameCard idiom) — null while FPV is inactive. */
const usePoseKey = () =>
  useCameraStore((s) =>
    s.fpvHud
      ? `${Math.round(s.fpvHud.headingDeg)}|${Math.round(s.fpvHud.pitchDeg)}|${Math.round(
          s.fpvHud.fovDeg * 2,
        )}|${s.fpvHud.aspect.toFixed(2)}`
      : null,
  );

export default function FindSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const poseKey = usePoseKey();
  const anchor = usePlanStore((s) => s.anchor);
  const bins = usePlanStore((s) => s.profileBins);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);
  const sceneHoverKey = useFindStore((s) => s.sceneHoverKey);
  const findOpen = useFindStore((s) => s.open);
  const bodies = useFindStore((s) => s.bodies);
  const setBody = useFindStore((s) => s.setBody);
  const rangeDays = useFindStore((s) => s.rangeDays);
  const setRangeDays = useFindStore((s) => s.setRangeDays);

  // STICKY open: showing the sheet switches the scan on; collapsing it does NOT switch it
  // off — the projections keep living in the frame (the whole point of the 4th tab).
  useEffect(() => {
    if (open) useFindStore.getState().setOpen(true);
  }, [open]);
  // Page teardown only: stand the scan down + clear the mirror.
  useEffect(
    () => () => {
      useFindStore.getState().setOpen(false);
      useFindStore.getState().publishGhosts(null, []);
    },
    [],
  );

  const baseMs = live ? Date.now() : pinnedMs;
  const minuteKey = Math.floor(baseMs / 60_000);
  const lat = anchor?.latDeg ?? focusLat;
  const lon = anchor?.lonDeg ?? focusLon;
  const latKey = Math.round(lat * 20);
  const lonKey = Math.round(lon * 20);
  // Scan gate: the sticky find.open AND FPV (the boot-flight freeze lesson). `open` joins
  // the gate so the first-visit frame computes before the sticky effect commits.
  const active = (findOpen || open) && poseKey !== null;

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
    useFindStore.getState().publishGhosts({ latDeg: latKey / 20, lonDeg: lonKey / 20 }, ghosts);
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

  // Collapsed renders nothing — every hook above stays alive (the sticky-scan contract).
  if (!open) return null;

  return (
    <Sheet title="FIND IN FRAME" onClose={onClose}>
      {active ? (
        <>
          <div className="m-status-line">
            AT {localTimeStr(baseMs)} EVERY DAY · NEXT {rangeLabel} — RINGS IN THE SKY ARE THE
            FINDS · THEY STAY WHEN THIS SHEET CLOSES
          </div>
          <div className="m-toggles">
            {(["sun", "moon", "gc"] as const).map((b) => (
              <button
                key={b}
                type="button"
                className={`m-toggle ${bodies[b] ? "m-toggle--on" : ""}`}
                onClick={() => setBody(b, !bodies[b])}
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
    </Sheet>
  );
}
