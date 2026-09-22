/**
 * ArCameraOverlay (owner order 2026-09-19; the small-screen layout 2026-09-22) — the phone's live
 * REAR CAMERA over the 3D view "in the same focal number", in two modes (`store/camera.arCam`):
 *
 *  · `view` (the CAM chip above AR) — just the feed, scaled and levelled to the virtual camera, so
 *    the planned frame can be read against the real street. The whole 3D frame shows THROUGH it
 *    (a CSS opacity — the canvas is opaque by design and stays so; no transparent sort, no
 *    renderer change), and the 3D ↔ CAM slider decides who leads.
 *  · `calibrate` (a LONG PRESS on AR) — the same picture, plus the screen becomes a calibration
 *    pad: DRAG moves the virtual view (yaw / pitch), PINCH sizes the camera picture (its field of
 *    view). CONFIRM stores it (`ftw:ar-calib:v1`) until the next calibration replaces it; RESET
 *    forgets it; CANCEL leaves everything as it was. (Roll is NOT calibrated — owner 2026-09-22.)
 *
 * THE SCREEN (owner order 2026-09-22, item 1 — "we have too little screen space and must use it
 * efficiently"): the top strip is ONE row — the title with the yaw / pitch / lens readout beside
 * it (no memo text; the mini-map folds to its puck while calibrating so the row has the width);
 * CONFIRM / RESET / CANCEL are three ROUND cells in a column on the LEFT, just above the AIM
 * stick, where a thumb reaches them (a row at the top was out of reach and ate the strip); the
 * 3D ↔ CAM slider stands VERTICAL just above the CAM chip on the right rail. Every seat is fixed
 * geometry off the same tokens the rail publishes (`--m-altcol-bottom`, `--m-altcol-h`), so the
 * column's own box never grows (the A1-2 contract).
 *
 * THE SHARED SCALE (`lib/sensors/arCalibration.videoLayout`): two pinhole pictures agree at every
 * pixel exactly when they share a focal length IN PIXELS, so the `<video>` is drawn at the size
 * that makes its pixel focal the 3D view's — magnified past the screen for a long virtual lens,
 * inset for a wide one — and follows a pinch-FOV per frame. It is counter-rotated by the phone's
 * SENSED roll: the FPV camera has no roll seam (DECISIONS 2026-09-07h), so the picture is levelled
 * instead of the world tilted.
 *
 * PER FRAME, NOT PER RENDER: the size and the rotation are written straight onto the element in a
 * rAF that reads `lib/sensors/arFrame` (the engine's 60 fps channel). React renders only on a mode
 * / draft / opacity change.
 *
 * THE STREAM: `getUserMedia` at 720p / 30 fps ideals (memory beside a WebGL scene on a 2 GB iOS
 * page budget), `<video playsinline muted autoplay>`, the MAIN rear camera (`lib/sensors/arCamera`),
 * tracks STOPPED on hide / exit / unmount (iOS interrupts a hidden capture anyway) and re-acquired
 * on return. Mounted by `FpvControls` — only while FPV is on; AR off takes the overlay with it.
 * A `mobile/**` file: stores + `lib/**` + `globe/tuning` only (`mobileFence`).
 */

import { useEffect, useRef, useState } from "react";
import { useCameraStore } from "../../store/camera";
import { FPV } from "../globe/tuning";
import { arFrame } from "../../lib/sensors/arFrame";
import { AR_CAM_COPY, cameraConstraints, classifyCameraError, pickMainBackCamera, type CameraFailure } from "../../lib/sensors/arCamera";
import { camFocalEqMm, dragToAimDelta, focalPx, isCalibrated, pinchSpread, videoLayout } from "../../lib/sensors/arCalibration";
import { formatSigned } from "../../lib/format/readout";
import "../../styles/mobile/ar-camera.css";

