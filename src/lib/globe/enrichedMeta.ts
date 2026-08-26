/**
 * RC17 — the runtime half of the per-cell `.meta.json` sidecar (RENDERING CHARTER Group D).
 *
 * WHAT THE SIDECAR BUYS. A baked cell is a triangle soup with one float32 `_FEATURE_ID_0` per
 * vertex. That id is bake-sequential and float32-limited, so it can carry neither a stable OSM
 * identity (way ids are ~10^9, exact float32 stops at 2^24) nor any semantics at all. Everything
 * the runtime "knows" about a baked feature it has had to infer from GEOMETRY — and the two places
 * it does that are both wrong in ways nobody could fix without this file:
 *
 *   1. THE PICK FENCE. `ENRICHED.overrideMinPickHeightM` (2.5 m) is a height floor standing in for
 *      "is this a building". It fails in both directions. A single-storey outbuilding is below it
 *      and cannot be picked; a street lamp, a flagpole or a 30 m transmission pylon sails over it
 *      and is fully pickable AND rescalable. That is not hypothetical — the shipped Chernobyl o2w
 *      bake is 30.6 % non-building features (516 of 1,688), including 273 `HighVoltagePowerTower`.
 *      The floor was sized against an assumed 4.5 %.
 *   2. THE HEIGHT. `topY − baseY` over a feature's vertex run is the geometric extent, which RC13
 *      has just made 4 m taller than the building by lowering its wall rim below ground. The
 *      sidecar carries the true `base`/`top`, so the skirt is undone exactly instead of inflating
 *      every reported height and shifting the pivot a U8 rescale turns about.
 *
 * The class token also makes an OSM id available for the first time, which is what lets a U8
 * override survive a re-bake — today rows key on `(variant, cellUri, featureId)` and are defended
 * by a centroid checksum that a re-bake invalidates by design (`bldgOverrides.ts`).
 *
 * DEGRADING HONESTLY IS PART OF THE CONTRACT. Bakes that predate the writers have no sidecar, so
 * every consumer here is written as "meta if present, the old inference otherwise" and a 404 is a
 * normal answer, not an error. The schema number exists so a shape this code does not understand
 * is refused outright rather than half-read.
 *
 * Pure, DOM-free, three-free — the fetch and the apply live in `scene/enrichedBuildings.ts`.
 * Writer + field semantics: `scripts/bake/lib/meta.mjs` (keep the two in step).
 */

/** The only schema this runtime understands. Bumped when a field's MEANING changes. */
export const META_SCHEMA = 2;

/** One baked feature, as the bakers describe it. Metres are in the cell's baked local frame. */
export interface FeatureMeta {
  /** Stable OSM element id ("w141472295"), or null when the baker had none. */
  osm: string | null;
  /** OSM2World class token; the extruder writes "Building" for everything it bakes. */
  cls: string;
  /** TRUE ground-contact Y, with the RC13 skirt already added back. */
  base: number;
  /** Highest Y, roof included — `top - base` is the real rendered height. */
  top: number;
  /** Metres the geometry was lowered below `base` (0 when RC13's guards skipped it). */
  skirt: number;
  /** Height provenance: "height" | "levels" | "class" | "default" | "o2w". */
  src: string;
}

export interface CellMeta {
  /** The bake this cell came from, e.g. "dnipro-o2w" — a cheap cross-check against the variant. */
  variant: string;
  /** The bake-wide skirt setting. Per-feature `skirt` is what actually applies. */
  skirtM: number;
  byId: Map<number, FeatureMeta>;
}

/**
 * Sidecar URL for a baked cell, derived from the cell's own `.glb` URL rather than from the
 * tileset base — the baker names them as siblings, and the glb URL is the one string the fetch
 * plugin is handed. Returns null for anything that is not a `.glb`, so a caller cannot
 * accidentally probe the tileset or a Draco payload.
 *
 * The `?v=<tilesetVersion>` cache-buster the baker stamps on content uris is PRESERVED. The
 * sidecar is the glb's twin — same bake, same lifetime — so the two must invalidate together, or
 * a re-bake would pair fresh geometry with a previous bake's class tokens and feature ids.
 */
export function metaUrlForGlb(glbUrl: string): string | null {
  const [path, query] = glbUrl.split("#")[0].split("?");
  if (!path.endsWith(".glb")) return null;
  return path.slice(0, -4) + ".meta.json" + (query ? `?${query}` : "");
}

/**
 * The STABLE cell identity ("cell-10-10.glb") from any form of a cell's uri or url — relative or
 * absolute, with or without the baker's `?v=<tilesetVersion>` cache-buster.
 *
 * This string is a persistence key: U8 override rows and banked cell seats are stored under it.
 * So it must survive a version bump, which is exactly why the query is stripped here and kept in
 * `metaUrlForGlb`. One function, because the load-model registration and the sidecar fetch key
 * the same map and a silent disagreement between them would look like a permanent cache miss.
 */
export function cellUriOf(uriOrUrl: string): string {
  return uriOrUrl.split("#")[0].split("?")[0].split("/").pop() ?? "";
}

/**
 * Is this class a mass a person can pick and rescale?
 *
 * Deliberately an ALLOW-list on the Building family rather than a deny-list of street furniture.
 * OSM2World's class vocabulary grows with its releases (the shipped bakes already carry 17 distinct
 * tokens), and a deny-list silently admits every token added upstream — which is the failure the
 * height floor already demonstrates. A new `Building*` variant being pickable is the safe default;
 * a new `Antenna` being rescalable is not.
 */
export function isPickableClass(cls: string): boolean {
  return cls.startsWith("Building");
}

/** Narrow one raw row, or null if any field is missing or the wrong type. */
function parseRow(r: unknown): (FeatureMeta & { id: number }) | null {
  if (typeof r !== "object" || r === null) return null;
  const o = r as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const id = num(o.id);
  const base = num(o.base);
  const top = num(o.top);
  const skirt = num(o.skirt);
  if (id === null || base === null || top === null || skirt === null) return null;
  if (typeof o.cls !== "string") return null;
  return {
    id,
    osm: typeof o.osm === "string" ? o.osm : null,
    cls: o.cls,
    base,
    top,
    skirt,
    src: typeof o.src === "string" ? o.src : "",
  };
}

/**
 * Parse a fetched sidecar. Returns null for anything unusable — a wrong schema, a non-object, a
 * missing feature array — so the caller's "no meta" path is the single place that handles absence,
 * whatever the reason. Individual malformed ROWS are dropped rather than failing the cell: one bad
 * row should cost one building's class token, not the whole cell's.
 */
export function parseCellMeta(raw: unknown): CellMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.schema !== META_SCHEMA) return null;
  if (!Array.isArray(o.features)) return null;
  const byId = new Map<number, FeatureMeta>();
  for (const r of o.features) {
    const row = parseRow(r);
    if (row) {
      const { id, ...rest } = row;
      byId.set(id, rest);
    }
  }
  return {
    variant: typeof o.variant === "string" ? o.variant : "",
    skirtM: typeof o.skirtM === "number" && Number.isFinite(o.skirtM) ? o.skirtM : 0,
    byId,
  };
}
