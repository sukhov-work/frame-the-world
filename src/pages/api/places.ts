// /api/places — saved first-person viewpoints (owner 2026-07-15): GET list · POST save ·
// DELETE remove. Thin per C1: validate → auth → owner gate → write (no quota — owner
// 2026-08-15c dropped the saved-places cap). This endpoint is
// the ONLY writer of the SavedPlaces collection (ADMIN-only platform-side), same posture as
// /api/photos. Places are member-private bookmarks — they are never published (C6-safe: the
// exact pose stays in the ADMIN-read collection, visible only to its owner through this
// elevated, owner-filtered surface).
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { json, requireMember } from "../../lib/api/http";
import {
  parseSavePlaceBody,
  placeListItem,
  placeRecord,
  PLACE_PAGE,
  type PlaceListItem,
} from "../../lib/wix/placeRecords";

/** The member's own SavedPlaces row, or null when missing / owned by someone else. */
async function ownedPlace(placeId: string, memberId: string) {
  const row = await auth.elevate(items.get)("SavedPlaces", placeId).catch(() => null);
  return row && row.ownerMemberId === memberId ? row : null;
}

// GET /api/places — the member's own saved places, newest first.
export const GET: APIRoute = async () => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to list places" }, 401);

  try {
    const res = await auth.elevate(items.query)("SavedPlaces")
      .eq("ownerMemberId", member._id)
      .descending("_createdDate")
      .limit(PLACE_PAGE)
      .find();
    const places = (res.items as Record<string, unknown>[])
      .map(placeListItem)
      .filter((p): p is PlaceListItem => p !== null);
    return json({ places });
  } catch (e) {
    console.error("[places:list]", e);
    return json({ error: "LIST_FAILED", message: "could not list places" }, 502);
  }
};

// POST /api/places — save the current FPV viewpoint (no media, no public row).
export const POST: APIRoute = async ({ request }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to save places" }, 401);

  const parsed = parseSavePlaceBody(await request.json().catch(() => null));
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);

  try {
    // No per-member quota (owner 2026-08-15c) — places are tiny media-less rows; the old
    // 50-cap 402 gate is gone. The GET page (PLACE_PAGE) is the only listing bound.
    const row = await auth.elevate(items.insert)(
      "SavedPlaces",
      placeRecord(parsed.body, member._id),
    );
    return json({ placeId: row._id });
  } catch (e) {
    console.error("[places]", e);
    return json({ error: "SAVE_FAILED", message: "could not save the place" }, 502);
  }
};

// DELETE /api/places?id= — owner-gated removal.
export const DELETE: APIRoute = async ({ url }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to delete places" }, 401);

  const placeId = url.searchParams.get("id");
  if (!placeId) return json({ error: "BAD_REQUEST", message: "id query param required" }, 400);

  try {
    const existing = await ownedPlace(placeId, member._id);
    if (!existing) return json({ error: "NOT_FOUND", message: "no such place of yours" }, 404);
    await auth.elevate(items.remove)("SavedPlaces", placeId);
    return json({ deleted: true });
  } catch (e) {
    console.error("[places:delete]", e);
    return json({ error: "DELETE_FAILED", message: "could not delete the place" }, 502);
  }
};
