// /api/building-overrides — U8 backend prep (owner 2026-08-19): the NEXT phase's batch-sync
// surface for per-building height overrides. GET is public (persisted overrides apply for ALL
// users — the globe will fetch its variant's rows at boot next phase); POST is the member
// batch sync (any logged-in member may overwrite any building — LWW via bulkSave's `_id`
// upsert). Thin per C1: validate → auth → bulk write; everything unit-testable lives in
// lib/wix/overrideRecords. This endpoint is the ONLY writer of BuildingOverrides (ADMIN-only
// platform-side, the /api/photos posture). NOTE: the collection is provisioned by
// `node scripts/provision-collections.mjs` — until that runs, both verbs 502.
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { json, requireMember } from "../../lib/api/http";
import {
  overrideId,
  overrideRecord,
  OVERRIDES_COLLECTION,
  parseSyncBody,
  publicOverride,
  SYNC_MAX,
  type PublicOverride,
} from "../../lib/wix/overrideRecords";

// GET /api/building-overrides?variant= — the world-shared overrides for one bake variant.
// Public by design (they apply for everyone); memberId never leaves the elevated read.
export const GET: APIRoute = async ({ url }) => {
  const variant = url.searchParams.get("variant");
  if (!variant || variant.length > 64)
    return json({ error: "BAD_REQUEST", message: "variant query param required" }, 400);
  try {
    const res = await auth.elevate(items.query)(OVERRIDES_COLLECTION)
      .eq("variant", variant)
      .limit(SYNC_MAX)
      .find();
    const overrides = (res.items as Record<string, unknown>[])
      .map(publicOverride)
      .filter((o): o is PublicOverride => o !== null);
    return json({ overrides });
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
        parsed.removes.map((r) => overrideId(r.variant, r.cell, r.featureId)),
      );
      removed = res.removed ?? 0;
    }
    return json({ inserted, updated, removed });
  } catch (e) {
    console.error("[building-overrides:sync]", e);
    return json({ error: "SYNC_FAILED", message: "could not sync overrides" }, 502);
  }
};
