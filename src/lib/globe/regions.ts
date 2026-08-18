/**
 * Baked-region registry — THE single source of truth for "where do we have advanced bakes"
 * (owner rule 2026-08-18: best available variant loads BY DEFAULT per region; the user gets an
 * on/off, never a variant choice). Bundled pure data: zero fetches, no failure mode, O(1)
 * point-in-bbox — a new city = one entry here + the bakes on R2 (scripts/bake/README.md).
 *
 * Coupling rules (violations = bugs):
 * - `bbox` MUST equal the city's bake bbox (scripts/bake/cities/<id>.json) — it drives the OSM
 *   building mask AND the enriched re-seat extent (the old tuning.ENRICHED.bbox contract).
 * - `variants` are R2 path names under enriched/ (…/enriched/<variant>/tileset.json), BEST
 *   FIRST — [0] is what boots by default; the tail is reachable via the `?enriched=` dev seam.
 * - `terrain` values come verbatim from the bake output (patch-info.json / bake-terrain.mjs
 *   console snippet); the bake asserts its layer.json availability CONTAINS the serve-set this
 *   config generates, so a mismatch fails at bake time, not in the field.
 */
import type { TerrainPatchCfg, LonLatBbox } from "../geo/terrainTiles";

export interface BakedRegion {
  id: string;
  /** Enriched-bake extent [w,s,e,n] deg — mask + seat + region-pick extent. */
  bbox: LonLatBbox;
  /** Enriched building tileset variants on R2, BEST FIRST. */
  variants: string[];
  /** Self-baked terrain patch (GLO-30), when this region has one. */
  terrain?: TerrainPatchCfg;
}

export const BAKED_REGIONS: readonly BakedRegion[] = [
  {
    id: "dnipro",
    bbox: [34.915, 48.37, 35.185, 48.55],
    // o2w first (owner 2026-08-18: the detailed bake IS the default now); the classic extruder
    // bake stays uploaded as the ?enriched=dnipro fallback/AB seam.
    variants: ["dnipro-o2w", "dnipro"],
    // Values from the bake console snippet (bake-terrain.mjs step 7) — maxDepth 13: mago clamps
    // to its 30 m-resolution heuristic; L13 posting ≈ native GLO-30 (ruling 2026-08-18).
    terrain: {
      path: "dnipro",
      extentBbox: [34.0, 48.0, 36.0, 49.0],
      extentMaxDepth: 13,
      cityBbox: [34.915, 48.37, 35.185, 48.55],
      maxDepth: 13,
    },
  },
  {
    id: "st-albans",
    bbox: [-0.3692, 51.7244, -0.2821, 51.7787],
    variants: ["st-albans-o2w"],
  },
];

/** Region whose bbox contains (latDeg, lonDeg), or null. */
export function regionContaining(latDeg: number, lonDeg: number): BakedRegion | null {
  for (const r of BAKED_REGIONS) {
    const [w, s, e, n] = r.bbox;
    if (lonDeg >= w && lonDeg <= e && latDeg >= s && latDeg <= n) return r;
  }
  return null;
}

/** Region that owns an enriched variant name (the `?enriched=` dev seam), or null. */
export function regionOfVariant(variant: string): BakedRegion | null {
  return BAKED_REGIONS.find((r) => r.variants.includes(variant)) ?? null;
}

/** Region by id, or null. */
export function regionById(id: string): BakedRegion | null {
  return BAKED_REGIONS.find((r) => r.id === id) ?? null;
}
