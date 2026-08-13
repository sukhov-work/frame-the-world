/**
 * Camera pose + optics fields shared by every pin shape (B9). The same 11 nullable fields appear on
 * the private Photos row (SavePinBody), the owner list row (PhotoListItem), the public row's client
 * shape (PublicPin) and a re-opened saved-pin view (SavedPinView, as `Partial`). Orientation/optics
 * are NOT location — C6 governs coordinates only, so these travel on public records too.
 */
import { numOrNull, strOrNull } from "../geo/coerce";
import { DEFAULT_PRECISION_TIER } from "../geo/precision";

export interface CameraPoseOptics {
  altitudeM: number | null;
  headingDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  focalLengthMm: number | null;
  hFovDeg: number | null;
  textureWidth: number | null;
  textureHeight: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
}

// ---------------------------------------------------------------------------------------------
// Row mappers (audit A6, 2026-08-13): the field-reading twins of the types above were
// copy-pasted across lib/wix/pinRecords.ts (Photos rows), api/market.ts (buyer rows) and
// store/pins.ts (globe rows) — three drift-prone copies over the SAME collection shape (the
// Photos↔PublicPins-divergence class). ONE reader lives here now. Pure module: safe for server
// routes, lib/wix and client stores alike (no zustand, no tuning, no @wix imports — the
// locality concern documented in api/market.ts stays satisfied).
// ---------------------------------------------------------------------------------------------

/** Read the CameraPoseOptics block off a raw Wix Data item (Photos and PublicPins name-parity). */
export function pinOpticsFields(item: Record<string, unknown>): CameraPoseOptics {
  return {
    altitudeM: numOrNull(item.altitudeM),
    headingDeg: numOrNull(item.headingDeg),
    pitchDeg: numOrNull(item.pitchDeg),
    rollDeg: numOrNull(item.rollDeg),
    focalLengthMm: numOrNull(item.focalLengthMm),
    hFovDeg: numOrNull(item.hFovDeg),
    textureWidth: numOrNull(item.textureWidth),
    textureHeight: numOrNull(item.textureHeight),
    cameraMake: strOrNull(item.cameraMake),
    cameraModel: strOrNull(item.cameraModel),
    lensModel: strOrNull(item.lensModel),
  };
}

/** The marketplace linkage block (Phase 6). Not location data — C6-ok. */
function pinProductFields(item: Record<string, unknown>) {
  return {
    productId: strOrNull(item.productId),
    productVariantId: strOrNull(item.productVariantId),
    priceAmount: numOrNull(item.priceAmount),
    currency: strOrNull(item.currency),
  };
}

/**
 * Map a world-readable PublicPins row to the client pin shape. Defensive: bad rows → null.
 * lat/lon read ONLY the reduced fields (C6) — this mapping now lives in exactly one place.
 */
export function publicPinCore(item: Record<string, unknown>) {
  const lat = item.latReduced;
  const lon = item.lonReduced;
  const id = item._id;
  if (typeof lat !== "number" || typeof lon !== "number" || typeof id !== "string") return null;
  return {
    id,
    title: typeof item.title === "string" ? item.title : "Untitled",
    authorName: strOrNull(item.authorName),
    lat,
    lon,
    precision: typeof item.precision === "string" ? item.precision : DEFAULT_PRECISION_TIER as string,
    previewUrl: strOrNull(item.previewUrl),
    capturedAt: strOrNull(item.capturedAt),
    ...pinOpticsFields(item),
    ...pinProductFields(item),
  };
}
