import { wrapHeadingDeg } from "./heading";

/**
 * Camera pose ↔ URL hash (S7 feedback batch #2). The orchestrator mirrors the settled view into
 * `location.hash` at low cadence, so a reload lands exactly where the user left off (skipping
 * the welcome screen) and the address bar is always a shareable link. Hash — not query — so
 * navigation never re-runs the server route and history stays clean (replaceState only).
 *
 * Format: `#p=<focusLat>,<focusLon>,<camAltM>,<headingDeg>,<tiltDeg>` — the VIEW FOCUS plus the
 * camera's geodetic altitude/heading/tilt, i.e. exactly the inputs of the shared arrival-pose
 * derivation (flight.arrivalPose), which the boot path reuses to reconstruct the camera.
 * Precision: 5 dp lat/lon (~1.1 m) · whole metres · 0.1°.
 *
 * Scene time (owner 2026-07-14): a CUSTOM scene time (pinned/playing) rides the same hash as
 * `&t=<utcMs>` so a golden-hour setup is shareable; LIVE time is deliberately never written —
 * a link without `t` simply opens on the real clock (the pre-existing behavior).
 *
 * FPV views (owner 2026-07-14): while any first-person view is active the hash switches to
 * `#f=<lat>,<lon>,<eyeM>,<headingDeg>,<pitchDeg>,<fovDeg>` — the EXACT viewer ground point
 * (6 dp ≈ 0.11 m), eye height above the local ground, view bearing/elevation and camera FOV.
 * A shared link boots straight into a temp-pin FPV reproducing that view (ground-relative eye
 * height reproduces across machines regardless of terrain-tile LOD; an absolute altitude would
 * not). The two hash forms are mutually exclusive; `&t=` rides either.
 */
export interface UrlPose {
  latDeg: number;
  lonDeg: number;
  altM: number;
  headingDeg: number;
  tiltDeg: number;
}

const ALT_MIN_M = 2;
const ALT_MAX_M = 50_000_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pose → `#p=…` (pure — unit-tested; values clamped/wrapped so the hash is always valid). */
export function formatPoseHash(p: UrlPose): string {
  const lat = clamp(p.latDeg, -90, 90).toFixed(5);
  const lon = wrapLon(p.lonDeg).toFixed(5);
  const alt = Math.round(clamp(p.altM, ALT_MIN_M, ALT_MAX_M));
  const heading = wrapHeadingDeg(p.headingDeg).toFixed(1);
  const tilt = clamp(p.tiltDeg, 0, 88).toFixed(1);
  return `#p=${lat},${lon},${alt},${heading},${tilt}`;
}

/** Pose + optional custom scene time → the full `#p=…[&t=…]` hash (pure — unit-tested).
 *  `timeMs: null` = live scene time, which is never shared. */
export function formatSceneHash(p: UrlPose, timeMs: number | null): string {
  return timeMs === null
    ? formatPoseHash(p)
    : `${formatPoseHash(p)}&t=${Math.round(timeMs)}`;
}

/** `#p=…` (leading `#` optional; a trailing `&t=…` is ignored) → pose, or null on anything
 *  malformed (pure — unit-tested). */
