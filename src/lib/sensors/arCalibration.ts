/**
 * AR CALIBRATION (owner order 2026-09-19) — the user's own eyes as the last rung of the ladder.
 *
 * THE PROBLEM. Every AR viewfinder drifts: the compass is off by a few degrees to begin with (hard
 * iron in the phone and its case, the declination model, the camera not quite square to the
 * chassis) and the fused heading wanders as the phone is swung. No amount of filtering knows where
 * north REALLY is. The user does: they can SEE that the virtual skyline sits 4° left of the real one.
 *
 * THE FIX. Calibration mode (`components/mobile/ArCameraOverlay.tsx`) puts the phone's live rear
 * camera over the 3D view at the SAME angular scale, and the user drags / pinches until the two
 * agree. What they dialled in is ONE small record — this file's `ArCalibration` — saved under
 * `ftw:ar-calib:v1` until the next calibration replaces it (or RESET clears it):
 *
 *  · `yawDeg` / `pitchDeg` — added to the sensor ladder's aim (`scene/arLook.ts` `aim()`), AFTER
 *    the rungs and the smoother, so it composes with every rung and with ⌖ ALIGN identically;
 *  · `camLongFovDeg` — the streamed frame's field of view along its LONG side. A web page cannot
 *    read a camera's focal length (`MediaTrackSettings` has no such field), so the default is a
 *    typical main camera and the pinch in calibration mode is how the real one is learned.
 *
 * ROLL IS NOT CALIBRATED (owner ruling 2026-09-22 — "remove roll from calibration completely, it
 * is not useful"): the video is still counter-rotated by the phone's SENSED roll (`smoothRollDeg`,
 * the FPV camera has no roll seam — DECISIONS 2026-09-07h), but there is no user offset on top of
 * it and no twist gesture. An older blob's `rollDeg` is ignored by `sanitizeArCalibration`
 * (the key stays `v1`: every field is defaulted, nothing needs a migration).
 *
 * Pure, three-free, DOM-free apart from the guarded `localStorage` seam (the `lib/prefs.ts`
 * posture: every read sanitizes, every write is best-effort). Unit-pinned in
 * `test/lib/sensors/arCalibration.test.ts`.
 */

import { circDiffDeg, wrapDeg360 } from "./deviceOrientation";

/** Persisted user state — an `ftw:*` key like its siblings (CLAUDE.md §The name: never renamed). */
export const AR_CALIB_KEY = "ftw:ar-calib:v1";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface ArCalibration {
  /** Added to the ladder's TRUE heading, degrees, + = clockwise; (−180, 180]. */
  yawDeg: number;
  /** Added to the ladder's pitch, degrees, + = up. */
  pitchDeg: number;
  /** The streamed camera frame's field of view along its LONG side, degrees. */
  camLongFovDeg: number;
  /** `Date.now()` of the CONFIRM that stored it; 0 = never calibrated (the identity). */
  savedAtMs: number;
}

/** The rails: a calibration is a CORRECTION, not a second aim — anything larger than these means
 *  the sensors are wrong in a way an offset cannot fix (yaw alone is free: a compass can be out by
 *  anything next to a steel railing, and the user's eyes outrank it). */
export const AR_CALIB_RAILS = Object.freeze({
  pitchMaxDeg: 30,
  camLongFovMinDeg: 30,
  camLongFovMaxDeg: 110,
});

/**
 * The default long-side FOV of `getUserMedia({ video: { facingMode: "environment" } })`.
 * A phone's main camera is 24–26 mm-equivalent: a 4:3 sensor at 24 mm-eq spans 2·atan(18/24) =
 * 73.7° across its long side, at 26 mm-eq 69.4° (the Pixel 6 Pro's 82° diagonal 4:3 frame ≈ 69.6°
 * across). A 16:9 video frame is cut from the SHORT side, so the long side keeps that figure; a
 * stabilisation crop, where the UA applies one, takes ~5–10 % off. 2026-09-19 guessed 62° (a full
 * 10 % crop on the narrowest lens); the owner's drift report (2026-09-22 — the aligned building
 * slides off the feed as the phone pitches, i.e. the two pictures do NOT share a pixel focal, see
 * `videoLayout`) is the signature of a default that is too NARROW: the feed is drawn too small and
 * everything away from the centre cross slips outward. 68° is the middle of the measured band.
 * [ASSUMPTION 2026-09-22 — a per-device constant the page cannot read; the pinch in calibration
 * mode replaces it with the measured one, and T147 asks the owner's phones for the real number.]
 */
export const AR_CAM_LONG_FOV_DEFAULT_DEG = 68;

