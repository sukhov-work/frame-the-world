/**
 * Save-pin contract + record builders (Phase 5) — the PURE core of POST /api/photos.
 *
 * The endpoint stays thin (validate → auth → quota → insert, per C1); everything that can be
 * unit-tested lives here. C6 (BINDING) is enforced structurally: `publicPinRecord` is the ONLY
 * way a PublicPins row is built, and every location field it emits comes from
 * `reduceLocation` — client-supplied "reduced" values or extra fields can never leak through.
 */

import { encodeGeohash } from "../geo/geohash";
import { numOrNull, strOrNull } from "../geo/coerce";
import { isPrecisionTier, reduceLocation, type PrecisionTier } from "../geo/precision";
import { pinOpticsFields, type CameraPoseOptics } from "../pins/fields";
import type { PinListing } from "../market/listing";

/** Free-tier pin quota (owner re-ruling 2026-07-17, supersedes D8's 10): save #101 is refused. */
export const PIN_QUOTA_FREE = 100;

/** Premium-tier pin quota (owner ruling 2026-07-17 — was "unlimited"): a hard ceiling too. */
export const PIN_QUOTA_PREMIUM = 1000;

/**
 * Public display label for a member: nickname → login-email user part → "Member".
 * Server-side twin of `memberLabel` in store/member.ts (kept separate so the endpoint never
 * imports a client store). A display name is NOT location data — C6 governs coordinates only;
 * the owner explicitly wants authorship on public pins (Phase 5.5 S3).
 */
export function authorLabel(nickname?: string | null, loginEmail?: string | null): string {
  if (nickname) return nickname;
  if (loginEmail) return loginEmail.split("@")[0];
  return "Member";
}

export interface SavePinBody extends CameraPoseOptics {
  title: string;
  lat: number;
  lon: number;
  fovEstimated: boolean;
  /** TZ-naive EXIF local ISO string, stored verbatim (mem:patterns/upload-flow). */
  capturedAt: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  originalFileId: string | null;
  previewFileId: string | null;
  previewUrl: string | null;
  isPublic: boolean;
  precision: PrecisionTier;
}

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

const str = (v: unknown, maxLen: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= maxLen ? v : null;

/** Validate an untrusted request body into a SavePinBody, or name the offending field. */
export function parseSavePinBody(raw: unknown): { body: SavePinBody } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "body must be a JSON object" };
  const r = raw as Record<string, unknown>;

  const lat = num(r.lat, -90, 90);
  const lon = num(r.lon, -180, 180);
  if (lat === null) return { error: "lat must be a number in [-90, 90]" };
  if (lon === null) return { error: "lon must be a number in [-180, 180]" };
  if (!isPrecisionTier(r.precision)) return { error: "precision must be exact | 1km | city" };

  return {
    body: {
      title: str(r.title, 120) ?? "Untitled",
      lat,
      lon,
      altitudeM: num(r.altitudeM, -500, 20_000),
      headingDeg: num(r.headingDeg, -360, 360),
      pitchDeg: num(r.pitchDeg, -90, 90),
      rollDeg: num(r.rollDeg, -180, 180),
      focalLengthMm: num(r.focalLengthMm, 0.1, 5_000),
      hFovDeg: num(r.hFovDeg, 0.1, 179),
      fovEstimated: r.fovEstimated === true,
      capturedAt: str(r.capturedAt, 40),
      cameraMake: str(r.cameraMake, 80),
      cameraModel: str(r.cameraModel, 80),
      lensModel: str(r.lensModel, 120),
      textureWidth: num(r.textureWidth, 1, 100_000),
      textureHeight: num(r.textureHeight, 1, 100_000),
      fileName: str(r.fileName, 255),
      fileSizeBytes: num(r.fileSizeBytes, 0, 100_000_000_000),
      originalFileId: str(r.originalFileId, 255),
      previewFileId: str(r.previewFileId, 255),
      previewUrl: str(r.previewUrl, 2_000),
      isPublic: r.isPublic === true,
      precision: r.precision,
    },
  };
}

/**
 * Validate an untrusted UPDATE body (PATCH /api/photos): `photoId` + the same pin fields a
 * save carries. Media/file fields are typically absent on updates (they were minted at save
 * time) — `applyPinUpdate` keeps the stored values for any that arrive null.
 */
export function parseUpdatePinBody(
  raw: unknown,
): { photoId: string; body: SavePinBody } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "body must be a JSON object" };
  const photoId = str((raw as Record<string, unknown>).photoId, 64);
  if (!photoId) return { error: "photoId is required" };
  const parsed = parseSavePinBody(raw);
  if ("error" in parsed) return parsed;
  return { photoId, body: parsed.body };
}

/**
 * Merge an update into the existing Photos row (pure core of PATCH /api/photos).
 * Null media/file fields in the patch KEEP the stored values — the client edit flow never
 * re-uploads media. Returns the full Photos row to write plus the effective SavePinBody that
 * drives the PublicPins re-derivation (C6: a location edit re-reduces to the cell centre
 * because `publicPinRecord` remains the only builder of public rows).
 */
