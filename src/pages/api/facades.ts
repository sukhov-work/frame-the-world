// /api/facades — the facade-photo lifecycle endpoint (PHOTO PROJECTION F2 persist, T169 / T172 —
// 2026-10-21): GET the member's own facades (`?skip=`) or the member-gated WORLD read (`?cells=`) ·
// POST save a facade photo whose three files the client already PUT to Wix Media · PATCH an owner
// edit (pose / projection / seats / title) · DELETE remove one. Thin per C1: validate → auth →
// verify the descriptor → write. This endpoint is the ONLY writer of the FacadePhotos collection
// (ADMIN everything platform-side), which makes the URL posture STRUCTURAL: a row only ever carries
// a display / thumb URL the server copied off a descriptor the platform classified as a public
// IMAGE under the static host — a client cannot register an arbitrary URL (the /api/models rule).
// C6: a projected facade photo is EXACT by nature (the pose IS the content), so reduced precision
// cannot apply — rows are PRIVATE (`isPublic` false, `moderation` "PRIVATE", both stamped
// server-side, never body-driven) and the v1 world read is OWNER-FILTERED: a member streams their
// own facades only; any public tier needs explicit consent + the moderation gate first.
// No quota: `FACADE_MAX_PER_MEMBER` is a HEALTH rail (one `count()` per POST → 429 `TOO_MANY`),
// not a product limit (owner 2026-10-21: "hundreds per city, maybe thousands").
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { files } from "@wix/media";
import { json, requireMember } from "../../lib/api/http";
import {
  FACADE_MAX_PER_MEMBER,
  FACADE_PAGE,
  FACADES_COLLECTION,
  applyFacadeUpdate,
  facadeListItem,
  facadeRecord,
  facadeWorldItem,
  parseSaveFacadeBody,
  parseSkip,
  parseUpdateFacadeBody,
  verifyFacadeImageDescriptor,
  type FacadeListItem,
  type FacadeWorldItem,
} from "../../lib/wix/facadeRecords";
import { parseWorldCells } from "../../lib/wix/modelRecords";

/** The member's own FacadePhotos row, or null when missing / owned by someone else (the `ownedModel` twin). */
async function ownedFacade(facadeId: string, memberId: string): Promise<Record<string, unknown> | null> {
  const row = await auth.elevate(items.get)(FACADES_COLLECTION, facadeId).catch(() => null);
  return row && row.ownerMemberId === memberId ? (row as Record<string, unknown>) : null;
}

// GET /api/facades — TWO reads, both member-only (there is no public tier — C6):
//   · `?cells=<gh5,…>` the WORLD read for a geohash cover (1..16 p5 cells — `parseWorldCells`, the
//     /api/world-models grammar; `hasSome` on the denormalized `gh5` column, Wix Data has no geo
//     query — ADR D7), OWNER-FILTERED in v1, REMOVED rows withheld, one page oldest-first,
//     `complete: false` when a cell holds more than the page → `{ facades: FacadeWorldItem[], complete }`;
//   · otherwise MY FACADES, newest first, paged by `?skip=` (0-based, `FACADE_PAGE` rows per page —
//     each page its own elevated call, the /api/building-overrides precedent) → `{ facades:
//     FacadeListItem[], hasNext }`.
export const GET: APIRoute = async ({ url }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to list facade photos" }, 401);

  const cellsParam = url.searchParams.get("cells");
  try {
    if (cellsParam !== null) {
      const parsed = parseWorldCells(cellsParam);
      if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
      const res = await auth.elevate(items.query)(FACADES_COLLECTION)
        .hasSome("gh5", parsed.cells)
        .eq("ownerMemberId", member._id)
        .ne("moderation", "REMOVED")
        .ascending("_createdDate")
        .limit(FACADE_PAGE)
        .find();
      const facades = (res.items as Record<string, unknown>[])
        .map(facadeWorldItem)
        .filter((f): f is FacadeWorldItem => f !== null);
      return json({ facades, complete: !res.hasNext() });
    }

    const skip = parseSkip(url.searchParams.get("skip"));
    if ("error" in skip) return json({ error: "BAD_REQUEST", message: skip.error }, 400);
    const res = await auth.elevate(items.query)(FACADES_COLLECTION)
      .eq("ownerMemberId", member._id)
      .descending("_createdDate")
      .limit(FACADE_PAGE)
      .skip(skip.skip)
      .find();
    const facades = (res.items as Record<string, unknown>[])
      .map(facadeListItem)
      .filter((f): f is FacadeListItem => f !== null);
    return json({ facades, hasNext: res.hasNext() });
  } catch (e) {
    console.error("[facades:list]", e);
    return json({ error: "LIST_FAILED", message: "could not list facade photos" }, 502);
  }
};

/** The thumb's URL off ITS verified descriptor — a refusal costs the thumb, never the save (the
 *  models' thumbnail posture; markers fall back to the display). */
async function verifiedThumbUrl(thumbFileId: string | null): Promise<string | null> {
  if (!thumbFileId) return null;
  const descriptor = await auth.elevate(files.getFileDescriptor)(thumbFileId).catch(() => null);
  const verdict = descriptor ? verifyFacadeImageDescriptor(descriptor) : null;
  if (verdict?.ok) return verdict.url;
  console.warn("[facades] thumb refused — saving without one", verdict && !verdict.ok ? verdict.error : "no descriptor");
  return null;
}

