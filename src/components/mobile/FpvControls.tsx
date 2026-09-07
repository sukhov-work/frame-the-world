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
import { useCameraStore, type ArLookState } from "../../store/camera";
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

// ── AR LOOK-AROUND (owner order 2026-09-07g) ────────────────────────────────────────────────
/**
 * The copy, in one place so the fence can read it. Every line is a claim the 2026-09-07 research
 * made checkable (DECISIONS 2026-09-07h):
 *  · `denied` — WebKit caches a denial per top origin for the whole Safari process, across tabs,
 *    and iOS 13+ has NO Settings toggle for it (the old "Motion & Orientation Access" switch was
 *    removed); the only user-side recoveries are quit-and-reopen Safari or Clear History and
 *    Website Data. Saying "check Settings" would send the user hunting for a switch that is gone.
 *  · `needsTap` — the promise REJECTS (`NotAllowedError`) when the call did not run inside the
 *    tap's own activation; it RESOLVES "denied" (with a console warning) on an insecure context.
 */
export const AR_COPY = Object.freeze({
  armed: "MOVE THE PHONE TO LOOK AROUND · THE DRAG IS OFF WHILE THIS IS ON",
  denied:
    "MOTION ACCESS WAS DENIED. iOS REMEMBERS THAT UNTIL SAFARI IS QUIT AND REOPENED (OR SETTINGS → SAFARI → CLEAR HISTORY AND WEBSITE DATA). A PAGE OVER HTTP IS ALSO DENIED.",
  needsTap: "TAP AGAIN — THE BROWSER ONLY ASKS FOR MOTION ACCESS FROM THE TAP ITSELF",
  noSensors: "NO MOTION SENSORS IN THIS BROWSER — THE JOYSTICK IS THE LOOK",
  stale: "NO SENSOR DATA — MOVE THE PHONE; IF NOTHING CHANGES, MOTION ACCESS MAY BE OFF",
  aligned: "ALIGNED TO THE VIEW",
});

/** The rung's one-line readout — what the phone is actually being aimed by. */
export function arRungLine(state: ArLookState | null): string {
  if (!state) return "";
  if (state.stale) return AR_COPY.stale;
  switch (state.rung) {
    case "android-absolute":
      return `COMPASS · TRUE NORTH (${state.declinationDeg >= 0 ? "+" : "−"}${Math.abs(state.declinationDeg).toFixed(1)}° DECLINATION)`;
    case "ios-compass":
      return state.compassAgeMs > 60_000
        ? "COMPASS · TRUE NORTH · TILT THE PHONE DOWN A MOMENT TO RE-SYNC"
        : `COMPASS · TRUE NORTH (${state.declinationDeg >= 0 ? "+" : "−"}${Math.abs(state.declinationDeg).toFixed(1)}° DECLINATION)`;
    case "relative-aligned":
      return "GYRO · ALIGNED (NO COMPASS — RE-ALIGN IF IT DRIFTS)";
    case "relative-unaligned":
      return "GYRO ONLY — FACE WHERE THE VIEW LOOKS AND TAP ALIGN";
  }
}

/** How long a transient note (armed / aligned) covers the rung line. */
const AR_NOTE_MS = 3500;

/** Minimal surface of the iOS 13+ permission API — lib.dom has no such static. */
type DeviceOrientationEventCtor = { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * The toggle. The permission request runs SYNCHRONOUSLY inside the tap handler — WebKit gates
 * `requestPermission()` on `processingUserGesture`, not on a time window, so nothing may be
 * awaited before it (`test/components/mobileArLook.test.ts` pins the shape). Chrome 151+ has the
 * same static and resolves it without a prompt; browsers without it (older Chromium, Firefox)
 * just arm. Never asked at page load: the toggle IS the gesture.
 */
export function ArLookToggle() {
  const on = useCameraStore((s) => s.arLook);
  const state = useCameraStore((s) => s.arLookState);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number | null>(null);
  const flash = (text: string, sticky = false) => {
    setNote(text);
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
    // A transient note stands in for the rung line briefly, then the rung line is back — the
    // rung IS the information ("compass" vs "gyro only"); errors stay until the next tap.
    noteTimer.current = sticky ? null : window.setTimeout(() => setNote(null), AR_NOTE_MS);
  };
  useEffect(
    () => () => {
      if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
    },
    [],
  );
  const arm = () => {
    useCameraStore.getState().setArLook(true);
    flash(AR_COPY.armed);
  };
  const onTap = () => {
    const cam = useCameraStore.getState();
    if (cam.arLook) {
      cam.setArLook(false);
      setNote(null);
      return;
    }
    if (!("DeviceOrientationEvent" in window)) {
      flash(AR_COPY.noSensors, true);
      return;
    }
    const ctor = window.DeviceOrientationEvent as unknown as DeviceOrientationEventCtor;
    if (typeof ctor.requestPermission === "function") {
      ctor
        .requestPermission()
        .then((r) => (r === "granted" ? arm() : flash(AR_COPY.denied, true)))
        .catch(() => flash(AR_COPY.needsTap, true));
    } else {
      arm();
    }
  };
  const relative = on && state !== null && !state.stale && state.rung.startsWith("relative");
  const line = note ?? (on ? arRungLine(state) : "");
  return (
    <div className="m-arwrap">
      <button
        type="button"
        className={`m-arbtn${on ? " m-arbtn--on" : ""}`}
        aria-pressed={on}
        aria-label="AR look-around — aim the view by moving the phone"
        onClick={onTap}
      >
        <span className="m-arbtn__glyph" aria-hidden="true">
          🧭
        </span>
        AR
      </button>
      {relative && (
        <button
          type="button"
          className="m-act m-act--accent m-aralign"
          onClick={() => {
            useCameraStore.getState().requestArAlign();
            flash(AR_COPY.aligned);
          }}
        >
          ⌖ ALIGN
        </button>
      )}
      {line && (
        <span className="m-arnote" role="status">
          {line}
        </span>
      )}
    </div>
  );
}

export default function FpvControls() {
  const hud = useCameraStore((s) => s.fpvHud);
  useFpvWakeLock();
  return (
    <>
      <ArLookToggle />
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
