// POST /api/photos — save a placed photo as a pin (ARCHITECTURE §6).
// Thin per C1: validate → auth → quota → insert. This endpoint is the ONLY writer of the
// Photos and PublicPins collections (both are ADMIN-only on the platform side), which makes
// two invariants structural:
//   • quota — a free member's 11th photo is refused HERE, and the collections refuse direct
//     member-session writes, so the wall cannot be bypassed from the client;
//   • C6 — the PublicPins row is built by publicPinRecord (reduced-precision derivation only);
//     exact GPS is never written to a public record.
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { members } from "@wix/members";
import { orders } from "@wix/pricing-plans";
import {
  parseSavePinBody,
  photoListItem,
  photoRecord,
  PIN_QUOTA_FREE,
  publicPinRecord,
  type PhotoListItem,
} from "../../lib/wix/pinRecords";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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
  let member;
  try {
    ({ member } = await members.getCurrentMember());
  } catch {
    member = undefined;
  }
  if (!member?._id) return json({ error: "SIGNED_OUT", message: "sign in to list pins" }, 401);

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
  let member;
  try {
    ({ member } = await members.getCurrentMember());
  } catch {
    member = undefined;
  }
  if (!member?._id) return json({ error: "SIGNED_OUT", message: "sign in to save pins" }, 401);

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
        publicPinRecord(body, photo._id),
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
