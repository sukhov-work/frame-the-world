/**
 * FpvControls (M2) — the /m first-person touch instruments (MOBILE_PLAN §3/§4): the left-thumb
 * analog WALK joystick (store seam `setFpvWalkInput`, integrated by the orchestrator into the
 * world-space walk offset — the pivot invariant lives there, not here), ⤒/⤓ ALTITUDE nudge
 * chips on the existing encoder rate seam (`setZoomRate`; in FPV + = ascend, strictly
 * vertical), a compact HUD row (FOCAL · HDG · PITCH · EYE off the `fpvHud` mirror), and a
 * Screen Wake Lock while the viewpoint is active (a planning session on-site must not dim
 * mid-frame; iOS 16.4+ / Android Chrome, silently absent elsewhere).
 *
 * Mounted by MobileShell ONLY while FPV is on (`tempFpv || fpvHud` — the store flag flips
 * instantly on entry; the HUD mirror covers every FPV kind). Pinch-FOV needs no UI: the
 * engine's own FPV pointer handlers own the second finger (StylizedTiles, M2).
 */

import { useEffect, useRef } from "react";
import { useCameraStore } from "../../store/camera";
import { CONTROLS } from "../globe/tuning";
import { focalFromVerticalFov } from "../../lib/decode/sensors";
import { cardinal, formatEyeM, formatFocal, formatSigned } from "../../lib/format/readout";
import { Joystick } from "../controls/Joystick";
import "../../styles/mobile/fpv.css";

/** Minimal Screen Wake Lock surface — lib.dom's types vary across TS versions. */
interface WakeLockSentinelLike {
  release: () => Promise<void>;
}
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

function useFpvWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinelLike | null = null;
    let disposed = false;
    const acquire = () => {
      (navigator as NavigatorWithWakeLock).wakeLock
        ?.request("screen")
        .then((l) => {
          if (disposed) void l.release().catch(() => {});
          else lock = l;
        })
        .catch(() => {
          /* denied (low battery / not visible) — a dimming screen is survivable */
        });
    };
    acquire();
    // The lock is auto-released whenever the tab hides — re-acquire on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}

/** The WALK instance — deflection → the walk-input store seam (speed curve is the ENGINE's:
 *  quadratic, rim = sprint). The stick geometry itself is the shared controls/Joystick. */
function WalkJoystick() {
  const setWalk = useCameraStore((s) => s.setFpvWalkInput);
  return (
    <Joystick
      label="WALK"
      ariaLabel="Walk joystick — drag to walk where you look"
      onVector={(v) =>
        // Screen y grows downward; fwd is "walk where you look".
        setWalk(v === null ? null : { fwd: -v.y, right: v.x })
      }
    />
  );
}

/** Hold-to-fly altitude nudge: writes the encoder rate seam while pressed (FPV identity =
 *  strictly vertical eye move with the tempEyeMaxM ceiling), null on release. */
function AltNudge({ dir }: { dir: 1 | -1 }) {
  const setZoomRate = useCameraStore((s) => s.setZoomRate);
  const held = useRef(false);
  useEffect(
    () => () => {
      if (held.current) setZoomRate(null);
    },
    [setZoomRate],
  );
  const start = (e: React.PointerEvent<HTMLButtonElement>) => {
    held.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers (test dispatch) can't be captured — release still fires */
    }
    setZoomRate(dir * CONTROLS.zoomRateMaxPerS); // FPV: + rate = ASCEND (encoder identity)
  };
  const stop = () => {
    if (!held.current) return;
    held.current = false;
    setZoomRate(null);
  };
  return (
    <button
      type="button"
      className="m-alt"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      aria-label={dir === 1 ? "Ascend (hold)" : "Descend (hold)"}
    >
      {dir === 1 ? "⤒" : "⤓"}
    </button>
  );
}

export default function FpvControls() {
  const hud = useCameraStore((s) => s.fpvHud);
  useFpvWakeLock();
  return (
    <>
      {hud && (
        <div className="m-fpvhud" aria-label="Camera view readout">
          <span className="m-fpvhud__cell">
            <span className="m-fpvhud__k">FOCAL</span>
            {formatFocal(focalFromVerticalFov(hud.fovDeg))}
          </span>
          <span className="m-fpvhud__cell">
            <span className="m-fpvhud__k">HDG</span>
            {Math.round(hud.headingDeg)}° {cardinal(hud.headingDeg)}
          </span>
          <span className="m-fpvhud__cell">
            <span className="m-fpvhud__k">PITCH</span>
            {formatSigned(hud.pitchDeg)}
          </span>
          <span className="m-fpvhud__cell">
            <span className="m-fpvhud__k">EYE</span>
            {formatEyeM(hud.eyeAboveGroundM)}
          </span>
        </div>
      )}
      <WalkJoystick />
      <div className="m-altcol" aria-label="Eye altitude">
        <AltNudge dir={1} />
        <AltNudge dir={-1} />
      </div>
    </>
  );
}