/** The round cells carry a glyph over a tiny label (the `.m-act--icon` idiom — 💾 SAVE's). */
export const AR_CAL_COPY = Object.freeze({
  title: "CALIBRATE AR",
  confirm: "CONFIRM",
  reset: "RESET",
  cancel: "CANCEL",
});

const IDEAL = { widthPx: FPV.arCamIdealWidthPx, heightPx: FPV.arCamIdealHeightPx, fps: FPV.arCamIdealFps };

/** Acquire the main rear camera; re-acquire by device id when Android handed back another lens. */
async function openRearCamera(): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  let stream = await md.getUserMedia(cameraConstraints(IDEAL));
  try {
    const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
    const better = pickMainBackCamera(await md.enumerateDevices(), current);
    if (better) {
      const next = await md.getUserMedia(cameraConstraints(IDEAL, better));
      stream.getTracks().forEach((t) => t.stop());
      stream = next;
    }
  } catch {
    /* the first stream is a rear camera already — keep it */
  }
  return stream;
}

function useRearCamera(on: boolean, videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let disposed = false;
    const stop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
    const start = () => {
      const env = { secure: window.isSecureContext, hasApi: !!navigator.mediaDevices?.getUserMedia };
      if (!env.secure || !env.hasApi) {
        setFailure(classifyCameraError(null, env));
        return;
      }
      openRearCamera()
        .then((s) => {
          if (disposed || document.visibilityState !== "visible") {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = s;
          setFailure(null);
          const v = videoRef.current;
          if (!v) return;
          v.srcObject = s;
          void v.play().catch(() => {
            /* muted + playsinline autoplays; a refusal leaves the first frame — survivable */
          });
        })
        .catch((e: unknown) => {
          if (!disposed) setFailure(classifyCameraError(e, env));
        });
    };
    // A hidden page's capture is interrupted by the OS anyway (and must not hold the camera).
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!stream) start();
      } else stop();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  return failure;
}

/** The calibration pad: pointer deltas → `stepArCalDraft` (the math is `lib/sensors/arCalibration`). */
function CalibrationPad() {
  const step = useCameraStore((s) => s.stepArCalDraft);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pts.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    if (pts.current.size === 1) {
      const f = focalPx(window.innerHeight, arFrame.vFovDeg);
      step(dragToAimDelta(next.x - prev.x, next.y - prev.y, f, arFrame.viewPitchDeg));
    } else if (pts.current.size === 2) {
      const [otherId] = [...pts.current.keys()].filter((id) => id !== e.pointerId);
      const other = pts.current.get(otherId)!;
      const spread = pinchSpread(other, prev, other, next);
      if (spread !== null) step({ spread });
    }
    pts.current.set(e.pointerId, next);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pts.current.delete(e.pointerId);
  };
  return (
    <div
      className="m-arcal__pad"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      aria-label="Calibration pad — drag the 3D view onto the camera, pinch to size the camera picture"
    >
      <span className="m-arcal__cross" aria-hidden="true" />
    </div>
  );
}

