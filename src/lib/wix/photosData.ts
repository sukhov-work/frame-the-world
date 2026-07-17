/**
 * Shared elevated Photos helpers used by both /api/photos and /api/listings (Phase 6).
 * Server-only — pulls in @wix/data / @wix/stores which must never reach the client bundle.
 */
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { productsV3 } from "@wix/stores";

/** The member's own Photos row, or null when it doesn't exist / belongs to someone else. */
export async function ownedPhoto(photoId: string, memberId: string) {
  const row = await auth.elevate(items.get)("Photos", photoId).catch(() => null);
  return row && row.ownerMemberId === memberId ? row : null;
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
