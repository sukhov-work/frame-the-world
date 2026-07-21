// Enriched-tileset A/B compare seam (OSM2World variant work, 2026-07-14).
//
// The Dnipro enrichment now has PARALLEL bakes (the default extruder bake `enriched/dnipro` and the
// OSM2World variant `enriched/dnipro-o2w` — scripts/bake/bake-osm2world.mjs). To compare them
// visually WITHOUT touching the default pipeline, the `?enriched=` URL search param overrides which
// tileset the globe streams, resolved once at boot:
//
//   (absent)                     → PUBLIC_ENRICHED_TILES_URL exactly as before (byte-identical default)
//   ?enriched=off|none|0         → no enriched tileset AND no OSM mask → the stock Cesium OSM look
//   ?enriched=dnipro-o2w         → the env URL with its variant path segment swapped
//                                  (…/enriched/dnipro/tileset.json → …/enriched/dnipro-o2w/tileset.json);
//                                  with no env URL set, falls back to the same-origin public dir
//                                  (/enriched/dnipro-o2w/tileset.json) — the local pre-upload A/B
//   ?enriched=<anything with "/"> → used verbatim (full URL or absolute path)
//
// The camera pose persists in the URL HASH (#p=…, lib/geo/urlPose.ts), which reloads survive — so a
// same-pose A/B is just the same link with a different ?enriched= value. Pure function; unit-tested.

// Type-only (erased at build) — the mask/seat extent resolved per variant (resolveEnrichedBbox).
import type { GeoBbox } from "./enrichedMask";

/** The OSM2World variant the UI toggle switches to (the `?enriched=` value; city-specific v1 —
 *  becomes per-city config if a second city ever bakes a variant). */
export const ENRICHED_VARIANT_NAME = "dnipro-o2w";

/** Is the o2w variant the active enriched source in this page's URL? */
export function isVariantActive(search: string, variant: string = ENRICHED_VARIANT_NAME): boolean {
  try {
    const v = new URLSearchParams(search).get("enriched");
    return v != null && (v === variant || v.includes(`/${variant}/`));
  } catch {
    return false;
  }
}

/** Persisted BLD chip (owner 2026-07-21): with NO `?enriched=` in the URL, a stored preference
 *  (lib/prefs `enrichedVariant`, written by the chip) injects the variant into the effective
 *  search — that's how the choice survives a plain reload of `/`. An explicit URL param (any
 *  value, including `off` and other variants) always wins verbatim. Pure — callers pass the
 *  stored flag in. */
export function applyStoredVariant(
  search: string,
  storedOn: boolean | undefined,
  variant: string = ENRICHED_VARIANT_NAME,
): string {
  if (!storedOn) return search;
  try {
    const params = new URLSearchParams(search);
    if (params.get("enriched") != null) return search;
    params.set("enriched", variant);
    return `?${params.toString()}`;
  } catch {
    return search;
  }
}

/** The same page URL with the variant EXPLICITLY on (param set) or off (param removed) — the hash
 *  (and with it the `#p=` camera pose) is preserved, so the reload lands at the identical view.
 *  The BLD chip drives this with the EFFECTIVE state (URL + stored pref): a blind param toggle
 *  would flip the wrong way when the pref, not the URL, made the variant active. */
export function setVariantUrl(href: string, on: boolean, variant: string = ENRICHED_VARIANT_NAME): string {
  const url = new URL(href);
  if (on) url.searchParams.set("enriched", variant);
  else url.searchParams.delete("enriched");
  return url.toString();
}

/** The same page URL with `?enriched=` toggled to/from the variant (URL-only view of the state). */
export function toggleVariantUrl(href: string, variant: string = ENRICHED_VARIANT_NAME): string {
  return setVariantUrl(href, !isVariantActive(new URL(href).search, variant), variant);
}

/** Resolve the enrichment mask/seat bbox for the active `?enriched=` value: a variant listed in
 *  `variantBboxes` (a bake over a DIFFERENT box — cross-city experiments, tuning.ts
 *  `ENRICHED.variantBboxes`) gets its own extent; everything else — no param, a same-box variant
 *  like dnipro-o2w, off, a verbatim URL — returns `defaultBbox` ITSELF (identity ⇒ the default
 *  path stays byte-identical). Off drops the mask anyway (`resolveEnrichedUrl` → undefined). */
export function resolveEnrichedBbox(
  defaultBbox: GeoBbox,
  search: string,
  variantBboxes: Readonly<Record<string, GeoBbox>>,
): GeoBbox {
  try {
    const v = new URLSearchParams(search).get("enriched")?.trim();
    if (v && variantBboxes[v]) return variantBboxes[v];
  } catch {
    /* malformed search → default */
  }
  return defaultBbox;
}

/** Resolve the enriched-tileset URL from the env default + the page's `location.search`. */
export function resolveEnrichedUrl(envUrl: string | undefined, search: string): string | undefined {
  const base = envUrl || undefined;
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get("enriched");
  } catch {
    raw = null;
  }
  if (raw == null || raw.trim() === "") return base;
  const val = raw.trim();
  if (/^(off|none|0)$/i.test(val)) return undefined;
  if (val.includes("/")) return val;
  if (base) {
    // Swap the second-to-last path segment: …/<variant>/<file> → …/<val>/<file>.
    const m = base.match(/^(.*\/)[^/]+(\/[^/]+)$/);
    if (m) return `${m[1]}${val}${m[2]}`;
  }
  return `/enriched/${val}/tileset.json`;
}