export const AR_CALIB_IDENTITY: Readonly<ArCalibration> = Object.freeze({
  yawDeg: 0,
  pitchDeg: 0,
  camLongFovDeg: AR_CAM_LONG_FOV_DEFAULT_DEG,
  savedAtMs: 0,
});

const fin = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Any value → a calibration on its rails. Junk reads as the identity; never throws. */
export function sanitizeArCalibration(raw: unknown): ArCalibration {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const yaw = circDiffDeg(fin(r.yawDeg, 0), 0);
  return {
    yawDeg: yaw || 0, // fold a −0
    pitchDeg: clamp(fin(r.pitchDeg, 0), -AR_CALIB_RAILS.pitchMaxDeg, AR_CALIB_RAILS.pitchMaxDeg) || 0,
    // (a pre-2026-09-22 blob's `rollDeg` is dropped here — roll is no longer calibrated)
    camLongFovDeg: clamp(
      fin(r.camLongFovDeg, AR_CAM_LONG_FOV_DEFAULT_DEG),
      AR_CALIB_RAILS.camLongFovMinDeg,
      AR_CALIB_RAILS.camLongFovMaxDeg,
    ),
    savedAtMs: Math.max(0, fin(r.savedAtMs, 0)),
  };
}

/** True when the record changes nothing the AIM sees (the camera FOV is not part of the aim). */
export function isIdentityAim(c: ArCalibration): boolean {
  return Math.abs(c.yawDeg) < 1e-9 && Math.abs(c.pitchDeg) < 1e-9;
}

/** True when a calibration has been confirmed and stored (the chip's dot, the RESET button). */
export function isCalibrated(c: ArCalibration): boolean {
  return c.savedAtMs > 0;
}

export function loadArCalibration(): ArCalibration {
  try {
    if (typeof localStorage === "undefined") return { ...AR_CALIB_IDENTITY };
    const raw = localStorage.getItem(AR_CALIB_KEY);
    return raw ? sanitizeArCalibration(JSON.parse(raw)) : { ...AR_CALIB_IDENTITY };
  } catch {
    return { ...AR_CALIB_IDENTITY };
  }
}

/** Store a confirmed calibration — it REPLACES the previous one (owner: "it will override"). */
export function saveArCalibration(c: ArCalibration, nowMs: number = Date.now()): ArCalibration {
  const next = { ...sanitizeArCalibration(c), savedAtMs: nowMs };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(AR_CALIB_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — the session still carries it */
  }
  return next;
}

export function clearArCalibration(): ArCalibration {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(AR_CALIB_KEY);
  } catch {
    /* best-effort */
  }
  return { ...AR_CALIB_IDENTITY };
}

/** The ladder's aim with the calibration on top — heading wrapped, pitch inside the sphere. */
export function applyArCalibration(
  aim: { azDeg: number; altDeg: number },
  c: Pick<ArCalibration, "yawDeg" | "pitchDeg">,
): { azDeg: number; altDeg: number } {
  return {
    azDeg: wrapDeg360(aim.azDeg + c.yawDeg),
    altDeg: clamp(aim.altDeg + c.pitchDeg, -90, 90),
  };
}

// ── THE SHARED ANGULAR SCALE ──────────────────────────────────────────────────────────────────
// A pinhole view maps a ray at angle θ off the axis to `f · tan θ` pixels off the centre, where
// `f` (the focal length IN PIXELS) = (H / 2) / tan(vFov / 2). Two pictures agree everywhere —
// not just at the centre — exactly when they share `f`. So "the same focal number" is one
// equation: scale the video until ITS pixel focal equals the 3D view's.

/** The 3D view's focal length in CSS pixels: the viewport height against the vertical FOV. */
export function focalPx(viewportHeightPx: number, vFovDeg: number): number {
  const v = clamp(vFovDeg, 0.01, 179);
  return viewportHeightPx / 2 / Math.tan((v * D2R) / 2);
}

export interface VideoLayoutIn {
  /** `video.videoWidth` / `videoHeight` — the stream's intrinsic frame. */
  videoW: number;
  videoH: number;
  /** The 3D viewport (CSS px) and its live vertical FOV (`camera.fov`). */
  viewH: number;
  vFovDeg: number;
  camLongFovDeg: number;
}

/**
 * The CSS box (px) the `<video>` must be drawn at — centred on the viewport — for its angular
 * scale to equal the 3D view's. Longer virtual focal → the video is magnified past the screen
 * (a digital zoom); wider → it sits inside the screen as the rectangle the real lens covers.
 * Null until the stream reports a frame size.
 */
