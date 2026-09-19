/**
 * AR CALIBRATION (owner order 2026-09-19) — the user's own eyes as the last rung of the ladder.
 *
 * THE PROBLEM. Every AR viewfinder drifts: the compass is off by a few degrees to begin with (hard
 * iron in the phone and its case, the declination model, the camera not quite square to the
 * chassis) and the fused heading wanders as the phone is swung. No amount of filtering knows where
 * north REALLY is. The user does: they can SEE that the virtual skyline sits 4° left of the real one.
 *
 * THE FIX. Calibration mode (`components/mobile/ArCameraOverlay.tsx`) puts the phone's live rear
 * camera over the 3D view at the SAME angular scale, and the user drags / twists / pinches until
 * the two agree. What they dialled in is ONE small record — this file's `ArCalibration` — saved
 * under `ftw:ar-calib:v1` until the next calibration replaces it (or RESET clears it):
 *
 *  · `yawDeg` / `pitchDeg` — added to the sensor ladder's aim (`scene/arLook.ts` `aim()`), AFTER
 *    the rungs and the smoother, so it composes with every rung and with ⌖ ALIGN identically;
 *  · `rollDeg` — added to the sensed roll the VIDEO is counter-rotated by (the FPV camera has no
 *    roll seam — DECISIONS 2026-09-07h — so the picture is levelled instead of the world tilted);
 *  · `camLongFovDeg` — the streamed frame's field of view along its LONG side. A web page cannot
 *    read a camera's focal length (`MediaTrackSettings` has no such field), so the default is a
 *    typical main camera and the pinch in calibration mode is how the real one is learned.
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
  /** Added to the sensed roll before the video is counter-rotated, degrees, + = clockwise. */
  rollDeg: number;
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
  rollMaxDeg: 30,
  camLongFovMinDeg: 30,
  camLongFovMaxDeg: 110,
});

/**
 * The default long-side FOV of `getUserMedia({ video: { facingMode: "environment" } })`.
 * A phone's main camera is 24–26 mm-equivalent (diagonal FOV ≈ 80–84°); a 16:9 video frame cut
 * from that sensor keeps the long side (≈ 67–70°) and a video-mode / stabilisation crop takes
 * ~10 % off → ≈ 62°. [ASSUMPTION 2026-09-19 — a per-device constant the page cannot read; the
 * pinch in calibration mode replaces it with the measured one.]
 */
export const AR_CAM_LONG_FOV_DEFAULT_DEG = 62;

export const AR_CALIB_IDENTITY: Readonly<ArCalibration> = Object.freeze({
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
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
    rollDeg: clamp(fin(r.rollDeg, 0), -AR_CALIB_RAILS.rollMaxDeg, AR_CALIB_RAILS.rollMaxDeg) || 0,
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

/** Two fingers: the twist (radians→degrees, screen-clockwise +) and the spread ratio between two
 *  pointer pairs. `null` when the fingers coincide. */
export function pinchTwist(
  a0: { x: number; y: number },
  b0: { x: number; y: number },
  a1: { x: number; y: number },
  b1: { x: number; y: number },
): { twistDeg: number; spread: number } | null {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  if (!(d0 > 1) || !(d1 > 1)) return null;
  // Screen y grows DOWNWARD, so atan2(dy, dx) already increases clockwise on screen.
  const t0 = Math.atan2(b0.y - a0.y, b0.x - a0.x);
  const t1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
  return { twistDeg: circDiffDeg((t1 - t0) * R2D, 0), spread: d1 / d0 };
}

/**
 * Apply one gesture step to a DRAFT calibration. The user is handling the VIRTUAL view:
 *  · twisting clockwise turns the virtual picture clockwise against the video — the video is what
 *    actually rotates, so its roll offset goes the other way;
 *  · spreading makes the virtual picture larger against the video — the video is what actually
 *    shrinks, i.e. the camera's FOV estimate narrows: tan(fov'/2) = tan(fov/2) / spread.
 */
export function stepCalibration(
  c: ArCalibration,
  g: { dYawDeg?: number; dPitchDeg?: number; twistDeg?: number; spread?: number },
): ArCalibration {
  const spread = g.spread !== undefined && Number.isFinite(g.spread) && g.spread > 0 ? g.spread : 1;
  const fov = 2 * Math.atan(Math.tan((c.camLongFovDeg * D2R) / 2) / spread) * R2D;
  return sanitizeArCalibration({
    ...c,
    yawDeg: c.yawDeg + fin(g.dYawDeg, 0),
    pitchDeg: c.pitchDeg + fin(g.dPitchDeg, 0),
    rollDeg: c.rollDeg - fin(g.twistDeg, 0),
    camLongFovDeg: fov,
  });
}

/** A slow EMA on the sensed roll (degrees) — the video's counter-rotation must not shiver. */
export function smoothRollDeg(prevDeg: number | null, nextDeg: number, dtMs: number, tauMs: number): number {
  if (prevDeg === null || !Number.isFinite(prevDeg) || !(tauMs > 0)) return nextDeg;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return prevDeg + circDiffDeg(nextDeg, prevDeg) * k;
}
