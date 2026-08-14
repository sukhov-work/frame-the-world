import { useMemo } from "react";
import { useCameraStore } from "../../store/camera";
import { usePlanStore } from "../../store/plan";
import { useSkyStore } from "../../store/sky";
import { useTimeStore } from "../../store/time";
import {
  frameCrossings,
  nearestFrameCentre,
  type FrameCrossing,
  type FramePose,
  type FrameSampler,
} from "../../lib/ephemeris/frameFinder";
import { horizontal } from "../../lib/ephemeris/bodies";
import { targetAzAlt, targetShortName } from "../../lib/ephemeris/targets";
import { sampleBins } from "../../lib/geo/horizonProfile";
import { kindGlyph } from "../../lib/sky/searchIndex";
import { downloadIcs } from "../../lib/export/ics";

/**
 * THIS FRAME (QoL-2, PLANNING_QOL_PLAN §3.2) — FPV-only: when do the sun, the moon and the
 * tracked target cross the CURRENT frame rectangle (lib/ephemeris/frameFinder over the live
 * heading/pitch/fov/aspect pose), each window light-tagged + skyline-checked (the plan bins
 * mirror) + moon-annotated; every row pins scene time, ⤓ exports the window as a calendar
 * event. Beats PhotoPills' Find: their user types az/el numbers — here the frame IS the query.
 *
 * Pose subscription = the TimeScrubber quantized-key idiom: re-render only on ~1° moves /
 * aspect changes, then read the full pose with getState() — the HUD mirror writes at a low
 * cadence and must not re-render this card per frame. The scan itself memoises on the pose
 * key + a 5-minute scene-time quantum + the bins identity + the target id.
 */

const SCAN_DAYS = 1.5; // "today + tonight + tomorrow" — the card is a next-shot surface
const SCAN_STEP_MIN = 5; // the twilight engine idiom (≤ 1.25° body motion per step)
const FROM_QUANTUM_MS = 5 * 60_000;

const hhmm = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?([AP])M$/i, (_, p) => p.toLowerCase());

interface Row {
  key: string;
  glyph: string;
  label: string;
  win: FrameCrossing | null;
  /** The moon row reads its own illumination; other rows read interference (glare). */
  isMoon: boolean;
}

function rowMeta(r: Row): string {
  const w = r.win;
  if (!w) return "";
  const parts: string[] = [w.light.toUpperCase()];
  if (w.skyline !== "unknown") parts.push(w.skyline.toUpperCase());
  if (r.isMoon) parts.push(`${Math.round(w.moonIllum * 100)}%`);
  else if (w.moonGlare > 0.25) parts.push(`☾${Math.round(w.moonGlare * 100)}%`);
  return parts.join(" · ");
}

function icsForWindow(r: Row, latDeg: number, lonDeg: number): void {
  const w = r.win;
  if (!w) return;
  downloadIcs(`ftw-frame-${r.key}-${new Date(w.startMs).toISOString().slice(0, 10)}`, [
    {
      startMs: w.startMs,
      endMs: w.endMs,
      summary: `${r.glyph} ${r.label} crosses your frame · ${rowMeta(r)} (Frame the World)`,
      description: `In frame ${new Date(w.startMs).toLocaleString()} → ${new Date(
        w.endMs,
      ).toLocaleString()}; nearest frame centre ${new Date(w.peakMs).toLocaleTimeString()} (${w.peakSepDeg.toFixed(1)}° off).`,
      geo: { latDeg, lonDeg },
    },
  ]);
}

