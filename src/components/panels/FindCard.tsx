import { useMemo, useState } from "react";
import { useCameraStore } from "../../store/camera";
import { usePlanStore } from "../../store/plan";
import { useSkyStore } from "../../store/sky";
import { useTimeStore } from "../../store/time";
import { azElHits, type AzElHit, type FrameSampler } from "../../lib/ephemeris/frameFinder";
import { horizontal } from "../../lib/ephemeris/bodies";
import { targetAzAlt, targetShortName } from "../../lib/ephemeris/targets";
import { sampleBins } from "../../lib/geo/horizonProfile";
import { downloadIcs } from "../../lib/export/ics";
import type { LightPhase } from "../../lib/ephemeris/twilight";

/**
 * FIND (QoL-3 P4 FULL, PLANNING_QOL_PLAN §1.1 R8): "when does the body stand at az ± 3° /
 * el ± 0.5°?" over a date range — the PhotoPills killer tool with the FTW beat: results are
 * SKYLINE-verdicted through the real local horizon (plan bins mirror) and any tracked target
 * is findable, not just the sun/moon. Az/el seed from the live FPV frame (⌖); range presets
 * are the R8 craft constants; rows sort by date or by photographic light. Engine:
 * lib/ephemeris/frameFinder.azElHits — per-day azimuth root-find, ~1 ms/day, so even the 1 Y
 * preset computes in one memo pass.
 */

const RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
] as const;

const MAX_ROWS = 12;
const DAY_MS = 24 * 3600_000;

/** Photographic light preference for the LIGHT sort (R8 "sortable"). */
const LIGHT_RANK: Record<LightPhase, number> = {
  golden: 0,
  blue: 1,
  night: 2,
  astro: 3,
  nautical: 4,
  day: 5,
};

const hhmm = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?([AP])M$/i, (_, p) => p.toLowerCase());

const dateTag = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

function icsForHit(h: AzElHit, glyph: string, azDeg: number, elDeg: number, latDeg: number, lonDeg: number): void {
  downloadIcs(`ftw-find-${new Date(h.utcMs).toISOString().slice(0, 10)}`, [
    {
      startMs: h.startMs,
      endMs: Math.max(h.endMs, h.startMs + 5 * 60_000),
      summary: `${glyph} at az ${Math.round(azDeg)}° / el ${Math.round(elDeg)}° · ${h.light.toUpperCase()} (Frame the World)`,
      description: `Standing ${new Date(h.startMs).toLocaleString()} → ${new Date(h.endMs).toLocaleString()}; skyline ${h.skyline}.`,
      geo: { latDeg, lonDeg },
    },
  ]);
}

