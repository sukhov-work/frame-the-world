import Slider from "../ui/Slider";
import { useCameraStore } from "../../store/camera";
import { CONTROLS } from "../globe/tuning";
import "../../styles/camera-tilt.css";

/**
 * CameraTiltPanel — manual camera declination control (2026-07-10 owner ask). A single
 * board-04 instrument slider docked above the scene clock: 0° looks straight down, 90° looks
 * at the horizon. Dragging asks the globe orchestrator to GLIDE the camera to that pitch
 * (store/camera seam); the readout tracks the live pitch when the user steers the globe
 * directly. Double-click/Backspace = release any in-progress glide (free camera).
 */
export default function CameraTiltPanel() {
  const tiltDeg = useCameraStore((s) => s.tiltDeg);
  const targetTiltDeg = useCameraStore((s) => s.targetTiltDeg);
  const setTargetTilt = useCameraStore((s) => s.setTargetTilt);
  const clearTargetTilt = useCameraStore((s) => s.clearTargetTilt);

  // While a glide is pending, the knob shows the REQUEST (stable under the finger); otherwise
  // it mirrors the live camera pitch.
  const shown = targetTiltDeg ?? tiltDeg;

  return (
    <aside className="ct" aria-label="Camera tilt control">
      <Slider
        label="CAM TILT"
        formatted={`${Math.round(shown)}°`}
        value={Math.round(shown)}
        min={CONTROLS.tiltMinDeg}
        max={CONTROLS.tiltMaxDeg}
        step={1}
        onChange={setTargetTilt}
        onReset={clearTargetTilt}
      />
    </aside>
  );
}
