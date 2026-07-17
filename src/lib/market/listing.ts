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
 * The site's checkout currency, written onto every listing at creation time. A constant because
 * no installed SDK exposes it cleanly: productsV3 never echoes currency, and @wix/ecom's
 * ecommerce-settings BUSINESS_INFO is typed `{}` on the public build (internal-only fields,
 * verified 2026-07-17) — the Checkout entity carries it, but only at buy time. The store is
 * configured in EUR; change here if the site currency ever changes.
 */
export const SITE_CURRENCY = "EUR";

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

/**
 * The V3 digital-product create input (camelCase; `digitalFile._id` is the SDK field name).
 * `inventoryItem.inStock: true` is the V3 "tracked by status" method — available for sale with NO
 * quantity limit. Without it `createProduct` defaults to tracked quantity 0 and checkout blocks
 * with OUT OF STOCK (hit live 2026-07-17 on the €7.50 test listing) — a digital file never runs
 * out, so every listing ships untracked. Requires `createProductWithInventory` (plain
 * `createProduct` ignores the field).
 */
export interface DigitalProductInput {
  name: string;
  productType: "DIGITAL";
  variantsInfo: {
    variants: Array<{
      price: { actualPrice: { amount: string } };
      digitalProperties: { digitalFile: { _id: string } };
      inventoryItem: { inStock: true };
    }>;
  };
}

/**
 * Build the `productsV3.createProductWithInventory` input for a photo listing. Single digital
 * variant priced at `priceAmount` (site currency), the secured file = the retained original's
 * Wix Media id, inventory untracked (unlimited — nobody manages stock on a digital file).
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
          inventoryItem: { inStock: true },
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

/** Symbol-prefixed currencies; anything else renders as an ISO suffix ("12.50 CHF"). */
const CURRENCY_SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", UAH: "₴" };

/** Human-facing price label — "€12.50" / "12.50 CHF"; pre-currency-fix rows (null) → just "12.50". */
export function formatPrice(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "";
  const n = amount.toFixed(2).replace(/\.00$/, "");
  if (!currency) return n;
  const symbol = CURRENCY_SYMBOL[currency];
  return symbol ? `${symbol}${n}` : `${n} ${currency}`;
}
