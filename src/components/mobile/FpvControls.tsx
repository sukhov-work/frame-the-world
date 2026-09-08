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

/** How long a transient note (armed / aligned / a rung line) stays up before the bubble clears.
 *  Owner 2026-09-08b: the hints are welcome, the standing bubble is not — it hides the view. */
export const AR_NOTE_MS = 3500;

/**
 * The ONE transition key a note is worth re-showing for: the rung and the stale flag. Never the
 * heading or the sample count — the engine mirror's own signature moves on every ~1° of heading
 * and keying on it would re-show the bubble forever (the thing the owner asked to stop).
 */
export function arNoteKey(on: boolean, state: ArLookState | null): string {
  if (!on) return "off";
  if (!state) return "on";
  return `${state.rung}|${state.stale ? "stale" : "live"}`;
}

/**
 * What to announce when the key moves (pure, so the DOM-less vitest can pin the contract):
 *  · AR switched off → clear the bubble (`null`);
 *  · the sensors went STALE → the stale line, STICKY while it lasts (an error is an action the
 *    user has to take — move the phone, check access);
 *  · a rung landed or changed (compass ↔ gyro, aligned ↔ unaligned, stale → live again) → the
 *    rung line, TRANSIENT (`AR_NOTE_MS`), queued behind a transient note still up so the armed
 *    hint gets its full read before the rung line replaces it.
 *  Nothing else re-shows anything.
 */
export function arAnnouncement(
  on: boolean,
  state: ArLookState | null,
): { text: string; sticky: boolean; defer: boolean } | null | "clear" {
  if (!on) return "clear";
  if (!state) return null;
  // Stale BEFORE any sample is the engine's first mirror write after arming (a phone's sensors
  // land ~100 ms later, the HUD tick can precede them) — worth saying only if it lasts: it waits
  // behind the armed hint, and a rung that lands first supersedes it. Stale AFTER samples is the
  // sensors dying mid-session: immediate.
  if (state.stale) return { text: AR_COPY.stale, sticky: true, defer: state.samples === 0 };
  return { text: arRungLine(state), sticky: false, defer: false };
}

/** Minimal surface of the iOS 13+ permission API — lib.dom has no such static. */
type DeviceOrientationEventCtor = { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * The toggle. The permission request runs SYNCHRONOUSLY inside the tap handler — WebKit gates
 * `requestPermission()` on `processingUserGesture`, not on a time window, so nothing may be
 * awaited before it (`test/components/mobileArLook.test.ts` pins the shape). Chrome 151+ has the
 * same static and resolves it without a prompt; browsers without it (older Chromium, Firefox)
 * just arm. Never asked at page load: the toggle IS the gesture.
 *
 * Seat (owner 2026-09-08b): the FIRST cell of the right-rail altitude column — a 44 px round
 * chip like ⤒/⤓ below it, the two letters AR in the column's mono (no glyph: the compass emoji
 * broke the icon style and made the map harder to read — owner 2026-09-08b). The note bubble and the ALIGN chip FLOAT above the column
 * (`.m-arfloat`, absolute) so the column's own box — the A1-2 `--m-altcol-h` contract the map
 * window's ◉ RE-CENTRE reads — never grows while a note is up.
 */
export function ArLookToggle() {
  const on = useCameraStore((s) => s.arLook);
  const state = useCameraStore((s) => s.arLookState);
  // Mounting while already ON shows the rung line once (then it clears like any transient).
  const [note, setNote] = useState<string | null>(() => (on && state ? arRungLine(state) : null));
  const noteTimer = useRef<number | null>(null);
  const noteUntil = useRef<number>(on && state ? Date.now() + AR_NOTE_MS : 0);
  const lastKey = useRef(arNoteKey(on, state));
  const clearTimer = () => {
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
    noteTimer.current = null;
  };
  const flash = (text: string, sticky = false) => {
    setNote(text);
    clearTimer();
    // A transient note stands in briefly, then the bubble CLEARS (owner 2026-09-08b — the view
    // is the point); errors stay until the next tap or until the sensors recover.
    noteUntil.current = sticky ? Infinity : Date.now() + AR_NOTE_MS;
    noteTimer.current = sticky ? null : window.setTimeout(() => setNote(null), AR_NOTE_MS);
  };
  const clearNote = () => {
    clearTimer();
    noteUntil.current = 0;
    setNote(null);
  };
  /** A line queued behind a transient note still up (the armed hint keeps its read); a later
   *  announcement supersedes a queued one. */
  const announce = (text: string, sticky = false) => {
    const remaining = noteUntil.current === Infinity ? 0 : noteUntil.current - Date.now();
    if (remaining > 0) {
      clearTimer();
      noteTimer.current = window.setTimeout(() => flash(text, sticky), remaining);
    } else {
      flash(text, sticky);
    }
  };
  useEffect(() => clearTimer, []);
  // Re-show ONLY on the key's transitions (rung · stale); the mirror object itself changes at the
  // HUD cadence and must not be what re-opens the bubble.
  useEffect(() => {
    const key = arNoteKey(on, state);
    if (key === lastKey.current) return;
    lastKey.current = key;
    const a = arAnnouncement(on, state);
    if (a === "clear") clearNote();
    else if (a !== null) (a.sticky && !a.defer ? flash(a.text, true) : announce(a.text, a.sticky));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, state]);
  const arm = () => {
    useCameraStore.getState().setArLook(true);
    flash(AR_COPY.armed);
  };
  const onTap = () => {
    const cam = useCameraStore.getState();
    if (cam.arLook) {
      cam.setArLook(false);
      clearNote();
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
  const line = note ?? "";
  return (
    <div className="m-arwrap">
      {(line || relative) && (
        <div className="m-arfloat">
          {line && (
            <span className="m-arnote" role="status">
              {line}
            </span>
          )}
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
        </div>
      )}
      <button
        type="button"
        className={`m-arbtn${on ? " m-arbtn--on" : ""}`}
        aria-pressed={on}
        aria-label="AR look-around — aim the view by moving the phone"
        onClick={onTap}
      >
        AR
      </button>
    </div>
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
      <div className="m-altcol" aria-label="AR look-around · eye altitude">
        <ArLookToggle />
        <AltNudge dir={1} />
        <AltNudge dir={-1} />
      </div>
    </>
  );
}