export default function FrameCard() {
  // Quantized pose key (≈1° / aspect hundredths) — null while FPV is inactive.
  const poseKey = useCameraStore((s) =>
    s.fpvHud
      ? `${Math.round(s.fpvHud.headingDeg)}|${Math.round(s.fpvHud.pitchDeg)}|${Math.round(
          s.fpvHud.fovDeg * 2,
        )}|${s.fpvHud.aspect.toFixed(2)}`
      : null,
  );
  const anchor = usePlanStore((s) => s.anchor);
  const bins = usePlanStore((s) => s.profileBins);
  const target = useSkyStore((s) => s.target);
  const targetVisible = useSkyStore((s) => s.visible);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);

  const sceneMs = live ? Date.now() : pinnedMs;
  const fromKey = Math.floor(sceneMs / FROM_QUANTUM_MS);
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
    const from = fromKey * FROM_QUANTUM_MS;
    const opts = { profileFn, stepMin: SCAN_STEP_MIN, maxWindows: 1 } as const;
    const sunS: FrameSampler = (t) => horizontal("sun", t, pose.latDeg, pose.lonDeg);
    const moonS: FrameSampler = (t) => horizontal("moon", t, pose.latDeg, pose.lonDeg);
    const tgtS: FrameSampler = (t) => targetAzAlt(target, t, pose.latDeg, pose.lonDeg);
    const rows: Row[] = [
      { key: "sun", glyph: "☀", label: "SUN", isMoon: false, win: frameCrossings(sunS, pose, from, SCAN_DAYS, opts)[0] ?? null },
      { key: "moon", glyph: "☾", label: "MOON", isMoon: true, win: frameCrossings(moonS, pose, from, SCAN_DAYS, opts)[0] ?? null },
    ];
    let centre: { utcMs: number; sepDeg: number } | null = null;
    // A tracked sun/moon already has its own row above — no duplicate target row; the centre
    // chip ("nearest frame centre") still computes for ANY tracked target.
    const targetIsBodyRow = target.id === "body:sun" || target.id === "body:moon";
    if (targetVisible) {
      if (!targetIsBodyRow)
        rows.push({
          key: "target",
          glyph: kindGlyph(target.kind),
          label: targetShortName(target).toUpperCase(),
          isMoon: false,
          win: frameCrossings(tgtS, pose, from, SCAN_DAYS, opts)[0] ?? null,
        });
      centre = nearestFrameCentre(tgtS, pose, from, SCAN_DAYS, { stepMin: SCAN_STEP_MIN });
    }
    return { rows, centre, from, latDeg: pose.latDeg, lonDeg: pose.lonDeg };
    // eslint-disable-next-line react-hooks/exhaustive-deps — pose read via getState on poseKey change
  }, [poseKey, hasEye, anchor, bins, target, targetVisible, fromKey]);

  if (!scan) return null;
  const { rows, centre, from, latDeg, lonDeg } = scan;

  return (
    <>
      <div className="pp-section">THIS FRAME · NEXT 36 H</div>
      <div className="pp-fr">
        {rows.map((r) => (
          <div className="pp-day__row" key={r.key}>
            {r.win ? (
              <button
                type="button"
                className="pp-day__jump"
                onClick={() => setTime(r.win!.startMs <= from ? r.win!.peakMs : r.win!.startMs)}
                title="Jump scene time"
              >
                <span className="pp-fr__glyph">{r.glyph}</span>
                <span className="pp-day__time">
                  {r.win.startMs <= from ? `NOW → ${hhmm(r.win.endMs)}` : `${hhmm(r.win.startMs)}–${hhmm(r.win.endMs)}`}
                </span>
                <span className="pp-day__meta">{rowMeta(r)}</span>
              </button>
            ) : (
              <div className="pp-fr__none">
                <span className="pp-fr__glyph">{r.glyph}</span>
                <span className="pp-day__meta">NOT IN FRAME · 36 H</span>
              </div>
            )}
            {r.win && (
              <button
                type="button"
                className="pp-ics"
                onClick={() => icsForWindow(r, latDeg, lonDeg)}
                title="Add to calendar (.ics)"
                aria-label={`Export ${r.label} frame window to calendar`}
              >
                ⤓
              </button>
            )}
          </div>
        ))}
        {centre && (
          <button
            type="button"
            className="pp-chip pp-chip--cross"
            onClick={() => setTime(centre.utcMs)}
            title="When the tracked target passes nearest the frame centre"
          >
            ◎ CENTRE {hhmm(centre.utcMs)}
            {centre.sepDeg > 1.5 ? ` · ${Math.round(centre.sepDeg)}° OFF` : ""}
          </button>
        )}
      </div>
    </>
  );
}
