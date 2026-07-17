/**
 * Shared elevated Photos helpers used by both /api/photos and /api/listings (Phase 6).
 * Server-only — pulls in @wix/data / @wix/stores which must never reach the client bundle.
 */
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { productsV3 } from "@wix/stores";
import { buildDigitalProduct, SITE_CURRENCY } from "../market/listing";

/** The member's own Photos row, or null when it doesn't exist / belongs to someone else. */
export async function ownedPhoto(photoId: string, memberId: string) {
  const row = await auth.elevate(items.get)("Photos", photoId).catch(() => null);
  return row && row.ownerMemberId === memberId ? row : null;
}

/** The created Stores product identifiers a listing stamps onto the Photos/PublicPins rows. */
export interface CreatedListing {
  productId: string;
  productVariantId: string | null;
  currency: string;
}

/**
 * Create the Stores Catalog V3 DIGITAL product for a listing (shared by /api/listings and the
 * dev-only seed route). WithInventory variant: plain createProduct defaults to tracked qty 0 →
 * OUT OF STOCK at checkout (hit live 2026-07-17); buildDigitalProduct marks the variant inStock
 * (untracked/unlimited — nobody manages stock on a digital file).
 */
export async function createListingProduct(
  name: string,
  priceAmount: number,
  originalFileId: string,
): Promise<CreatedListing> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the V3Product type is vast; the
  // create input is validated by buildDigitalProduct + the live gateway (verified 2026-07-16).
  const created: any = await auth.elevate(productsV3.createProductWithInventory)(
    buildDigitalProduct(name, priceAmount, originalFileId) as never,
  );
  const product = created?.product ?? created;
  const productId: string | undefined = product?._id ?? product?.id;
  if (!productId) throw new Error("createProduct returned no product id");
  const productVariantId: string | null = product?.variantsInfo?.variants?.[0]?._id ?? null;
  // createProduct does not echo a currency anywhere (verified 2026-07-17) — badges rendered a
  // bare "7.50" on a EUR store. The site constant is the honest source (see SITE_CURRENCY).
  const currency: string =
    product?.variantsInfo?.variants?.[0]?.price?.actualPrice?.currency ??
    product?.actualPriceRange?.minValue?.currency ??
    SITE_CURRENCY;
  return { productId, productVariantId, currency };
}

/**
 * Best-effort teardown of a listing's Stores Catalog V3 product (unlist / photo-delete). A
 * failure never blocks clearing the pin — orders keep their own snapshot of the sold item, so a
 * lingering product is harmless; an orphaned productId on a deleted pin is the worse outcome.
 */
export async function deleteListingProduct(productId: string): Promise<boolean> {
  try {
    await auth.elevate(productsV3.deleteProduct)(productId);
    return true;
  } catch (e) {
    console.warn("[listings] product delete failed — clearing the pin anyway", e);
    return false;
  }
}
