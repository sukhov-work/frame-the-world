/**
 * Saved-places contract + record builders (owner 2026-07-15) — the PURE core of /api/places.
 *
 * A saved place is a PHOTO-LESS first-person viewpoint bookmark: exactly the `#f=` share-hash
 * fields (UrlFpvPose: viewer ground point, ground-relative eye height, view bearing/elevation,
 * camera FOV) plus an optional pinned scene time — everything a temp-pin FPV needs to reproduce
 * the framing. Same ranges/clamps as lib/geo/urlPose.ts so a saved place and a shared link can
 * never disagree about what a valid pose is.
 *
 * The endpoint stays thin (validate → auth → quota → write, per C1); everything unit-testable
 * lives here. C6 note: places hold the member's OWN exact pose in an ADMIN-only collection —
 * they are never published; nothing here feeds a world-readable row.
 */

import { numOrNull, strOrNull } from "../geo/coerce";
import { wrapHeadingDeg } from "../geo/heading";
import { wrapLon, type UrlFpvPose } from "../geo/urlPose";

/** Saved-places cap per member (matches the GET limit; small rows, no media — no paid tier). */
export const PLACE_QUOTA = 50;

/** Mirrors the urlPose clamp bands (EYE_MIN/MAX, PITCH_MAX, FOV_MIN/MAX) — one contract. */
const EYE_MIN_M = 0.5;
const EYE_MAX_M = 10_000;
const PITCH_MAX_DEG = 89;
const FOV_MIN_DEG = 1;
const FOV_MAX_DEG = 120;
/** Same sanity band as parseTimeHash: 1970 < t < ~year 3000. */
const TIME_MAX_MS = 32_503_680_000_000;

export interface SavePlaceBody extends UrlFpvPose {
  title: string;
  /** Pinned scene time (UTC ms) the view was saved at; null = the live wall clock. */
  timeMs: number | null;
}

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

const str = (v: unknown, maxLen: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= maxLen ? v : null;

/** Validate an untrusted request body into a SavePlaceBody, or name the offending field. */
export function parseSavePlaceBody(raw: unknown): { body: SavePlaceBody } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "body must be a JSON object" };
  const r = raw as Record<string, unknown>;

  const latDeg = num(r.latDeg, -90, 90);
  if (latDeg === null) return { error: "latDeg must be a number in [-90, 90]" };
  const lonRaw = num(r.lonDeg, -540, 540);
  if (lonRaw === null) return { error: "lonDeg must be a number" };
  const eyeM = num(r.eyeM, EYE_MIN_M, EYE_MAX_M);
  if (eyeM === null) return { error: `eyeM must be a number in [${EYE_MIN_M}, ${EYE_MAX_M}]` };
  const headingRaw = num(r.headingDeg, -720, 720);
  if (headingRaw === null) return { error: "headingDeg must be a number" };
  const pitchDeg = num(r.pitchDeg, -PITCH_MAX_DEG, PITCH_MAX_DEG);
  if (pitchDeg === null) return { error: `pitchDeg must be a number in [±${PITCH_MAX_DEG}]` };
  const fovDeg = num(r.fovDeg, FOV_MIN_DEG, FOV_MAX_DEG);
  if (fovDeg === null) return { error: `fovDeg must be a number in [${FOV_MIN_DEG}, ${FOV_MAX_DEG}]` };
  const timeMs = r.timeMs == null ? null : num(r.timeMs, 1, TIME_MAX_MS);
  if (r.timeMs != null && timeMs === null) return { error: "timeMs must be a UTC epoch ms" };

  return {
    body: {
      title: str(r.title, 120) ?? "Untitled place",
      latDeg,
      lonDeg: wrapLon(lonRaw),
      eyeM,
      headingDeg: wrapHeadingDeg(headingRaw),
      pitchDeg,
      fovDeg,
      timeMs,
    },
  };
}

/** The member-private SavedPlaces row (ADMIN-only collection; endpoint is the only writer). */
export function placeRecord(body: SavePlaceBody, ownerMemberId: string): Record<string, unknown> {
  return {
    title: body.title,
    ownerMemberId,
    lat: body.latDeg,
    lon: body.lonDeg,
    eyeM: body.eyeM,
    headingDeg: body.headingDeg,
    pitchDeg: body.pitchDeg,
    fovDeg: body.fovDeg,
    timeMs: body.timeMs,
  };
}

/** Owner-facing list row for GET /api/places — carries the FULL pose (the jump needs it). */
export interface PlaceListItem extends UrlFpvPose {
  id: string;
  title: string;
  timeMs: number | null;
  createdAt: string | null;
}

export function placeListItem(item: Record<string, unknown>): PlaceListItem | null {
  if (typeof item._id !== "string") return null;
  const latDeg = numOrNull(item.lat);
  const lonDeg = numOrNull(item.lon);
  const eyeM = numOrNull(item.eyeM);
  const headingDeg = numOrNull(item.headingDeg);
  const pitchDeg = numOrNull(item.pitchDeg);
  const fovDeg = numOrNull(item.fovDeg);
  // A place without a complete pose cannot be jumped into — drop the row defensively.
  if (
    latDeg === null ||
    lonDeg === null ||
    eyeM === null ||
    headingDeg === null ||
    pitchDeg === null ||
    fovDeg === null
  ) {
    return null;
  }
  const created = item._createdDate;
  return {
    id: item._id,
    title: strOrNull(item.title) ?? "Untitled place",
    latDeg,
    lonDeg,
    eyeM,
    headingDeg,
    pitchDeg,
    fovDeg,
    timeMs: numOrNull(item.timeMs),
    createdAt:
      created instanceof Date
        ? created.toISOString()
        : typeof created === "string"
          ? created
          : null,
  };
}
