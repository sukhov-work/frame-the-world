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
import {
  applyPinUpdate,
  authorLabel,
  parseSavePinBody,
  parseUpdatePinBody,
  photoListItem,
  photoRecord,
  PIN_QUOTA_FREE,
  publicPinRecord,
  type PhotoListItem,
} from "../../lib/wix/pinRecords";

/** The member's own Photos row, or null when it doesn't exist / belongs to someone else. */
async function ownedPhoto(photoId: string, memberId: string) {
  const row = await auth.elevate(items.get)("Photos", photoId).catch(() => null);
  return row && row.ownerMemberId === memberId ? row : null;
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

    if (used >= PIN_QUOTA_FREE && !(await hasActivePlan())) {
      return json(
        {
          error: "QUOTA_EXCEEDED",
          message: `free plan holds ${PIN_QUOTA_FREE} pins — upgrade for unlimited`,
          quota: { used, limit: PIN_QUOTA_FREE },
        },
        402,
      );
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

    if (effective.isPublic) {
      const pinRow = publicPinRecord(
        effective,
        photoId,
        authorLabel(member.profile?.nickname, member.loginEmail),
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
