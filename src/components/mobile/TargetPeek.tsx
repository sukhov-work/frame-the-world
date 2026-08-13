/**
 * TargetPeek (M1) — the tracked-target peek row above the time dock (MOBILE_PLAN §3):
 * glyph · name · az/alt · CLEAR/BEHIND badge; tapping opens the TARGET sheet. Same per-minute
 * az/alt discipline as the TargetPanel; the verdict badge is id-matched against the plan
 * mirror so a just-swapped target never wears the old verdict.
 */

import { useEffect, useMemo, useState } from "react";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { useCameraStore } from "../../store/camera";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { targetAzAlt, targetShortName } from "../../lib/ephemeris/targets";
import { kindGlyph } from "../../lib/sky/searchIndex";
import { cardinal } from "../../lib/format/readout";
import "../../styles/mobile/chrome.css";

export default function TargetPeek({ onOpen }: { onOpen: () => void }) {
  const target = useSkyStore((s) => s.target);
  const planTarget = usePlanStore((s) => s.target);
  const anchor = usePlanStore((s) => s.anchor);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  const live = useTimeStore((s) => s.live);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const playRate = useTimeStore((s) => s.playRate);
  const latDeg = anchor?.latDeg ?? focusLat;
  const lonDeg = anchor?.lonDeg ?? focusLon;

  const [nowMs, setNowMs] = useState(() => sceneTimeMs());
  useEffect(() => {
    if (!live && playRate === null) {
      setNowMs(pinnedMs);
      return;
    }
    setNowMs(sceneTimeMs());
    const id = setInterval(() => setNowMs(sceneTimeMs()), playRate === null ? 1000 : 250);
    return () => clearInterval(id);
  }, [live, pinnedMs, playRate]);

  const minuteKey = Math.floor(nowMs / 60_000);
  const now = useMemo(
    () => targetAzAlt(target, minuteKey * 60_000, latDeg, lonDeg),
    [minuteKey, latDeg, lonDeg, target],
  );
  const upNow = now.altDeg > 0;

  return (
    <button type="button" className="m-peek" onClick={onOpen} aria-label={`Tracked target: ${target.name}`}>
      <span className="m-peek__glyph" aria-hidden="true">
        {kindGlyph(target.kind)}
      </span>
      <span className="m-peek__name">{targetShortName(target).toUpperCase()}</span>
      {upNow && planTarget?.id === target.id ? (
        <span className={`m-badge ${planTarget.blockedNow ? "m-badge--blocked" : "m-badge--clear"}`}>
          {planTarget.blockedNow ? "BEHIND" : "CLEAR"}
        </span>
      ) : (
        !upNow && <span className="m-badge">BELOW</span>
      )}
      <span className="m-peek__pos">
        {now.altDeg.toFixed(0)}° · {Math.round(now.azDeg)}° {cardinal(now.azDeg)} ▲
      </span>
    </button>
  );
}
