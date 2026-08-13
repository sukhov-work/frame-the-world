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

import { useEffect, useRef, useState } from "react";
import { useCameraStore } from "../../store/camera";
import { CONTROLS } from "../globe/tuning";
import { focalFromVerticalFov } from "../../lib/decode/sensors";
import { cardinal, formatEyeM, formatFocal, formatSigned } from "../../lib/format/readout";
import "../../styles/mobile/fpv.css";

/** Knob travel radius as a fraction of the pad radius (the rim ring stays visible). */
const KNOB_TRAVEL = 0.72;

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

/** Left-thumb analog walk stick: deflection −1..1 (fwd = up, right = right), unit-disc
 *  clamped; null on release. The speed curve (quadratic, rim = sprint) is the ENGINE's —
 *  this component only reports geometry. */
function Joystick() {
  const setWalk = useCameraStore((s) => s.setFpvWalkInput);
  const padRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<number | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);

  // Release everything if the shell unmounts mid-hold (FPV exited under the thumb; the
  // orchestrator's exit branch is the second backstop).
  useEffect(() => () => setWalk(null), [setWalk]);

  const apply = (e: React.PointerEvent<HTMLDivElement>) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const r = rect.width / 2;
    let x = (e.clientX - (rect.left + r)) / r;
    let y = (e.clientY - (rect.top + r)) / r;
    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    setWalk({ fwd: -y, right: x }); // screen y grows downward; fwd is "walk where you look"
    setKnob({ x: x * r * KNOB_TRAVEL, y: y * r * KNOB_TRAVEL });
  };
  const release = () => {
    dragId.current = null;
    setWalk(null);
    setKnob(null);
  };

  return (
    <div
      ref={padRef}
      className="m-joy"
      role="application"
      aria-label="Walk joystick — drag to walk where you look"
      onPointerDown={(e) => {
        dragId.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers (test dispatch) can't be captured — tracking still works */
        }
        apply(e);
      }}
      onPointerMove={(e) => {
        if (dragId.current === e.pointerId) apply(e);
      }}
      onPointerUp={(e) => {
        if (dragId.current === e.pointerId) release();
      }}
      onPointerCancel={(e) => {
        if (dragId.current === e.pointerId) release();
      }}
    >
      <span className="m-joy__label">WALK</span>
      <span
        className={`m-joy__knob${knob ? " m-joy__knob--live" : ""}`}
        style={knob ? { transform: `translate(${knob.x}px, ${knob.y}px)` } : undefined}
        aria-hidden="true"
      />
    </div>
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
      <Joystick />
      <div className="m-altcol" aria-label="Eye altitude">
        <AltNudge dir={1} />
        <AltNudge dir={-1} />
      </div>
    </>
  );
}