export function applyPinUpdate(
  existing: Record<string, unknown>,
  body: SavePinBody,
): { record: Record<string, unknown>; effective: SavePinBody } {
  const effective: SavePinBody = {
    ...body,
    fileName: body.fileName ?? strOrNull(existing.fileName),
    fileSizeBytes: body.fileSizeBytes ?? numOrNull(existing.fileSizeBytes),
    originalFileId: body.originalFileId ?? strOrNull(existing.originalFileId),
    previewFileId: body.previewFileId ?? strOrNull(existing.previewFileId),
    previewUrl: body.previewUrl ?? strOrNull(existing.previewUrl),
  };
  const record = {
    ...existing,
    ...photoRecord(effective, String(existing.ownerMemberId ?? "")),
    _id: existing._id,
    // photoRecord() nulls the link for fresh saves — an update must keep it (the caller
    // reconciles it after the PublicPins insert/remove).
    publicPinId: existing.publicPinId ?? null,
  };
  return { record, effective };
}

/** The owner-private Photos row — exact GPS lives here and only here. */
export function photoRecord(body: SavePinBody, ownerMemberId: string): Record<string, unknown> {
  return {
    title: body.title,
    ownerMemberId,
    lat: body.lat,
    lon: body.lon,
    altitudeM: body.altitudeM,
    headingDeg: body.headingDeg,
    pitchDeg: body.pitchDeg,
    rollDeg: body.rollDeg,
    focalLengthMm: body.focalLengthMm,
    hFovDeg: body.hFovDeg,
    fovEstimated: body.fovEstimated,
    geohash9: encodeGeohash(body.lat, body.lon, 9),
    capturedAt: body.capturedAt,
    cameraMake: body.cameraMake,
    cameraModel: body.cameraModel,
    lensModel: body.lensModel,
    textureWidth: body.textureWidth,
    textureHeight: body.textureHeight,
    fileName: body.fileName,
    fileSizeBytes: body.fileSizeBytes,
    originalFileId: body.originalFileId,
    previewFileId: body.previewFileId,
    previewUrl: body.previewUrl,
    isPublic: body.isPublic,
    publicPrecision: body.isPublic ? body.precision : null,
    publicPinId: null,
  };
}

/** Slim owner-facing list row for GET /api/photos (the rudimentary "My pins" list). The
 *  owner sees their own exact data — C6 governs PUBLIC records, not this member-only view. */
// The pose fields (altitudeM … lensModel) let a list row re-open as the full camera view — the
// owner sees their own exact data (C6 governs PUBLIC records, not this member-only view).
export interface PhotoListItem extends CameraPoseOptics {
  id: string;
  title: string;
  previewUrl: string | null;
  capturedAt: string | null;
  lat: number | null;
  lon: number | null;
  isPublic: boolean;
  publicPrecision: string | null;
  createdAt: string | null;
  /** Marketplace (Phase 6): the Stores product id when this photo is listed for sale (else null). */
  productId: string | null;
  priceAmount: number | null;
  currency: string | null;
}

export function photoListItem(item: Record<string, unknown>): PhotoListItem | null {
  if (typeof item._id !== "string") return null;
  const created = item._createdDate;
  return {
    id: item._id,
    title: typeof item.title === "string" ? item.title : "Untitled",
    previewUrl: strOrNull(item.previewUrl),
    capturedAt: strOrNull(item.capturedAt),
    lat: numOrNull(item.lat),
    lon: numOrNull(item.lon),
    isPublic: item.isPublic === true,
    publicPrecision: strOrNull(item.publicPrecision),
    createdAt:
      created instanceof Date
        ? created.toISOString()
        : typeof created === "string"
          ? created
          : null,
    ...pinOpticsFields(item), // ONE optics reader — lib/pins/fields.ts (audit A6)
    productId: strOrNull(item.productId),
    priceAmount: numOrNull(item.priceAmount),
    currency: strOrNull(item.currency),
  };
}

/**
 * The world-readable PublicPins row (C6). Location fields derive exclusively from
 * `reduceLocation(exact, tier)` — for reduced tiers that is the geohash cell CENTER, so the
 * published coordinates carry no more than the tier's cell-size information.
 */
export function publicPinRecord(
  body: SavePinBody,
  photoRef: string,
  authorName: string | null = null,
  listing: PinListing | null = null,
): Record<string, unknown> {
  const reduced = reduceLocation(body.lat, body.lon, body.precision);
  return {
    title: body.title,
    photoRef,
    // Denormalized display label (Phase 5.5 S3) — identity, not location; C6-compatible.
    authorName,
    latReduced: reduced.latReduced,
    lonReduced: reduced.lonReduced,
    geohash: reduced.geohash,
    gh4: reduced.gh4,
    gh6: reduced.gh6,
    precision: reduced.precision,
    previewUrl: body.previewUrl,
    capturedAt: body.capturedAt,
    // Camera POSE (not location) — powers the "open pin as camera view" experience for
    // everyone. C6 governs the coordinates; orientation/optics reveal nothing about where.
    altitudeM: body.altitudeM,
    headingDeg: body.headingDeg,
    pitchDeg: body.pitchDeg,
    rollDeg: body.rollDeg,
    focalLengthMm: body.focalLengthMm,
    hFovDeg: body.hFovDeg,
    textureWidth: body.textureWidth,
    textureHeight: body.textureHeight,
    cameraMake: body.cameraMake,
    cameraModel: body.cameraModel,
    lensModel: body.lensModel,
    // Marketplace (Phase 6): denormalized so buyers see "for sale" + price. A PATCH rebuild MUST
    // pass the existing listing (from the Photos row) or the public row would lose it — /api/photos
    // does exactly that. Buyers/globe read productId+variantId+price; not location data (C6-ok).
    productId: listing?.productId ?? null,
    productVariantId: listing?.variantId ?? null,
    priceAmount: listing?.priceAmount ?? null,
    currency: listing?.currency ?? null,
  };
}
