// /api/models — the user-model lifecycle endpoint (MESH SUITE MS4, D3 — 2026-09-02): GET the
// member's own models · POST register a stored GLB as a UserModels row · DELETE remove one.
// Thin per C1: validate → auth → verify the Media descriptor → write. This endpoint is the ONLY
// writer of the UserModels collection (ADMIN everything platform-side), which makes the
// allowlist STRUCTURAL: a row only ever points at a URL the server copied off a descriptor the
// platform classified as a public MODEL3D — a client cannot register an arbitrary URL — and
// "hide" / "delete" are RECORD operations (private 3D files do not exist on the platform; MS0).
// No quota (owner 2026-09-01c): per-file health caps only, re-checked here against the
// descriptor's own byte count. The world read (visitors streaming placed models) is the sibling
// public route /api/world-models (MESH SUITE MS5). PATCH here has TWO authorities since MESH
// SUITE MS6 (2026-09-02m): a PLACEMENT body (lat/lon + the seats) is open to EVERY signed-in
// member — the owner's D3 ("any other logged-in user can re-edit any mesh's params"), last writer
// wins by construction (`items.update` replaces the whole row) and the row records the editor —
// while a MANAGEMENT body (title / hidden) stays the owner's.
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { files } from "@wix/media";
import { json, requireMember } from "../../lib/api/http";
import {
  MODEL_PAGE,
  MODELS_COLLECTION,
  applyModelManage,
  applyModelPlacement,
  isPlacementPatch,
  modelListItem,
  modelRecord,
  parseCreateModelBody,
  parseManageBody,
  parsePlacementBody,
  publicModel,
  verifyModelDescriptor,
  verifyThumbnailDescriptor,
  type ModelListItem,
  type ModelPatchAnswer,
} from "../../lib/wix/modelRecords";

/** The member's own UserModels row, or null when missing / owned by someone else. */
async function ownedModel(modelId: string, memberId: string) {
  const row = await auth.elevate(items.get)(MODELS_COLLECTION, modelId).catch(() => null);
  return row && row.ownerMemberId === memberId ? row : null;
}

// GET /api/models — the member's own models, newest first (the MS6 "my uploads" list reads it).
export const GET: APIRoute = async () => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to list models" }, 401);

  try {
    const res = await auth.elevate(items.query)(MODELS_COLLECTION)
      .eq("ownerMemberId", member._id)
      .descending("_createdDate")
      .limit(MODEL_PAGE)
      .find();
    const models = (res.items as Record<string, unknown>[])
      .map(modelListItem)
      .filter((m): m is ModelListItem => m !== null);
    return json({ models });
  } catch (e) {
    console.error("[models:list]", e);
    return json({ error: "LIST_FAILED", message: "could not list models" }, 502);
  }
};

// POST /api/models — register a GLB the client already PUT to Wix Media. The body carries the
// client's FACTS about the file (format, counts, bounds, the UPLOAD HERE seed); the url,
// thumbnail and byte count come from the descriptor fetched HERE.
export const POST: APIRoute = async ({ request }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to upload models" }, 401);

  const parsed = parseCreateModelBody(await request.json().catch(() => null));
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
  const body = parsed.body;

  try {
    // One record per file: a retried save of the same fileId answers the existing row; another
    // member's fileId is refused (the bytes are public, the record is not theirs to make).
    const dup = await auth.elevate(items.query)(MODELS_COLLECTION).eq("fileId", body.fileId).limit(1).find();
    const existing = dup.items[0] as Record<string, unknown> | undefined;
    if (existing) {
      if (existing.ownerMemberId !== member._id)
        return json({ error: "ALREADY_REGISTERED", message: "that file is already registered" }, 409);
      return json({
        modelId: existing._id,
        url: existing.url,
        thumbnailUrl: existing.thumbnailUrl ?? null,
        readiness: existing.readiness ?? "PENDING",
        existing: true,
      });
    }

    // The descriptor is the allowlist. Elevated: the file was minted by the app identity.
    const descriptor = await auth.elevate(files.getFileDescriptor)(body.fileId).catch(() => null);
    if (!descriptor) return json({ error: "FILE_NOT_FOUND", message: "no such media file" }, 404);
    const verdict = verifyModelDescriptor(descriptor);
    if (!verdict.ok) return json({ error: verdict.code, message: verdict.error }, 400);

    // Our card thumbnail — a public IMAGE the client uploaded beside the GLB. Verified the same
    // way; a refusal costs the thumbnail, never the model.
    if (body.thumbnailFileId) {
      const thumbDescriptor = await auth.elevate(files.getFileDescriptor)(body.thumbnailFileId).catch(() => null);
      const thumb = thumbDescriptor ? verifyThumbnailDescriptor(thumbDescriptor) : null;
      if (thumb?.ok) {
        verdict.file.thumbnailFileId = thumb.fileId;
        verdict.file.thumbnailUrl = thumb.url;
      } else {
        console.warn("[models] thumbnail refused — registering the model without one", thumb && !thumb.ok ? thumb.error : "no descriptor");
      }
    }

    const row = await auth.elevate(items.insert)(MODELS_COLLECTION, modelRecord(body, verdict.file, member._id));
    return json({
      modelId: row._id,
      url: verdict.file.url,
      thumbnailUrl: verdict.file.thumbnailUrl,
      readiness: verdict.file.readiness,
    });
  } catch (e) {
    console.error("[models]", e);
    return json({ error: "SAVE_FAILED", message: "could not register the model" }, 502);
  }
};

