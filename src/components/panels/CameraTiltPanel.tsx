import Slider from "../ui/Slider";
import {
  altMToSlider,
  sliderToAltM,
  useCameraStore,
  wrapHeadingDeg,
} from "../../store/camera";
import { CONTROLS } from "../globe/tuning";
import "../../styles/camera-tilt.css";

/**
 * Camera panel — manual global camera controls (2026-07-10 owner asks). Board-04 instrument
 * sliders docked above the scene clock:
 *  • CAM TILT — declination: 0° looks straight down, 88° at the horizon.
 *  • ROTATE — compass heading of the view (0° N, 90° E); orbits the view focus about its local
 *    up, preserving the current tilt exactly.
 *  • ZOOM — camera altitude, log-mapped (the wheel/pinch alternative).
 * Dragging asks the globe orchestrator to GLIDE the camera (store/camera seam); the readouts
 * track the live pose when the user steers the globe directly. Double-click/Backspace releases
 * an in-progress glide (free camera).
 */

function formatAltM(altM: number): string {
  if (altM < 1_000) return `${Math.round(altM)} m`;
  if (altM < 100_000) return `${(altM / 1000).toFixed(1)} km`;
  return `${Math.round(altM / 1000)} km`;
}

export default function CameraTiltPanel() {
  const s = useCameraStore();

  // While a glide is pending, each knob shows the REQUEST (stable under the finger); otherwise
  // it mirrors the live camera pose.
  const shownTilt = s.targetTiltDeg ?? s.tiltDeg;
  const shownHeading = wrapHeadingDeg(s.targetHeadingDeg ?? s.headingDeg);
  const shownAltM = s.targetZoomAltM ?? s.zoomAltM;
  const zoomSlider = altMToSlider(shownAltM, CONTROLS.zoomMinAltM, CONTROLS.zoomMaxAltM);

  return (
    <aside className="ct" aria-label="Camera controls">
      <Slider
        label="CAM TILT"
        formatted={`${Math.round(shownTilt)}°`}
        value={Math.round(shownTilt)}
        min={CONTROLS.tiltMinDeg}
        max={CONTROLS.tiltMaxDeg}
        step={1}
        onChange={s.setTargetTilt}
        onReset={s.clearTargetTilt}
      />
      <Slider
        label="ROTATE"
        formatted={`${Math.round(shownHeading)}°`}
        value={Math.round(shownHeading)}
        min={0}
        max={360}
        step={1}
        onChange={(v) => s.setTargetHeading(wrapHeadingDeg(v))}
        onReset={s.clearTargetHeading}
      />
      <Slider
        label="ZOOM"
        formatted={formatAltM(shownAltM)}
        // photographic convention: right = zoom IN (lower altitude) — hence the inversion
        value={Number(((1 - zoomSlider) * 100).toFixed(1))}
        min={0}
        max={100}
        step={0.5}
        onChange={(v) =>
          s.setTargetZoom(sliderToAltM(1 - v / 100, CONTROLS.zoomMinAltM, CONTROLS.zoomMaxAltM))
        }
        onReset={s.clearTargetZoom}
      />
    </aside>
  );
}
