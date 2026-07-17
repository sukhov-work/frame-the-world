// POST /api/dev-seed — DEV-ONLY seeding endpoint for scripts/seed-demo-pins.mjs.
//
// Exists because the demo pins must be OWNED by yevhens@wix.com (owner ruling, DEMO_CONTENT_SEED.md)
// and that site member authenticates via Google — no password for a script to log in with. Elevated
// inserts run as the APP identity (the Phase-5 trap), so this route sets `ownerMemberId` explicitly
// after looking the member up by email. It reuses the exact same record builders as POST /api/photos
// (photoRecord / publicPinRecord — C6 reduction stays structural) and the same product creation as
// POST /api/listings (createListingProduct), skipping only the quota wall (seed-time, owner-driven).
//
// SECURITY: hard-gated to `import.meta.env.DEV` — the route 404s in a production build, and `wix dev`
// binds to localhost. Never relax this gate.
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { members } from "@wix/members";
import { json } from "../../lib/api/http";
import { normalizePrice } from "../../lib/market/listing";
import { createListingProduct } from "../../lib/wix/photosData";
import {
  authorLabel,
  parseSavePinBody,
  photoRecord,
  publicPinRecord,
} from "../../lib/wix/pinRecords";

/** The owner's member row by login email (with `_id` narrowed to a definite string), or null. */
async function memberByEmail(email: string) {
  const found = await auth.elevate(members.queryMembers)({ fieldsets: ["FULL"] })
    .eq("loginEmail", email)
    .find();
  const m = found.items[0];
  return m?._id ? { ...m, _id: m._id } : null;
}

// GET /api/dev-seed?ownerEmail= — the member's existing pin titles (idempotent re-run support:
// the seed script skips entries whose title is already saved).
export const GET: APIRoute = async ({ url }) => {
  if (!import.meta.env.DEV) return json({ error: "NOT_FOUND" }, 404);
  const ownerEmail = url.searchParams.get("ownerEmail");
  if (!ownerEmail) return json({ error: "BAD_REQUEST", message: "ownerEmail required" }, 400);
  try {
    const owner = await memberByEmail(ownerEmail);
    if (!owner) return json({ error: "NO_MEMBER", message: `${ownerEmail} is not a site member` }, 404);
    const res = await auth.elevate(items.query)("Photos")
      .eq("ownerMemberId", owner._id)
      .limit(1000)
      .find();
    const photos = (res.items as Record<string, unknown>[]).map((p) => ({
      id: p._id as string,
      title: typeof p.title === "string" ? p.title : "Untitled",
      productId: typeof p.productId === "string" ? p.productId : null,
    }));
    return json({ memberId: owner._id, photos });
  } catch (e) {
    console.error("[dev-seed:list]", e);
    return json({ error: "SEED_LIST_FAILED", message: "could not list seeded pins" }, 502);
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) return json({ error: "NOT_FOUND" }, 404);

  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ownerEmail = typeof raw?.ownerEmail === "string" ? raw.ownerEmail : null;
  if (!ownerEmail) return json({ error: "BAD_REQUEST", message: "ownerEmail required" }, 400);
  const parsed = parseSavePinBody(raw?.pin);
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
  const body = parsed.body;
  const priceAmount = raw?.priceAmount == null ? null : normalizePrice(raw.priceAmount);

  try {
    const owner = await memberByEmail(ownerEmail);
    if (!owner)
      return json({ error: "NO_MEMBER", message: `${ownerEmail} is not a site member` }, 404);

    const photo = await auth.elevate(items.insert)("Photos", photoRecord(body, owner._id));

    let publicPinId: string | null = null;
    if (body.isPublic) {
      const pin = await auth.elevate(items.insert)(
        "PublicPins",
        publicPinRecord(body, photo._id, authorLabel(owner.profile?.nickname, owner.loginEmail)),
      );
      publicPinId = pin._id;
      await auth.elevate(items.update)("Photos", { ...photo, publicPinId });
    }

    // Optional listing — same preconditions as /api/listings (public + retained original).
    let listing: { productId: string; productVariantId: string | null; currency: string } | null =
      null;
    if (priceAmount !== null && body.isPublic && body.originalFileId) {
      listing = await createListingProduct(body.title, priceAmount, body.originalFileId);
      await auth.elevate(items.update)("Photos", {
        ...photo,
        publicPinId,
        productId: listing.productId,
        productVariantId: listing.productVariantId,
        priceAmount,
        currency: listing.currency,
      });
      if (publicPinId) {
        const pin = await auth.elevate(items.get)("PublicPins", publicPinId);
        await auth.elevate(items.update)("PublicPins", {
          ...pin,
          productId: listing.productId,
          productVariantId: listing.productVariantId,
          priceAmount,
          currency: listing.currency,
        });
      }
    }

    return json({ photoId: photo._id, publicPinId, listing });
  } catch (e) {
    console.error("[dev-seed]", e);
    return json({ error: "SEED_FAILED", message: "could not seed the pin" }, 502);
  }
};
