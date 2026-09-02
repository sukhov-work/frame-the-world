// /api/world-models — the PUBLIC world read of user-uploaded models (MESH SUITE MS5, D3 —
// 2026-09-02): what every visitor streams into the globe. `UserModels` is ADMIN-everything, so
// this elevated GET is the ONLY door the world has (the /api/building-overrides posture), and it
// is C6-clean by construction: `publicModel` emits the CHOSEN placement of a world-visible object
// plus the seats and streaming facts — never `ownerMemberId`, never a file id. The client asks
// for a geohash COVER (`?cells=` p5 cells around its ground focus; `hasSome` on the denormalized
// `gh5` column — Wix Data has no geo query, ADR D7) and only READY, un-hidden rows answer.
// One page per query (a POC world — `complete: false` says a cell holds more than the page).
import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { auth } from "@wix/essentials";
import { json } from "../../lib/api/http";
import {
  MODEL_WORLD_PAGE,
  MODELS_COLLECTION,
  parseWorldCells,
  publicModel,
  type PublicModel,
} from "../../lib/wix/modelRecords";

export const GET: APIRoute = async ({ url }) => {
  const parsed = parseWorldCells(url.searchParams.get("cells"));
  if ("error" in parsed) return json({ error: "BAD_REQUEST", message: parsed.error }, 400);
  try {
    const res = await auth.elevate(items.query)(MODELS_COLLECTION)
      .hasSome("gh5", parsed.cells)
      .eq("readiness", "READY")
      .ne("hidden", true)
      .ascending("_createdDate")
      .limit(MODEL_WORLD_PAGE)
      .find();
    const models = (res.items as Record<string, unknown>[])
      .map(publicModel)
      .filter((m): m is PublicModel => m !== null);
    return json({ models, complete: !res.hasNext() });
  } catch (e) {
    console.error("[world-models:list]", e);
    return json({ error: "LIST_FAILED", message: "could not list models" }, 502);
  }
};
