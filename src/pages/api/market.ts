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
import { publicPinCore } from "../../lib/pins/fields";
import { SITE_CURRENCY } from "../../lib/market/listing";

/** Map a PublicPins row to the client's PublicPin shape. Field reading lives in
 *  lib/pins/fields.ts `publicPinCore` (audit A6 — was a drift-prone local twin of
 *  store/pins.ts pinFromItem; the shared module is pure, so the locality concern —
 *  never import a zustand store or the globe tuning module here — stays satisfied). */
function marketPin(item: Record<string, unknown>): Record<string, unknown> | null {
  const core = publicPinCore(item);
  if (!core || !core.productId) return null; // marketplace rows require a listed product
  return {
    ...core,
    // Pre-currency-fix listings stored null — the site checkout is EUR regardless.
    currency: core.currency ?? SITE_CURRENCY,
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
