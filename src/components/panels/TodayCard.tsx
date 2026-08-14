import { useMemo } from "react";
import { useTimeStore } from "../../store/time";
import { dayEvents, moonPhaseEvents, type PlanEvent, type PlanEventKind } from "../../lib/ephemeris/planner";
import { lightPhaseAt, sunAltDeg } from "../../lib/ephemeris/twilight";
import { formatSigned } from "../../lib/format/readout";
import { downloadIcs } from "../../lib/export/ics";
import { GOLDEN } from "../globe/tuning";

/**
 * TODAY — the daily surface (QoL-2, PLANNING_QOL_PLAN §3.2 / R5): the anchor's midnight→midnight
 * cross-body chronology as ONE ordered list, each row light-phase-coded (the scrubber band
 * colours), moonrise/set rows carrying the "sun elevation at that moment" quality signal
 * (PhotoPills R5 — a moonrise in daylight photographs pale), plus the next full/new-moon dated
 * chips (R7). Every row pins scene time; ⤓ exports a calendar event (R15, client .ics).
 *
 * Self-computing (the MwCard/TargetPanel precedent — dodges the planFeed panel-open mirror trap):
 * memoised per solar day + quantized anchor, so scrubbing minutes never re-scans.
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

const DAY_MS = 24 * 3600_000;

const hhmm = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?([AP])M$/i, (_, p) => p.toLowerCase());

function dateTag(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** 15-minute calendar block ending question-free: DTSTART at the event, summary carries it. */
function icsForEvent(e: PlanEvent, latDeg: number, lonDeg: number, light: string): void {
  downloadIcs(`ftw-${e.kind}-${new Date(e.utcMs).toISOString().slice(0, 10)}`, [
    {
      startMs: e.utcMs,
      endMs: e.utcMs + 15 * 60_000,
      summary: `${CHIP_LABEL[e.kind]} · ${light.toUpperCase()} (Frame the World)`,
      description: `${CHIP_LABEL[e.kind]} at ${new Date(e.utcMs).toLocaleString()} — az ${Math.round(e.azDeg)}°, alt ${formatSigned(e.altDeg)}.`,
      geo: { latDeg, lonDeg },
    },
  ]);
}

export default function TodayCard({ latDeg, lonDeg }: { latDeg: number; lonDeg: number }) {
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
    const anchorMs = dayKey * DAY_MS + DAY_MS / 2; // solar-day selection is window-internal
    const day = dayEvents(anchorMs, obs, GOLDEN);
    const phases = moonPhaseEvents(anchorMs, obs);
    return [...day, ...phases].map((e) => ({
      e,
      light: lightPhaseAt(e.utcMs, lat, lon),
      // R5 quality signal: the sun's elevation at moonrise/set — daylight moonrises look pale.
      sunAtMoon:
        e.kind === "moonrise" || e.kind === "moonset" ? sunAltDeg(e.utcMs, lat, lon) : null,
    }));
  }, [dayKey, latKey, lonKey]);

  return (
    <>
      <div className="pp-section">TODAY · MIDNIGHT → MIDNIGHT</div>
      <div className="pp-day">
        {rows.map(({ e, light, sunAtMoon }) => (
          <div className="pp-day__row" key={`${e.kind}:${e.utcMs}`}>
            <button
              type="button"
              className="pp-day__jump"
              onClick={() => setTime(e.utcMs)}
              title="Jump scene time"
            >
              <i className={`pp-day__dot pp-day__dot--${light}`} />
              <span className="pp-day__time">
                {DATED_KINDS.has(e.kind) ? `${dateTag(e.utcMs)} ${hhmm(e.utcMs)}` : hhmm(e.utcMs)}
              </span>
              <span className="pp-day__kind">{CHIP_LABEL[e.kind]}</span>
              {sunAtMoon != null && (
                <span
                  className="pp-day__meta"
                  title="Sun elevation at that moment — a daylight moon photographs pale"
                >
                  ☀{formatSigned(Math.round(sunAtMoon))}
                </span>
              )}
            </button>
            <button
              type="button"
              className="pp-ics"
              onClick={() => icsForEvent(e, latKey / 20, lonKey / 20, light)}
              title="Add to calendar (.ics)"
              aria-label={`Export ${CHIP_LABEL[e.kind]} to calendar`}
            >
              ⤓
            </button>
          </div>
        ))}
        {rows.length === 0 && <div className="pp-status">NO EVENTS FOR THIS DAY</div>}
      </div>
    </>
  );
}