// POST /api/facades — register a facade photo whose files are already in Wix Media. The body carries
// the pose + params + the EXIF facts + the three file ids; the URLs come from the descriptors fetched
// HERE (elevated — the files were minted by the app identity). The display JPEG is what every
// projector slot samples, so a display descriptor without a static URL yet (image ingest is async —
// wix-headless §9) is 409 `FILE_NOT_READY` + `retryable`: the client re-POSTs the same body, never
// stores its own URL.
export const POST: APIRoute = async ({ request }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to save facade photos" }, 401);

  const parsed = parseSaveFacadeBody(await request.json().catch(() => null));
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
  const body = parsed.body;

  try {
    const used = await auth.elevate(items.query)(FACADES_COLLECTION).eq("ownerMemberId", member._id).count();
    if (used >= FACADE_MAX_PER_MEMBER) {
      return json(
        { error: "TOO_MANY", message: `a member holds up to ${FACADE_MAX_PER_MEMBER} facade photos — delete some to add more`, used },
        429,
      );
    }

    const display = await auth.elevate(files.getFileDescriptor)(body.displayFileId).catch(() => null);
    if (!display) return json({ error: "FILE_NOT_FOUND", message: "no such display image" }, 404);
    const verdict = verifyFacadeImageDescriptor(display);
    if (!verdict.ok) {
      if (verdict.code === "NO_URL") {
        return json(
          { error: "FILE_NOT_READY", message: "the display image is still being processed — retry in a moment", retryable: true },
          409,
        );
      }
      return json({ error: verdict.code, message: verdict.error }, 400);
    }
    const thumbUrl = await verifiedThumbUrl(body.thumbFileId);

    const record = facadeRecord(body, member._id, { displayUrl: verdict.url, thumbUrl });
    const row = await auth.elevate(items.insert)(FACADES_COLLECTION, record);
    // The list row from the SAVED item (it carries `_createdDate` / `_updatedDate`), falling back to
    // the record we sent when the platform answers nothing readable (the models' `patchAnswer` rule).
    const facade = facadeListItem(row as Record<string, unknown>) ?? facadeListItem({ ...record, _id: row._id });
    return json({ facadeId: row._id, facade });
  } catch (e) {
    console.error("[facades]", e);
    return json({ error: "SAVE_FAILED", message: "could not save the facade photo" }, 502);
  }
};

// PATCH /api/facades { facadeId, …editable fields } — the OWNER's edit: the row by id (owner-gated),
// the patch merged by `applyFacadeUpdate` (a pose edit re-derives both geohash columns and re-stamps
// `poseSource`; the file ids / URLs / owner / EXIF pose / moderation never move), `items.update` the
// WHOLE row (read-modify-write — the photos precedent). Answers `{ facadeId, facade }`.
export const PATCH: APIRoute = async ({ request }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to edit facade photos" }, 401);

  const parsed = parseUpdateFacadeBody(await request.json().catch(() => null));
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
  const { facadeId, body } = parsed;

  try {
    const existing = await ownedFacade(facadeId, member._id);
    if (!existing) return json({ error: "NOT_FOUND", message: "no such facade photo of yours" }, 404);
    const { record } = applyFacadeUpdate(existing, body);
    const saved = await auth.elevate(items.update)(FACADES_COLLECTION, record as { _id: string });
    const facade = facadeListItem((saved ?? record) as Record<string, unknown>) ?? facadeListItem(record);
    return json({ facadeId, facade });
  } catch (e) {
    console.error("[facades:update]", e);
    return json({ error: "UPDATE_FAILED", message: "could not update the facade photo" }, 502);
  }
};

// DELETE /api/facades?id= — owner-gated removal: the row, then the three media files best-effort (a
// stuck file must never leave a ghost row — the photos / models precedent; the Media Manager keeps
// the bytes for the owner to clear by hand, and `mediaDeleted` says so).
export const DELETE: APIRoute = async ({ url }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to delete facade photos" }, 401);

  const facadeId = url.searchParams.get("id");
  if (!facadeId) return json({ error: "BAD_REQUEST", message: "id query param required" }, 400);

  try {
    const existing = await ownedFacade(facadeId, member._id);
    if (!existing) return json({ error: "NOT_FOUND", message: "no such facade photo of yours" }, 404);
    await auth.elevate(items.remove)(FACADES_COLLECTION, facadeId);

    const fileIds = [existing.originalFileId, existing.displayFileId, existing.thumbFileId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    let mediaDeleted = false;
    if (fileIds.length > 0) {
      try {
        await auth.elevate(files.bulkDeleteFiles)(fileIds);
        mediaDeleted = true;
      } catch (e) {
        console.warn("[facades:delete] media cleanup failed — record removed anyway", e);
      }
    }
    return json({ deleted: true, mediaDeleted });
  } catch (e) {
    console.error("[facades:delete]", e);
    return json({ error: "DELETE_FAILED", message: "could not delete the facade photo" }, 502);
  }
};
