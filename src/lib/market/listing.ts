/**
 * Marketplace-light (Phase 6) — the PURE core of listing a photo as a digital product.
 *
 * A member lists one of their OWN, already-PUBLIC pins for sale; the retained full-res original
 * (Photos.originalFileId, a private Wix Media file) becomes the digital asset. Wix Stores Catalog
 * V3 attaches it as a variant's secured digital file — verified end-to-end 2026-07-16
 * (mem:project/wip-2026-07-16-phase6-marketplace-research). The buy flow references the product by
 * its id; on payment a preinstalled Stores automation delivers the 30-day download link.
 *
 * Everything unit-testable lives here; the elevated SDK calls stay in the thin /api/listings route
 * (C1). NOTE: the site's Stores app is on Catalog **V3** — Catalog V1 is hard-rejected by the
 * gateway (`CATALOG_V3_CALLING_CATALOG_V1_API`), so V1 was never an option despite the seed's note.
 */

/**
 * The FIXED Wix-Stores catalog app id every Stores line item references at checkout — NOT the
 * metasite's installed-TPA id. Verified in @wix/auto_sdk_ecom_checkout CatalogReference.appId docs.
 */
export const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

/** Sanity ceiling for a listing price (site currency units). */
export const MAX_PRICE = 100_000;

/**
 * A pin's listing snapshot — mirrored from the Photos row onto the public pin for buyer display.
 * `variantId` is REQUIRED at checkout: a V3 Stores product resolves to a line item only via
 * `catalogReference.options.variantId` — a productId-only reference yields an EMPTY checkout
 * (verified against the live gateway 2026-07-16). It is null on an own-pin snapshot (the owner
 * never buys) and on pre-Phase-6 rows.
 */
export interface PinListing {
  productId: string;
  variantId: string | null;
  priceAmount: number | null;
  currency: string | null;
}

/** The V3 digital-product create input (camelCase; `digitalFile._id` is the SDK field name). */
export interface DigitalProductInput {
  name: string;
  productType: "DIGITAL";
  variantsInfo: {
    variants: Array<{
      price: { actualPrice: { amount: string } };
      digitalProperties: { digitalFile: { _id: string } };
    }>;
  };
}

/**
 * Build the `productsV3.createProduct` input for a photo listing. Single digital variant priced at
 * `priceAmount` (site currency), the secured file = the retained original's Wix Media id.
 */
export function buildDigitalProduct(
  name: string,
  priceAmount: number,
  originalFileId: string,
): DigitalProductInput {
  return {
    name: name && name.length > 0 ? name.slice(0, 80) : "Untitled photo",
    productType: "DIGITAL",
    variantsInfo: {
      variants: [
        {
          price: { actualPrice: { amount: priceAmount.toFixed(2) } },
          digitalProperties: { digitalFile: { _id: originalFileId } },
        },
      ],
    },
  };
}

/** Normalize a user-entered price into a clean 2-dp positive number, or null when invalid. */
export function normalizePrice(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return null;
  return Math.round(n * 100) / 100;
}

/** Validate an untrusted POST /api/listings body into { photoId, priceAmount }, or name the error. */
export function parseListBody(raw: unknown): { photoId: string; priceAmount: number } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "body must be a JSON object" };
  const r = raw as Record<string, unknown>;
  const photoId = typeof r.photoId === "string" && r.photoId.length > 0 && r.photoId.length <= 64 ? r.photoId : null;
  if (!photoId) return { error: "photoId is required" };
  const priceAmount = normalizePrice(r.priceAmount);
  if (priceAmount === null) return { error: `priceAmount must be a number in (0, ${MAX_PRICE}]` };
  return { photoId, priceAmount };
}

/** Human-facing price label — "12.50 USD" or, when the store currency is unknown, just "12.50". */
export function formatPrice(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "";
  const n = amount.toFixed(2).replace(/\.00$/, "");
  return currency ? `${n} ${currency}` : n;
}
