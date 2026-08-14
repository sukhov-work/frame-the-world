import { useMemo, useState } from "react";
import { useCameraStore } from "../../store/camera";
import {
  maxCosDecInFrame,
  npfFullSec,
  npfSimpleSec,
  rule500Sec,
} from "../../lib/photo/npf";
import { focalFromVerticalFov } from "../../lib/decode/sensors";

/**
 * SPOT STARS (QoL-3 P5, PLANNING_QOL_PLAN §1.1 R14): the NPF exposure ceiling for the CURRENT
 * FPV frame — NPF primary, the 500 rule as the legacy ghost. The FTW beat: PhotoPills makes
 * the user type a "min declination in frame"; here the declination term comes FREE from the
 * frustum (lib/photo/npf.maxCosDecInFrame over the live pose — the fastest-moving sky point in
 * frame sets the worst case). Aperture + pixel pitch are the two honest inputs the pose cannot
 * know (MOBILE_PLAN §5: manual sensor input v1, camera DB later). FPV-only, like THIS FRAME.
 */

const fmtSec = (s: number) => (s >= 10 ? `${Math.round(s)} s` : `${s.toFixed(1)} s`);

export default function SpotStarsCard({ latDeg }: { latDeg: number }) {
  // Quantized pose key (the FrameCard idiom) — null hides the card outside FPV.
  const poseKey = useCameraStore((s) =>
    s.fpvHud
      ? `${Math.round(s.fpvHud.headingDeg)}|${Math.round(s.fpvHud.pitchDeg)}|${Math.round(
          s.fpvHud.fovDeg * 2,
        )}|${s.fpvHud.aspect.toFixed(2)}`
      : null,
  );
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

  return (
    <>
      <div className="pp-section">SPOT STARS · NPF</div>
      <div className="pp-npf">
        <div className="pp-find__inputs">
          <label className="pp-find__field">
            f/
            <input
              className="pp-in"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={apertureStr}
              onChange={(e) => setApertureStr(e.target.value)}
              aria-label="Aperture (f-number)"
            />
          </label>
          <label className="pp-find__field" title="Sensor pixel pitch (µm) — sensor width / pixel count">
            P µM
            <input
              className="pp-in"
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
              className={`pp-chip ${k === kk ? "pp-chip--on" : ""}`}
              onClick={() => setK(kk)}
              title={kk === 1 ? "Sharp stars" : kk === 3 ? "Relaxed (visible trailing)" : "Balanced"}
            >
              ×{kk}
            </button>
          ))}
        </div>
        <div className="pp-npf__big" title="Full NPF rule with the frame's worst-case declination">
          NPF {fmtSec(calc.npf)}
        </div>
        <div className="pp-status pp-status--inline">
          {Math.round(calc.focalMm)} MM · δ AUTO (cos {calc.cosDec.toFixed(2)}) · SIMPLE{" "}
          {fmtSec(calc.simple)} · 500: {fmtSec(calc.r500)}
        </div>
      </div>
    </>
  );
}