export function parsePoseHash(hash: string): UrlPose | null {
  const m = /^#?p=([^#&]+)(?:&t=\d+)?$/.exec(hash ?? "");
  if (!m) return null;
  const parts = m[1].split(",");
  if (parts.length !== 5) return null;
  const nums = parts.map((s) => (s.trim() === "" ? Number.NaN : Number(s)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [latDeg, lonDeg, altM, headingDeg, tiltDeg] = nums;
  if (latDeg < -90 || latDeg > 90) return null;
  return {
    latDeg,
    lonDeg: wrapLon(lonDeg),
    altM: clamp(altM, ALT_MIN_M, ALT_MAX_M),
    headingDeg: wrapHeadingDeg(headingDeg),
    tiltDeg: clamp(tiltDeg, 0, 88),
  };
}

/** The custom scene time carried by a `#p=…&t=<utcMs>` or `#f=…&t=<utcMs>` hash, or null when
 *  absent/malformed (a live-time link carries no `t` by design). Pure — unit-tested. */
export function parseTimeHash(hash: string): number | null {
  const m = /^#?[pf]=[^#&]+&t=(\d{1,15})$/.exec(hash ?? "");
  if (!m) return null;
  const ms = Number(m[1]);
  // Sanity band: 1970 < t < ~year 3000 — a garbage instant must not scrub the scene.
  return ms > 0 && ms < 32_503_680_000_000 ? ms : null;
}

// --- FPV pose hash (owner 2026-07-14: shareable first-person views) -------------------------

/** A first-person viewpoint: viewer ground point + eye height above the LOCAL ground + the
 *  view direction + camera FOV — everything a temp-pin FPV needs to reproduce the framing. */
export interface UrlFpvPose {
  latDeg: number;
  lonDeg: number;
  /** Eye height above the rendered local ground (m) — terrain-relative on purpose. */
  eyeM: number;
  /** View-centre compass bearing (deg; 0 = north, 90 = east). */
  headingDeg: number;
  /** View-centre elevation (deg; + = up). */
  pitchDeg: number;
  /** Camera vertical FOV (deg) — carries the focal-length feel of the framing. */
  fovDeg: number;
}

const EYE_MIN_M = 0.5;
const EYE_MAX_M = 10_000;
const PITCH_MAX_DEG = 89;
const FOV_MIN_DEG = 1;
const FOV_MAX_DEG = 120;

/** FPV pose (+ optional custom scene time) → the full `#f=…[&t=…]` hash (pure — unit-tested).
 *  Precision: 6 dp lat/lon (~0.11 m — street-level needs it) · 0.1 m eye · 0.1° angles. */
export function formatFpvHash(f: UrlFpvPose, timeMs: number | null): string {
  const lat = clamp(f.latDeg, -90, 90).toFixed(6);
  const lon = wrapLon(f.lonDeg).toFixed(6);
  const eye = clamp(f.eyeM, EYE_MIN_M, EYE_MAX_M).toFixed(1);
  const heading = wrapHeadingDeg(f.headingDeg).toFixed(1);
  const pitch = clamp(f.pitchDeg, -PITCH_MAX_DEG, PITCH_MAX_DEG).toFixed(1);
  const fov = clamp(f.fovDeg, FOV_MIN_DEG, FOV_MAX_DEG).toFixed(1);
  const base = `#f=${lat},${lon},${eye},${heading},${pitch},${fov}`;
  return timeMs === null ? base : `${base}&t=${Math.round(timeMs)}`;
}

/** `#f=…` (leading `#` optional; a trailing `&t=…` is ignored) → FPV pose, or null on anything
 *  malformed (pure — unit-tested). */
export function parseFpvHash(hash: string): UrlFpvPose | null {
  const m = /^#?f=([^#&]+)(?:&t=\d+)?$/.exec(hash ?? "");
  if (!m) return null;
  const parts = m[1].split(",");
  if (parts.length !== 6) return null;
  const nums = parts.map((s) => (s.trim() === "" ? Number.NaN : Number(s)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [latDeg, lonDeg, eyeM, headingDeg, pitchDeg, fovDeg] = nums;
  if (latDeg < -90 || latDeg > 90) return null;
  return {
    latDeg,
    lonDeg: wrapLon(lonDeg),
    eyeM: clamp(eyeM, EYE_MIN_M, EYE_MAX_M),
    headingDeg: wrapHeadingDeg(headingDeg),
    pitchDeg: clamp(pitchDeg, -PITCH_MAX_DEG, PITCH_MAX_DEG),
    fovDeg: clamp(fovDeg, FOV_MIN_DEG, FOV_MAX_DEG),
  };
}

/** Longitude wrapped to [−180, 180) (pure). */
export function wrapLon(lonDeg: number): number {
  const w = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  return Object.is(w, -0) ? 0 : w;
}
