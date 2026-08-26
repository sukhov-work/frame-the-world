// RC17 — the per-cell `.meta.json` sidecar: ONE schema, written by BOTH bakers.
//
// WHY A SIDECAR AT ALL. `_FEATURE_ID_0` is a float32 vertex attribute, exact only to 2^24; OSM way
// ids are ~10^9. The stable identity therefore cannot ride the geometry and needs its own channel.
// It is a per-cell file rather than a block inside `tileset.json` because cells stream and evict —
// a 40k-feature table inlined in the manifest would be downloaded in full for cells nobody visits,
// and the R2 worker deliberately gives `.json` a short 300 s cache so re-bakes are picked up fast.
//
// WHY IT IS UNIFIED. The two bakers shipped DIFFERENT shapes: the extruder wrote
// `{id, osm, base, height, heightSource}` with no class, the OSM2World adapter wrote
// `{id, osm, cls}` with no height. A runtime that consumed either one would silently no-op on the
// other variant — and both variants of the same city ship side by side (`regions.ts` `variants`),
// so the A/B seam would have behaved differently from the default. One schema, both writers.
//
// THE ROW
//   id     bake-local `_FEATURE_ID_0` — the key the runtime already has from a raycast hit
//   osm    stable OSM element id ("w141472295" / "r8705336" / "n7255825315"), or null
//   cls    OSM2World class token ("Building", "Wall", "StreetLamp", "HighVoltagePowerTower", …).
//          The extruder only ever bakes `building=*` footprints, so it writes "Building" for all
//          of them — which is what makes ONE runtime predicate (`cls === "Building"`) correct on
//          both variants instead of one predicate per baker.
//   base   TRUE ground-contact Y (m, baked local frame), BEFORE the RC13 skirt
//   top    highest Y (m) — with the roof, so `top - base` is the real rendered height
//   skirt  metres the geometry was lowered below `base` by RC13 (0 when the guards skipped it).
//          The runtime needs this to undo the skirt: the vertex minimum it can measure is
//          `base - skirt`, and a U8 rescale pivots on the base, not on the buried rim.
//   src    height provenance — "height" | "levels" | "class" | "default" (extruder) | "o2w"
//
// `base`/`top` are MEASURED from the emitted vertices in both bakers rather than re-derived from
// tags. The extruder's `params.height` is the EAVE and the roof rides above it (see
// `inferBuilding`), so a tag-derived "height" would understate every gabled building — and the
// adapter has no tags at all. Measuring is the only definition that means the same thing on both
// sides, which is the whole point of unifying the schema.

/** Bumped whenever a field's MEANING changes. The runtime refuses a schema it does not know. */
export const META_SCHEMA = 2;

/**
 * Min/max Y over `positions` (a flat [x,y,z,…] array) from vertex index `fromVert` to the end.
 * Returns `null` for an empty range — a feature that emitted no triangles has no extent.
 */
export function yExtent(positions, fromVert = 0) {
  let lo = Infinity, hi = -Infinity;
  for (let i = fromVert * 3 + 1; i < positions.length; i += 3) {
    const y = positions[i];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return lo === Infinity ? null : { lo, hi };
}

/**
 * One sidecar row. `lo`/`hi` are the feature's emitted Y extent — `lo` is already skirted, so the
 * true base is `lo + skirt`. Rounded to the millimetre: these ride the wire per feature and the
 * runtime only ever compares them against metre-scale thresholds.
 */
export function metaRow({ id, osm, cls, lo, hi, skirt, src }) {
  const r = (x) => Math.round(x * 1000) / 1000;
  return { id, osm: osm ?? null, cls, base: r(lo + skirt), top: r(hi), skirt: r(skirt), src };
}

/** The whole sidecar for one cell. */
export function cellMetaJson({ variant, skirtM, features }) {
  return JSON.stringify({ schema: META_SCHEMA, variant, skirtM, features });
}