export default function FindCard({ latDeg, lonDeg }: { latDeg: number; lonDeg: number }) {
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const live = useTimeStore((s) => s.live);
  const setTime = useTimeStore((s) => s.setTime);
  const bins = usePlanStore((s) => s.profileBins);
  const target = useSkyStore((s) => s.target);
  const targetVisible = useSkyStore((s) => s.visible);
  const fpvHud = useCameraStore((s) => s.fpvHud);

  const [azStr, setAzStr] = useState("");
  const [elStr, setElStr] = useState("");
  const [body, setBody] = useState<"sun" | "moon" | "target">("sun");
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [sortBy, setSortBy] = useState<"date" | "light">("date");

  const sceneMs = live ? Date.now() : pinnedMs;
  const dayKey = Math.floor(sceneMs / DAY_MS);
  const latKey = Math.round(latDeg * 20);
  const lonKey = Math.round(lonDeg * 20);

  // Az/el resolve: typed value wins; empty fields follow the live frame (FPV) or a south stance.
  const azDeg = azStr === "" ? (fpvHud ? Math.round(fpvHud.headingDeg) : 180) : Number(azStr);
  const elDeg = elStr === "" ? (fpvHud ? Math.round(fpvHud.pitchDeg) : 20) : Number(elStr);
  const targetIsBody = target.id === "body:sun" || target.id === "body:moon";
  const showTargetChip = targetVisible && !targetIsBody;
  const effBody = body === "target" && !showTargetChip ? "sun" : body;

  const hits = useMemo(() => {
    if (!Number.isFinite(azDeg) || !Number.isFinite(elDeg) || elDeg < -1 || elDeg > 89) return [];
    const lat = latKey / 20;
    const lon = lonKey / 20;
    const sampler: FrameSampler =
      effBody === "target"
        ? (t) => targetAzAlt(target, t, lat, lon)
        : (t) => horizontal(effBody, t, lat, lon);
    const profileFn = bins ? (az: number) => sampleBins(bins, az) : null;
    const q = { azDeg: ((azDeg % 360) + 360) % 360, elDeg, azTolDeg: 3, elTolDeg: 0.5 };
    return azElHits(sampler, q, dayKey * DAY_MS, rangeDays, { latDeg: lat, lonDeg: lon }, profileFn);
  }, [azDeg, elDeg, effBody, target, rangeDays, latKey, lonKey, dayKey, bins]);

  const shown = useMemo(() => {
    const s = [...hits];
    if (sortBy === "light")
      s.sort((a, b) => LIGHT_RANK[a.light] - LIGHT_RANK[b.light] || a.utcMs - b.utcMs);
    return s.slice(0, MAX_ROWS);
  }, [hits, sortBy]);

  const glyph = effBody === "sun" ? "☀" : effBody === "moon" ? "☾" : "◎";

  return (
    <>
      <div className="pp-section">FIND · AZ ±3° / EL ±0.5°</div>
      <div className="pp-find">
        <div className="pp-find__inputs">
          <label className="pp-find__field">
            AZ°
            <input
              className="pp-in"
              type="number"
              inputMode="decimal"
              placeholder={String(azDeg)}
              value={azStr}
              onChange={(e) => setAzStr(e.target.value)}
              aria-label="Target azimuth (degrees)"
            />
          </label>
          <label className="pp-find__field">
            EL°
            <input
              className="pp-in"
              type="number"
              inputMode="decimal"
              placeholder={String(elDeg)}
              value={elStr}
              onChange={(e) => setElStr(e.target.value)}
              aria-label="Target elevation (degrees)"
            />
          </label>
          {fpvHud && (
            <button
              type="button"
              className="pp-chip"
              onClick={() => {
                setAzStr(String(Math.round(fpvHud.headingDeg)));
                setElStr(String(Math.round(fpvHud.pitchDeg)));
              }}
              title="Seed az/el from the current frame centre"
            >
              ⌖
            </button>
          )}
        </div>
        <div className="pp-find__chips" role="group" aria-label="Body">
          <button type="button" className={`pp-chip ${effBody === "sun" ? "pp-chip--on" : ""}`} onClick={() => setBody("sun")}>☀</button>
          <button type="button" className={`pp-chip ${effBody === "moon" ? "pp-chip--on" : ""}`} onClick={() => setBody("moon")}>☾</button>
          {showTargetChip && (
            <button
              type="button"
              className={`pp-chip ${effBody === "target" ? "pp-chip--on" : ""}`}
              onClick={() => setBody("target")}
              title={targetShortName(target)}
            >
              ◎
            </button>
          )}
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
        {shown.map((h) => (
          <div className="pp-day__row" key={h.utcMs}>
            <button
              type="button"
              className="pp-day__jump"
              onClick={() => setTime(h.utcMs)}
              title={`In the box ${hhmm(h.startMs)}–${hhmm(h.endMs)}`}
            >
              <i className={`pp-day__dot pp-day__dot--${h.light}`} />
              <span className="pp-day__time">{`${dateTag(h.utcMs)} ${hhmm(h.utcMs)}`}</span>
              <span className="pp-day__kind">
                {h.skyline === "blocked" ? "SKYLINE ✕" : h.skyline === "clear" ? "CLEAR" : "—"}
              </span>
              {h.moonGlare > 0.25 && effBody !== "moon" && (
                <span className="pp-day__meta" title="Moonlight interference at that moment">
                  ☾{Math.round(h.moonGlare * 100)}%
                </span>
              )}
              {effBody === "moon" && (
                <span className="pp-day__meta">{Math.round(h.moonIllum * 100)}%</span>
              )}
            </button>
            <button
              type="button"
              className="pp-ics"
              onClick={() => icsForHit(h, glyph, azDeg, elDeg, latKey / 20, lonKey / 20)}
              title="Add to calendar (.ics)"
              aria-label="Export standing to calendar"
            >
              ⤓
            </button>
          </div>
        ))}
        <div className="pp-find__foot">
          <span className="pp-status pp-status--inline">
            {hits.length === 0
              ? "NO STANDINGS IN RANGE"
              : `${hits.length} STANDING${hits.length === 1 ? "" : "S"}${hits.length > MAX_ROWS ? ` · FIRST ${MAX_ROWS}` : ""}`}
          </span>
          {hits.length > 1 && (
            <button
              type="button"
              className="pp-chip"
              onClick={() => setSortBy(sortBy === "date" ? "light" : "date")}
              title="Toggle sort: chronological ↔ best photographic light first"
            >
              {sortBy === "date" ? "SORT: DATE" : "SORT: LIGHT"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
