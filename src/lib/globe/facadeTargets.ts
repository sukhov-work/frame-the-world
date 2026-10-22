/**
 * FACADE TARGETS (the alignment hooks, F5 — T172, 2026-10-22): the pure half of "which buildings
 * does this photo paint". The owner's order (2026-10-21): "keep a way for more advanced future
 * improvements to properly align content with the buildings". The projection itself stays at
 * RUNTIME (the city material projects the stored pose every frame — `facadeResidency.ts`); what a
 * record persists beside the pose is the SET OF BUILDINGS the projector lands on, so a later
 * crop-to-building, a per-building mask or a PnP solve has stable keys to work from without
 * re-deriving them from tiles that stream differently on every visit.
 *
 * This module answers, with no three.js and no store:
 *   • the probe rays (`rayGridDirections` — a 7×5 grid from the apex through the far face, at the
 *     INSET cell centres so no ray rides the 0.03-uv edge feather where the projector fades out),
 *   • the sampling law (`sampleFacadeTargets` — cast every ray, keep first-seen order, honour the
 *     server's three rails `FACADE_TARGET_IDS_MAX` / `_ID_MAX_LEN` / `_IDS_MAX_BYTES` so a probe
 *     result can never be the reason a SAVE is refused),
 *   • the id contract (`osmTargetId` / `enrichedTargetId` — `"osm:<w|r|n><digits>"`, else the
 *     override key `"<variant>|<cell>|<featureId>"`; never a bare `_feature_id_0`, ids restart per
 *     tile — `lib/wix/facadeRecords.ts` § FacadeAlignment),
 *   • the PULL seam (`registerFacadeTargetProbe` / `probeFacadeTargets` — the `debugFeed`
 *     registry idiom): the orchestrator owns the raycast against the building meshes and registers
 *     a probe; `store/facadeSave` pulls it once per SAVE / UPDATE. A missing or throwing probe
 *     reads as null — it never throws into a save.
 */

import type { FrustumGeometry } from "../geo/frustum";
import { add, normalise, scale, type Vec3 } from "../geo/projection";
import { FACADE_TARGET_ID_MAX_LEN, FACADE_TARGET_IDS_MAX, FACADE_TARGET_IDS_MAX_BYTES } from "../wix/facadeRecords";
import { OSM_ID_RE, overrideKey } from "./bldgOverrides";

/** The default probe grid — 35 rays: dense enough to catch a narrow facade in a wide frame, cheap
 *  enough to run synchronously at SAVE time. */
export const FACADE_TARGET_GRID = { nx: 7, ny: 5 } as const;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

/**
 * The probe rays: unit directions from the apex through the far face at the inset cell centres
 * `u = (i + 0.5) / nx`, `v = (j + 0.5) / ny` (u left → right, v top → bottom), bilinear over the
 * corners `[TL, TR, BR, BL]`. Row-major from the top-left cell. Pure.
 */
export function rayGridDirections(
  geom: FrustumGeometry,
  nx: number = FACADE_TARGET_GRID.nx,
  ny: number = FACADE_TARGET_GRID.ny,
): Vec3[] {
  const [tl, tr, br, bl] = geom.corners;
  const cols = Math.max(1, Math.floor(nx));
  const rows = Math.max(1, Math.floor(ny));
  const out: Vec3[] = [];
  for (let j = 0; j < rows; j++) {
    const v = (j + 0.5) / rows;
    const left = lerp(tl, bl, v);
    const right = lerp(tr, br, v);
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols;
      out.push(normalise(sub(lerp(left, right, u), geom.apex)));
    }
  }
  return out;
}

/** One ray against the building meshes: the hit building's target id, or null (a miss, terrain,
 *  a building with no stable key). The orchestrator implements it; `farM` bounds the cast. */
export type FacadeTargetCast = (origin: Vec3, dir: Vec3, farM: number) => string | null;

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).byteLength;

/**
 * Cast the grid with `farM = rangeM` and collect the ids: first-seen order, de-duplicated, ids
 * longer than `FACADE_TARGET_ID_MAX_LEN` dropped, at most `FACADE_TARGET_IDS_MAX`, and never past
 * `FACADE_TARGET_IDS_MAX_BYTES` serialised (the server's rails, `parseTargetFeatureIds`) — the
 * first id that would cross the byte rail ends the set. A throwing cast counts as a miss. Pure
 * given `cast`.
 */
export function sampleFacadeTargets(
  geom: FrustumGeometry,
  rangeM: number,
  cast: FacadeTargetCast,
  grid: { nx: number; ny: number } = FACADE_TARGET_GRID,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let bytes = 2; // "[]"
  for (const dir of rayGridDirections(geom, grid.nx, grid.ny)) {
    if (ids.length >= FACADE_TARGET_IDS_MAX) break;
    let id: string | null;
    try {
      id = cast(geom.apex, dir, rangeM);
    } catch {
      id = null;
    }
    if (typeof id !== "string" || id.length === 0 || id.length > FACADE_TARGET_ID_MAX_LEN || seen.has(id)) continue;
    const next = bytes + utf8Bytes(JSON.stringify(id)) + (ids.length > 0 ? 1 : 0);
    if (next > FACADE_TARGET_IDS_MAX_BYTES) break;
    bytes = next;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

const OSM_LETTER: ReadonlyMap<string, string> = new Map([
  ["way", "w"],
  ["relation", "r"],
  ["node", "n"],
]);

/** The Cesium OSM batch-table pair (`elementType` "way" | "relation" | "node", `elementId` a
 *  positive integer) → `"osm:w132547176"`; anything else → null. */
export function osmTargetId(elementType: unknown, elementId: unknown): string | null {
  const letter = typeof elementType === "string" ? OSM_LETTER.get(elementType) : undefined;
  if (!letter) return null;
  if (typeof elementId !== "number" || !Number.isSafeInteger(elementId) || elementId <= 0) return null;
  const tail = `${letter}${elementId}`;
  return OSM_ID_RE.test(tail) ? `osm:${tail}` : null;
}

/** An enriched (baked) building → `"osm:<id>"` when its sidecar carried a valid OSM id (re-bake
 *  stable — the recovery key), else the override key `"<variant>|<cell>|<featureId>"` when the
 *  variant is known, else null (a bare per-tile feature id is never a key). */
export function enrichedTargetId(variant: string | null, cellUri: string, featureId: number, osm: string | null): string | null {
  if (typeof osm === "string" && OSM_ID_RE.test(osm)) return `osm:${osm}`;
  if (typeof variant !== "string" || variant.length === 0) return null;
  if (typeof cellUri !== "string" || cellUri.length === 0 || !Number.isInteger(featureId) || featureId < 0) return null;
  return overrideKey(variant, cellUri, featureId);
}

// ── the pull seam (the debugFeed registry idiom) ────────────────────────────────────────────────

let probe: (() => string[] | null) | null = null;

/** Register the globe's target probe; returns the unregister. Last registration wins (a re-attached
 *  globe replaces its old closure); the unregister clears ONLY if it is still the current one. */
export function registerFacadeTargetProbe(fn: () => string[] | null): () => void {
  probe = fn;
  return () => {
    if (probe === fn) probe = null;
  };
}

/** Pull the current target set: null when no probe is registered, the probe throws, or it returns
 *  something that is not an array. Never throws — a save must not fail on its alignment hook. */
export function probeFacadeTargets(): string[] | null {
  if (!probe) return null;
  try {
    const ids = probe();
    return Array.isArray(ids) ? ids : null;
  } catch {
    return null;
  }
}