export default function ArCameraOverlay() {
  const mode = useCameraStore((s) => s.arCam);
  const arOn = useCameraStore((s) => s.arLook);
  const stored = useCameraStore((s) => s.arCalibration);
  const draft = useCameraStore((s) => s.arCalDraft);
  const [opacity, setOpacity] = useState<number>(FPV.arCamOpacity);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const on = mode !== "off" && arOn;
  const failure = useRearCamera(on, videoRef);

  // AR off (or FPV left — this unmounts) takes the overlay with it: the feed without the sensors
  // is a picture that does not follow the phone.
  useEffect(() => {
    if (!arOn && mode !== "off") useCameraStore.getState().setArCam("off");
  }, [arOn, mode]);
  useEffect(() => () => useCameraStore.getState().setArCam("off"), []);

  // The per-frame layout: size = the shared pixel focal, rotation = the phone's sensed roll.
  // Written straight onto the element — no React render at 60 fps.
  const cal = draft ?? stored;
  const calRef = useRef(cal);
  calRef.current = cal;
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v) return;
      const c = calRef.current;
      const l = videoLayout({
        videoW: v.videoWidth,
        videoH: v.videoHeight,
        viewH: window.innerHeight,
        vFovDeg: arFrame.vFovDeg,
        camLongFovDeg: c.camLongFovDeg,
      });
      if (!l) return;
      v.style.width = `${l.widthPx.toFixed(1)}px`;
      v.style.height = `${l.heightPx.toFixed(1)}px`;
      v.style.transform = `translate(-50%, -50%) rotate(${arFrame.rollDeg.toFixed(2)}deg)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  if (!on) return null;
  const calibrating = mode === "calibrate" && draft !== null;
  const cam = useCameraStore.getState();
  return (
    <>
      <div className="m-arcam" aria-hidden="true">
        <video ref={videoRef} className="m-arcam__video" style={{ opacity }} playsInline muted autoPlay />
      </div>
      {calibrating && <CalibrationPad />}
      {/* The top strip: ONE row. */}
      <div className={`m-arcal${calibrating ? " m-arcal--on" : ""}`} role="group" aria-label={calibrating ? "AR calibration" : "Camera view"}>
        {failure ? (
          <span className="m-arcal__note m-arcal__note--warn" role="status">
            {AR_CAM_COPY[failure]}
          </span>
        ) : calibrating ? (
          <>
            <span className="m-arcal__title">{AR_CAL_COPY.title}</span>
            <span className="m-arcal__read" data-read="cal">
              YAW {formatSigned(draft.yawDeg)} · PITCH {formatSigned(draft.pitchDeg)} · {Math.round(camFocalEqMm(draft.camLongFovDeg))} mm
            </span>
          </>
        ) : (
          <span className="m-arcal__read" data-read="view">
            CAMERA ≈ {Math.round(camFocalEqMm(stored.camLongFovDeg))} mm · {isCalibrated(stored) ? "CALIBRATED" : "NOT CALIBRATED — HOLD AR"}
          </span>
        )}
      </div>
      {/* The 3D ↔ CAM slider: vertical, just above the CAM chip on the right rail (CAM at the top). */}
      <div className="m-arcal__mixv" role="group" aria-label="3D to camera mix">
        <span className="m-arcal__mixlbl" aria-hidden="true">
          CAM
        </span>
        <span className="m-arcal__mixtrack">
          <input
            type="range"
            className="m-arcal__mixin"
            min={FPV.arCamOpacityMin}
            max={FPV.arCamOpacityMax}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            aria-label="Camera feed opacity over the 3D view"
            aria-orientation="vertical"
          />
        </span>
        <span className="m-arcal__mixlbl" aria-hidden="true">
          3D
        </span>
      </div>
      {/* The verdict column: three round cells on the left, just above the AIM stick. */}
      {calibrating && (
        <div className="m-arcal__actions" role="group" aria-label="Calibration actions">
          <button
            type="button"
            className="m-act m-act--icon m-act--accent"
            data-act="ar-cal-confirm"
            aria-label="Confirm the calibration"
            onClick={() => cam.confirmArCalibration()}
          >
            <span className="m-act__glyph" aria-hidden="true">
              ✓
            </span>
            <span>{AR_CAL_COPY.confirm}</span>
          </button>
          <button
            type="button"
            className="m-act m-act--icon"
            data-act="ar-cal-reset"
            aria-label="Reset the calibration"
            onClick={() => cam.resetArCalibration()}
          >
            <span className="m-act__glyph" aria-hidden="true">
              ↺
            </span>
            <span>{AR_CAL_COPY.reset}</span>
          </button>
          <button
            type="button"
            className="m-act m-act--icon"
            data-act="ar-cal-cancel"
            aria-label="Cancel the calibration"
            onClick={() => cam.cancelArCalibration()}
          >
            <span className="m-act__glyph" aria-hidden="true">
              ✕
            </span>
            <span>{AR_CAL_COPY.cancel}</span>
          </button>
        </div>
      )}
    </>
  );
}
