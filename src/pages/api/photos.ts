// /api/photos — the pin lifecycle endpoint (ARCHITECTURE §6): GET list · POST save ·
// PATCH update · DELETE remove. Thin per C1: validate → auth → quota/owner gate → write.
// This endpoint is the ONLY writer of the Photos and PublicPins collections (both are
// ADMIN-only on the platform side), which makes two invariants structural:
//   • quota — a free member's 11th photo is refused HERE, and the collections refuse direct
//     member-session writes, so the wall cannot be bypassed from the client;
//   • C6 — the PublicPins row is built by publicPinRecord (reduced-precision derivation only);
//     exact GPS is never written to a public record — location EDITS re-reduce the same way.
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { files } from "@wix/media";
import { orders } from "@wix/pricing-plans";
import { json, requireMember } from "../../lib/api/http";
import { numOrNull, strOrNull } from "../../lib/geo/coerce";
import { ownedPhoto, deleteListingProduct } from "../../lib/wix/photosData";
import type { PinListing } from "../../lib/market/listing";
import {
  applyPinUpdate,
  authorLabel,
  parseSavePinBody,
  parseUpdatePinBody,
  photoListItem,
  photoRecord,
  PIN_QUOTA_FREE,
  PIN_QUOTA_PREMIUM,
  publicPinRecord,
  type PhotoListItem,
} from "../../lib/wix/pinRecords";

/** The listing snapshot carried on a Photos row (Phase 6) — null when the photo is not for sale. */
function rowListing(row: Record<string, unknown>): PinListing | null {
  const productId = strOrNull(row.productId);
  return productId
    ? {
        productId,
        variantId: strOrNull(row.productVariantId),
        priceAmount: numOrNull(row.priceAmount),
        currency: strOrNull(row.currency),
      }
    : null;
}

/** Paid = any ACTIVE pricing-plan order for the calling member (member context, not elevated). */
async function hasActivePlan(): Promise<boolean> {
  try {
    const res = await orders.memberListOrders({ orderStatuses: ["ACTIVE"] });
    return (res.orders ?? []).length > 0;
  } catch (e) {
    // No Pricing Plans app / no orders yet must read as FREE, never as unlimited.
    console.warn("[photos] memberListOrders failed — treating member as free tier", e);
    return false;
  }
}

// GET /api/photos — the member's own saved pins, newest first (the rudimentary "My pins"
// list until a proper gallery phase). Photos is ADMIN-only on the platform, so the owner's
// view goes through this elevated, owner-filtered query — never a client-side collection read.
export const GET: APIRoute = async () => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to list pins" }, 401);

  try {
    const res = await auth.elevate(items.query)("Photos")
      .eq("ownerMemberId", member._id)
      .descending("_createdDate")
      .limit(50)
      .find();
    const photos = (res.items as Record<string, unknown>[])
      .map(photoListItem)
      .filter((p): p is PhotoListItem => p !== null);
    return json({ photos, quota: { used: photos.length, limit: PIN_QUOTA_FREE } });
  } catch (e) {
    console.error("[photos:list]", e);
    return json({ error: "LIST_FAILED", message: "could not list pins" }, 502);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const member = await requireMember({ full: true });
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to save pins" }, 401);

  const parsed = parseSavePinBody(await request.json().catch(() => null));
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
  const body = parsed.body;

  try {
    const used = await auth.elevate(items.query)("Photos")
      .eq("ownerMemberId", member._id)
      .count();

    // Two-tier quota (owner 2026-07-17): free 100 · premium 1000. The plan lookup runs only
    // once the free wall is hit, so the common save path stays a single count query.
    if (used >= PIN_QUOTA_FREE) {
      const premium = await hasActivePlan();
      const limit = premium ? PIN_QUOTA_PREMIUM : PIN_QUOTA_FREE;
      if (used >= limit) {
        return json(
          {
            error: "QUOTA_EXCEEDED",
            message: premium
              ? `premium holds ${PIN_QUOTA_PREMIUM} pins — delete some to add more`
              : `free plan holds ${PIN_QUOTA_FREE} pins — upgrade for ${PIN_QUOTA_PREMIUM}`,
            premium,
            quota: { used, limit },
          },
          402,
        );
      }
    }

    const photo = await auth.elevate(items.insert)("Photos", photoRecord(body, member._id));

    let publicPinId: string | null = null;
    if (body.isPublic) {
      const pin = await auth.elevate(items.insert)(
        "PublicPins",
        publicPinRecord(body, photo._id, authorLabel(member.profile?.nickname, member.loginEmail)),
      );
      publicPinId = pin._id;
      await auth.elevate(items.update)("Photos", { ...photo, publicPinId });
    }

    return json({
      photoId: photo._id,
      publicPinId,
      quota: { used: used + 1, limit: PIN_QUOTA_FREE },
    });
  } catch (e) {
    console.error("[photos]", e);
    return json({ error: "SAVE_FAILED", message: "could not save the pin" }, 502);
  }
};