export function videoLayout(i: VideoLayoutIn): { widthPx: number; heightPx: number; scale: number } | null {
  const long = Math.max(i.videoW, i.videoH);
  if (!(long > 0) || !(i.viewH > 0)) return null;
  const f = focalPx(i.viewH, i.vFovDeg);
  const camLong = clamp(i.camLongFovDeg, AR_CALIB_RAILS.camLongFovMinDeg, AR_CALIB_RAILS.camLongFovMaxDeg);
  // The video's long side spans 2·tan(camLong/2) in tangent units → that many `f` pixels.
  const scale = (2 * f * Math.tan((camLong * D2R) / 2)) / long;
  return { widthPx: i.videoW * scale, heightPx: i.videoH * scale, scale };
}

/** The camera's 35 mm-equivalent focal length for a long-side FOV (36 mm reference — the readout
 *  the calibration panel shows, the same convention as `focalFromHorizontalFov`). */
export function camFocalEqMm(camLongFovDeg: number): number {
  return 18 / Math.tan((clamp(camLongFovDeg, 1, 179) * D2R) / 2);
}

// ── THE CALIBRATION GESTURES (pure; the overlay's pad feeds them pointer deltas) ──────────────

/**
 * One-finger drag → the aim offset's change. GRAB-THE-WORLD, the FPV look-drag's own sense
 * (`StylizedTiles` onFpvPointerMove): dragging right carries the virtual scene right, i.e. the
 * camera turns LEFT (yaw −); dragging down carries it down, i.e. the camera tips UP (pitch +).
 * Exact at the centre of the frame: a pixel is `atan(1 / f)`; a yaw moves the centre by
 * `cos(pitch)` of itself, so the heading change is divided by it (floored — near the zenith a
 * heading is ill-conditioned and a drag must not spin the view).
 */
export function dragToAimDelta(
  dxPx: number,
  dyPx: number,
  fPx: number,
  viewPitchDeg: number,
): { dYawDeg: number; dPitchDeg: number } {
  if (!(fPx > 0)) return { dYawDeg: 0, dPitchDeg: 0 };
  const cosP = Math.max(0.2, Math.cos(clamp(viewPitchDeg, -89, 89) * D2R));
  return {
    dYawDeg: (-Math.atan(dxPx / fPx) * R2D) / cosP,
    dPitchDeg: Math.atan(dyPx / fPx) * R2D,
  };
}

/** Two fingers: the spread ratio (the pointer pair's distance now over before). `null` when the
 *  fingers coincide. (The twist that used to ride along was the roll gesture — gone 2026-09-22.) */
export function pinchSpread(
  a0: { x: number; y: number },
  b0: { x: number; y: number },
  a1: { x: number; y: number },
  b1: { x: number; y: number },
): number | null {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  if (!(d0 > 1) || !(d1 > 1)) return null;
  return d1 / d0;
}

/**
 * Apply one gesture step to a DRAFT calibration.
 *  · a drag moves the VIRTUAL view (the 3D scene is what visibly follows the finger — `dragToAimDelta`);
 *  · a pinch sizes the CAMERA PICTURE — the only thing the pinch can move on screen, since the 3D
 *    view's focal is the FPV lens, not the calibration's. Spreading the fingers ENLARGES the feed
 *    (the pinch-to-zoom reflex, the repo's own convention — `verify-mobile-batch` "a pinch OUT
 *    zooms in"): a bigger picture at the same pixel focal means the lens covers MORE of the world,
 *    so the camera's FOV estimate widens: tan(fov'/2) = tan(fov/2) · spread. (2026-09-19 had it
 *    the other way round, reasoned from "the user handles the virtual view" — the owner's phones
 *    said the gesture worked backwards; owner order 2026-09-22.)
 */
export function stepCalibration(
  c: ArCalibration,
  g: { dYawDeg?: number; dPitchDeg?: number; spread?: number },
): ArCalibration {
  const spread = g.spread !== undefined && Number.isFinite(g.spread) && g.spread > 0 ? g.spread : 1;
  const fov = 2 * Math.atan(Math.tan((c.camLongFovDeg * D2R) / 2) * spread) * R2D;
  return sanitizeArCalibration({
    ...c,
    yawDeg: c.yawDeg + fin(g.dYawDeg, 0),
    pitchDeg: c.pitchDeg + fin(g.dPitchDeg, 0),
    camLongFovDeg: fov,
  });
}

/** A slow EMA on the sensed roll (degrees) — the video's counter-rotation must not shiver. */
export function smoothRollDeg(prevDeg: number | null, nextDeg: number, dtMs: number, tauMs: number): number {
  if (prevDeg === null || !Number.isFinite(prevDeg) || !(tauMs > 0)) return nextDeg;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return prevDeg + circDiffDeg(nextDeg, prevDeg) * k;
}
