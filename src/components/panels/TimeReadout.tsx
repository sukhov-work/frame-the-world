/**
 * TimeReadout — the sleek scene-clock HUD (pre-Phase-4). The globe's lighting (terminator,
 * sun/moon bodies, shadows) is driven by `store/time` + `lib/ephemeris`; this readout shows the
 * SAME instant, so what you see is provably what the sky does at that time.
 *
 * Live mode follows the wall clock (1 s tick — the store is not written per-frame); the Phase-4
 * time scrubber will pin/scrub `timeMs` and this component already renders that state (PINNED).
 * Moon phase is recomputed once per minute (sub-ms; it drifts ~0.5°/hour).
 */

import { useEffect, useMemo, useState } from "react";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { bodyStatesAt } from "../../lib/ephemeris/bodies";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import "../../styles/time-readout.css";

const two = (n: number) => String(n).padStart(2, "0");

/** Phase-angle bucket → glyph + name. moonPhaseDeg: 0 new · 90 first quarter · 180 full · 270 last. */
function moonGlyph(phaseDeg: number): { glyph: string; name: string } {
  const names: Array<[string, string]> = [
    ["●", "NEW MOON"],
    ["☽", "WAXING CRESCENT"],
    ["◐", "FIRST QUARTER"],
    ["☽", "WAXING GIBBOUS"],
    ["○", "FULL MOON"],
    ["☾", "WANING GIBBOUS"],
    ["◑", "LAST QUARTER"],
    ["☾", "WANING CRESCENT"],
  ];
  // 45°-wide buckets centred on the 8 principal phases
  const idx = Math.round(((phaseDeg % 360) + 360) % 360 / 45) % 8;
  const [glyph, name] = names[idx];
  return { glyph, name };
}

export default function TimeReadout() {
  const drag = usePanelDrag("clock");
  const live = useTimeStore((s) => s.live);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const playRate = useTimeStore((s) => s.playRate);
  const [nowMs, setNowMs] = useState(() => sceneTimeMs());

  useEffect(() => {
    // Pinned-and-still: render the pinned instant once, no ticking. Live ticks at 1 s; playback
    // ticks at 250 ms so the readout rides the fluid scene time (the store is never written
    // per frame — sceneTimeMs derives the instant).
    if (!live && playRate === null) {
      setNowMs(pinnedMs);
      return;
    }
    setNowMs(sceneTimeMs());
    const id = setInterval(() => setNowMs(sceneTimeMs()), playRate === null ? 1000 : 250);
    return () => clearInterval(id);
  }, [live, pinnedMs, playRate]);

  // Moon phase drifts ~0.5°/hour — once a minute is plenty (and keeps the tick render cheap).
  const minuteKey = Math.floor(nowMs / 60_000);
  const moon = useMemo(() => {
    const s = bodyStatesAt(minuteKey * 60_000);
    return { ...moonGlyph(s.moonPhaseDeg), illum: Math.round(s.moonIllumination * 100) };
  }, [minuteKey]);

  const d = new Date(nowMs);
  const local = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  const utc = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

  // Playback states (owner 2026-07-14): real-speed playback reads ▶ PLAYING; compressed time
  // reads ▶▶ ×rate with the red fast-forward tint (the "not the real clock, and moving" alarm).
  const ff = playRate !== null && playRate > 1;
  const mode = live
    ? "LIVE"
    : playRate === null
      ? "PINNED"
      : ff
        ? `▶▶ ×${playRate}`
        : "▶ PLAYING";

  return (
    <div className="tr" style={drag.style} aria-label="Scene time — drives the globe's sun, moon and lighting">
      <DragGrip drag={drag} label="Move the scene clock" tipPos="left" />
      <div className="tr-main">
        <span
          className={`tr-dot${live ? "" : ff ? " tr-dot--ff" : " tr-dot--pinned"}`}
          title={live ? "Live — scene follows the real clock" : ff ? "Fast-forwarding" : "Pinned"}
          aria-hidden="true"
        />
        <span className="tr-clock">{local}</span>
        <span className={`tr-mode${ff ? " tr-mode--ff" : ""}`}>{mode}</span>
      </div>
      <div className="tr-sub">
        {date} · UTC {utc} · {moon.glyph} {moon.illum}% <span className="tr-phase">{moon.name}</span>
      </div>
    </div>
  );
}
