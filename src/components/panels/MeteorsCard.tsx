import { useMemo } from "react";
import { useTimeStore } from "../../store/time";
import { useSkyStore } from "../../store/sky";
import { showerTarget } from "../../lib/ephemeris/targets";
import { upcomingShowerPeaks, type ShowerPeak } from "../../lib/ephemeris/showers";

/**
 * METEORS card (Phase 8c P7) — the upcoming shower maxima with their moon-scored best nights
 * (showers.ts conventions: rate = ZHR×sin(radiant alt), score = rate × (1 − moon)). A row jumps
 * scene time to the best night's peak sample AND tracks the radiant (the FindPanel jump idiom) —
 * the radiant is where the meteors stream FROM; frame it off-centre and the trails cross the
 * shot. Self-computed off the pure lib per the MwCard precedent; memoised per day/eye so
 * scrubbing minutes never re-scans (~10 showers × 3 nights ≈ 200 ms, once per key).
 */

const DAY_MS = 24 * 3600_000;
const HORIZON_DAYS = 120;
const MAX_ROWS = 8;

/** Compact clock, the MwCard idiom: "2:10a". */
const hhmm = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?([AP])M$/i, (_, p) => p.toLowerCase());

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

export default function MeteorsCard({ latDeg, lonDeg }: { latDeg: number; lonDeg: number }) {
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);
  const sceneMs = live ? Date.now() : pinnedMs;
  const dayKey = Math.floor(sceneMs / DAY_MS);
  const latKey = Math.round(latDeg * 20);
  const lonKey = Math.round(lonDeg * 20);
  const peaks = useMemo(
    () =>
      upcomingShowerPeaks(
        dayKey * DAY_MS,
        { latDeg: latKey / 20, lonDeg: lonKey / 20, groundAltM: 0, eyeAboveGroundM: 1.6 },
        HORIZON_DAYS,
      ).slice(0, MAX_ROWS),
    [dayKey, latKey, lonKey],
  );
  const maxScore = Math.max(1, ...peaks.map((p) => p.night?.score ?? 0));

  const jump = (p: ShowerPeak) => {
    setTime(p.night?.peak?.utcMs ?? p.peakMs);
    const sky = useSkyStore.getState();
    sky.setTarget(showerTarget(p.row));
    if (!sky.visible) sky.setVisible(true);
  };

  if (peaks.length === 0) return null;
  return (
    <>
      <div className="pp-section">METEORS · PEAK NIGHTS · NEXT {HORIZON_DAYS}D</div>
      <div className="pp-mw">
        {peaks.map((p) => (
          <button
            key={p.row.code}
            type="button"
            className="pp-mw__night"
            onClick={() => jump(p)}
            title={`${p.row.name} — ${p.row.parent ? `parent ${p.row.parent}` : "parent unknown"}${
              p.row.note ? ` · ${p.row.note}` : ""
            } · jump to the best night and track the radiant`}
          >
            <span className="pp-mw__date">{dateLabel(p.peakMs)}</span>
            {p.night?.peak ? (
              <>
                <span className="pp-mw__bar">
                  <i style={{ width: `${Math.round((p.night.score / maxScore) * 100)}%` }} />
                </span>
                <span className="pp-mw__meta">
                  {p.row.code} · ≈{Math.round(p.night.peak.rate)}/h · {hhmm(p.night.peak.utcMs)}
                  {p.night.moonInterference > 0 &&
                    ` · ☾${Math.round(p.night.moonInterference * 100)}%`}
                </span>
              </>
            ) : (
              <span className="pp-mw__meta pp-mw__meta--none">
                {p.row.code} · {p.row.zhr == null ? "OUTBURST WATCH" : "RADIANT DOWN IN DARK"}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