// PATCH /api/photos {photoId, …SavePinBody} — owner-gated update. The PublicPins row is
// re-derived through the same server-only publicPinRecord (C6 stays structural: a location
// edit publishes only the new cell centre); toggling isPublic creates/removes the public row.
export const PATCH: APIRoute = async ({ request }) => {
  const member = await requireMember({ full: true });
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to edit pins" }, 401);

  const parsed = parseUpdatePinBody(await request.json().catch(() => null));
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
  const { photoId, body } = parsed;

  try {
    const existing = await ownedPhoto(photoId, member._id);
    if (!existing) return json({ error: "NOT_FOUND", message: "no such pin of yours" }, 404);

    const { record, effective } = applyPinUpdate(existing, body);
    const prevPinId = typeof existing.publicPinId === "string" ? existing.publicPinId : null;
    let publicPinId = prevPinId;
    // Listing (Phase 6) rides on the Photos row; photoRecord() doesn't touch it, so `record`
    // (…existing) already keeps it across an edit. The PUBLIC row is rebuilt from scratch, so the
    // listing must be passed through publicPinRecord or the edit would drop "for sale".
    const listing = rowListing(existing);

    if (effective.isPublic) {
      const pinRow = publicPinRecord(
        effective,
        photoId,
        authorLabel(member.profile?.nickname, member.loginEmail),
        listing,
      );
      if (prevPinId) {
        await auth.elevate(items.update)("PublicPins", { ...pinRow, _id: prevPinId });
      } else {
        const pin = await auth.elevate(items.insert)("PublicPins", pinRow);
        publicPinId = pin._id;
      }
    } else if (prevPinId) {
      await auth.elevate(items.remove)("PublicPins", prevPinId);
      publicPinId = null;
    }

    // A photo turned private can no longer be sold — tear down any active listing (C6/marketplace).
    if (!effective.isPublic && listing) {
      await deleteListingProduct(listing.productId);
      record.productId = null;
      record.productVariantId = null;
      record.priceAmount = null;
      record.currency = null;
    }

    record.publicPinId = publicPinId;
    await auth.elevate(items.update)("Photos", record as { _id: string });

    return json({ photoId, publicPinId });
  } catch (e) {
    console.error("[photos:update]", e);
    return json({ error: "UPDATE_FAILED", message: "could not update the pin" }, 502);
  }
};

// DELETE /api/photos?id= — owner-gated removal: PublicPins row (linked id, else a defensive
// photoRef lookup), the Photos row, then the media files best-effort (a stuck file must never
// leave a ghost pin). Frees a quota slot — the response carries the fresh count.
export const DELETE: APIRoute = async ({ url }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to delete pins" }, 401);

  const photoId = url.searchParams.get("id");
  if (!photoId) return json({ error: "BAD_REQUEST", message: "id query param required" }, 400);

  try {
    const existing = await ownedPhoto(photoId, member._id);
    if (!existing) return json({ error: "NOT_FOUND", message: "no such pin of yours" }, 404);

    let pinId = typeof existing.publicPinId === "string" ? existing.publicPinId : null;
    if (!pinId) {
      const res = await auth.elevate(items.query)("PublicPins").eq("photoRef", photoId).find();
      pinId = (res.items[0]?._id as string | undefined) ?? null;
    }
    if (pinId) await auth.elevate(items.remove)("PublicPins", pinId).catch(() => null);

    // Marketplace (Phase 6): a listed photo's Stores product must go with it (best-effort — a
    // stuck product must never leave the pin undeletable).
    const productId = strOrNull(existing.productId);
    if (productId) await deleteListingProduct(productId);

    await auth.elevate(items.remove)("Photos", photoId);

    const fileIds = [existing.originalFileId, existing.previewFileId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (fileIds.length > 0) {
      try {
        await auth.elevate(files.bulkDeleteFiles)(fileIds);
      } catch (e) {
        console.warn("[photos:delete] media cleanup failed — records removed anyway", e);
      }
    }

    const used = await auth.elevate(items.query)("Photos")
      .eq("ownerMemberId", member._id)
      .count();
    return json({ deleted: true, quota: { used, limit: PIN_QUOTA_FREE } });
  } catch (e) {
    console.error("[photos:delete]", e);
    return json({ error: "DELETE_FAILED", message: "could not delete the pin" }, 502);
  }
};
