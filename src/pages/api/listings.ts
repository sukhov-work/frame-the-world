// /api/listings — marketplace-light (Phase 6). Self-serve: a member lists one of their OWN,
// already-PUBLIC pins as a Wix Stores Catalog V3 DIGITAL product whose digital file = the retained
// full-res original (Photos.originalFileId). On payment a preinstalled Stores automation delivers
// the 30-day download link; the site owner marks the manual payment paid + pays out in the Wix
// dashboard (C3 — no split payments). Thin per C1: validate → auth → owner/asset gate → SDK write.
//   POST   {photoId, priceAmount}  — list for sale (idempotent: an already-listed photo returns it)
//   DELETE ?photoId=               — unlist (delete the product + clear both rows)
//   GET                            — the caller's listings + a PAID-order count each ("sales")
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { orders } from "@wix/ecom";
import { json, requireMember } from "../../lib/api/http";
import { ownedPhoto, deleteListingProduct, createListingProduct } from "../../lib/wix/photosData";
import { parseListBody, SITE_CURRENCY } from "../../lib/market/listing";

/** Denormalize the listing onto the linked PublicPins row so buyers see it on the shared globe. */
async function writePublicListing(
  publicPinId: unknown,
  fields: {
    productId: string | null;
    productVariantId: string | null;
    priceAmount: number | null;
    currency: string | null;
  },
): Promise<void> {
  if (typeof publicPinId !== "string" || publicPinId.length === 0) return;
  const pin = await auth.elevate(items.get)("PublicPins", publicPinId).catch(() => null);
  if (pin) await auth.elevate(items.update)("PublicPins", { ...pin, ...fields });
}

export const POST: APIRoute = async ({ request }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to list a photo" }, 401);

  const parsed = parseListBody(await request.json().catch(() => null));
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
  const { photoId, priceAmount } = parsed;

  try {
    const photo = await ownedPhoto(photoId, member._id);
    if (!photo) return json({ error: "NOT_FOUND", message: "no such pin of yours" }, 404);

    const originalFileId = typeof photo.originalFileId === "string" ? photo.originalFileId : "";
    if (!originalFileId)
      return json({ error: "NO_ASSET", message: "this pin has no stored original to sell" }, 409);
    if (photo.isPublic !== true)
      return json({ error: "NOT_PUBLIC", message: "make the pin public before listing it" }, 409);

    // Idempotent: an already-listed photo returns its listing rather than creating a second product.
    if (typeof photo.productId === "string" && photo.productId.length > 0) {
      return json({
        productId: photo.productId,
        priceAmount: typeof photo.priceAmount === "number" ? photo.priceAmount : priceAmount,
        currency: typeof photo.currency === "string" ? photo.currency : SITE_CURRENCY,
        alreadyListed: true,
      });
    }

    const name = typeof photo.title === "string" ? photo.title : "Untitled photo";
    const { productId, productVariantId, currency } = await createListingProduct(
      name,
      priceAmount,
      originalFileId,
    );

    await auth.elevate(items.update)("Photos", {
      ...photo,
      productId,
      productVariantId,
      priceAmount,
      currency,
    });
    await writePublicListing(photo.publicPinId, { productId, productVariantId, priceAmount, currency });

    return json({ productId, productVariantId, priceAmount, currency });
  } catch (e) {
    console.error("[listings:create]", e);
    return json({ error: "LIST_FAILED", message: "could not list the photo for sale" }, 502);
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to unlist" }, 401);
  const photoId = url.searchParams.get("photoId") ?? url.searchParams.get("id");
  if (!photoId) return json({ error: "BAD_REQUEST", message: "photoId query param required" }, 400);

  try {
    const photo = await ownedPhoto(photoId, member._id);
    if (!photo) return json({ error: "NOT_FOUND", message: "no such pin of yours" }, 404);

    const productId = typeof photo.productId === "string" ? photo.productId : null;
    if (productId) await deleteListingProduct(productId);

    await auth.elevate(items.update)("Photos", {
      ...photo,
      productId: null,
      productVariantId: null,
      priceAmount: null,
      currency: null,
    });
    await writePublicListing(photo.publicPinId, {
      productId: null,
      productVariantId: null,
      priceAmount: null,
      currency: null,
    });

    return json({ unlisted: true });
  } catch (e) {
    console.error("[listings:delete]", e);
    return json({ error: "UNLIST_FAILED", message: "could not unlist the photo" }, 502);
  }
};

export const GET: APIRoute = async () => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to see your sales" }, 401);

  try {
    const res = await auth.elevate(items.query)("Photos")
      .eq("ownerMemberId", member._id)
      .descending("_createdDate")
      .limit(100)
      .find();
    const listings = (res.items as Record<string, unknown>[])
      .filter((p) => typeof p.productId === "string" && (p.productId as string).length > 0)
      .map((p) => ({
        photoId: p._id as string,
        title: typeof p.title === "string" ? p.title : "Untitled",
        previewUrl: typeof p.previewUrl === "string" ? p.previewUrl : null,
        productId: p.productId as string,
        priceAmount: typeof p.priceAmount === "number" ? p.priceAmount : null,
        // Pre-currency-fix rows stored null — every checkout on this site is EUR regardless.
        currency: typeof p.currency === "string" ? p.currency : SITE_CURRENCY,
        soldCount: 0,
      }));

    // Best-effort sold count — a failing orders query still returns the listings (the payout is
    // done in the Wix dashboard regardless). Orders reads need the APP identity → elevate().
    if (listings.length > 0) {
      try {
        const ids = listings.map((l) => l.productId);
        const search = await auth.elevate(orders.searchOrders)({
          filter: {
            paymentStatus: "PAID",
            "lineItems.catalogReference.catalogItemId": { $hasSome: ids },
          },
          cursorPaging: { limit: 100 },
        });
        const counts = new Map<string, number>();
        for (const o of search.orders ?? []) {
          for (const li of ((o as Record<string, unknown>).lineItems as Record<string, unknown>[]) ?? []) {
            const cid = (li?.catalogReference as Record<string, unknown> | undefined)?.catalogItemId;
            if (typeof cid === "string") counts.set(cid, (counts.get(cid) ?? 0) + 1);
          }
        }
        for (const l of listings) l.soldCount = counts.get(l.productId) ?? 0;
      } catch (e) {
        console.warn("[listings:sales] order count unavailable", e);
      }
    }

    return json({ listings });
  } catch (e) {
    console.error("[listings:list]", e);
    return json({ error: "SALES_FAILED", message: "could not load your listings" }, 502);
  }
};
