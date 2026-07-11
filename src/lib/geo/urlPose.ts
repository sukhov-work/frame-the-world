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

/** `#p=…` (leading `#` optional) → pose, or null on anything malformed (pure — unit-tested). */
export function parsePoseHash(hash: string): UrlPose | null {
  const m = /^#?p=([^#]+)$/.exec(hash ?? "");
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

/** Longitude wrapped to [−180, 180) (pure). */
export function wrapLon(lonDeg: number): number {
  const w = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  return Object.is(w, -0) ? 0 : w;
}
