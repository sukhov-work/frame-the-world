// /api/market — the PUBLIC listed-pins query (Phase 6.9, owner ruling 2026-07-17): everything
// currently for sale, for the MARKETPLACE browse panel. No auth — buyers browse signed-out.
// C6-safe by construction: rows come from PublicPins, which only ever holds reduced-precision
// coordinates (publicPinRecord is the sole writer); this endpoint adds no fields to what the
// world-readable collection already exposes to any visitor. GET /api/listings stays owner-only
// (it carries sales counts); this is the buyer-facing sibling.
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { json } from "../../lib/api/http";
import { numOrNull, strOrNull } from "../../lib/geo/coerce";
import { SITE_CURRENCY } from "../../lib/market/listing";

/** Map a PublicPins row to the client's PublicPin shape (the store/pins.ts pinFromItem twin —
 *  kept local so the endpoint never imports a zustand store or the globe tuning module). */
function marketPin(item: Record<string, unknown>): Record<string, unknown> | null {
  const lat = item.latReduced;
  const lon = item.lonReduced;
  const id = item._id;
  const productId = strOrNull(item.productId);
  if (typeof lat !== "number" || typeof lon !== "number" || typeof id !== "string" || !productId)
    return null;
  return {
    id,
    title: typeof item.title === "string" ? item.title : "Untitled",
    authorName: strOrNull(item.authorName),
    lat,
    lon,
    precision: typeof item.precision === "string" ? item.precision : "1km",
    previewUrl: strOrNull(item.previewUrl),
    capturedAt: strOrNull(item.capturedAt),
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
    productId,
    productVariantId: strOrNull(item.productVariantId),
    priceAmount: numOrNull(item.priceAmount),
    // Pre-currency-fix listings stored null — the site checkout is EUR regardless.
    currency: strOrNull(item.currency) ?? SITE_CURRENCY,
  };
}

export const GET: APIRoute = async () => {
  try {
    const res = await auth.elevate(items.query)("PublicPins")
      .isNotEmpty("productId")
      .descending("_createdDate")
      .limit(100)
      .find();
    const pins = (res.items as Record<string, unknown>[])
      .map(marketPin)
      .filter((p): p is Record<string, unknown> => p !== null);
    return json({ pins });
  } catch (e) {
    console.error("[market:list]", e);
    return json({ error: "MARKET_FAILED", message: "could not load the marketplace" }, 502);
  }
};