// PATCH /api/models — MESH SUITE MS5 placement + MS6 management, dispatched on the body's SHAPE.
// PLACEMENT (`lat`/`lon` present — the seats optional): ANY signed-in member may move / turn /
// resize ANY model (MS6, the owner's D3): the row by id, the placement columns re-derived (both
// geohash cells), the seats clamped, `editorMemberId` stamped from the session, `items.update`
// the WHOLE row (last writer wins — structural). MANAGEMENT (no coordinates — `title` and/or
// `hidden`): the OWNER's only. Both answer `{ own, model, public }`: the owner-shaped list row
// ONLY to the owner, the public row to everyone (C6 — no editor, no owner, no file id).
export const PATCH: APIRoute = async ({ request }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to edit models" }, 401);

  const raw = await request.json().catch(() => null);
  try {
    if (isPlacementPatch(raw)) {
      const parsed = parsePlacementBody(raw);
      if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
      const body = parsed.body;
      const existing = await auth.elevate(items.get)(MODELS_COLLECTION, body.id).catch(() => null);
      if (!existing) return json({ error: "NOT_FOUND", message: "no such model" }, 404);
      const record = applyModelPlacement(existing as Record<string, unknown>, body, member._id);
      const saved = await auth.elevate(items.update)(MODELS_COLLECTION, record as { _id: string });
      return json(patchAnswer((saved ?? record) as Record<string, unknown>, record, member._id));
    }
    const parsed = parseManageBody(raw);
    if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
    const body = parsed.body;
    const existing = await ownedModel(body.id, member._id);
    if (!existing) return json({ error: "NOT_FOUND", message: "no such model of yours" }, 404);
    const record = applyModelManage(existing as Record<string, unknown>, body);
    const saved = await auth.elevate(items.update)(MODELS_COLLECTION, record as { _id: string });
    return json(patchAnswer((saved ?? record) as Record<string, unknown>, record, member._id));
  } catch (e) {
    console.error("[models:patch]", e);
    return json({ error: "UPDATE_FAILED", message: "could not update the model" }, 502);
  }
};

/** The PATCH answer from the saved row (falling back to the record we sent when the platform
 *  answers nothing readable): the list row only for the owner, the public row for everyone. */
function patchAnswer(saved: Record<string, unknown>, sent: Record<string, unknown>, memberId: string): ModelPatchAnswer {
  const row = typeof saved._id === "string" ? saved : sent;
  const own = row.ownerMemberId === memberId;
  return {
    own,
    model: own ? modelListItem(row) ?? modelListItem(sent) : null,
    public: publicModel(row) ?? publicModel(sent),
  };
}

// DELETE /api/models?id= — owner-gated removal: the row, then the media file best-effort (a
// stuck file must never leave a ghost row — the photos precedent; the Media Manager keeps the
// bytes for the owner to clear by hand if the delete fails, and the response says so).
export const DELETE: APIRoute = async ({ url }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to delete models" }, 401);

  const modelId = url.searchParams.get("id");
  if (!modelId) return json({ error: "BAD_REQUEST", message: "id query param required" }, 400);

  try {
    const existing = await ownedModel(modelId, member._id);
    if (!existing) return json({ error: "NOT_FOUND", message: "no such model of yours" }, 404);
    await auth.elevate(items.remove)(MODELS_COLLECTION, modelId);

    const fileIds = [existing.fileId, existing.thumbnailFileId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    let mediaDeleted = false;
    if (fileIds.length > 0) {
      try {
        await auth.elevate(files.bulkDeleteFiles)(fileIds);
        mediaDeleted = true;
      } catch (e) {
        console.warn("[models:delete] media cleanup failed — record removed anyway", e);
      }
    }
    return json({ deleted: true, mediaDeleted });
  } catch (e) {
    console.error("[models:delete]", e);
    return json({ error: "DELETE_FAILED", message: "could not delete the model" }, 502);
  }
};
