// /api/building-overrides — the world-shared building edits (U8 backend prep, owner 2026-08-19;
// ACTIVATED at MESH SUITE MS3, 2026-09-02). GET is public (persisted overrides apply for ALL
// users — the globe fetches its variant's rows at boot and before every SYNC); POST is the member
// batch sync (any logged-in member may overwrite any building — LWW via bulkSave's `_id` upsert).
// Thin per C1: validate → auth → bulk write; everything unit-testable lives in
// lib/wix/overrideRecords. This endpoint is the ONLY writer of BuildingOverrides (ADMIN-only
// platform-side, the /api/photos posture). The collection is provisioned by
// `node scripts/provision-collections.mjs` (run 2026-09-02, MS3) — until it exists, both verbs 502
// and the client fails OPEN (local rows keep applying).
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { json, requireMember } from "../../lib/api/http";
import {
  GET_MAX_PAGES,
  overrideId,
  overrideRecord,
  OVERRIDES_COLLECTION,
  parseSyncBody,
  publicOverride,
  SYNC_MAX,
  type PublicOverride,
} from "../../lib/wix/overrideRecords";

// GET /api/building-overrides?variant= — the world-shared overrides for one bake variant.
// Public by design (they apply for everyone); memberId never leaves the elevated read. Pages
// by `skip()` (each page its own elevated call — a result's `next()` would run outside the
// elevation) up to GET_MAX_PAGES; `complete: false` tells the client the world is larger than
// what it got, so it must not treat "absent" as "removed".
export const GET: APIRoute = async ({ url }) => {
  const variant = url.searchParams.get("variant");
  if (!variant || variant.length > 64)
    return json({ error: "BAD_REQUEST", message: "variant query param required" }, 400);
  try {
    const overrides: PublicOverride[] = [];
    let complete = false;
    for (let page = 0; page < GET_MAX_PAGES; page++) {
      const res = await auth.elevate(items.query)(OVERRIDES_COLLECTION)
        .eq("variant", variant)
        .limit(SYNC_MAX)
        .skip(page * SYNC_MAX)
        .find();
      for (const it of res.items as Record<string, unknown>[]) {
        const o = publicOverride(it);
        if (o) overrides.push(o);
      }
      if (!res.hasNext()) {
        complete = true;
        break;
      }
    }
    return json({ overrides, complete });
  } catch (e) {
    console.error("[building-overrides:list]", e);
    return json({ error: "LIST_FAILED", message: "could not list overrides" }, 502);
  }
};

// POST /api/building-overrides — batch sync: upsert the member's local rows (LWW by
// deterministic _id) + remove explicit resets. Requires login; the member id is stamped
// server-side (elevated writes run as the APP identity).
export const POST: APIRoute = async ({ request }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to sync overrides" }, 401);

  const parsed = parseSyncBody(await request.json().catch(() => null));
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);

  try {
    let inserted = 0;
    let updated = 0;
    let removed = 0;
    if (parsed.upserts.length > 0) {
      const res = await auth.elevate(items.bulkSave)(
        OVERRIDES_COLLECTION,
        parsed.upserts.map((e) => overrideRecord(e, member._id)),
      );
      inserted = res.inserted ?? 0;
      updated = res.updated ?? 0;
    }
    if (parsed.removes.length > 0) {
      const res = await auth.elevate(items.bulkRemove)(
        OVERRIDES_COLLECTION,
        parsed.removes.map((r) => overrideId(r.variant, r.cell, r.featureId, r.osmId)),
      );
      removed = res.removed ?? 0;
    }
    return json({ inserted, updated, removed });
  } catch (e) {
    console.error("[building-overrides:sync]", e);
    return json({ error: "SYNC_FAILED", message: "could not sync overrides" }, 502);
  }
};
