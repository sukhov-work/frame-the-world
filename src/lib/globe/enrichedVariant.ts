// Enriched-tileset selection — BEST VARIANT BY DEFAULT per baked region (owner rule 2026-08-18,
// superseding the 2026-07-14 A/B-chip semantics): the registry (lib/globe/regions.ts) decides
// which bake streams; the user's BLD / ▦ 3D DETAIL chips are a plain live buildings on/off
// (prefs `buildings3d`), never a variant choice. The `?enriched=` URL search param survives as
// the DEV seam only:
//
//   (absent)                     → the BOOT REGION's best variant (regions.ts, variants[0]);
//                                  region = the boot view's containing region, else the region
//                                  anchored by the env URL's city segment, else the first entry
//   ?enriched=off|none|0         → no enriched tileset AND no OSM mask → stock Cesium OSM look
//   ?enriched=<name>             → that variant verbatim (A/B compares; mask bbox follows the
//                                  region OWNING the name — unknown names fall back to the
//                                  default region's bbox, exactly the old variantBboxes rule)
//   ?enriched=<anything with /=> → used verbatim (full URL or absolute path)
//
// The stored `enrichedVariant` pref is RETIRED (prefs sanitize drops the stale key). Camera pose
// rides the #p= hash as before, so explicit-param A/B reloads still land on the identical view.
// Pure; unit-tested (test/enriched-variant.test.ts).

import type { GeoBbox } from "./enrichedMask";
import { BAKED_REGIONS, regionContaining, regionOfVariant, type BakedRegion } from "./regions";

export interface EnrichedSelection {
  /** Tileset URL to stream — undefined = no enriched renderer (stock Cesium OSM look). */
  url: string | undefined;
  /** OSM-mask + re-seat extent — null exactly when url is undefined. */
  bbox: GeoBbox | null;
  /** Resolved variant name (null for verbatim URLs). */
  variant: string | null;
  /** Owning registry region id (null when off). */
  regionId: string | null;
}

const toGeoBbox = (b: readonly [number, number, number, number]): GeoBbox => ({
  west: b[0],
  south: b[1],
  east: b[2],
  north: b[3],
});

/** The env URL's second-to-last path segment (…/enriched/<city>/tileset.json → "<city>"). */
function envAnchorSegment(envUrl: string | undefined): string | null {
  const m = envUrl?.match(/^(?:.*\/)?([^/]+)\/[^/]+$/);
  return m ? m[1] : null;
}

/** Swap the env URL's variant path segment (…/enriched/dnipro/tileset.json → …/<variant>/…). */
function swapVariant(envUrl: string | undefined, variant: string): string {
  if (envUrl) {
    const m = envUrl.match(/^(.*\/)[^/]+(\/[^/]+)$/);
    if (m) return `${m[1]}${variant}${m[2]}`;
  }
  return `/enriched/${variant}/tileset.json`;
}

/** The region the boot defaults to: the boot view's containing region wins (a #p= share into
 *  another baked city streams THAT city's best bake), else the env anchor, else the registry head. */
function defaultRegion(envUrl: string | undefined, bootLatDeg?: number, bootLonDeg?: number): BakedRegion {
  const byBoot =
    bootLatDeg !== undefined && bootLonDeg !== undefined
      ? regionContaining(bootLatDeg, bootLonDeg)
      : null;
  if (byBoot) return byBoot;
  const anchor = envAnchorSegment(envUrl);
  return (anchor && regionOfVariant(anchor)) || BAKED_REGIONS[0];
}

/** Resolve WHAT streams and WHERE the mask sits, in ONE call — the tileset URL and the mask/seat
 *  bbox must always derive from the same decision (the old two-resolver sync trap). */
export function resolveEnrichedSelection(
  envUrl: string | undefined,
  search: string,
  bootLatDeg?: number,
  bootLonDeg?: number,
): EnrichedSelection {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get("enriched");
  } catch {
    raw = null;
  }
  const region = defaultRegion(envUrl, bootLatDeg, bootLonDeg);
  const val = raw?.trim() ?? "";
  if (val === "") {
    // Default path: best variant of the boot region. No env URL → no enriched (dev without the
    // local middleware / prod without R2 stays byte-identical to the pre-enrichment app).
    if (!envUrl) return { url: undefined, bbox: null, variant: null, regionId: null };
    const variant = region.variants[0];
    return { url: swapVariant(envUrl, variant), bbox: toGeoBbox(region.bbox), variant, regionId: region.id };
  }
  if (/^(off|none|0)$/i.test(val)) return { url: undefined, bbox: null, variant: null, regionId: null };
  if (val.includes("/")) {
    return { url: val, bbox: toGeoBbox(region.bbox), variant: null, regionId: region.id };
  }
  const owner = regionOfVariant(val) ?? region;
  return { url: swapVariant(envUrl, val), bbox: toGeoBbox(owner.bbox), variant: val, regionId: owner.id };
}
