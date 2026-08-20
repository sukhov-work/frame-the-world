import { useMemo } from "react";
import { useTimeStore } from "../../store/time";
import {
  moonCalendar,
  nextSupermoons,
  type MoonCalEvent,
  type MoonCalKind,
} from "../../lib/ephemeris/moonCalendar";
import { lightPhaseAt } from "../../lib/ephemeris/twilight";
import { downloadIcs } from "../../lib/export/ics";

/**
 * MOON calendar (QoL-3 P6, PLANNING_QOL_PLAN §1.1 R10): the next weeks of quarter phases and
 * perigees/apogees as one dated list — supermoons starred, every row carrying the as-seen disc
 * size + distance (the R9 angular-diameter-everywhere thread), light-phase-dotted at the local
 * eye, jump-on-tap + per-row .ics (the TodayCard grammar). Self-computing off the pure libs
 * (the MwCard precedent — no planFeed mirror).
 */

const SCAN_DAYS = 45; // ~1.5 lunations of rows fits the card; NEXT SUPERMOON reaches further
const MAX_ROWS = 12;
const DAY_MS = 24 * 3600_000;

const KIND_LABEL: Record<MoonCalKind, string> = {
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

function icsForMoonEvent(e: MoonCalEvent, latDeg: number, lonDeg: number): void {
  const label = e.supermoon ? `SUPERMOON` : `MOON ${KIND_LABEL[e.kind]}`;
  downloadIcs(`ftw-moon-${e.kind}-${new Date(e.utcMs).toISOString().slice(0, 10)}`, [
    {
      startMs: e.utcMs,
      endMs: e.utcMs + 15 * 60_000,
      summary: `☾ ${label} · ${e.discArcmin.toFixed(1)}′ disc (Plux)`,
      description: `${label} at ${new Date(e.utcMs).toLocaleString()} — ${Math.round(
        e.distanceKm / 1000,
      )}k km, disc ${e.discArcmin.toFixed(1)}′, ${Math.round(e.illum * 100)}% lit.`,
      geo: { latDeg, lonDeg },
    },
  ]);
}

export default function MoonCalCard({ latDeg, lonDeg }: { latDeg: number; lonDeg: number }) {
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);
  const sceneMs = live ? Date.now() : pinnedMs;
  const dayKey = Math.floor(sceneMs / DAY_MS);
  const latKey = Math.round(latDeg * 20);
  const lonKey = Math.round(lonDeg * 20);

  const { rows, superChip } = useMemo(() => {
    const from = dayKey * DAY_MS;
    const events = moonCalendar(from, SCAN_DAYS).slice(0, MAX_ROWS);
    const lat = latKey / 20;
    const lon = lonKey / 20;
    const rows = events.map((e) => ({ e, light: lightPhaseAt(e.utcMs, lat, lon) }));
    // The next supermoon, when it sits beyond the listed rows — the R10 headline.
    const listedSuper = events.some((e) => e.supermoon);
    const superChip = listedSuper ? null : (nextSupermoons(from, 1)[0] ?? null);
    return { rows, superChip };
  }, [dayKey, latKey, lonKey]);

  return (
    <>
      <div className="pp-section">MOON · PHASES & DISTANCES</div>
      <div className="pp-day">
        {rows.map(({ e, light }) => (
          <div className="pp-day__row" key={`${e.kind}:${e.utcMs}`}>
            <button
              type="button"
              className="pp-day__jump"
              onClick={() => setTime(e.utcMs)}
              title="Jump scene time"
            >
              <i className={`pp-day__dot pp-day__dot--${light}`} />
              <span className="pp-day__time">{`${dateTag(e.utcMs)} ${hhmm(e.utcMs)}`}</span>
              <span className="pp-day__kind">
                {e.supermoon ? "★ SUPER" : KIND_LABEL[e.kind]}
              </span>
              <span
                className="pp-day__meta"
                title="Apparent disc diameter · geocentric distance"
              >
                {e.discArcmin.toFixed(1)}′
              </span>
            </button>
            <button
              type="button"
              className="pp-ics"
              onClick={() => icsForMoonEvent(e, latKey / 20, lonKey / 20)}
              title="Add to calendar (.ics)"
              aria-label={`Export moon ${KIND_LABEL[e.kind]} to calendar`}
            >
              ⤓
            </button>
          </div>
        ))}
        {superChip && (
          <button
            type="button"
            className="pp-chip pp-chip--cross"
            onClick={() => setTime(superChip.utcMs)}
            title={`Next supermoon — ${Math.round(superChip.distanceKm / 1000)}k km, ${superChip.discArcmin.toFixed(1)}′ disc`}
          >
            ★ SUPERMOON {dateTag(superChip.utcMs)}
          </button>
        )}
      </div>
    </>
  );
}
